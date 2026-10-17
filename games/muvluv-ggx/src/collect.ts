'use strict';
const fs = require('node:fs'), path = require('node:path');
const { downloadUrls } = require('../../../app/download.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { resourceKind } = require('./format.ts');
const { readCatalog, prepareCatalog, readJson, writeJson } = require('./catalog.ts');
const { ensureStoryUi } = require('./story-ui.ts');
function collectionScope(scope = 'all') {
  if (!['all', 'catalog', 'portraits', 'cg', 'motions', 'voices', 'stories', 'ui'].includes(scope)) throw new Error('下载分类有误。');
  return scope;
}
function assetAddresses(catalog, { roles, scope = 'all' }: any = {}) {
  scope = collectionScope(scope);
  const chosen = roles || catalog.characters.map(character => character.id);
  if (!Array.isArray(chosen) || !chosen.length || chosen.some(id => !catalog.characters.some(character => character.id === id))) throw new Error('请指定已索引的角色编号。');
  if (scope === 'ui') return [];
  const addresses = [];
  const baseCards = new Set([...catalog.characters].sort((a, b) => (a.styleOrder ?? Number(a.id)) - (b.styleOrder ?? Number(b.id)))
    .filter((character, index, all) => !all.slice(0, index).some(previous => (previous.personId ?? previous.id) === (character.personId ?? character.id))).map(character => character.id));
  for (const character of catalog.characters.filter(character => chosen.includes(character.id))) {
    if (['all', 'catalog', 'portraits'].includes(scope)) addresses.push(...Object.values<string>(character.portal || {}).filter(Boolean));
    if (['all', 'portraits'].includes(scope) || scope === 'catalog' && baseCards.has(character.id)) addresses.push(...character.portraits);
    if (['all', 'portraits'].includes(scope)) addresses.push(...(character.cardPortraits || []));
    if (['all', 'cg', 'motions'].includes(scope)) addresses.push(...(scope === 'motions' ? [] : character.cg), ...character.motions);
    if (['all', 'voices'].includes(scope)) addresses.push(...character.voices.map(voice => voice.address));
  }
  if (['all', 'stories'].includes(scope)) {
    const { cachedStories } = require('./story.ts');
    for (const story of cachedStories(catalog.root, catalog, chosen)) addresses.push(...story.assets);
  }
  return [...new Set(addresses)];
}
async function collect(root, { roles, scope = 'all', retryMissing = false, fetchResource = fetchPublicResource,
  extractResources = (...args) => require('./extract.ts').extract(...args), prepareUi = ensureStoryUi }: any = {}) {
  scope = collectionScope(scope);
  const catalog = scope === 'catalog' ? await prepareCatalog(root, { fetchResource }) : readCatalog(root); catalog.root = root;
  assetAddresses(catalog,{roles,scope:'catalog'});
  const file = path.join(root, 'state/muvluv-status.json'), unavailableFile = path.join(root, 'state/muvluv-unavailable.json');
  const unavailable = readJson(unavailableFile, {}), absent = new Set<string>();
  const state = { state: 'running', scope, roles: roles || [], targets: 0, checked: 0, saved: 0, skipped: 0, failed: 0, unavailable: 0, started: new Date().toISOString(), pid: process.pid };
  const persist = () => writeJson(file, state); persist();
  const ui = { targets: 0, checked: 0, saved: 0, skipped: 0 };
  try {
    if (['all', 'stories', 'ui'].includes(scope)) await prepareUi(root, { fetchResource, onProgress: progress => {
      Object.assign(ui, progress); Object.assign(state, progress); persist();
    } });
    const scripts=['all','stories'].includes(scope)?await require('./fetch-stories.ts').fetchStories(root,catalog,{roles,fetchResource,onProgress:p=>{Object.assign(state,p,{checked:p.scriptChecked,targets:p.scriptTargets});persist();}}):{failed:0,errors:[]};
    const addresses=assetAddresses(catalog,{roles,scope}),targets=[...new Set(addresses.flatMap(address=>catalog.assets[address]?.bundles||[]))].map(url=>({url}));
    if(targets.some(target=>resourceKind(target.url)!=='bundle'))throw new Error('下载地址不是该游戏的公开素材包。');
    const queue=targets.filter(target=>retryMissing||!unavailable[target.url]);Object.assign(state,{phase:scope==='ui'?'ui':'assets',targets:ui.targets+queue.length,checked:ui.checked,unavailable:targets.length-queue.length});persist();
    const result = queue.length ? await downloadUrls(root, queue, { concurrency: 4, maxBytes: 80 * 1024 * 1024,
      fetchResource: async (url, options) => {
        if (resourceKind(url) !== 'bundle') throw new Error('素材地址无效。');
        const response = await fetchResource(url, options);
        if (response.status === 404) { absent.add(url); unavailable[url] = { status: 404, checked: new Date().toISOString() }; }
        if (response.status === 200) delete unavailable[url]; return response;
      },
      validate: bytes => { if (bytes.length < 48 || bytes.subarray(0, 8).toString('ascii') !== 'UnityFS\0') throw new Error('下载内容不是完整的 Unity 素材包。'); },
      onProgress: progress => { Object.assign(state, { checked: ui.checked+progress.done, saved: ui.saved+progress.saved, skipped: ui.skipped+progress.skipped, failed: progress.failed }); persist(); }
    }) : { done: 0, saved: 0, skipped: 0, failed: 0, errors: [] };
    writeJson(unavailableFile, unavailable);
    const index = await extractResources(root, undefined, { roles, scope });
    const issues = (index.issues || []).filter(issue => !roles || roles.includes(issue.character));
    const incomplete = ['all', 'stories'].includes(scope) ? (index.stories || []).filter(story => story.complete === false && (!roles || roles.includes(story.character)))
      .map(story => ({ character: story.character, scene: story.id, error: '剧情尚未完整：已保存 ' + story.segments + '/' + story.expectedSegments + ' 段脚本，缺少 ' + story.missingAssets + ' 项播放资源。' })) : [];
    const errors = [...scripts.errors,...result.errors.filter(error => !absent.has(error.url)), ...incomplete];
    Object.assign(state, { state: errors.length || issues.length ? 'partial' : 'ready', checked: ui.checked+result.done, saved: ui.saved+result.saved, skipped: ui.skipped+result.skipped,
      unavailable: state.unavailable + absent.size, failed: errors.length + issues.length, errors: [...errors, ...issues], authRequired:!!scripts.authRequired,missingSceneIds:scripts.missingSceneIds||[],stats: index.stats, finished: new Date().toISOString() });
    persist(); return state;
  } catch (error) { Object.assign(state, { state: 'failed', error: error.message, finished: new Date().toISOString() }); persist(); throw error; }
}
if (require.main === module) {
  const option = flag => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
  const root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../../parsed-data/muvluv-ggx');
  require('../../../app/projects.ts').withPackLock(root, () => collect(root, { roles: option('--roles')?.split(','), scope: option('--scope'), retryMissing: process.argv.includes('--retry-missing') }))
    .then(result => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
export { collect, collectionScope, assetAddresses };
