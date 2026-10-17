const fs = require('node:fs'), path = require('node:path');
const { writeAtomicFileSync } = require('../../../app/atomic-file.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { VERSION_URL, ORIGIN, TABLES, validVersion, hash, requestBytes, decodeTable, decodeManifest } = require('./format.ts');
const { readJson, writeJson, readCatalog, buildCatalog, STORY_SOURCE_VERSION } = require('./catalog.ts');
const { downloadUrls } = require('../../../app/download.ts');
async function missingIcons(root, catalog, fetchResource, onProgress) {
  const saved = readJson(path.join(root, 'metadata/exports.json'), {}), output = path.join(root, 'library');
  const icons = [...new Set<string>(catalog.characters.map(role => role.icon).filter(Boolean))].filter(logical => {
    const item = saved[logical], file = item?.file;
    if (typeof file !== 'string' || !/^images\/[A-Za-z0-9_.-]+\.png$/.test(file) || !fs.existsSync(path.join(output, file))) return true;
    return hash(fs.readFileSync(path.join(output, file)), 'md5') !== catalog.assets[logical]?.md5;
  });
  const specs = icons.map(logical => catalog.assets[logical]);
  if (specs.some(spec => !spec || !spec.logical.startsWith('image/') || !spec.url.startsWith(ORIGIN + '/'))) throw new Error('头像资源地址无效。');
  const wanted = new Map(specs.map(spec => [spec.url, spec]));
  return downloadUrls(root, specs.map(spec => ({ url: spec.url })), { fetchResource, concurrency: 4, maxBytes: 4 * 1024 * 1024,
    validate: async (bytes, entry) => {
      if (hash(bytes, 'md5') !== wanted.get(entry.url)?.md5) throw new Error('头像校验值不符。');
      const meta = await require('sharp')(bytes, { limitInputPixels: 4 * 1024 * 1024 }).metadata();
      if (meta.format !== 'png' || !meta.width || !meta.height) throw new Error('头像图片格式无效。');
    }, onProgress: state => onProgress({ phase: 'icons', targets: state.total, checked: state.done, saved: state.saved, skipped: state.skipped, failed: state.failed }) });
}
async function refreshCatalog(root, { fetchResource = fetchPublicResource, onProgress = () => {}, extractResources = require('./extract.ts').extract }: any = {}) {
  const directory = path.join(root, 'metadata'), source = readJson(path.join(directory, 'source.json'), {}), previous = readCatalog(root);
  let checked = 0; const targets = TABLES.length + 2, progress = phase => onProgress({ phase, checked, targets });
  progress('version'); let version;
  try { version = JSON.parse((await requestBytes(fetchResource, VERSION_URL, 64 * 1024)).toString('utf8')).version; } catch { throw new Error('游戏版本接口未返回有效结果，请重试。'); }
  if (!version || !['resourceVersion', 'masterVersion', 'clientVersion'].every(key => validVersion(version[key]))) throw new Error('游戏版本格式无效，已保留原清单。');
  checked++; progress('catalog');
  const staged: Record<string, string> = {}, digests: Record<string, string> = {}, tables = {};
  const cached = (name, unchanged) => {
    const file = path.join(directory, name + '.json'); if (!unchanged || !fs.existsSync(file)) return null;
    const bytes = fs.readFileSync(file); return source.digests?.[name] === hash(bytes) ? JSON.parse(bytes) : null;
  };
  let manifest = cached('manifest', source.resourceVersion === version.resourceVersion);
  if (!manifest) manifest = decodeManifest(await requestBytes(fetchResource, ORIGIN + '/' + version.resourceVersion + '/resource.json'));
  if (manifest.version !== version.resourceVersion) throw new Error('资源清单内容与版本不符。');
  staged.manifest = JSON.stringify(manifest); digests.manifest = hash(staged.manifest); checked++; progress('catalog');
  const results = await Promise.allSettled(TABLES.map(async name => {
    const rows = cached(name, source.masterVersion === version.masterVersion && (name !== 'StoryMain' || source.storySourceVersion === STORY_SOURCE_VERSION))
      || decodeTable(await requestBytes(fetchResource, ORIGIN + '/bin/' + name + '.bin', 16 * 1024 * 1024), name);
    tables[name] = rows; staged[name] = JSON.stringify(rows); digests[name] = hash(staged[name]); checked++; progress('catalog');
  }));
  const failed = results.find(result => result.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
  const captured = readJson(path.join(directory, 'captured-stories.json'), []), discovered = readJson(path.join(directory, 'story-resources.json'), []);
  const scenes = [...new Map([...captured, ...discovered].map(scene => [scene.storyId, scene])).values()], catalog = buildCatalog(tables, manifest, scenes, previous);
  const currentSource = { resourceVersion: version.resourceVersion, masterVersion: version.masterVersion, clientVersion: version.clientVersion, storySourceVersion: STORY_SOURCE_VERSION, digests };
  const files = { ...Object.fromEntries(Object.entries(staged).map(([name, text]) => [path.join(directory, name + '.json'), text])),
    [path.join(directory, 'catalog.json')]: JSON.stringify(catalog), [path.join(directory, 'source.json')]: JSON.stringify(currentSource) };
  const indexFile = path.join(root, 'library/index.json'), exportsFile = path.join(root, 'metadata/exports.json');
  const original = new Map<string, Buffer | null>([...Object.keys(files), indexFile, exportsFile].map(file => [file, fs.existsSync(file) ? fs.readFileSync(file) : null])); let icons;
  try {
    for (const [file, text] of Object.entries(files)) writeAtomicFileSync(file, text);
    icons = await missingIcons(root, catalog, fetchResource, onProgress);
    progress('indexing'); await extractResources(root, undefined, { metadataOnly: icons.total === 0 });
  } catch (error) {
    for (const [file, bytes] of original) if (bytes) writeAtomicFileSync(file, bytes); else if (fs.existsSync(file)) fs.unlinkSync(file);
    throw error;
  }
  return { checked, targets, failed: icons.failed, errors: icons.errors, iconSaved: icons.saved, iconSkipped: icons.skipped, resourceVersion: version.resourceVersion, masterVersion: version.masterVersion };
}
if (require.main === module) {
  const root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../../parsed-data/minashigo-x');
  require('../../../app/projects.ts').withPackLock(root, () => refreshCatalog(root, { onProgress: state => console.log(JSON.stringify(state)) }))
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
export { refreshCatalog };
