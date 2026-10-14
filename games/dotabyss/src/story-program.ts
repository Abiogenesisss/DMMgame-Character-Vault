'use strict';
const path=require('node:path');
const {csvRows}=require('./csv.ts');
const UI_SCENE='Assets/Project/LazyAssets/Scenes/Novel.unity';
const SUPPORTED=new Set(['fade','l2dshow','l2dhide','l2dmotion','charaload','adultui','uivisible','window','bgmplay','bgmstop','bgvplay','bgvstop','seplay','sestop','message','l2dmessage','wait','waitorclick','asyncwait','asyncstopwait','cleanall','bg','scale','move','camerazoom','cameramove','blur','colorfade','crossfadeready','crossfade','transitionFade','transitionCrossFadeReady','transitionCrossFade','screeneffect']);
for(const op of ['segment','live2dinit','initend','labeljump','cleanskip','charamove','charascale','charashow','charashowalpha','charahide','charaface','charapose','charaitem','charafocuson','charafocusonall','charareaction','charaemo','emodelete','charaMask','charaColor','silhouette','changematerial','jump','shake','shakeall','shakeallstop','priority','subimage','subimagefade','subimagedelete','seplayIngame','popupbgfade','bgcolor','title','messagetextwindow','messageTextCenter','messageTextUnder','linework','prefabloadUI','prefabshowUI','prefabshowAll','prefabhideall','prefabdeleteui','item','asyncskipwait'])SUPPORTED.add(op);
function cgStoryAddresses(character){
  const models=new Set<string>((character.motions||[]).map(address=>/\/(hmr_\d+)\//.exec(address)?.[1]).filter(Boolean));
  return (character.stories||[]).filter(address=>models.has(path.posix.basename(address,'.txt'))||(character.cg||[]).some(cg=>cg.includes('/'+path.posix.basename(address,'.txt')+'/')));
}
function cgChapterAddresses(character){
  const cg=new Set<string>(cgStoryAddresses(character)),chapters=new Set([...cg].map(address=>/^(hmr_\d{10})[123]$/.exec(path.posix.basename(address,'.txt'))?.[1]).filter(Boolean));
  return (character.stories||[]).filter(address=>cg.has(address)||chapters.has(/^(hmr_\d{10})[123]$/.exec(path.posix.basename(address,'.txt'))?.[1]));
}
function compileProgram(bytes,address,catalog){
  if(bytes.length>8*1024*1024)throw new Error('剧情脚本超过大小限制。');
  const rows=csvRows(new TextDecoder('utf8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
  const assets=new Set<string>(),unsupported=new Set<string>(),audio={},assetsByName=new Map(),models={},actors={},commands=[],missing=[];
  const cgAssets=new Set<string>((catalog.characters||[]).flatMap(role=>role.cg||[]));
  for(const asset of Object.values<any>(catalog.assets)){
    const key=asset.type+':'+path.posix.basename(asset.address).replace(/\.[^.]+$/,'');
    if(!assetsByName.has(key))assetsByName.set(key,asset.address);else assetsByName.set(key,null);
  }
  function find(name,type){
    let result=assetsByName.get(type+':'+path.posix.basename(name||'').replace(/\.(?:png|prefab|acb)$/,''));
    if(!result&&name?.includes('/')){const matches=Object.values<any>(catalog.assets).filter(a=>a.type===type&&a.address.replace(/\.[^.]+$/,'').endsWith('/'+name.replace(/\.(?:png|prefab|acb)$/, '')));if(matches.length===1)result=matches[0].address;}
    if(result)assets.add(result);return result||null;
  }
  const name=path.posix.basename(address,'.txt'),voiceBank=find(name,'CriWare.Assets.CriAtomAcbAsset');
  const bgvBank=find(name+'_bgv','CriWare.Assets.CriAtomAcbAsset');
  let hasCg=false,dialogue=0;
  for(const [op,...args]of rows){
    const asynchronous=op.startsWith('async')&&!['asyncwait','asyncstopwait','asyncskipwait'].includes(op),verb=asynchronous?op.slice(5):op;
    const action: { op: any; args: any; source: number; async: boolean; delay?: number; skipMode?: string; resource?: string; audioKey?: string; placeholder?: boolean; cue?: string; dialogue?: number; speaker?: string; text?: string; actor?: string; label?: boolean; }={op:verb,args,source:commands.length,async:asynchronous};
    if(asynchronous){const mode=args.findIndex(value=>value==='STOP'||value==='CONT');action.delay=mode>=0?Math.max(0,Number(args[mode+1])||0):0;action.skipMode=mode>=0?args[mode]:'STOP';}
    if(verb==='l2dshow'){action.resource=find(args[0],'UnityEngine.GameObject');models[args[0]]=action.resource;hasCg=!!action.resource||hasCg;}
    if(verb==='bg'){action.resource=find(args[0],'UnityEngine.Sprite')||find(args[0],'UnityEngine.Texture2D');hasCg=cgAssets.has(action.resource)||hasCg;}
    if(verb==='charaload'){
      action.resource=find('CharaStand'+args[1],'UnityEngine.GameObject');const icon=find('DotNovelCharaIcon'+args[1],'UnityEngine.GameObject')||find('DotNovelCharaIcon'+args[1]?.replace(/G$/,'X'),'UnityEngine.GameObject');
      actors[args[0]]={resource:action.resource,iconResource:icon,id:args[1],name:args[2]||''};
    }
    if(verb==='subimage'||verb==='item')action.resource=find(args[verb==='item'?1:0],'UnityEngine.Sprite')||find(args[verb==='item'?1:0],'UnityEngine.Texture2D');
    if(verb==='prefabloadUI'||verb==='prefabshowAll')action.resource=find(args[1],'UnityEngine.GameObject');
    if(verb==='charaemo')action.resource=find('Emo_'+args[1],'UnityEngine.GameObject');
    if(['bgmplay','seplay','seplayIngame'].includes(verb)){
      action.resource=find(args[1],'CriWare.Assets.CriAtomAcbAsset');action.audioKey=verb==='seplayIngame'?args[1]+'#'+args[2]:args[1];
      if(args[1]==='SE_DUMMY')action.placeholder=true;
      if(action.resource)audio[action.audioKey]={bank:action.resource,cue:verb==='seplayIngame'?args[2]:null};
    }
    if(verb==='bgvplay'){action.resource=bgvBank;action.cue=args[1];if(bgvBank)audio[args[1]]={bank:bgvBank,cue:args[1]};}
    if(['message','l2dmessage','messageTextCenter','messageTextUnder'].includes(verb)){
      action.dialogue=dialogue++;action.speaker=args[0]||'';action.text=args[1]||'';action.resource=voiceBank;action.cue=args[3]||null;
      action.actor=args[4]||Object.keys(actors).find(key=>actors[key].name===action.speaker)||null;
      if(voiceBank&&action.cue)audio[action.cue]={bank:voiceBank,cue:action.cue};
    }
    if(verb.startsWith(':'))action.label=true;
    else if(!SUPPORTED.has(verb))unsupported.add(op);
    commands.push(action);
  }
  for(const action of commands)if(['bg','charaload','l2dshow','subimage','bgmplay','bgvplay','seplay','seplayIngame','charaemo','prefabshowAll','prefabloadUI'].includes(action.op)&&!action.resource&&!action.placeholder)missing.push({op:action.op,source:action.source});
  const labels=new Set(commands.filter(c=>c.label).map(c=>c.op.slice(1)));for(const action of commands)if(action.op==='labeljump'&&!labels.has(action.args[0]))throw new Error('剧情跳转目标不存在：'+action.args[0]);
  return {version:2,frame:{width:1920,height:1080},hasCg,dialogue,commands,assets:[...assets],models,actors,audio,ui:UI_SCENE,unsupported:[...unsupported],missing};
}
export { UI_SCENE, SUPPORTED, cgStoryAddresses, cgChapterAddresses, compileProgram };
