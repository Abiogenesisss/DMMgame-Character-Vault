import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { decodeMulti, encode } = require('@msgpack/msgpack');
const { ORIGIN, decodeData } = require('./format.ts');
const { buildCatalog, readCatalog, readJson } = require('./catalog.ts');
const { parseAddressables } = require('./addressables.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { catalogSession, requestBytes, MASTER_URL, NAMES } = require('./catalog-session.ts');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function masterManifest(bytes) {
  let value;
  try { const envelope = [...decodeMulti(bytes, { maxStrLength: 8192, maxArrayLength: 10000, maxMapLength: 10000 })]; value = decodeData(encode(envelope[1])); }
  catch { throw new Error('角色主数据接口格式无效。'); }
  if (!Array.isArray(value) || value.length !== 4 || typeof value[0] !== 'string'
    || !/^master-data\/\d{8}\/masterdata_\d+_\d+_\d+\.bin$/.test(value[0])
    || typeof value[1] !== 'string' || value[1].length > 8192 || !value[1].startsWith('?')
    || typeof value[2] !== 'string' || !/^\d+_\d+$/.test(value[2])
    || !Number.isSafeInteger(value[3])) throw new Error('角色主数据版本或地址无效。');
  const file = path.posix.basename(value[0]);
  if (!file.startsWith('masterdata_' + value[2] + '_')) throw new Error('角色主数据版本与文件不符。');
  const url = new URL('/production-private/' + value[0], ORIGIN); url.search = value[1];
  return { url: url.href, file, version: value[2] };
}

function mergeCatalog(previous, current) {
  const assets = { ...previous.assets, ...current.assets };
  for (const address of current.conflicts || []) delete assets[address];
  const known = new Map<string, any>(previous.characters.map(role => [role.id, role]));
  const characters = current.characters.map(role => {
    const old = known.get(role.id); if (!old) return role;
    const value = { ...role, icon: role.icon || old.icon,
      portal: Object.fromEntries(['background', 'teamLogo'].map(key => [key, role.portal?.[key] || old.portal?.[key] || null])) };
    for (const key of ['portraits', 'cardPortraits', 'cg', 'motions']) value[key] = [...new Set([...(role[key] || []), ...(old[key] || [])])].filter((address: string) => assets[address]);
    value.voices = [...new Map([...(old.voices || []), ...(role.voices || [])].filter(voice => assets[voice.address]).map(voice => [voice.address, voice])).values()];
    value.episodes = [...new Map([...(old.episodes || []), ...(role.episodes || [])].map(scene => [scene.sceneId, scene])).values()];
    return value;
  });
  const ids = new Set(characters.map(role => role.id));
  characters.push(...previous.characters.filter(role => !ids.has(role.id)));
  const scenes = [...new Map([...(previous.scenes || []), ...current.scenes].map(scene => [scene.sceneId, scene])).values()];
  return { ...current, characters, assets, scenes };
}

async function refreshCatalog(root, { fetchResource = fetchPublicResource, onProgress = () => {},
  parseCatalog = parseAddressables, extractResources = require('./extract.ts').extract }: any = {}) {
  const analysis = path.join(root, 'metadata'), oldSource = readJson(path.join(analysis, 'source.json'), {}), previous = readCatalog(root);
  let checked = 0;
  const progress = phase => onProgress({ phase, checked, targets: 11 });
  const step = phase => { checked++; progress(phase); };
  const get = async (url, limit, label, headers?) => (await requestBytes(fetchResource, url, limit, label, { headers })).bytes;
  progress('version');
  const session = await catalogSession(root, fetchResource); step('version');
  const source = { ...oldSource, ...session.source };
  const manifest = masterManifest(await get(MASTER_URL, 128 * 1024, '角色版本接口', session.headers)); step('catalog');
  const masterFile = path.join(analysis, manifest.file);
  let masterBytes = fs.existsSync(masterFile) ? fs.readFileSync(masterFile) : null;
  const masterChanged = oldSource.masterVersion !== manifest.version || !masterBytes || oldSource.masterDigest !== digest(masterBytes);
  if (masterChanged) masterBytes = await get(manifest.url, 64 * 1024 * 1024, '角色主数据');
  const master = decodeData(masterBytes);
  if (!Array.isArray(master) || master[1] !== manifest.version) throw new Error('角色主数据内容与版本不符，已保留原资源库。');
  step('catalog');
  const binaries = {}, hashes = {}, digests = {};
  let catalogChanged = masterChanged;
  const results = await Promise.allSettled(NAMES.map(async name => {
    const url = source.catalogUrls[name], hashUrl = url.replace(/\.bin$/, '.hash');
    const hash = (await get(hashUrl, 1024, '资源目录校验文件')).toString('utf8').trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(hash)) throw new Error('资源目录校验文件无效。');
    step('catalog');
    const file = path.join(analysis, name + '.bin');
    let bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!bytes || oldSource.catalogUrls?.[name] !== url || oldSource.catalogHashes?.[name] !== hash || oldSource.catalogDigests?.[name] !== digest(bytes)) {
      bytes = await get(url, 32 * 1024 * 1024, '资源目录'); catalogChanged = true;
    }
    const parsed = parseCatalog(bytes); binaries[file] = bytes; hashes[name] = hash; digests[name] = digest(bytes); step('catalog'); return parsed;
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  const catalogs = results.map(result => result.status === 'fulfilled' ? result.value : null);
  Object.assign(source, { masterFile: manifest.file, masterVersion: manifest.version, masterDigest: digest(masterBytes), catalogHashes: hashes, catalogDigests: digests });
  const current = buildCatalog(master, catalogs, source);
  if (!current.characters.length || !Object.keys(current.assets).length) throw new Error('新目录没有有效角色，已保留原资源库。');
  const catalog = mergeCatalog(previous, current);
  const files = { ...binaries, [masterFile]: masterBytes, [path.join(analysis, 'master-data.json')]: JSON.stringify(master),
    [path.join(analysis, 'source.json')]: JSON.stringify(source), [path.join(analysis, 'catalog.json')]: JSON.stringify(catalog) };
  const indexFile = path.join(root, 'library/index.json');
  const originals = new Map<string, Buffer | null>([...Object.keys(files), indexFile].map(file => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
  try {
    for (const [file, bytes] of Object.entries(files)) writeAtomicFileSync(file, bytes as string | Buffer);
    progress('indexing');
    await extractResources(root, undefined, { roles: [], scope: 'catalog' });
  } catch (error) {
    for (const [file, bytes] of originals) { if (bytes) writeAtomicFileSync(file, bytes); else if (fs.existsSync(file)) fs.unlinkSync(file); }
    throw error;
  }
  return { masterVersion: manifest.version, catalogChanged, targets: 11, checked, failed: 0 };
}

if (require.main === module) {
  const root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../../parsed-data/muvluv-ggx');
  require('../../../app/projects.ts').withPackLock(root, () => refreshCatalog(root, { onProgress: progress => console.log(JSON.stringify(progress)) }))
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
export { refreshCatalog, masterManifest, mergeCatalog, MASTER_URL };
