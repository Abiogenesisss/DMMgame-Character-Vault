import fs from 'node:fs';
import path from 'node:path';
import {loadPack,routeKey,sha256} from '../../../app/pack.ts';
import {downloadUrls} from '../../../app/download.ts';
import {BASE} from './format.ts';
import {readCatalog,readJson,writeJson} from './catalog.ts';
import {resourceTransport} from './source.ts';
import {runUnity} from './unity.ts';

export const UI_ASSETS=['prefab_adv.dmm','sprite_atlas/common_sprite_atlas.dmm','sprite_atlas/novel_adv_sprite_atlas.dmm'];
const themeFile='story-ui/girls-creation/theme.json';
const localFile=(file)=>typeof file==='string'&&/^story-ui\/girls-creation\/(?:theme\.json|[a-f0-9]{64}\.png)$/.test(file);
export function readStoryUi(root){
  try{
    const meta=readJson(path.join(root,'metadata/story-ui.json'));
    if(meta?.version!==1||meta.file!==themeFile||!Array.isArray(meta.files)||meta.files.length>64)return null;
    for(const item of meta.files){if(!localFile(item.file))return null;const bytes=fs.readFileSync(path.join(root,'library',item.file));if(bytes.length!==item.bytes||sha256(bytes)!==item.sha256)return null;}
    const theme=readJson(path.join(root,'library',themeFile));
    if(theme.version!==1||!theme.sprites?.message||!theme.sprites.cgMessage||!theme.sprites.cgLine||Object.values<any>(theme.sprites).some(s=>!localFile(s.file)||!meta.files.some(f=>f.file===s.file)))return null;
    return {file:themeFile,files:meta.files.map(f=>f.file),frames:meta.frames};
  }catch{return null;}
}
export async function ensureStoryUi(root,{fetchResource=require('../../../app/public-fetch.ts').fetchPublicResource,source,exportUi=request=>runUnity(request,{worker:path.join(__dirname,'../python/export_story_ui.py')})}:any={}){
  const previous=readStoryUi(root);if(previous)return previous;
  const catalog=readCatalog(root);
  if(UI_ASSETS.some(n=>!catalog.assets[n]))throw Error('游戏目录缺少原版界面素材，请先刷新目录。');
  const result=await downloadUrls(root,UI_ASSETS.map(n=>({url:BASE+n})),{maxBytes:24*1024*1024,concurrency:1,fetchResource:resourceTransport(root,catalog.assets,{fetchResource,source}),validate:bytes=>{if(bytes.toString('ascii',0,8)!=='UnityFS\0')throw Error('界面资源格式无效。');}});
  if(result.failed)throw Error('原版界面素材下载未完成；已有资源已保留。');
  const pack=loadPack(path.join(root,'cache')),assets=UI_ASSETS.map(name=>{
    const record=pack.manifest.routes[routeKey('GET',BASE+name)]?.at(-1);
    if(record?.status!==200||!/^[a-f0-9]{64}$/.test(record.body))throw Error('界面资源缓存缺失。');
    const input=path.join(pack.root,'bodies',record.body);if(sha256(fs.readFileSync(input))!==record.body)throw Error('界面资源校验失败。');
    return {name,input,fingerprint:record.body};
  });
  const ui:any=await exportUi({output:path.join(root,'library'),assets});
  if(ui.file!==themeFile||!Array.isArray(ui.files)||!ui.files.includes(themeFile)||ui.files.some(f=>!localFile(f)))throw Error('界面导出结果无效。');
  writeJson(path.join(root,'metadata/story-ui.json'),{version:1,...ui,files:ui.files.map(file=>{const bytes=fs.readFileSync(path.join(root,'library',file));return {file,bytes:bytes.length,sha256:sha256(bytes)};})});
  const installed=readStoryUi(root);if(!installed)throw Error('界面导出不完整。');return installed;
}
