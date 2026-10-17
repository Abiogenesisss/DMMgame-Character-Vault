'use strict';
const fs = require('node:fs'), path = require('node:path');
const { decodeMulti, encode } = require('@msgpack/msgpack');
const { ORIGIN, decodeData } = require('./format.ts');
const { readJson, writeJson } = require('./catalog.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const API = 'https://api-game.muvluv-girls-garden.com';
const sessionMessage = '剧情会话已失效或未提供有效授权，当前剧情无法获取。';
function sceneUrl(value, id) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('剧情下载地址无效。');
  const url = new URL(value, ORIGIN + '/production-private/');
  if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== '/production-private/master-data/scenes/' + id + '.bin') throw new Error('剧情下载地址与编号不符。');
  return url.href;
}
function sceneRows(bytes, id) {
  const rows = decodeData(bytes);
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !Array.isArray(row) || row[1] !== Number(id) || !Number.isSafeInteger(row[0]) || typeof row[4] !== 'string')) throw new Error('剧情编号或结构无效。');
  for (const row of rows) { const value = JSON.parse(row[4]); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('剧情指令无效。'); }
  return rows;
}
function dataSource(bytes, id) {
  // API responses are a sequence of MessagePack objects; the second is the
  // compressed result. The trailing empty arrays are metadata, not the body.
  const envelope = [...decodeMulti(bytes, { maxStrLength: 8192, maxArrayLength: 10000, maxMapLength: 10000 })];
  const value = decodeData(encode(envelope[1]));
  if (!Array.isArray(value) || value.length !== 1) throw new Error('剧情接口返回格式无效。');
  return sceneUrl(value[0], id);
}
async function readBytes(response, limit, label) {
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(label + ' HTTP ' + response.status), { status: response.status }); }
  const chunks = []; let total = 0;
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error(label + '超过大小限制。'); }
  for await (const chunk of response.body || []) { total += chunk.length; if (total > limit) throw new Error(label + '超过大小限制。'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function readAccess(root) {
  const helper=path.join(__dirname,'../dev/session.cjs');
  return fs.existsSync(helper)?require(helper).readAccess(root,{ORIGIN,API,sceneUrl}):{urls:new Map(),headers:{}};
}
function cgScenes(catalog, roles) {
  const chapters = catalog.characters.filter(role => !roles || roles.includes(role.id)).flatMap(role => role.episodes || []);
  if(chapters.some(scene=>!/^\d{8}$/.test(scene.sceneId)))throw new Error('剧情编号格式无效。');
  const episodes = new Set<string>(chapters.filter(scene => scene.adult).map(scene => scene.episodeId));
  return [...new Map<any, any>(chapters.filter(scene => episodes.has(scene.episodeId)).map(scene => [scene.sceneId, scene])).values()].sort((a, b) => a.episodeId - b.episodeId || a.order - b.order);
}
async function fetchStories(root, catalog, { roles, fetchResource = fetchPublicResource, onProgress = () => {}, access }: any = {}) {
  const scenes = cgScenes(catalog, roles), result = { targets: scenes.length, checked: 0, saved: 0, failed: 0, errors: [], missingSceneIds: [], authRequired: false };
  const sourceFile = path.join(root, 'metadata/source.json'), source = readJson(sourceFile, {}); source.scenes ||= [];
  let blocked = false;
  for (const scene of scenes) {
    const id = scene.sceneId, file = path.join(root, 'metadata/scene-' + id + '.json');
    try {
      if (!fs.existsSync(file)) {
        access ||= readAccess(root);
        const captured = access.bodies?.get(id);
        let bytes = captured;
        let url = access.urls.get(id);
        const freshUrl = async () => {
          if (blocked || !access.headers['x-client-key']) throw Object.assign(new Error(sessionMessage), { status: 401 });
          const response = await fetchResource(API + '/api/episode/scenes/' + id + '/dataSource', { headers: access.headers, signal: AbortSignal.timeout(30000) });
          try { return dataSource(await readBytes(response, 128 * 1024, '剧情接口'), id); }
          catch (error) { if ([401, 403].includes(error.status)) blocked = true; throw error; }
        };
        // The signed blob URL is used in memory only, never added to the public
        // pack, index, error text, generated playback documents or saved config.
        if (!bytes) {
          const cachedUrl = !!url;
          url ||= await freshUrl();
          const download = async () => readBytes(await fetchResource(sceneUrl(url, id), { signal: AbortSignal.timeout(30000) }), 16 * 1024 * 1024, '剧情脚本');
          try { bytes = await download(); }
          catch (error) {
            // A signed blob can expire while the game session is still valid.
            // Refresh that exact scene once; storage never receives API headers.
            if (cachedUrl && [401, 403, 404].includes(error.status) && access.headers['x-client-key'] && !blocked) { url = await freshUrl(); bytes = await download(); }
            else throw error;
          }
        }
        writeJson(file, sceneRows(bytes, id)); result.saved++;
      }
      if (!source.scenes.includes(id)) source.scenes.push(id);
    } catch (error) {
      if ([401, 403].includes(error.status)) result.authRequired = true;
      result.errors.push({ scene: id, character: scene.character, error: [401, 403].includes(error.status) ? sessionMessage : '剧情 ' + id + ' 未能下载或校验。' });
      result.missingSceneIds.push(id); result.failed++;
    }
    result.checked++; onProgress({ phase: 'scripts', scriptChecked: result.checked, scriptTargets: result.targets });
  }
  writeJson(sourceFile, source); return result;
}
export { fetchStories, cgScenes, readAccess, sceneUrl, sceneRows, dataSource, API };
