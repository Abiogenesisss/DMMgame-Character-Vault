'use strict';
const fs = require('node:fs'), path = require('node:path');
const { acquirePackLock } = require('../../../app/projects.ts');
const lock = require('../../../app/download-lock.ts');
const { canonicalId } = require('./identity.ts');
const { readCatalog, readJson } = require('./catalog.ts');
const { collectionScope, collect } = require('./collect.ts');
function createService({ root, origin, fetchResource }) {
  return { async handle(request) {
    const url = new URL(request.url); if (url.origin !== origin || !url.pathname.startsWith('/api/')) return null;
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    const file = path.join(root, 'state/otogi-status.json');
    if (url.pathname === '/api/status' && request.method === 'GET') {
      const state = readJson(file, null); if (state?.state === 'running' && !lock.busy(path.join(root, 'state/pack.lock'))) state.state = 'interrupted'; return json(state);
    }
    if (url.pathname === '/api/collect' && request.method === 'POST') {
      let payload; try { payload = await request.json(); } catch { return json({ error: '请求格式有误。' }, 400); }
      const catalog = readCatalog(root), id = canonicalId(payload?.id, catalog); if (!id) return json({ error: '角色编号有误。' }, 400);
      let scope; try { scope = collectionScope(payload.scope); } catch (error) { return json({ error: error.message }, 400); }
      if (!catalog.characters.some(character => character.id === id)) return json({ error: '角色未被索引。' }, 404);
      let release; try { release = acquirePackLock(root); } catch { return json({ error: '童话边境资源正在处理，请等当前任务完成。' }, 409); }
      const initial = { state: 'running', roles: [id], scope, targets: 0, checked: 0, failed: 0, pid: process.pid };
      const save = state => { fs.writeFileSync(file + '.tmp', JSON.stringify(state)); fs.renameSync(file + '.tmp', file); };
      try { save(initial); } catch (error) { release(); throw error; }
      Promise.resolve().then(async () => {
        try { await collect(root, { roles: [id], scope, retryMissing: payload.retryMissing === true, fetchResource }); }
        catch (error) { save({ state: 'failed', roles: [id], scope, error: error.message }); }
        finally { release(); }
      }).catch(error => console.error(error.message)); return json(initial, 202);
    }
    return json({ error: '接口不存在。' }, 404);
  } };
}
async function runExtraction(root, progress) { await require('./prepare.ts').prepareCatalog(root); const index = await require('./extract.ts').extract(root, progress); return { state: 'ready', stats: index.stats }; }
const adapter = { webRoot: path.join(__dirname, '../../../app/viewer'), extract: runExtraction, createService,
  refreshCharacters: (root, options) => require('./refresh-catalog.ts').refreshCatalog(root, options) };

const createDiscoveryService =options=>require('./discovery.ts').createDiscoveryService({...options,refreshCharacters:adapter.refreshCharacters});

export = { ...adapter, createDiscoveryService };
