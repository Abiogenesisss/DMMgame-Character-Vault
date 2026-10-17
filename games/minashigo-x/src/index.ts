const path = require('node:path');
const { readCatalog, readJson, writeJson } = require('./catalog.ts');
const { validId } = require('./format.ts');
const { collect, collectionScope } = require('./collect.ts');
const { refreshCatalog } = require('./refresh-catalog.ts');
const { acquirePackLock } = require('../../../app/projects.ts');
const lock = require('../../../app/download-lock.ts');
function createService({ root, origin, fetchResource }) {
  const file = path.join(root, 'state/minashigo-status.json');
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  return { async handle(request) {
    const url = new URL(request.url); if (url.origin !== origin || !url.pathname.startsWith('/api/')) return null;
    if (url.pathname === '/api/status' && request.method === 'GET') {
      const state = readJson(file, null); if (state?.state === 'running' && !lock.busy(path.join(root, 'state/pack.lock'))) state.state = 'interrupted'; return json(state);
    }
    if (!['/api/collect', '/api/discover'].includes(url.pathname)) return json({ error: '接口不存在。' }, 404);
    if (request.method !== 'POST') return json({ error: '请求方式有误。' }, 405);
    let payload; try { payload = await request.json(); } catch { return json({ error: '请求格式有误。' }, 400); }
    const discovery = url.pathname === '/api/discover'; let scope;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: '请求格式有误。' }, 400);
    if (discovery) {
      if (payload.har || payload.ids != null && payload.ids !== '') return json({ error: '更新角色列表无需输入编号或上传文件。' }, 400);
    } else {
      if (!validId(payload.id)) return json({ error: '角色编号有误。' }, 400);
      try { scope = collectionScope(payload.scope); } catch (error) { return json({ error: error.message }, 400); }
      if (!readCatalog(root).characters.some(role => role.id === payload.id)) return json({ error: '角色未被索引。' }, 404);
    }
    let release; try { release = acquirePackLock(root); } catch { return json({ error: '资源正在处理，请等当前任务完成。' }, 409); }
    const state: any = { state: 'running', type: discovery ? 'catalog' : 'collect', scope: discovery ? 'catalog' : scope, roles: discovery || scope === 'catalog' ? [] : [payload.id], targets: 0, checked: 0, failed: 0, pid: process.pid, started: new Date().toISOString() };
    const save = patch => { Object.assign(state, patch); writeJson(file, state); };
    try { save({}); } catch (error) { release(); throw error; }
    const initial = { ...state };
    Promise.resolve().then(async () => {
      try {
        if (discovery) {
          const known = new Set(readJson(path.join(root, 'library/index.json'), { characters: [] }).characters.map(role => role.id));
          const result = await refreshCatalog(root, { fetchResource, onProgress: save });
          const index = readJson(path.join(root, 'library/index.json')), addedIds = index.characters.filter(role => !known.has(role.id)).map(role => role.id);
          save({ ...result, state: result.failed ? 'partial' : 'ready', addedIds, added: addedIds.length, stats: index.stats, finished: new Date().toISOString() });
        } else await collect(root, { roles: scope === 'catalog' ? undefined : [payload.id], scope, fetchResource });
      } catch (error) { save({ state: 'failed', failed: 1, error: error.message, finished: new Date().toISOString() }); }
      finally { release(); }
    }).catch(error => console.error(error.message));
    return json(initial, 202);
  } };
}
async function extract(root, progress = () => {}) { const index = await require('./extract.ts').extract(root); return { state: 'ready', stats: index.stats }; }
export = { createService, createDiscoveryService: createService, extract, refreshCharacters: refreshCatalog };
