import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { CLIENT, clientFiles, clientConstant } from './master.ts';
import { BASE, resourceName } from './format.ts';
import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
import { runUnity } from './unity.ts';

export const CLOCK_URL = 'https://www-r18.gc.dmmgames.com/manifest/webgl/r18';
const LIMIT = 128 * 1024 * 1024;
const validKey = value => typeof value === 'string' && /^[A-Za-z0-9]{32}$/.test(value);

export function configAppKey(bytes: Buffer, secret: Buffer, keyBase: Buffer) {
  const key = crypto.createHmac('sha256', secret).update(keyBase).digest(), values = [];
  let at = 0;
  while (at < bytes.length) {
    let size = 0, shift = 0, byte;
    do { if (at >= bytes.length || shift > 28) throw Error('客户端配置长度无效。'); byte = bytes[at++]; size += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    if (!size || size > 65536 || at + size > bytes.length || values.length >= 2048) throw Error('客户端配置越界。');
    const encoded = bytes.toString('utf8', at, at + size); at += size;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error('客户端配置格式无效。');
    const content = Buffer.from(encoded, 'base64');
    if (content.length < 32 || content.length % 16) throw Error('客户端配置块无效。');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, content.subarray(0,16));
    values.push(Buffer.concat([decipher.update(content.subarray(16)),decipher.final()]).toString('utf8'));
  }
  if (values.length % 2 !== 1) throw Error('客户端配置字段不完整。');
  for (let i=1;i<values.length;i+=2) if (values[i]==='AppKey' && validKey(values[i+1])) return values[i+1];
  throw Error('客户端缺少 CDN 资源配置。');
}

export async function loadSource(root, { fetchResource = require('../../../app/public-fetch.ts').fetchPublicResource, refresh = false, exportConfig = runUnity }: any = {}) {
  const file = path.join(root,'metadata/public-source.json');
  if (!refresh && fs.existsSync(file)) { const saved=JSON.parse(fs.readFileSync(file,'utf8')); if(validKey(saved.appKey)) return saved; }
  const response = await fetchResource(CLIENT,{signal:AbortSignal.timeout(60000),redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw Error('公开客户端配置 HTTP '+response.status);}
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>LIMIT)throw Error('公开客户端超过大小限制。');chunks.push(chunk);}
  const {player,metadata}=clientFiles(Buffer.concat(chunks));if(!player)throw Error('公开客户端缺少配置文件。');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'girlscreation-source-')),input=path.join(folder,'data.unity3d');
  try{
    fs.writeFileSync(input,player);
    const result:any=await exportConfig({output:folder,assets:[{name:'client-config',kind:'config',input,fingerprint:crypto.createHash('sha256').update(player).digest('hex')}]});
    const config=result.resources?.[0]?.config;if(typeof config!=='string')throw Error('公开客户端配置读取失败。');
    const appKey=configAppKey(Buffer.from(config,'base64'),clientConstant(metadata,'Crypt','DefaultSecretKey'),clientConstant(metadata,'Crypt','DefaultKeyBase'));
    const value={appKey};writeAtomicFileSync(file,JSON.stringify(value));return value;
  }finally{
    fs.unlinkSync(input);fs.rmdirSync(folder);
  }
}

export function resourceUrl(name: string, asset, appKey: string, expires: number) {
  if(resourceName(BASE+name)!==name||!validKey(appKey)||!Number.isSafeInteger(expires)||expires<=0)throw Error('CDN 资源参数无效。');
  const url=new URL(BASE+name);
  url.searchParams.set('s',crypto.createHash('md5').update(appKey+url.pathname+expires).digest('base64url'));
  url.searchParams.set('t',String(expires));
  if(/^[a-f0-9]{32}$/.test(asset?.hash||''))url.searchParams.set('h',asset.hash);
  return url.href;
}

export function resourceTransport(root, assets, {fetchResource=require('../../../app/public-fetch.ts').fetchPublicResource, source=loadSource, now=Date.now}:any={}) {
  let context=null,denied=false,renewed=false;
  async function prepare(refresh=false){
    const config=await source(root,{fetchResource,refresh});
    const response=await fetchResource(CLOCK_URL,{signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok){await response.body?.cancel();throw Error('资源时间同步 HTTP '+response.status);}
    const value=await response.json(),timestamp=value.cdn_timestamp;
    if(value.status!=='OK'||!Number.isSafeInteger(timestamp)||timestamp<1500000000||timestamp>4000000000)throw Error('资源时间同步响应无效。');
    // Match AttachSecureLink's hourly expiry, using server time rather than the
    // workstation clock. Never retain response tokens or replay account APIs.
    const expires=(Math.floor(timestamp/3600)+1)*3600;
    context={...config,expires,until:now()+Math.max(1,expires-timestamp-10)*1000};
  }
  return async(url,options)=>{
    const name=resourceName(url);if(!name||!assets[name])throw Error('资源地址不在游戏目录中。');
    if(denied)return new Response(null,{status:403});
    try{
      if(!context||now()>=context.until)await prepare();
      const requestOptions={signal:options?.signal,redirect:'error'};
      let response=await fetchResource(resourceUrl(name,assets[name],context.appKey,context.expires),requestOptions);
      if([401,403].includes(response.status)&&!renewed){
        renewed=true;await response.body?.cancel();await prepare(true);
        response=await fetchResource(resourceUrl(name,assets[name],context.appKey,context.expires),requestOptions);
      }
      if([401,403].includes(response.status))denied=true;
      return response;
    }catch{throw Error('无法更新或使用 CDN 资源地址，请稍后重试。');}
  };
}
