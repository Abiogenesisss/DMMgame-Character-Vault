import fs from 'node:fs';
import path from 'node:path';
import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
import { loadPack, routeKey, saveManifest, sha256 } from '../../../app/pack.ts';
import { acquirePackLock, withPackLock } from '../../../app/projects.ts';
import { parseFileList } from './file-list.ts';
import { selectCatalogHar, harBody } from './catalog-har.ts';
import { table } from './format.ts';
import { buildCatalog, readCatalog } from './catalog.ts';
import { attachArtists, cachedArtistMetadata } from './artists.ts';
import { extract } from './extract.ts';

async function importCatalogHar(root, har, { onProgress = (_state: any) => {} } = {}) {
  const selected = selectCatalogHar(har).log.entries, listUrl = selected[0].request.url;
  function resource(spec, validate) {
    const entry = selected.find(entry => entry.request.url === spec.url), captured = entry && harBody(entry.response.content);
    if (captured) {
      const bytes = Buffer.from(captured);
      if (spec.size != null && bytes.length !== spec.size) throw new Error('HAR 目录数据的长度与清单不符。');
      validate(bytes);
      const pack = loadPack(path.join(root, 'cache')), body = sha256(bytes);
      writeAtomicFileSync(path.join(pack.root, 'bodies', body), bytes);
      pack.manifest.routes[routeKey('GET', spec.url)] = [{ url: spec.url, method: 'GET', status: 200, body, size: bytes.length,
        headers: [], mimeType: 'application/octet-stream', requestBodyHash: sha256(Buffer.alloc(0)), range: '', source: 'aigis-catalog-har' }];
      saveManifest(pack.root, pack.manifest);
      return bytes;
    }
    throw new Error('HAR 缺少必要的清单或名称表响应正文，请重新导出包含响应内容的 HAR。');
  }
  onProgress({ phase: 'catalog', checked: 0, targets: 2 });
  const listBytes = resource({ url: listUrl }, parseFileList), parsed = parseFileList(listBytes);
  const nameSpec = parsed.entries.find(entry => entry.name === 'NameText.atb');
  if (!nameSpec) throw new Error('资源清单缺少角色名称表。');
  onProgress({ phase: 'catalog', checked: 1, targets: 2 });
  const names = table(resource(nameSpec, table)).rows;
  if (!names.length || names.some(row => typeof row.Message !== 'string')) throw new Error('角色名称表格式无效。');
  const previous = fs.existsSync(path.join(root, 'metadata/catalog.json')) ? readCatalog(root) : { characters: [], icons: [] };
  const unitsFile = path.join(root, 'metadata/unit-metadata.json');
  let units = [], rarityIssue;
  try { if (fs.existsSync(unitsFile)) units = JSON.parse(fs.readFileSync(unitsFile, 'utf8')); if (!Array.isArray(units)) throw new Error('稀有度资料格式无效。'); }
  catch (error) { units = []; rarityIssue = error.message; }
  const catalog = buildCatalog(parsed.entries, names, units);
  if (rarityIssue) catalog.rarityIssue = rarityIssue;
  if (!catalog.characters.length) throw new Error('清单中没有有效角色，已保留原角色列表。');
  const old = new Map<string, any>(previous.characters.map(character => [character.id, character]));
  const addedIds = catalog.characters.filter(character => !old.has(character.id)).map(character => character.id);
  for (const character of catalog.characters) {
    const before = old.get(character.id); if (!before) continue;
    for (const category of ['portraits', 'cg']) {
      const present = new Set(character[category].map(spec => spec.name));
      character[category].push(...before[category].filter(spec => !present.has(spec.name)));
    }
    character.portraits.sort((a, b) => a.phase.localeCompare(b.phase));
    if (before.name === character.name && character.rarityId == null) {
      for (const key of ['rarityId', 'rarityLabel', 'rarityCode']) character[key] = before[key];
    }
    if (before.name === character.name) { character.artists = before.artists; character.artistSource = before.artistSource; }
    old.delete(character.id);
  }
  // Retain retired identities and mappings so saved art remains reachable.
  catalog.characters.push(...old.values()); catalog.characters.sort((a, b) => a.id.localeCompare(b.id));
  const iconNames = new Set(catalog.icons.map(spec => spec.name));
  catalog.icons.push(...(previous.icons || []).filter(spec => !iconNames.has(spec.name)));
  try { attachArtists(catalog, cachedArtistMetadata(root)); } catch (error) { catalog.artistIssue = error.message; }
  catalog.resourceSignature = sha256(Buffer.concat([Buffer.from(parsed.text), Buffer.from(JSON.stringify(names))]));
  const files = ['metadata/catalog.json', 'metadata/source.json', 'metadata/filelist.txt', 'library/index.json'];
  const backups = files.map(relative => { const file = path.join(root, relative); return { file, bytes: fs.existsSync(file) ? fs.readFileSync(file) : null }; });
  onProgress({ phase: 'indexing', checked: 2, targets: 2 });
  try {
    writeAtomicFileSync(path.join(root, 'metadata/catalog.json'), JSON.stringify(catalog));
    // Empty roles deliberately refresh metadata without decoding cached art or icons.
    const index = extract(root, undefined, { roles: [], scope: 'catalog' });
    writeAtomicFileSync(path.join(root, 'metadata/filelist.txt'), parsed.text);
    writeAtomicFileSync(path.join(root, 'metadata/source.json'), JSON.stringify({ fileListUrl: listUrl, loadedFileListUrl: listUrl, imported: new Date().toISOString() }));
    return { addedIds, added: addedIds.length, stats: index.stats, failed: 0, checked: 2, targets: 2 };
  } catch (error) {
    for (const backup of backups) {
      if (backup.bytes) writeAtomicFileSync(backup.file, backup.bytes);
      else if (fs.existsSync(backup.file)) fs.unlinkSync(backup.file);
    }
    throw error;
  }
}
function createDiscoveryService({ root, origin }) {
  return { async handle(request: Request) {
    const url = new URL(request.url);
    if (url.origin !== origin || url.pathname !== '/api/discover') return null;
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    if (request.method !== 'POST') return json({ error: '请求方式有误。' }, 405);
    let har;
    try { har = selectCatalogHar((await request.json())?.har); }
    catch (error) { return json({ error: error.message }, 400); }
    let release;
    try { release = acquirePackLock(root); }
    catch { return json({ error: '千年战争资源正在处理，请等当前任务完成。' }, 409); }
    const state: any = { state: 'running', type: 'catalog', scope: 'catalog', phase: 'catalog', roles: [], checked: 0, targets: 2, failed: 0, pid: process.pid, started: new Date().toISOString() };
    const save = patch => { Object.assign(state, patch); writeAtomicFileSync(path.join(root, 'state/aigis-status.json'), JSON.stringify(state)); };
    try { save({}); } catch (error) { release(); throw error; }
    const initial = { ...state };
    Promise.resolve().then(async () => {
      try { save({ ...await importCatalogHar(root, har, { onProgress: save }), state: 'ready', finished: new Date().toISOString() }); }
      catch (error) { save({ state: 'failed', error: error.message, finished: new Date().toISOString() }); }
      finally { release(); }
    }).catch(error => console.error(error.message));
    return json(initial, 202);
  } };
}
if (require.main === module) {
  const input = process.argv[2];
  if (!input) throw new Error('用法：npm run import:aigis:catalog -- aigis.har');
  const root = require('./paths.ts').root;
  withPackLock(root, () => importCatalogHar(root, JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''))))
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
export { importCatalogHar, createDiscoveryService };
