'use strict';
const path=require('node:path');
const {downloadUrls}=require('../../../app/download.ts'),{fetchPublicResource}=require('../../../app/public-fetch.ts');
const {resourceKind}=require('./format.ts'),{readCatalog,readJson,writeJson}=require('./catalog.ts');
const {cgChapterAddresses,UI_SCENE}=require('./story-program.ts');
const {ensureStoryUi}=require('./story-ui.ts');
function collectionScope(scope='all'){if(!['all','catalog','portraits','cg','motions','voices','stories','ui'].includes(scope))throw new Error('下载分类有误。');return scope;}
function assetAddresses(catalog,{roles,scope='all'}: any={}){
  scope=collectionScope(scope);const chosen=roles||catalog.characters.map(item=>item.id);
  if(!Array.isArray(chosen)||!chosen.length||chosen.some(id=>!catalog.characters.some(item=>item.id===id)))throw new Error('请指定已索引的角色编号。');
  if(scope==='ui')return [];
  const addresses=[];
  for(const character of catalog.characters.filter(item=>chosen.includes(item.id))){
    if(scope!=='stories'&&character.icon)addresses.push(character.icon);
    if(scope==='catalog'){const script=character.stories.find(address=>address.endsWith('/hmn_'+character.id+'01.txt'))||character.stories.find(address=>address.includes('/hmn_'))||character.stories.find(address=>address.includes('/men_'))||[...character.stories].sort()[0];if(script)addresses.push(script);}
    if(['all','portraits'].includes(scope))addresses.push(...character.portraits);
    if(['all','cg','motions'].includes(scope))addresses.push(...character.cg,...character.motions);
    if(['all','voices'].includes(scope))addresses.push(...character.voices.map(item=>item.address));
    if(['all','stories'].includes(scope))addresses.push(...cgChapterAddresses(character));
  }
  return [...new Set(addresses)];
}
async function collect(root,{roles,scope='all',retryMissing=false,fetchResource=fetchPublicResource,extractResources=(...args)=>require('./extract.ts').extract(...args),prepareUi=ensureStoryUi,onProgress}: any={}){
  scope=collectionScope(scope);const catalog=readCatalog(root),addresses=assetAddresses(catalog,{roles,scope});
  const file=path.join(root,'state/dotabyss-status.json'),unavailableFile=path.join(root,'state/dotabyss-unavailable.json'),unavailable=readJson(unavailableFile,{}),seen=new Set<string>(),absent=new Set<string>();
  const state={state:'running',roles:roles||[],scope,targets:0,checked:0,saved:0,skipped:0,failed:0,unavailable:0,started:new Date().toISOString(),pid:process.pid};
  const persist=()=>onProgress?onProgress({...state}):writeJson(file,state);persist();const errors=[];
  async function download(addresses){
    const targets=[...new Set<string>(addresses.flatMap(address=>catalog.assets[address]?.bundles||[]))].filter(url=>!seen.has(url)).map(url=>({url}));targets.forEach(item=>seen.add(item.url));
    if(targets.some(item=>resourceKind(item.url)!=='bundle'))throw new Error('下载地址不是该游戏的公开素材包。');
    const queue=targets.filter(item=>retryMissing||!unavailable[item.url]);state.unavailable+=targets.length-queue.length;state.targets+=queue.length;persist();
    const baseline={checked:state.checked,saved:state.saved,skipped:state.skipped,failed:state.failed};
    const result=await downloadUrls(root,queue,{concurrency:4,maxBytes:80*1024*1024,fetchResource:async(url,options)=>{
      const response=await fetchResource(url,options);if(response.status===404){absent.add(url);unavailable[url]={status:404,checked:new Date().toISOString()};}if(response.status===200)delete unavailable[url];return response;
    },validate:bytes=>{if(bytes.length<32||!(bytes.subarray(0,8).toString('ascii')==='UnityFS\0'&&bytes.length>=48||bytes.subarray(0,4).toString('ascii')==='AFS2'))throw new Error('下载内容不是 Unity 或 CRI 素材包。');},onProgress:progress=>{
      Object.assign(state,{checked:baseline.checked+progress.done,saved:baseline.saved+progress.saved,skipped:baseline.skipped+progress.skipped,failed:baseline.failed+progress.failed});persist();
    }});
    errors.push(...result.errors.filter(error=>!absent.has(error.url)));writeJson(unavailableFile,unavailable);
  }
  try{
    if(['all','stories','ui'].includes(scope)){
      await prepareUi(root,{fetchResource,onProgress:progress=>{Object.assign(state,progress);persist();}});
      Object.assign(state,{phase:scope});
    }
    await download(addresses);let index=await extractResources(root,undefined,{roles,scope});
    if(['all','stories'].includes(scope)){
      const fs=require('node:fs'),dependencies=[];
      for(const metadata of index.stories.filter(item=>!roles||item.characters.some(id=>roles.includes(id)))){
        const story=JSON.parse(fs.readFileSync(path.join(root,'library',metadata.file)));dependencies.push(...story.assets.filter(address=>address!==UI_SCENE));
      }
      await download(dependencies);index=await extractResources(root,undefined,{roles,scope});
    }
    const issues=index.issues.filter(issue=>!roles||!issue.character||roles.includes(issue.character));
    Object.assign(state,{state:errors.length||issues.length?'partial':'ready',unavailable:state.unavailable+absent.size,failed:errors.length+issues.length,errors:[...errors,...issues],stats:index.stats,finished:new Date().toISOString()});persist();return state;
  }catch(error){Object.assign(state,{state:'failed',error:error.message,finished:new Date().toISOString()});persist();throw error;}
}
if(require.main===module){const option=flag=>{const at=process.argv.indexOf(flag);return at<0?undefined:process.argv[at+1];};const root=process.env.RESOURCE_PROJECT_DIR||path.resolve(__dirname,'../../../parsed-data/dotabyss');require('../../../app/projects.ts').withPackLock(root,()=>collect(root,{roles:option('--roles')?.split(','),scope:option('--scope'),retryMissing:process.argv.includes('--retry-missing')})).then(state=>{console.log(JSON.stringify(state));if(state.failed)process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});}
export { collect, collectionScope, assetAddresses };
