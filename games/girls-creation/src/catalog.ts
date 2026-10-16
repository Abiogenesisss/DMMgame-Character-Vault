import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {BASE,ORIGIN,validName,validId}=require('./format.ts');
const readJson = (file, fallback?: any) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
function writeJson(file, value) { writeAtomicFileSync(file, JSON.stringify(value)); }
function buildCatalog(manifests,captured=[],metadata: any={},master: any=null){
  const assets={};
  for(const manifest of manifests){
    if(!Array.isArray(manifest?.d))throw new Error('少女艺术绮谭资源目录格式无效。');
    for(const row of manifest.d){
      if(!validName(row.n)||!Array.isArray(row.d)||row.d.some(n=>!validName(n)))throw new Error('资源目录包含无效路径。');
      assets[row.n]={name:row.n,url:BASE+row.n,dependencies:row.d,size:row.s,hash:/^[a-f0-9]{32}$/.test(row.h||'')?row.h:null};
    }
  }
  // A newer public manifest must not hide valid bundles in an older capture.
  for(const name of captured)if(validName(name)&&!assets[name])assets[name]={name,url:BASE+name,dependencies:[]};
  const ids=new Set<string>();
  for(const name of Object.keys(assets)){const id=/^image_(?:sub_)?unit_(?:full|icon)\/(?:uf|sf|ut|sut)(40[12]\d{4})\.dmm$/.exec(name)?.[1];if(validId(id))ids.add(id);}
  const names=Object.keys(assets),choose=items=>items.filter(name=>assets[name]),storyDefinitions={};
  const label=value=>Array.isArray(value)?value[0]||'':'';
  const units=new Map((master?.mUnits||[]).map(row=>[row.id,row]));
  const cards=new Map<any,any>([...(master?.mLayers||[]),...(master?.mSubunits||[])].map(row=>[String(row.id),row]));
  const novels=new Map<any,any>((master?.mNovels||[]).map(row=>[row.id,row]));
  const scriptByCode=new Map(names.filter(n=>/^notinit\/novelchara_(?:main|sub)(?:_r18)?\/h[ms][nr]_\d+\.dmm$/.test(n)).map(n=>[path.posix.basename(n,'.dmm'),n]));
  const legacyAliases={};
  for(const [id,card]of cards){
    if(!validId(id)){const target=String(card.image_index);if(validId(target)&&ids.has(target))legacyAliases[id]=target;continue;}
    if(choose(['image_unit_icon/ut'+card.image_index+'.dmm','image_sub_unit_icon/sut'+card.image_index+'.dmm']).length)ids.add(id);
  }
  const characters=[...ids].sort().map(id=>{
    const sub=id.startsWith('402'),prefix=sub?'sub_':'',card=cards.get(id),unit: any=!sub&&card?units.get(card.unit_id):null;
    const imageId=card?.image_index||id;
    const portraits=choose(['notinit/standing_spine/st'+imageId+'.dmm','image_'+prefix+'unit_full/'+(sub?'sf':'uf')+imageId+'.dmm']);
    // Unit affection episodes belong to the artist's base card. Other layers
    // have their own episodes; a shared unit_id must not grant them the base CG.
    const voicePattern=new RegExp('^notinit/voice/(?:master/(?:sub_)?unit_words/stv_'+id+'_\\d+|(?:sub)?unitdetail/[^/]*'+id+'|chara_get/[^/]*'+id+')\\.dmm$');
    const storyPattern=new RegExp('^notinit/novelchara_(?:main|sub)(?:_r18)?/h[ms][nr]_'+id+'[1-9]\\.dmm$');
    const voices=new Set(names.filter(n=>voicePattern.test(n))),stories=new Set<string>(names.filter(n=>storyPattern.test(n)));
    if(card&&master){
      const links=sub?master.mSubunitOpenNovels.filter(row=>row.subunit_id===card.id):[...master.mLayerOpenNovels.filter(row=>row.layer_id===card.id),...master.mUnitLovePointOpenNovels.filter(row=>row.unit_id===card.unit_id&&String(unit?.default_layer_id)===id)];
      for(const link of links){const novel=novels.get(link.novel_id),name=scriptByCode.get(novel?.novel_script_id);if(name)stories.add(name);}
      const words=sub?master.mSubunitWords.filter(row=>row.subunit_id===card.id):master.mUnitWords.filter(row=>row.unit_id===card.unit_id&&(!row.layer_id||row.layer_id===card.id));
      for(const word of words){const file='notinit/voice/master/'+prefix+'unit_words/'+word.sound_asset+'.dmm';if(assets[file])voices.add(file);}
    }
    for(const name of stories){const code=path.posix.basename(name,'.dmm'),novel=[...novels.values()].find(n=>n.novel_script_id===code);
      const definition=storyDefinitions[name]||={id:code,title:label(novel?.ml_title)||novel?.title||'',adult:/\/h[ms]r_/.test(name),characters:[]};definition.characters.push(id);}
    const codes=new Set([...stories].map(n=>path.posix.basename(n,'.dmm').split('_')[1]));
    const videos=names.filter(n=>{const m=/(?:^|\/)e[sm]m_(\d{8})_\d+\.(?:mp4|webm)$/.exec(n);return m&&codes.has(m[1]);});
    const movieBundles=choose([...stories].map(n=>n.replace(/\.dmm$/,'_image.dmm')));
    const shortName=label(sub?card?.ml_name:unit?.ml_name)||metadata[id]?.name||'角色 '+id,subtitle=sub?'':label(card?.ml_name);
    const rarityId=Number.isInteger(card?.rarity)?card.rarity:null;
    return {id,name:subtitle?shortName+'【'+subtitle+'】':shortName,shortName,subtitle,unitId:unit?.id||null,defaultStyleId:unit?.default_layer_id?String(unit.default_layer_id):null,styleOrder:card?.sort_order??Number(id),kind:sub?'impression':'artist',rarityId,rarityLabel:rarityId?'★'+rarityId:'未标注',icon:choose(['image_'+prefix+'unit_icon/'+(sub?'sut':'ut')+imageId+'.dmm'])[0]||null,portraits,voices:[...voices],stories:[...stories].sort(),videos,movieBundles,cg:[],motions:[]};
  });
  return {version:3,game:'girls-creation',characters,assets,storyDefinitions,legacyAliases,masterMissing:!master};
}
async function prepareCatalog(root,{fetchResource=require('../../../app/public-fetch.ts').fetchPublicResource,refresh=false}: any={}){
  const folder=path.join(root,'metadata'),manifests=[];
  for(const name of ['master','assetbundle','advvoice']){
    const file=path.join(folder,name+'-manifest.json');
    if(refresh||!fs.existsSync(file)){
      const response=await fetchResource(ORIGIN+'/files/manifest/webgl/r18/'+name+'.json',{signal:AbortSignal.timeout(30000)});
      if(!response.ok){await response.body?.cancel();throw new Error('公开资源目录 HTTP '+response.status);}
      const text=await response.text();if(text.length>32*1024*1024)throw new Error('资源目录过大。');writeJson(file,JSON.parse(text));
    }
    manifests.push(readJson(file));
  }
  const masterAsset=manifests.flatMap(m=>m.d).find(row=>row.n==='master.dmm');
  if(refresh&&masterAsset){
    const file=path.join(folder,'master-source.json'),previous=readJson(file,{}),assets={'master.dmm':{hash:masterAsset.h}};
    const result=await require('../../../app/download.ts').downloadUrls(root,[{url:BASE+'master.dmm',size:masterAsset.s}],{
      fetchResource:require('./source.ts').resourceTransport(root,assets,{fetchResource}),refresh:previous.hash!==masterAsset.h,maxBytes:32*1024*1024,
      validate:bytes=>{if(bytes.length<48||bytes.toString('ascii',0,8)!=='UnityFS\0')throw Error('主数据响应无效。');}
    });
    if(result.failed)throw Error('主数据更新失败；已保存的角色资料已保留。');
    writeJson(file,{hash:masterAsset.h});
  }
  const master=await require('./master.ts').prepareMaster(root,{fetchResource});
  const captured=readJson(path.join(folder,'captured.json'),[]),catalog=buildCatalog(manifests,captured,readJson(path.join(folder,'characters.json'),{}),master);
  writeJson(path.join(folder,'catalog.json'),catalog);return catalog;
}
const readCatalog=root=>readJson(path.join(root,'metadata/catalog.json'),{characters:[],assets:{}});
export { buildCatalog, prepareCatalog, readCatalog, readJson, writeJson };
