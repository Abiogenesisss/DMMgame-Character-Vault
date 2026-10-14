'use strict';
const fs = require('node:fs'), path = require('node:path');
const { downloadUrls } = require('../../app/download.ts');
const { fetchPublicResource } = require('../../app/public-fetch.ts');
const { canonicalId, readCatalog } = require('./catalog.ts');
const { archive, decompress } = require('./format.ts');
const { extract } = require('./extract.ts');
function collectionScope(scope = 'all') {
  if (!['all', 'portraits', 'cg'].includes(scope)) throw new Error('千年战争只支持立绘和 CG 下载。');
  return scope;
}
async function collect(root, { roles, scope = 'all', retryMissing = false, fetchResource = fetchPublicResource }: any = {}) {
  scope = collectionScope(scope);
  if (!Array.isArray(roles) || !roles.length || roles.some(id => !canonicalId(id))) throw new Error('请指定千年战争角色编号。');
  roles = [...new Set<string>(roles.map(canonicalId))]; const catalog = readCatalog(root);
  if (roles.some(id => !catalog.characters.some(character => character.id === id))) throw new Error('角色未被索引。');
  const queue = [...new Map<any, any>(catalog.characters.filter(character => roles.includes(character.id))
    .flatMap(character => [...(scope !== 'cg' ? character.portraits : []), ...(scope !== 'portraits' ? character.cg : [])]).map(spec => [spec.url, spec])).values()];
  if (queue.some(spec => !spec.url.startsWith(require('./format.ts').BASE) || !/^\/[a-f0-9]{40}\/[a-z0-9]{32}$/.test(new URL(spec.url).pathname))) throw new Error('千年战争资源地址无效。');
  const directory = path.join(root, 'state'); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'aigis-status.json'), absentFile = path.join(directory, 'aigis-unavailable.json');
  const unavailable = fs.existsSync(absentFile) ? JSON.parse(fs.readFileSync(absentFile, 'utf8')) : {};
  const targets = queue.filter(spec => retryMissing || !unavailable[spec.url]), absent = new Set<string>();
  const state = { state: 'running', scope, roles, targets: targets.length, checked: 0, saved: 0, skipped: 0, failed: 0, unavailable: queue.length - targets.length, started: new Date().toISOString(), pid: process.pid };
  const persist = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(state)); fs.renameSync(file + '.tmp', file); };
  persist();
  try {
    const result = targets.length ? await downloadUrls(root, targets, { maxBytes: 32 * 1024 * 1024,
      fetchResource: async (url, options) => {
        const response = await fetchResource(url, options);
        if ([403, 404].includes(response.status)) { absent.add(url); unavailable[url] = { status: response.status, checked: new Date().toISOString() }; }
        else if (response.status === 200) delete unavailable[url];
        return response;
      },
      validate: bytes => { if (!archive(bytes).some(member => ['ALTX', 'ALIG'].includes(decompress(member.bytes).toString('ascii', 0, 4)))) throw new Error('归档中没有静态图片。'); },
      onProgress: progress => { Object.assign(state, { checked: progress.done, saved: progress.saved, skipped: progress.skipped, failed: progress.failed }); persist(); }
    }) : { saved: 0, skipped: 0, failed: 0, errors: [], done: 0 };
    const errors = result.errors.filter(error => !absent.has(error.url));
    fs.writeFileSync(absentFile + '.tmp', JSON.stringify(unavailable)); fs.renameSync(absentFile + '.tmp', absentFile);
    const index = extract(root, undefined, { roles, scope });
    const issues = index.issues.filter(issue => roles.includes(issue.character));
    const placeholders = index.characters.filter(character => roles.includes(character.id)).reduce((total, character) => total + character.placeholders.filter(item => scope === 'all' || item.category === scope).length, 0);
    Object.assign(state, { state: errors.length || issues.length ? 'partial' : 'ready', checked: result.done, saved: result.saved, skipped: result.skipped,
      failed: errors.length + issues.length, errors: [...errors, ...issues], unavailable: state.unavailable + absent.size, placeholders, stats: index.stats, finished: new Date().toISOString() });
    persist(); return state;
  } catch (error) { Object.assign(state, { state: 'failed', error: error.message }); persist(); throw error; }
}
if (require.main === module) {
  const option = flag => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
  const root = require('./paths.ts').root;
  require('../../app/projects.ts').withPackLock(root, () => collect(root, { roles: option('--roles')?.split(','), scope: option('--scope'), retryMissing: process.argv.includes('--retry-missing') }))
    .then(result => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
export { collect, collectionScope };
