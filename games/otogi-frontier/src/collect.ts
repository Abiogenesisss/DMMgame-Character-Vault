import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { downloadUrls } = require('../../../app/download.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { readCatalog, readJson } = require('./catalog.ts');
const { canonicalId } = require('./identity.ts');
const { resourceKind, decodeBundle } = require('./format.ts');
const { extract } = require('./extract.ts');
const { downloadStories } = require('./story-download.ts');
function collectionScope(scope = 'all') {
  if (!['all', 'portraits', 'cg', 'motions', 'voices', 'stories'].includes(scope)) throw new Error('童话边境支持立绘、CG、剧情和配套语音下载。');
  return scope;
}
async function collect(root, { roles, scope = 'all', retryMissing = false, fetchResource = fetchPublicResource, extractResources = extract, scriptHeaders }: any = {}) {
  scope = collectionScope(scope); const catalog = readCatalog(root);
  if (!Array.isArray(roles) || !roles.length || roles.some(id => !canonicalId(id, catalog))) throw new Error('请指定童话边境角色编号。');
  roles = [...new Set(roles.map(id => canonicalId(id, catalog)))];
  if (roles.some(id => !catalog.characters.some(character => character.id === id))) throw new Error('角色未被索引。');
  const library = readJson(path.join(root, 'library/index.json'), { characters: [] });
  const saved = new Map<any, any>(library.characters.map(character => [character.id, character]));
  const icons = roles.some(id => !saved.get(id)?.icon || !fs.existsSync(path.join(root, 'library', saved.get(id).icon))) ? catalog.icons : [];
  const iconUrls = new Set(icons.map(spec => spec.url));
  const scripts = scope === 'stories' ? await downloadStories(root, catalog, roles, { fetchResource, headers: scriptHeaders, refresh: retryMissing }) : { stories: [], errors: [] };
  const queue = [...new Map([...catalog.characters.filter(character => roles.includes(character.id)).flatMap(character => [
    ...(['all', 'portraits'].includes(scope) ? character.portraits : []), ...(['all', 'cg', 'motions', 'stories'].includes(scope) ? character.cg : []), ...(['all', 'voices'].includes(scope) ? character.voices : [])
  ]), ...icons, ...scripts.stories.flatMap(({ story }) => story.dependencies)].map(spec => [spec.url, spec])).values()];
  if (queue.some(spec => !['icons', 'portraits', 'cg', 'voices', 'backgrounds', 'music', 'sound'].includes(resourceKind(spec.url)))) throw new Error('童话边境资源地址无效。');
  const directory = path.join(root, 'state'); fs.mkdirSync(directory, { recursive: true });
  const status = path.join(directory, 'otogi-status.json'), absentFile = path.join(directory, 'otogi-unavailable.json'), unavailable = readJson(absentFile, {});
  const absent = new Set<string>(), targets = queue.filter(spec => iconUrls.has(spec.url) || retryMissing || !unavailable[spec.url]);
  const state = { state: 'running', scope, roles, targets: targets.length, checked: 0, saved: 0, skipped: 0, failed: 0, unavailable: queue.length - targets.length, started: new Date().toISOString(), pid: process.pid };
  const persist = () => writeAtomicFileSync(status, JSON.stringify(state)); persist();
  try {
    const result = targets.length ? await downloadUrls(root, targets, { maxBytes: 80 * 1024 * 1024,
      fetchResource: async (url, options) => {
        const response = await fetchResource(url, options);
        if ([403, 404].includes(response.status) && !iconUrls.has(url)) { absent.add(url); unavailable[url] = { status: response.status, checked: new Date().toISOString() }; }
        else if (response.status === 200) delete unavailable[url]; return response;
      }, validate: async bytes => decodeBundle(bytes, await require('./prepare.ts').ensureCodec(root, bytes, { fetchResource })), onProgress: progress => { Object.assign(state, { checked: progress.done, saved: progress.saved, skipped: progress.skipped, failed: progress.failed }); persist(); }
    }) : { saved: 0, skipped: 0, failed: 0, errors: [], done: 0 };
    writeAtomicFileSync(absentFile, JSON.stringify(unavailable));
    const index = await extractResources(root, undefined, { roles, scope }), issues = index.issues.filter(issue => !issue.character || roles.includes(issue.character)), errors = [...result.errors.filter(error => !absent.has(error.url)), ...scripts.errors];
    Object.assign(state, { state: errors.length || issues.length ? 'partial' : 'ready', checked: result.done, saved: result.saved, skipped: result.skipped, unavailable: state.unavailable + absent.size,
      failed: errors.length + issues.length, errors: [...errors, ...issues], stats: index.stats, finished: new Date().toISOString() }); persist(); return state;
  } catch (error) { Object.assign(state, { state: 'failed', error: error.message, finished: new Date().toISOString() }); persist(); throw error; }
}
if (require.main === module) {
  const option = flag => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
  const root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../../parsed-data/otogi-frontier');
  require('../../../app/projects.ts').withPackLock(root, () => collect(root, { roles: option('--roles')?.split(','), scope: option('--scope'), retryMissing: process.argv.includes('--retry-missing') }))
    .then(result => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
export { collect, collectionScope };
