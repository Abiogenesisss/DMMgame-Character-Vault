'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadPack,routeKey,sha256}=require('../../../app/pack.ts');
const {BASE}=require('./format.ts');
const {readCatalog,readJson,writeJson}=require('./catalog.ts');
const {parseStory}=require('./story.ts');
const {acbAudio}=require('./cri.ts');
const runUnity=request=>require('./unity.ts').runUnity(request,{worker:path.join(__dirname,'../python/export_unity.py'),pythonEnv:'GIRLSCREATION_PYTHON'});
function kind(name){
  if(/(?:^|\/)e[sm]m_40[12]\d{5}_\d+\.(?:mp4|webm)$/.test(name))return 'video';
  if(/^notinit\/novelchara_(?:main|sub)_r18\/h[ms]r_\d{8}_image\.dmm$/.test(name))return 'movies';
  if(/^notinit\/standing_spine\/st\d+\.dmm$/.test(name))return 'model';
  if(/^notinit\/novelchara_(?:main|sub)(?:_r18)?\/h[ms][nr]_\d+\.dmm$/.test(name))return 'script';
  if(/_voice\.dmm$/.test(name)||/^(?:notinit\/voice|sound\/(?:bgm|se|novel_se))\//.test(name))return 'bank';
  if(/^(?:image_(?:sub_)?unit_(?:icon|full)|notinit\/image_novel_(?:background|transition))\//.test(name))return 'image';
  return null;
}
async function extract(root,progress: (...args: any[]) => any=()=>{},{roles,scope='all',exportResources=runUnity}: any={}){
  const catalog=readCatalog(root),pack=loadPack(path.join(root,'cache')),output=path.join(root,'library'),cacheFile=path.join(root,'metadata/exports.json'),cache=readJson(cacheFile,{}),issues=[];
  const exists=file=>typeof file==='string'&&!path.isAbsolute(file)&&!file.split(/[\\/]/).includes('..')&&fs.existsSync(path.join(output,file));
  const intact=value=>value&&(value.image?exists(value.image.file):value.model?value.model.files.every(exists):value.script?exists(value.script.file):value.video?exists(value.video.file):value.movies?value.exportVersion===1&&value.movies.length&&value.movies.every(m=>exists(m.file)):value.bank?exists(value.bank.file)&&Array.isArray(value.audio)&&value.audio.every(a=>exists(a.file)):false);
  const chosen=catalog.characters.filter(c=>!roles||roles.includes(c.id)),wanted=new Set<string>();
  for(const role of chosen){
    if(role.icon)wanted.add(role.icon);
    if(['all','portraits'].includes(scope))role.portraits.forEach(n=>wanted.add(n));
    if(['all','voices'].includes(scope))role.voices.forEach(n=>wanted.add(n));
    if(['all','cg','motions','stories'].includes(scope))[...(role.videos||[]),...(role.movieBundles||[])].forEach(n=>wanted.add(n));
    if(['all','stories'].includes(scope))role.stories.forEach(n=>{wanted.add(n);wanted.add(n.replace(/\.dmm$/,'_voice.dmm'));});
  }
  // Re-read prefab geometry from already cached models after the scale fix.
  for(const [name,value]of Object.entries<any>(cache))if(value.model?.exportVersion===1){wanted.add(name);value.fingerprint=null;}
  async function exportNames(names){
    const requests=[];
    for(const name of names){
      const type=kind(name),record=pack.manifest.routes[routeKey('GET',BASE+name)]?.at(-1);if(!type||!record||record.status!==200||!/^[a-f0-9]{64}$/.test(record.body))continue;
      if(cache[name]?.fingerprint===record.body&&intact(cache[name]))continue;
      const input=path.join(pack.root,'bodies',record.body);if(!fs.existsSync(input)||sha256(fs.readFileSync(input))!==record.body){issues.push({resource:name,error:'已保存素材校验失败。'});continue;}
      if(type==='video'){
        const bytes=fs.readFileSync(input),extension=path.posix.extname(name);
        if(extension==='.mp4'?(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp'):(bytes.length<4||bytes.readUInt32BE(0)!==0x1a45dfa3)){issues.push({resource:name,error:'CG 视频格式无效。'});continue;}
        const file='videos/'+record.body+extension;fs.mkdirSync(path.join(output,'videos'),{recursive:true});if(!exists(file))fs.copyFileSync(input,path.join(output,file));cache[name]={name,fingerprint:record.body,video:{file}};continue;
      }
      requests.push({name,kind:type,input,fingerprint:record.body});
    }
    for(let at=0;at<requests.length;at+=32){
      const result=await exportResources({output,assets:requests.slice(at,at+32)});
      for(const value of result.resources||[])try{
        if(value.model)Object.assign(value.model,require('./spine.ts').spineMetadata(fs.readFileSync(path.join(output,value.model.file))));
        if(value.bank)value.audio=acbAudio(fs.readFileSync(path.join(output,value.bank.file))).map(clip=>{
          const file='audio/'+sha256(clip.data)+'.'+clip.extension;fs.mkdirSync(path.join(output,'audio'),{recursive:true});if(!exists(file))fs.writeFileSync(path.join(output,file),clip.data);
          return {file,code:clip.code,duration:clip.duration,loop:!!clip.loop};
        });
        cache[value.name]=value;
      }catch(error){issues.push({resource:value.name,error:error.message});}
      issues.push(...(result.issues||[]));writeJson(cacheFile,cache);progress({state:'extracting',message:'正在整理少女艺术绮谭素材…',checked:Math.min(at+32,requests.length),targets:requests.length});
    }
    writeJson(cacheFile,cache);
  }
  await exportNames(wanted);
  const saved=name=>intact(cache[name])?cache[name]:null;
  function stories(){const values=[];for(const name of new Set<string>(catalog.characters.flatMap(role=>role.stories))){const value=saved(name);if(!value?.script)continue;try{values.push(parseStory(fs.readFileSync(path.join(output,value.script.file)),name,catalog));}catch(e){issues.push({resource:name,error:e.message});}}return values;}
  let scripts=stories();
  if(['all','stories'].includes(scope)){await exportNames(new Set(scripts.filter(s=>!roles||s.characters.some(id=>roles.includes(id))).flatMap(s=>s.assets)));scripts=stories();}
  const names=readJson(path.join(root,'metadata/characters.json'),{});
  for(const s of scripts.filter(s=>!s.adult))for(const [id,name]of Object.entries<any>(s.names))names[id]={name,source:s.name};
  writeJson(path.join(root,'metadata/characters.json'),names);
  const index: { version: number; game: string; characters: any[]; images: any[]; audio: any[]; skeletons: any[]; stories: any[]; issues: any[]; legacyAliases?: any; limitations: { masterMissing: boolean; videoCgMissing: boolean; }; stats?: Record<string, number>; generated?: string; }={version:3,game:'girls-creation',characters:[],images:[],audio:[],skeletons:[],stories:[],issues:[],legacyAliases:catalog.legacyAliases||{},limitations:{masterMissing:catalog.masterMissing!==false,videoCgMissing:true}};
  function image(name,id,category){const value=saved(name)?.image;if(!value)return null;const item={...value,id:sha256(Buffer.from(id+':'+name)),character:id,category,resource:name};index.images.push(item);return item;}
  for(const role of catalog.characters){
    const icon=image(role.icon,role.id,'icon'),portraits=[];
    for(const name of role.portraits){const value=saved(name);if(value?.model){const model={...value.model,id:sha256(Buffer.from(name)),character:role.id,kind:'portrait',resource:name,label:'动态立绘'};index.skeletons.push(model);portraits.push({phase:'spine',label:'动态立绘',file:model.file,model:model.id});}
      else{const art=image(name,role.id,'portrait');if(art)portraits.push({phase:'illustration',label:'角色插画',file:art.file});}}
    for(const name of role.voices)for(const clip of saved(name)?.audio||[])index.audio.push({...clip,id:sha256(Buffer.from(role.id+name+clip.code)),character:role.id,context:'character',category:'character-voice',group:'daily',groupLabel:'角色语音',label:clip.code});
    const tracks=[...(role.videos||[]).flatMap(name=>saved(name)?.video?[{name:path.posix.basename(name,path.posix.extname(name)),file:saved(name).video.file,resource:name}]:[]),...(role.movieBundles||[]).flatMap(name=>(saved(name)?.movies||[]).map(m=>({...m,resource:name+'#'+m.name})))].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
    const motions=[];for(const chapter of new Set<string>(tracks.map(t=>t.name.split('_')[1]))){const group=tracks.filter(t=>t.name.split('_')[1]===chapter),id='girlscreation-video-'+chapter,existing=index.skeletons.find(m=>m.id===id);if(existing)existing.characters.push(role.id);else index.skeletons.push({id,character:role.id,characters:[role.id],kind:'cg',engine:'video',label:'视频 CG',file:group[0].file,tracks:group,animations:group.map(t=>t.name)});motions.push(id);}
    index.characters.push({id:role.id,name:catalog.masterMissing?names[role.id]?.name||role.name:role.name,shortName:role.shortName,subtitle:role.subtitle,kind:role.kind,unitId:role.unitId,defaultStyleId:role.defaultStyleId,styleOrder:role.styleOrder,rarityId:role.rarityId??null,rarityLabel:role.rarityLabel||'未标注',icon:icon?.file||null,portraits,portraitTotal:role.portraits.length,cg:[],motions,hasDynamicCg:motions.length>0,cgAvailable:!!(role.videos?.length||role.movieBundles?.length),voiceAvailable:role.voices.length>0,storyAvailable:role.stories.length>0,collected:!!(portraits.length||motions.length||index.audio.some(a=>a.character===role.id)),stories:[]});
  }
  for(const name of new Set<string>(scripts.flatMap(s=>s.assets))){const model=saved(name)?.model;if(model&&!index.skeletons.some(m=>m.file===model.file))index.skeletons.push({...model,id:sha256(Buffer.from(name)),kind:'portrait',resource:name,label:'剧情立绘'});}
  const ui=require('./story-ui.ts').readStoryUi(root);Object.assign(index,{storyUi:ui,characterFrames:ui?.frames||null});
  for(const part of scripts){
    const resources={},voices={},missing=new Set<string>();
    for(const name of part.assets){const value=saved(name),file=value?.image?.file||value?.model?.file||value?.video?.file||value?.audio?.[0]?.file;if(file)resources[name]=file;else if(!value?.script&&!value?.movies)missing.add(name);for(const clip of value?.audio||[])voices[name+'#'+clip.code]=clip.file;for(const movie of value?.movies||[])resources[name+'#'+movie.name]=movie.file;}
    const movies=part.movies.filter(code=>!index.skeletons.some(m=>m.engine==='video'&&m.tracks.some(t=>t.name===code)));
    const id='girlscreation-'+part.id,file='stories/'+id+'.json',script=saved(part.name).script.file;
    const title=part.title||(part.adult?'CG 剧情':'角色剧情');
    const missingVoices=[...new Set<string>(part.commands.filter(c=>c.command==='mess'&&c.args[2]&&!voices[c.args[2]]).map(c=>c.args[2]))];
    const story={id,character:part.character,characters:part.characters,format:'girlscreation',programVersion:3,ui:ui?.file||null,title,commands:part.commands,resources,voices,segments:[part.name],missingAssets:[...missing],missingMovies:movies,missingVoices,complete:!movies.length&&!missing.size&&!missingVoices.length};
    writeJson(path.join(output,file),story);
    index.stories.push({id,character:part.character,characters:part.characters,shared:part.characters.length>1,title:title+(story.complete?'':'（素材未齐）'),file,script,scriptFormat:'txt',format:'girlscreation',complete:story.complete,adult:part.adult,dialogue:story.commands.filter(c=>c.command==='mess').length,voiceFiles:Object.values<any>(voices)});
    for(const role of index.characters.filter(c=>part.characters.includes(c.id))){role.stories.push(id);role.collected=true;}
  }
  index.limitations.videoCgMissing=index.stories.some(s=>!s.complete);index.issues=issues;index.stats={characters:index.characters.length,named:index.characters.filter(c=>!c.name.startsWith('角色 ')).length,icons:index.characters.filter(c=>c.icon).length,portraits:index.characters.reduce((n,c)=>n+c.portraits.length,0),collected:index.characters.filter(c=>c.collected).length,cg:index.skeletons.filter(m=>m.kind==='cg').length,dynamicCg:index.skeletons.filter(m=>m.kind==='cg').length,characterVoices:index.audio.length,stories:index.stories.length,issues:issues.length};
  index.generated=new Date().toISOString();writeJson(path.join(output,'index.json'),index);progress({state:'ready',message:'少女艺术绮谭资源库已更新。',stats:index.stats});return index;
}
if(require.main===module){const root=process.env.RESOURCE_PROJECT_DIR||path.resolve(__dirname,'../../../parsed-data/girls-creation');require('../../../app/projects.ts').withPackLock(root,()=>extract(root)).then(x=>console.log(JSON.stringify(x.stats))).catch(e=>{console.error(e.message);process.exitCode=1;});}
export { extract, kind };
