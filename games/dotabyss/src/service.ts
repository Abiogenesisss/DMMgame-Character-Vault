'use strict';
const path=require('node:path');
const {acquirePackLock}=require('../../../app/projects.ts'),lock=require('../../../app/download-lock.ts');
const {readJson,writeJson}=require('./catalog.ts');
function createCatalogService({root,origin,fetchResource,validId,readCatalog,collectionScope,collect,statusName}){
  const file=path.join(root,'state',statusName+'-status.json');
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  return {async handle(request){
    const url=new URL(request.url);if(url.origin!==origin||!url.pathname.startsWith('/api/'))return null;
    if(url.pathname==='/api/status'&&request.method==='GET'){
      const state=readJson(file,null);if(state?.state==='running'&&!lock.busy(path.join(root,'state/pack.lock')))state.state='interrupted';return json(state);
    }
    if(url.pathname==='/api/collect'&&request.method==='POST'){
      let payload;try{payload=await request.json();}catch{return json({error:'请求格式有误。'},400);}
      if(!validId(payload?.id))return json({error:'角色编号有误。'},400);
      let scope;try{scope=collectionScope(payload.scope);if(scope==='catalog')throw new Error('此接口只下载当前角色资源。');}catch(error){return json({error:error.message},400);}
      if(!readCatalog(root).characters.some(item=>item.id===payload.id))return json({error:'角色未被索引。'},404);
      let release;try{release=acquirePackLock(root);}catch{return json({error:'资源正在处理，请等当前任务完成。'},409);}
      const initial={state:'running',roles:[payload.id],scope,targets:0,checked:0,failed:0,pid:process.pid};
      try{writeJson(file,initial);}catch(error){release();throw error;}
      Promise.resolve().then(async()=>{try{await collect(root,{roles:[payload.id],scope,retryMissing:payload.retryMissing===true,fetchResource});}
        catch(error){writeJson(file,{state:'failed',roles:[payload.id],scope,error:error.message});}finally{release();}}).catch(error=>console.error(error.message));
      return json(initial,202);
    }
    return json({error:'接口不存在。'},404);
  }};
}
export { createCatalogService };
