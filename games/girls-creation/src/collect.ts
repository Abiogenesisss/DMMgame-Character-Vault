'use strict';
const path=require('node:path');
const {downloadUrls}=require('../../../app/download.ts');
const {BASE,resourceName}=require('./format.ts');
const {readCatalog,readJson,writeJson}=require('./catalog.ts');
function collectionScope(scope='all'){if(!['all','catalog','portraits','cg','motions','voices','stories','story-ui'].includes(scope))throw new Error('下载分类有误。');return scope;}
function selectedAssets(catalog,{roles,scope='all'}: any={}){
  scope=collectionScope(scope);const ids=roles||catalog.characters.map(c=>c.id);
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>!catalog.characters.some(c=>c.id===id)))throw new Error('请指定已索引的角色。');
  const names=new Set<string>();for(const role of catalog.characters.filter(c=>ids.includes(c.id))){if(role.icon)names.add(role.icon);if(['all','portraits'].includes(scope))role.portraits.forEach(n=>names.add(n));if(['all','cg','motions','stories'].includes(scope))[...(role.videos||[]),...(role.movieBundles||[])].forEach(n=>names.add(n));if(['all','voices'].includes(scope))role.voices.forEach(n=>names.add(n));if(['all','stories'].includes(scope))role.stories.forEach(n=>{names.add(n);if(catalog.assets[n.replace(/\.dmm$/,'_voice.dmm')])names.add(n.replace(/\.dmm$/,'_voice.dmm'));});}return [...names];
}
async function collect(root,{roles,scope='all',fetchResource=require('../../../app/public-fetch.ts').fetchPublicResource,source,extractResources=(...args)=>require('./extract.ts').extract(...args)}: any={}){
  scope=collectionScope(scope);const catalog=scope==='catalog'?await require('./catalog.ts').prepareCatalog(root,{fetchResource,refresh:true}):readCatalog(root),names=selectedAssets(catalog,{roles,scope}),file=path.join(root,'state/girlscreation-status.json');
  const state={state:'running',roles:roles||[],scope,targets:names.length,checked:0,failed:0,started:new Date().toISOString(),pid:process.pid};const save=()=>writeJson(file,state);save();
  let denied=false;const requestResource=require('./source.ts').resourceTransport(root,catalog.assets,{fetchResource,source});
  async function download(items){return downloadUrls(root,items.map(n=>({url:BASE+n})),{concurrency:1,maxBytes:160*1024*1024,
    fetchResource:async(url,options)=>{
      const name=resourceName(url);if(!name||!catalog.assets[name])throw new Error('资源地址不在游戏目录中。');
      if(denied)return new Response(null,{status:403});
      const response=await requestResource(url,options);
      if(response.status===401||response.status===403)denied=true;return response;
    },validate:(bytes,entry)=>{const ext=path.posix.extname(resourceName(entry.url));if(ext==='.dmm'?(bytes.length<48||bytes.subarray(0,8).toString('ascii')!=='UnityFS\0'):ext==='.mp4'?(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp'):(bytes.length<4||bytes.readUInt32BE(0)!==0x1a45dfa3))throw new Error('下载内容不是有效的游戏素材。');},
    onProgress:p=>{Object.assign(state,{checked:p.done,targets:p.total,saved:p.saved,skipped:p.skipped,failed:p.failed});save();}});}
  try{
    const result=await download(names);
    if(['all','stories','story-ui','catalog'].includes(scope)&&catalog.assets['prefab_adv.dmm'])await require('./story-ui.ts').ensureStoryUi(root,{fetchResource,source});
    let index=await extractResources(root,undefined,{roles,scope});
    if(!denied&&['all','stories'].includes(scope)){
      const missing=[...new Set<string>(index.stories.filter(s=>!roles||s.characters?.some(id=>roles.includes(id))).flatMap(s=>readJson(path.join(root,'library',s.file),{}).missingAssets||[]))];
      if(missing.length){const extra=await download(missing);result.failed+=extra.failed;result.errors.push(...extra.errors);index=await extractResources(root,undefined,{roles,scope});}
    }
    const incomplete=['all','stories'].includes(scope)?index.stories.filter(s=>s.complete===false&&(!roles||s.characters?.some(id=>roles.includes(id)))).length:0;
    Object.assign(state,{state:denied||result.failed||index.issues.length||incomplete?'partial':'ready',authRequired:denied,incompleteStories:incomplete,failed:result.failed+index.issues.length,errors:[...result.errors,...index.issues].slice(0,16),stats:index.stats,finished:new Date().toISOString(),...(denied?{error:'更新资源地址后服务器仍拒绝请求；已保存素材已保留。'}:{})});save();return state;
  }catch(e){Object.assign(state,{state:'failed',error:e.message,finished:new Date().toISOString()});save();throw e;}
}
if(require.main===module){const option=f=>{const at=process.argv.indexOf(f);return at<0?undefined:process.argv[at+1];};const root=process.env.RESOURCE_PROJECT_DIR||path.resolve(__dirname,'../../../parsed-data/girls-creation');require('../../../app/projects.ts').withPackLock(root,()=>collect(root,{roles:option('--roles')?.split(','),scope:option('--scope')})).then(x=>{console.log(JSON.stringify(x));if(x.failed)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});}
export { collect, collectionScope, selectedAssets };
