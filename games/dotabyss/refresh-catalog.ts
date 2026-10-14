'use strict';
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { ORIGIN, validId } = require('./format.ts');
const { readCatalog, readJson, writeJson, buildCatalog, mergeCatalog } = require('./catalog.ts');
const { publicVersion, readResponse } = require('./public-version.ts');
const { parseAddressables } = require('./addressables.ts');
const { fetchPublicResource } = require('../../app/public-fetch.ts');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function refreshCatalog(root, { ids = [], fetchResource = fetchPublicResource, onProgress = () => {},
  resolveVersion = publicVersion, parseCatalog = parseAddressables,
  collectResources = require('./collect.ts').collect, extractResources = require('./extract.ts').extract }: any = {}) {
  if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => !validId(id))) throw new Error('角色编号格式有误。');
  const analysis = path.join(root, 'metadata'), previous = readCatalog(root), sourceFile = path.join(analysis, 'source.json');
  const oldSource = readJson(sourceFile, {}), binaryFile = path.join(analysis, 'catalog.bin');
  const version = await resolveVersion(root, { fetchResource, onProgress });
  const expectedBase = ORIGIN + '/resources/webgl/r18/aas/' + version.assetVersion + '/aa/';
  if (!/^[1-9]\d{0,11}$/.test(version.assetVersion) || version.bundleBase !== expectedBase || version.catalogUrl !== expectedBase + 'catalog_1.bin' || version.hashUrl !== expectedBase + 'catalog_1.hash') throw new Error('资源目录版本地址无效。');
  onProgress({ phase: 'catalog', checked: 0, targets: 0 });
  const hash = (await readResponse(await fetchResource(version.hashUrl, { signal: AbortSignal.timeout(30000) }), 1024, '资源目录校验文件')).toString('utf8').trim();
  if (!/^[a-f0-9]{32}$/i.test(hash)) throw new Error('资源目录校验文件格式无效。');
  let bytes = fs.existsSync(binaryFile) ? fs.readFileSync(binaryFile) : null;
  const changed = oldSource.catalogUrl !== version.catalogUrl || oldSource.catalogHash !== hash || !bytes || oldSource.catalogDigest !== digest(bytes);
  let catalog = previous;
  const source = { ...oldSource, ...version, catalogHash: hash };
  if (changed || !catalog.characters.length) {
    bytes = await readResponse(await fetchResource(version.catalogUrl, { signal: AbortSignal.timeout(60000) }), 64 * 1024 * 1024, '资源目录');
    const current = buildCatalog(parseCatalog(bytes).locations, source, readJson(path.join(analysis, 'characters.json'), {}));
    if (!current.characters.length || !Object.keys(current.assets).length) throw new Error('新版目录没有有效的角色，已保留原资源库。');
    catalog = mergeCatalog(previous, current); source.catalogDigest = digest(bytes); catalog.source = source;
  }
  const library = readJson(path.join(root, 'library/index.json'), { characters: [] });
  const known = new Map<any, any>(library.characters.map(role => [role.id, role]));
  const exported = readJson(path.join(analysis, 'exports.json'), {});
  const hasScript = role => role.stories.some(address => {
    const file = exported[address]?.script?.file;
    return typeof file === 'string' && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && fs.existsSync(path.join(root, 'library', file));
  });
  const roles = catalog.characters.filter(role => {
    const saved = known.get(role.id);
    return ids.includes(role.id) || !saved || role.icon && !saved.icon || role.stories.length && saved.name?.startsWith('角色 ') && (changed || !hasScript(role));
  }).map(role => role.id);
  const result = { assetVersion: version.assetVersion, previousVersion: /\/aas\/(\d+)\//.exec(oldSource.catalogUrl || '')?.[1] || null, catalogChanged: changed, targets: 0, checked: 0, failed: 0 };
  if (!changed && !roles.length) return result;
  // Validate and merge before replacing any library metadata. Roll back metadata
  // on unexpected extraction errors; downloaded files remain resumable.
  const files = [sourceFile, binaryFile, path.join(analysis, 'catalog.json'), path.join(root, 'library/index.json')];
  const originals = files.map(file => fs.existsSync(file) ? fs.readFileSync(file) : null);
  try {
    fs.mkdirSync(analysis, { recursive: true });
    fs.writeFileSync(binaryFile + '.tmp', bytes); fs.renameSync(binaryFile + '.tmp', binaryFile);
    writeJson(path.join(analysis, 'catalog.json'), catalog); writeJson(sourceFile, source);
    if (roles.length) {
      const state = await collectResources(root, { roles, scope: 'catalog', fetchResource, onProgress: progress => onProgress({ ...progress, phase: 'icons' }) });
      return { ...state, ...result, targets: state.targets, checked: state.checked, failed: state.failed, phase: 'indexing' };
    }
    onProgress({ phase: 'indexing', checked: 0, targets: 0 });
    await extractResources(root, undefined, { roles: [], scope: 'catalog' });
    return result;
  } catch (error) {
    files.forEach((file, index) => {
      if (originals[index]) { fs.writeFileSync(file + '.tmp', originals[index]); fs.renameSync(file + '.tmp', file); }
      else if (fs.existsSync(file)) fs.unlinkSync(file);
    });
    throw error;
  }
}
if (require.main === module) {
  const root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../parsed-data/dotabyss');
  const at = process.argv.indexOf('--ids');
  const ids = require('./discovery.ts').parseIds(at < 0 ? '' : process.argv[at + 1]);
  require('../../app/projects.ts').withPackLock(root, () => refreshCatalog(root, { ids, onProgress: progress => console.log(JSON.stringify({ phase: progress.phase, checked: progress.checked, targets: progress.targets })) }))
    .then(result => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
export { refreshCatalog };
