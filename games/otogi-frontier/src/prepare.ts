'use strict';
const fs = require('node:fs'), path = require('node:path');
const { loadPack } = require('../../../app/pack.ts');
const { downloadUrls } = require('../../../app/download.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { ORIGIN, decodeBundle, metadataLiterals, discoverCodec } = require('./format.ts');
const { buildCatalog, readJson } = require('./catalog.ts');
async function ensureCodec(root, bytes, { fetchResource = fetchPublicResource }: any = {}) {
  if (bytes.subarray(0, 8).toString() === 'UnityFS\0') return null;
  const codecFile = path.join(root, 'metadata/asset-codec.json');
  const cached = readJson(codecFile, null); if (cached) try { decodeBundle(bytes, cached); return cached; } catch {}
  if (bytes.length < 80 || bytes.length % 16) throw new Error('童话边境资源格式无效。');
  const source = readJson(path.join(root, 'metadata/source.json'), {});
  if (!source.buildDataUrl) throw new Error('CG 解码资料未就绪，请补充包含游戏加载资料的 HAR。');
  const url = new URL(source.buildDataUrl);
  if (url.origin !== ORIGIN || !/^\/production\/Release\d+\/Build\.data\.unityweb$/.test(url.pathname) || url.search || url.username || url.password) throw new Error('公开游戏资料地址无效。');
  const response = await fetchResource(url.href, { signal: AbortSignal.timeout(60000) });
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('公开游戏资料 HTTP ' + response.status); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 100 * 1024 * 1024) throw new Error('公开游戏资料超出大小限制。'); chunks.push(chunk); }
  const codec = discoverCodec(metadataLiterals(Buffer.concat(chunks)), bytes);
  fs.writeFileSync(codecFile, JSON.stringify(codec)); return codec;
}
async function prepareCatalog(root, { fetchResource = fetchPublicResource }: any = {}) {
  const catalog = buildCatalog(root);
  await downloadUrls(root, catalog.icons, { fetchResource, maxBytes: 80 * 1024 * 1024, validate: bytes => decodeBundle(bytes) });
  const records = Object.values<any>(loadPack(path.join(root, 'cache')).manifest.routes).flat();
  const encrypted = records.find(record => /\/chara\/still\/\d+$/.test(record.url) && record.status === 200);
  if (encrypted) await ensureCodec(root, fs.readFileSync(path.join(root, 'cache/bodies', encrypted.body)), { fetchResource });
  return catalog;
}
export { prepareCatalog, ensureCodec };
