const path = require('node:path');
const { downloadUrls } = require('../../../app/download.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { readCatalog, writeJson } = require('./catalog.ts');
const { validId, resourceKind, hash } = require('./format.ts');
function collectionScope(value = 'all') {
  if (!['all', 'catalog', 'portraits', 'cg', 'voices', 'stories', 'ui'].includes(value)) throw new Error('下载分类有误。'); return value;
}
function assetPaths(catalog, { roles, scope = 'all' }: any = {}) {
  collectionScope(scope);
  if (roles && (!Array.isArray(roles) || !roles.length || roles.some(id => !validId(id) || !catalog.characters.some(role => role.id === id)))) throw new Error('请指定已索引的角色。');
  const resources = [];
  for (const role of catalog.characters.filter(role => !roles || roles.includes(role.id))) {
    if (scope === 'catalog') { if (role.icon) resources.push(role.icon); continue; }
    if (['all', 'portraits'].includes(scope)) resources.push(...role.portraits, ...(role.icon ? [role.icon] : []));
    if (['all', 'cg'].includes(scope)) resources.push(...role.cg);
    if (['all', 'voices'].includes(scope)) resources.push(...role.voices.map(voice => voice.path));
    if (['all', 'stories'].includes(scope)) resources.push(...role.stories.flatMap(story => story.resources));
  }
  return [...new Set<string>(resources)];
}
async function collect(root, { roles, scope = 'all', fetchResource = fetchPublicResource, onProgress = () => {}, extractResources = require('./extract.ts').extract }: any = {}) {
  collectionScope(scope); let catalog = readCatalog(root); assetPaths(catalog, { roles, scope });
  const file = path.join(root, 'state/minashigo-status.json');
  const state: any = { state: 'running', roles: roles || [], scope, targets: 0, checked: 0, failed: 0, pid: process.pid, started: new Date().toISOString() };
  const save = patch => { Object.assign(state, patch); writeJson(file, state); onProgress(state); }; save({});
  try {
    let mappingErrors = [];
    if (['all', 'stories', 'ui'].includes(scope)) {
      try { await require('./story-ui.ts').ensureStoryUi(root, { fetchResource, onProgress: save }); }
      catch (error) { mappingErrors.push({ error: error.message }); }
    }
    if (['all', 'cg', 'stories'].includes(scope)) {
      const discovered = await require('./discover-stories.ts').discoverStories(root, { roles, scope, fetchResource, onProgress: save });
      catalog = discovered.catalog; mappingErrors.push(...discovered.errors);
    }
    const targets = assetPaths(catalog, { roles, scope }).map(logical => catalog.assets[logical]);
    if (targets.some(spec => !spec || resourceKind(spec.url) !== 'asset')) throw new Error('素材下载地址无效。');
    const wanted = new Map(targets.map(spec => [spec.url, spec])); save({ targets: targets.length, checked: 0 });
    const result = await downloadUrls(root, targets.map(spec => ({ url: spec.url })), { fetchResource, concurrency: 4, maxBytes: 32 * 1024 * 1024,
      validate: (bytes, record) => { const spec = wanted.get(record.url); if (!spec || hash(bytes, 'md5') !== spec.md5) throw new Error('素材校验值不符。'); },
      onProgress: progress => save({ phase: 'assets', checked: progress.done, saved: progress.saved, skipped: progress.skipped, failed: progress.failed }) });
    save({ phase: 'extracting' }); const index = await extractResources(root);
    const issues = index.issues.filter(issue => !issue.character || !roles || roles.includes(issue.character));
    const incomplete = ['all', 'stories'].includes(scope) ? index.stories.filter(story => !story.complete && (!roles || roles.includes(story.character))) : [];
    save({ state: result.failed || issues.length || incomplete.length || mappingErrors.length ? 'partial' : 'ready', checked: result.done, saved: result.saved, skipped: result.skipped,
      failed: result.failed + issues.length + incomplete.length + mappingErrors.length, errors: [...mappingErrors, ...result.errors, ...issues, ...incomplete.map(story => ({ character: story.character, error: '剧情缺少 ' + story.missingAssets + ' 项播放资源。' }))], stats: index.stats, finished: new Date().toISOString() });
    return state;
  } catch (error) { save({ state: 'failed', failed: 1, error: error.message, finished: new Date().toISOString() }); throw error; }
}
if (require.main === module) {
  const option = flag => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
  const root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../../parsed-data/minashigo-x');
  require('../../../app/projects.ts').withPackLock(root, () => collect(root, { roles: option('--roles')?.split(','), scope: option('--scope') }))
    .then(result => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
export { collect, collectionScope, assetPaths };
