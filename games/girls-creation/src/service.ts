'use strict';
const path=require('node:path');
const {acquirePackLock}=require('../../../app/projects.ts'),lock=require('../../../app/download-lock.ts');
const {readJson,writeJson}=require('./catalog.ts');
function discoveryIds(input=''){
  if(typeof input!=='string'||input.length>6000)throw Error('角色编号格式有误。');
  const ids=new Set<string>(),text=input.replace(/[～~—–]/g,'-').replace(/(\d+)\s*-\s*(\d+)/g,'$1-$2').trim();
  if(!text)return [];
  for(const item of text.split(/[\s,，、;；]+/)){
    if(!/^40[12]\d{4}(?:-40[12]\d{4})?$/.test(item))throw Error('请填写七位角色编号，例如 4011601。');
    const [first,last=first]=item.split('-').map(Number);
    if(last<first||last-first>=500)throw Error('每次最多确认 500 个角色编号。');
    for(let id=first;id<=last;id++){if(!require('./format.ts').validId(String(id)))throw Error('角色编号范围有误。');ids.add(String(id));}
    if(ids.size>500)throw Error('每次最多确认 500 个角色编号。');
  }
  return [...ids];
}
function createCatalogService({root,origin,fetchResource,validId,readCatalog,collectionScope,collect,statusName}){
  const file=path.join(root,'state',statusName+'-status.json');
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  return {async handle(request){
    const url=new URL(request.url);if(url.origin!==origin||!url.pathname.startsWith('/api/'))return null;
    if(url.pathname==='/api/status'&&request.method==='GET'){
      const state=readJson(file,null);if(state?.state==='running'&&!lock.busy(path.join(root,'state/pack.lock')))state.state='interrupted';return json(state);
    }
    if(['/api/collect','/api/discover'].includes(url.pathname)&&request.method==='POST'){
      let payload;try{payload=await request.json();}catch{return json({error:'请求格式有误。'},400);}
      const discovery=url.pathname==='/api/discover';let scope,ids=[];
      try{scope=discovery?'catalog':collectionScope(payload?.scope);if(discovery)ids=discoveryIds(payload?.ids);}catch(error){return json({error:error.message},400);}
      if(typeof payload?.id==='string')payload.id=readCatalog(root).legacyAliases?.[payload.id]||payload.id;
      if(scope!=='catalog'&&!validId(payload?.id))return json({error:'角色编号有误。'},400);
      if(scope!=='catalog'&&!readCatalog(root).characters.some(item=>item.id===payload.id))return json({error:'角色未被索引。'},404);
      const roles=scope==='catalog'?undefined:[payload.id];
      let release;try{release=acquirePackLock(root);}catch{return json({error:'资源正在处理，请等当前任务完成。'},409);}
      const initial={state:'running',roles:roles||[],scope,...(discovery?{type:'catalog'}:{}),targets:0,checked:0,failed:0,pid:process.pid};
      try{writeJson(file,initial);}catch(error){release();throw error;}
      Promise.resolve().then(async()=>{try{
        if(discovery){
          const known=new Set(readCatalog(root).characters.map(c=>c.id));
          const catalog=await require('./catalog.ts').prepareCatalog(root,{fetchResource,refresh:true});
          if(catalog.assets['prefab_adv.dmm'])await require('./story-ui.ts').ensureStoryUi(root,{fetchResource});
          const index=await require('./extract.ts').extract(root,undefined,{scope:'catalog'}),present=new Set(index.characters.map(c=>c.id));
          const addedIds=index.characters.filter(c=>!known.has(c.id)).map(c=>c.id);
          writeJson(file,{...initial,state:index.issues.length?'partial':'ready',addedIds,added:addedIds.length,missingIds:ids.filter(id=>!present.has(id)),failed:index.issues.length,stats:index.stats,finished:new Date().toISOString()});
        }else await collect(root,{roles,scope,retryMissing:payload.retryMissing===true,fetchResource});
      }catch(error){writeJson(file,{...initial,state:'failed',error:error.message});}finally{release();}}).catch(error=>console.error(error.message));
      return json(initial,202);
    }
    return json({error:'接口不存在。'},404);
  }};
}
export { createCatalogService, discoveryIds };
