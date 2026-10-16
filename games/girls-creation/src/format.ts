'use strict';
const ORIGIN='https://cdn-r18.gc.dmmgames.com',BASE=ORIGIN+'/secure/data/production/webgl/resources/';
const validId=id=>typeof id==='string'&&/^40[12]\d{4}$/.test(id);
const validName=name=>typeof name==='string'&&name.length<240&&/^[a-z0-9_/-]+\.(?:dmm|mp4|webm)$/.test(name)&&!name.includes('..')&&!name.startsWith('/');
function resourceName(input){try{const url=new URL(input);if(url.origin!==ORIGIN||url.username||url.password||!url.href.startsWith(BASE))return null;const name=url.pathname.slice(new URL(BASE).pathname.length);return validName(name)?name:null;}catch{return null;}}
function manifestName(input){try{const u=new URL(input);if(u.origin!==ORIGIN||u.username||u.password)return null;return /^\/files\/manifest\/webgl\/r18\/(manifest|master|assetbundle|advvoice)\.json$/.exec(u.pathname)?.[1]||null;}catch{return null;}}
export { ORIGIN, BASE, validId, validName, resourceName, manifestName };
