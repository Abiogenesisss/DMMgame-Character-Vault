'use strict';
const path=require('node:path');
const {csvRows}=require('./csv.ts');
const {compileProgram}=require('./story-program.ts');
function parseStory(bytes, address, catalog) {
  if(bytes.length>8*1024*1024)throw new Error('剧情脚本超过大小限制。');
  const rows=csvRows(new TextDecoder('utf8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
  const name=path.posix.basename(address,'.txt'),owner=/^(?:hmr|hmn|men)_(1\d{8})\d{2}$/.exec(name)?.[1]||null;
  const program=compileProgram(bytes,address,catalog);
  const commands=[],assets=new Set<string>(),characters=new Set(owner?[owner]:[]),names={},actors=new Map(),loaded=new Map(),models=new Map();
  const candidates=Object.values<any>(catalog.assets),resources={},voices={};
  const match=(predicate)=>{const found=candidates.filter(predicate);if(found.length!==1)return null;assets.add(found[0].address);return found[0].address;};
  const byName=(base,type)=>match(asset=>asset.type===type&&path.posix.basename(asset.address).replace(/\.[^.]+$/,'')===base);
  const portrait=id=>match(asset=>asset.type==='UnityEngine.GameObject'&&asset.address.endsWith('/CharaStand'+id+'.prefab')&&asset.address.includes('/CharaStand/Novel/Prefabs/'));
  const bank=byName(name,'CriWare.Assets.CriAtomAcbAsset');
  let background=null,activeModel=null;
  for(const [command,...args] of rows){
    const verb=command.replace(/^async/,'');
    if(verb==='charaload'){
      const id=args[1],reference=portrait(id);if(reference)loaded.set(args[0],{reference,id});
      const role=/^(1\d{8})[GX]$/.exec(id||'')?.[1];
      if(role&&catalog.characters.some(item=>item.id===role))characters.add(role);
      if(role&&owner&&role.slice(0,6)===owner.slice(0,6)&&args[2]&&!/[<>]/.test(args[2]))names[owner]=args[2];
    } else if(verb==='bg'){
      const next=byName(args[0],'UnityEngine.Sprite')||byName(args[0],'UnityEngine.Texture2D');
      if(background)commands.push({command:'image_delete',args:[background]});background=next;
      commands.push({command:'spine',args:[null]});if(next)commands.push({command:'image',args:[next]});
    } else if(['charashow','charashowalpha','charamove'].includes(verb)){
      const actor=loaded.get(args[0]);if(actor)actors.set(args[0],{reference:actor.reference,position:3,talking:false});
    } else if(verb==='charahide')actors.delete(args[0]);
    else if(verb==='cleanall'){actors.clear();commands.push({command:'spine',args:[null]});}
    else if(verb==='bgmplay'){
      const reference=byName(args[1],'CriWare.Assets.CriAtomAcbAsset');commands.push({command:'music',args:[reference]});
    } else if(verb==='bgmstop')commands.push({command:'music',args:[null]});
    else if(verb==='seplay'){
      const reference=byName(args[1]||args[0],'CriWare.Assets.CriAtomAcbAsset');if(reference)commands.push({command:'sound',args:[reference]});
    } else if(/^(?:l2d|live2d)load$/.test(verb)){
      const id=args.find(value=>/^l2d_\d+$/.test(value));const reference=id&&byName(id,'UnityEngine.GameObject');if(reference)models.set(args[0],reference);
    } else if(/^(?:l2d|live2d)show$/.test(verb)){
      const reference=models.get(args[0])||byName(args[0],'UnityEngine.GameObject');if(reference){activeModel=reference;commands.push({command:'spine',args:[reference]});}
    } else if(/^(?:l2d|live2d)(?:play|motion)$/.test(verb)){
      const animation=args.find(value=>/^scene\d+(?:_loop)?$/.test(value));if(activeModel&&animation)commands.push({command:'spine_play',args:[animation,'true']});
    } else if(/^(?:l2d|live2d)hide$/.test(verb)){activeModel=null;commands.push({command:'spine',args:[null]});
    } else if(['message','l2dmessage','messageTextCenter','messageTextUnder'].includes(verb)){
      const cue=args[3],voice=bank&&cue?bank+'#'+cue:null;
      commands.push({command:'actors',args:[[...actors.entries()].map(([key,actor])=>({...actor,talking:key===args[4]}))]});
      commands.push({command:'mess',args:[args[0]||'',args[1]||'',voice]});
    }
  }
  if(!commands.some(value=>value.command==='mess'))throw new Error('没有可识别的剧情对白。');
  return {id:'dotabyss-'+name,name,title:(owner?'角色剧情 ':'剧情 ')+name,character:owner,characters:[...characters],names,address,format:'dotabyss',adult:name.startsWith('hmr_'),
    commands,program,hasCg:program.hasCg,assets:program.assets,resources,voices};
}
export { parseStory };
