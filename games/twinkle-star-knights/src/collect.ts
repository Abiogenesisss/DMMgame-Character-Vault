import path from 'node:path';
import { Resources, eachLimit, readJson, writeJson, validId } from './resources.ts';
import { readCatalog, prepareCatalog } from './catalog.ts';
import { extract, exportAssets, roleAssetIds, selectScopes } from './extract.ts';
import { storyProgram } from './story.ts';
import { ensureStoryUi, readStoryUi } from './story-ui.ts';
export function collectionScope(value: unknown = 'all') { if (typeof value !== 'string' || !['all', 'catalog', 'portraits', 'cg', 'motions', 'stories', 'voices', 'ui'].includes(value)) throw new Error('下载分类无效。'); return value; }
export async function collect(root: string, options: any = {}) {
  const resources = new Resources(root, options.fetchResource), scope = collectionScope(options.scope), roles: string[] = options.roles || [];
  const state: any = { state: 'running', scope, roles, pid: process.pid, targets: 0, checked: 0, failed: 0, errors: [] };
  const publish = () => writeJson(path.join(root, 'state/twinkle-status.json'), state); publish();
  try {
    let catalog = readCatalog(root);
    if (catalog.version !== 3 && scope !== 'catalog') {
      state.phase = 'catalog'; publish(); catalog = await prepareCatalog(root, { resources });
    }
    if (scope === 'catalog') {
      state.type = 'catalog'; state.phase = 'catalog'; publish(); const known = new Set(catalog.characters.map(c => c.id));
      catalog = await prepareCatalog(root, { resources, refresh: true });
      state.addedIds = catalog.characters.filter(c => !known.has(c.id)).map(c => c.id); state.added = state.addedIds.length;
    } else if (!roles.length || roles.some(id => !validId(id) || !catalog.characters.some(c => c.id === id))) throw new Error('角色未被索引。');
    if (scope === 'ui') {
      state.phase = 'ui'; state.cached = !!readStoryUi(root); publish();
      const ui = await ensureStoryUi(root, catalog, resources), indexFile = path.join(root, 'library/index.json'), index = readJson(indexFile);
      if (index) { index.storyUi = ui; writeJson(indexFile, index); }
      state.state = 'ready'; state.phase = 'finished'; state.finished = new Date().toISOString(); publish(); return state;
    }
    const selected = scope === 'catalog' ? catalog.characters : catalog.characters.filter(c => roles.includes(c.id));
    const ids = selected.flatMap(c => scope === 'catalog' ? [c.iconAsset] : roleAssetIds(c, scope));
    const visited = new Set<string>();
    async function download(assetIds: string[], phase: string) {
      const bundles = [...new Set<string>(assetIds.flatMap(id => catalog.assets[id]?.bundles || []))].filter(b => !visited.has(b));
      state.phase = phase; state.targets += bundles.length; publish();
      await eachLimit(bundles, async name => { visited.add(name); try { await resources.get(name); } catch (error) { state.failed++; state.errors.push({ bundle: name, error: error.message }); } finally { state.checked++; publish(); } }); resources.save();
    }
    await download(ids, scope === 'catalog' ? 'icons' : scope);
    if (['all', 'stories'].includes(scope)) {
      if (!readStoryUi(root)) {
        state.phase = 'ui'; publish();
        try { await ensureStoryUi(root, catalog, resources); }
        catch (error) { state.failed++; state.errors.push({ asset: 'story-ui', error: error.message }); }
      }
      const result = await exportAssets(root, selected.map(c => c.storyAsset), resources, catalog); const required = [];
      for (const role of selected) {
        const file = result.saved[role.storyAsset]?.script; if (!file) continue;
        for (const rows of Object.values<any[]>(readJson(path.join(root, 'library', file)))) required.push(...storyProgram(rows, catalog).resources);
      }
      await download(required, 'stories');
    }
    if (scope !== 'catalog') selectScopes(root, roles, scope);
    state.phase = 'extracting'; publish(); const index = await extract(root, undefined, { resources });
    state.failed += index.issues.length; state.errors.push(...index.issues); state.stats = index.stats; state.state = state.failed ? 'partial' : 'ready'; state.finished = new Date().toISOString(); publish(); return state;
  } catch (error) { state.state = 'failed'; state.error = error.message; publish(); throw error; }
  finally { resources.save(); }
}
if (require.main === module) {
  const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../../parsed-data/twinkle-star-knights');
  require('../../../app/projects.ts').withPackLock(root, () => collect(root, { roles: (arg('--roles') || '').split(',').filter(Boolean), scope: arg('--scope') })).then(result => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
