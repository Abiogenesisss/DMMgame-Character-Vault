import { renameFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadPack,routeKey,sha256}=require('../../../app/pack.ts');
const {readCatalog,readJson,writeJson}=require('./catalog.ts');
const {parseStory}=require('./story.ts');
const {acbAudio}=require('./cri.ts');
const {runUnity}=require('./unity.ts');
const {cgChapterAddresses}=require('./story-program.ts');
const {readStoryUi}=require('./story-ui.ts');
const {completeStories}=require('./complete-story.ts');
function voiceLabel(code) {
  const rules: [RegExp, string, string][]=[[/^battle_/,'battle','战斗'],[/^(affection|level|limit|mastery|skill)_/,'growth','养成'],[/^(birthday|christmas|newyear|valentine|summer|halloween)_/,'season','季节']];
  const [,group,groupLabel]=rules.find(([pattern])=>pattern.test(code))||[null,'daily','日常'];
  const labels={battle_defeat:'战斗失败',battle_victory:'战斗胜利',title_call:'标题',welcome:'欢迎',login:'登录'};
  return {code,label:labels[code]||code,group,groupLabel};
}
async function extract(root,progress: (...args: any[]) => any=()=>{},{roles,scope='all',exportResources=runUnity}: any={}) {
  const catalog=readCatalog(root),pack=loadPack(path.join(root,'cache')),output=path.join(root,'library'),cacheFile=path.join(root,'metadata/exports.json');
  const cache=readJson(cacheFile,{}),issues=[],requests=[],queued=new Set<string>(),fingerprints=new Map(),validated=new Map();
  const exists=file=>typeof file==='string'&&!path.isAbsolute(file)&&!file.split(/[\\/]/).includes('..')&&fs.existsSync(path.join(output,file));
  const intact=value=>value&&(value.image?exists(value.image.file)&&(!value.address?.includes('/CharaStand/Novel/Prefabs/')||value.image.exportVersion===2):value.effect?exists(value.effect.file)&&value.effect.files.every(exists):value.script?exists(value.script.file):value.ui?value.ui.exportVersion===4&&value.ui.files?.every(exists):value.bank?exists(value.bank.file)&&(!value.bank.externalFile||exists(value.bank.externalFile))&&value.audio?.every(item=>exists(item.file)):value.model?value.model.exportVersion>=6&&exists(value.model.materials)&&value.model.files?.length&&value.model.files.every(exists):false);
  function bankAudio(value){
    value.audio=acbAudio(fs.readFileSync(path.join(output,value.bank.file)),value.bank.externalFile?fs.readFileSync(path.join(output,value.bank.externalFile)):undefined).map(clip=>{
      const digest=sha256(clip.data),file='audio/'+digest+'.'+clip.extension;fs.mkdirSync(path.join(output,'audio'),{recursive:true});
      if(!fs.existsSync(path.join(output,file)))fs.writeFileSync(path.join(output,file),clip.data);
      return {...voiceLabel(clip.code),file,bytes:clip.data.length,waveId:clip.waveId,loop:!!clip.loop,duration:clip.duration};
    });value.audioVersion=2;
  }
  for(const value of Object.values<any>(cache))if(value.bank&&value.audioVersion!==2&&intact(value))bankAudio(value);
  function inputs(address) {
    if(fingerprints.has(address))return fingerprints.get(address);
    const spec=catalog.assets[address];if(!spec?.bundles?.length)return null;const records=[];
    for(const url of spec.bundles){
      const record=pack.manifest.routes[routeKey('GET',url)]?.at(-1),file=record&&path.join(pack.root,'bodies',record.body);
      if(!record||record.status!==200||!existsPack(file,record))return null;
      records.push({input:file,body:record.body,streaming:/\.awb_[a-f0-9]+\.bundle$/.test(url)});
    }
    const value={inputs:records.filter(item=>!item.streaming).map(item=>item.input),banks:records.filter(item=>item.streaming).map(item=>item.input),fingerprint:sha256(Buffer.from('dotabyss-v1:'+spec.type+':'+spec.internalId+':'+records.map(item=>item.body).join(':')))};
    fingerprints.set(address,value);return value;
  }
  function existsPack(file,record){
    if(!/^[a-f0-9]{64}$/.test(record.body))return false;
    if(validated.has(record.body))return validated.get(record.body);
    const okay=fs.existsSync(file)&&fs.statSync(file).size===record.size&&sha256(fs.readFileSync(file))===record.body;
    validated.set(record.body,okay);return okay;
  }
  // A new version changes bundle URLs even for existing exports. Keep intact
  // local files visible until their replacements have actually been downloaded.
  function saved(address){const value=cache[address];return intact(value)?value:null;}
  function queue(address,kind){
    if(queued.has(address)||!catalog.assets[address])return;queued.add(address);const source=inputs(address),local=saved(address),previousSaved=source&&local?.fingerprint===source.fingerprint?local:null;
    const sceneIntact=previousSaved?.scene?.version===2&&exists(previousSaved.scene.file)&&previousSaved.scene.files.every(exists);
    const motionIntact=kind!=='motions'||previousSaved?.model?.motionVersion===2&&previousSaved.model.renderVersion===2;
    if(!source||(previousSaved&&motionIntact&&(kind!=='story-actors'||sceneIntact)&&(kind!=='story-emotions'||Array.isArray(previousSaved.image?.origin))))return;
    const previous=cache[address];
    // Animation/material migrations reuse verified MOC and textures locally.
    if(kind==='motions'&&previous?.fingerprint===source.fingerprint&&previous.model?.exportVersion>=5&&previous.model.files?.length&&previous.model.files.every(exists)){
      requests.push({...catalog.assets[address],...source,kind:previous.model.motionVersion===2?'materials':'motion-data',model:previous.model});return;
    }
    requests.push({...catalog.assets[address],...source,kind});
  }
  const chosen=catalog.characters.filter(character=>!roles||roles.includes(character.id));
  const chapters=new Set<string>(catalog.characters.flatMap(cgChapterAddresses));
  for(const character of chosen){
    if(scope!=='stories')queue(character.icon,'icons');
    if(['all','portraits'].includes(scope))character.portraits.forEach(address=>queue(address,scope==='all'?'story-actors':'portraits'));
    if(['all','cg','motions'].includes(scope)){character.cg.forEach(address=>queue(address,'cg'));character.motions.forEach(address=>queue(address,'motions'));}
    if(['all','voices'].includes(scope))character.voices.forEach(voice=>queue(voice.address,'voices'));
    if(['all','catalog','stories'].includes(scope))(scope==='catalog'?character.stories:cgChapterAddresses(character)).forEach(address=>queue(address,'stories'));
  }
  async function exportQueue(){
    const pending=requests.splice(0);
    for(let start=0;start<pending.length;start+=35){
      const result=await exportResources({output,assets:pending.slice(start,start+35)});
      for(const value of result.resources||[]){
        try{
          if(value.bank)bankAudio(value);
          cache[value.address]=value;
        }catch(error){issues.push({resource:value.address,error:error.message});}
      }
      issues.push(...(result.issues||[]).map(value=>({resource:value.address,error:value.error})));
      writeJson(cacheFile,cache);progress({state:'extracting',message:'正在整理 DOTABYSS 角色素材…',checked:Math.min(start+35,pending.length),targets:pending.length});
    }
  }
  await exportQueue();
  function scenarios(){return catalog.characters.flatMap(character=>character.stories.flatMap(address=>{
    const script=saved(address)?.script;if(!script)return [];
    try{return [parseStory(fs.readFileSync(path.join(output,script.file)),address,catalog)];}
    catch(error){issues.push({resource:address,error:error.message});return [];}
  }));}
  let stories=scenarios();
  if(['all','stories'].includes(scope)){
    for(const story of stories.filter(item=>chapters.has(item.address)&&(!roles||roles.includes(item.character))))for(const address of story.assets){
      const type=catalog.assets[address]?.type;
      queue(address,type==='CriWare.Assets.CriAtomAcbAsset'?(path.posix.basename(address,'.acb')===story.name?'story-voices':/bgm/i.test(address)?'music':'sound'):type==='UnityEngine.GameObject'?(/\/l2d_/.test(address)?'motions':address.includes('/Effects/Novel/')?'story-effects':address.includes('/CharaStand/Novel/')?'story-actors':address.includes('/Emotion/CharaStand/')?'story-emotions':'portraits'):'background');
    }
    await exportQueue();stories=scenarios();
  }
  const names=readJson(path.join(root,'metadata/characters.json'),{});
  for(const [id,value] of Object.entries<any>(names))if(!value.source?.includes('/hmn_'+id)&&!value.source?.includes('/hmr_'+id)&&!value.source?.includes('/men_'+id))delete names[id];
  for(const story of [...stories].sort((a,b)=>Number(a.adult)-Number(b.adult)))for(const [id,name] of Object.entries<any>(story.names)){
    if(names[id]?.name&&names[id].name!==name)continue;
    names[id]={...names[id],name,source:story.address};
  }
  writeJson(path.join(root,'metadata/characters.json'),names);
  const index: { version: number; game: string; characters: any[]; images: any[]; audio: any[]; stories: any[]; skeletons: any[]; issues: any[]; stats?: Record<string, number>; storyUi?: any; generated?: string; }={version:1,game:'dotabyss',characters:[],images:[],audio:[],stories:[],skeletons:[],issues:[]};
  function image(address,character,category){const value=saved(address)?.image;if(!value)return null;const item={...value,id:sha256(Buffer.from(character+':'+address)),character,category,resource:address};index.images.push(item);return item;}
  for(const character of catalog.characters){
    const icon=image(character.icon,character.id,'icon'),portraits=character.portraits.flatMap(address=>{
      const value=image(address,character.id,'portrait'),variant=/([GX])\.prefab$/.exec(address)?.[1]||'base';
      return value?[{file:value.file,phase:variant,label:'立绘 '+variant,resource:address}]:[];
    });
    const cg=character.cg.flatMap(address=>{const value=image(address,character.id,'cg');return value?[value]:[];});
    const motions=character.motions.flatMap(address=>{const model=saved(address)?.model;if(!model)return [];const value={...model,id:sha256(Buffer.from(address)),character:character.id,resource:address,kind:'cg',label:'动态 CG'};index.skeletons.push(value);return [value];});
    for(const voice of character.voices)for(const clip of saved(voice.address)?.audio||[])index.audio.push({...clip,id:sha256(Buffer.from(character.id+':'+voice.address+':'+clip.code)),character:character.id,resource:voice.address,context:'character',category:'character-voice'});
    index.characters.push({id:character.id,name:names[character.id]?.name||'角色 '+character.id,rarityId:null,rarityLabel:'未标注',icon:icon?.file||null,portraits,cg,motions:motions.map(item=>item.id),hasDynamicCg:motions.length>0,
      cgAvailable:character.motions.length+character.cg.length>0,portraitTotal:character.portraits.length,voiceAvailable:character.voices.length>0,storyAvailable:cgChapterAddresses(character).length>0,
      collected:!!(portraits.length||cg.length||motions.length||index.audio.some(item=>item.character===character.id)),stories:[]});
  }
  const storyUi=readStoryUi(root);
  // Catalog pulls also cache one script for identifying a character. Only
  // enroll owners requested for story collection (plus existing collections).
  const enrolled=new Set<string>(readJson(path.join(root,'metadata/story-owners.json'),readJson(path.join(output,'index.json'),{stories:[]}).stories.map(s=>s.character).filter(Boolean)));
  if(['all','stories'].includes(scope))for(const role of chosen)if(role.stories.some(address=>saved(address)?.script))enrolled.add(role.id);
  writeJson(path.join(root,'metadata/story-owners.json'),[...enrolled]);
  for(const story of completeStories(stories.filter(story=>enrolled.has(story.character)&&chapters.has(story.address)),catalog).filter(story=>story.hasCg)){
    for(const address of story.assets){const value=saved(address);if(!value)continue;
      const file=value.image?.file||value.model?.file||value.audio?.[0]?.file;if(file)story.resources[address]=file;
      for(const clip of value.audio||[]){story.voices[address+'#'+clip.code]=clip.file;
        if(story.segments.some(segment=>path.posix.basename(segment,'.txt')===path.posix.basename(address,'.acb')))index.audio.push({...clip,id:sha256(Buffer.from(story.id+':'+clip.code)),resource:address,context:'story',category:'story-voice',scene:story.id,characters:story.characters});}
      if(value.model&&!index.skeletons.some(item=>item.file===value.model.file))index.skeletons.push({...value.model,id:sha256(Buffer.from(address)),resource:address,kind:'story'});
    }
    story.ui=storyUi?.file||null;
    story.audio=Object.fromEntries(Object.entries<any>(story.program.audio).map(([key,reference])=>{const bank=saved(reference.bank),clip=reference.cue?bank?.audio?.find(clip=>clip.code===reference.cue):bank?.audio?.[0];return [key,{...reference,file:clip?.file||null,loop:!!clip?.loop,duration:clip?.duration}];}));
    story.models=Object.fromEntries(Object.entries<any>(story.program.models).flatMap(([key,address])=>{const model=saved(address)?.model;return model?[[key,model]]:[];}));
    story.effects=Object.fromEntries(story.assets.flatMap(address=>saved(address)?.effect?[[address,saved(address).effect]]:[]));
    story.emotions=Object.fromEntries(story.assets.filter(address=>address.includes('/Emotion/CharaStand/')).flatMap(address=>saved(address)?.image?[[address,saved(address).image]]:[]));
    story.actors=Object.fromEntries(Object.entries<any>(story.program.actors||{}).map(([key,actor])=>{const value=saved(actor.resource),icon=saved(actor.iconResource)?.image?.file||index.characters.find(c=>actor.id.startsWith(c.id))?.icon;return [key,{...actor,file:value?.image?.file||null,scene:value?.scene?.file||null,icon}];}));
    story.icons=Object.fromEntries(Object.values<any>(story.actors).filter(a=>a.name&&a.icon).map(a=>[a.name,a.icon]));
    story.missingAssets=story.assets.filter(address=>!saved(address));
    if(!storyUi)story.missingAssets.push(require('./story-program.ts').UI_SCENE);
    story.complete=story.expectedSegments.length===story.segments.length&&!story.missingAssets.length&&!story.program.missing?.length&&Object.values<any>(story.audio).every(a=>a.file)&&Object.values<any>(story.actors).every(a=>a.file);
    const file='stories/'+story.id+'.json';writeJson(path.join(output,file),story);
    const script=story.segments.length===1?saved(story.address).script.file:'scripts/'+story.id+'-complete.txt';
    if(story.segments.length>1){fs.mkdirSync(path.join(output,'scripts'),{recursive:true});fs.writeFileSync(path.join(output,script)+'.tmp',story.segments.map(address=>fs.readFileSync(path.join(output,saved(address).script.file),'utf8')).join('\n'));renameFileSync(path.join(output,script)+'.tmp',path.join(output,script));}
    const metadata={id:story.id,title:story.title,character:story.character,characters:[story.character],file,script,scriptFormat:'txt',format:'dotabyss',hasCg:story.hasCg,complete:story.complete,segments:story.segments.length,programVersion:2,adult:story.adult,dialogue:story.program.dialogue,voiceFiles:[...new Set(Object.values<any>(story.audio).filter(a=>a.cue&&a.file).map(a=>a.file))]};
    index.stories.push(metadata);for(const character of index.characters)if(story.character===character.id){character.stories.push(story.id);character.collected=true;}
  }
  index.issues=issues.map(issue=>({...issue,character:issue.character||catalog.characters.find(character=>[character.icon,...character.portraits,...character.cg,...character.motions,...character.stories,...character.voices.map(item=>item.address)].includes(issue.resource))?.id}));
  index.stats={characters:index.characters.length,named:index.characters.filter(item=>!item.name.startsWith('角色 ')).length,icons:index.characters.filter(item=>item.icon).length,collected:index.characters.filter(item=>item.collected).length,
    portraits:index.images.filter(item=>item.category==='portrait').length,cg:index.images.filter(item=>item.category==='cg').length,dynamicCg:index.skeletons.filter(item=>item.kind==='cg').length,characterVoices:index.audio.filter(item=>item.context==='character').length,stories:index.stories.length,issues:index.issues.length};
  index.storyUi=storyUi;
  index.generated=new Date().toISOString();writeJson(path.join(output,'index.json'),index);
  // These are derived playback documents, not source scripts or shared media.
  // Prune only our own filenames after publishing the new authoritative index.
  const storyFolder=path.resolve(output,'stories'),keep=new Set(index.stories.map(story=>path.basename(story.file)));
  if(fs.existsSync(storyFolder)&&fs.realpathSync(storyFolder).toLowerCase()===storyFolder.toLowerCase())for(const entry of fs.readdirSync(storyFolder,{withFileTypes:true})){
    if(entry.isFile()&&/^dotabyss-(?:hmn|hmr|men)_1\d{10}\.json$/.test(entry.name)&&!keep.has(entry.name))fs.unlinkSync(path.join(storyFolder,entry.name));
  }
  progress({state:'ready',message:'DOTABYSS 资源库已更新。',stats:index.stats});return index;
}
if(require.main===module){const root=process.env.RESOURCE_PROJECT_DIR||path.resolve(__dirname,'../../../parsed-data/dotabyss');require('../../../app/projects.ts').withPackLock(root,()=>extract(root)).then(index=>console.log(JSON.stringify(index.stats))).catch(error=>{console.error(error.message);process.exitCode=1;});}
export { extract, voiceLabel };
