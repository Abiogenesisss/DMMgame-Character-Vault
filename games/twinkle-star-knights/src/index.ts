import path from 'node:path';
import { acquirePackLock } from '../../../app/projects.ts';
import { busy } from '../../../app/download-lock.ts';
import { readJson, writeJson, validId } from './resources.ts';
import { readCatalog } from './catalog.ts';
import { collect, collectionScope } from './collect.ts';
import { extract as extractLibrary } from './extract.ts';
function createService({ root, origin, fetchResource }) {
  const file = path.join(root, 'state/twinkle-status.json');
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  return { async handle(request: Request) {
    const url = new URL(request.url); if (url.origin !== origin || !url.pathname.startsWith('/api/')) return null;
    if (url.pathname === '/api/status' && request.method === 'GET') { const state = readJson(file); if (state?.state === 'running' && !busy(path.join(root, 'state/pack.lock'))) state.state = 'interrupted'; return json(state); }
    if (!['/api/collect', '/api/discover'].includes(url.pathname) || request.method !== 'POST') return json({ error: '接口不存在。' }, 404);
    let payload: any, scope: string;
    try { payload = await request.json(); scope = url.pathname.endsWith('/discover') ? 'catalog' : collectionScope(payload?.scope); } catch { return json({ error: '下载请求格式有误。' }, 400); }
    if (scope !== 'catalog' && (!validId(payload?.id) || !readCatalog(root).characters.some(c => c.id === payload.id))) return json({ error: '角色未被索引。' }, 404);
    if (scope === 'catalog' && payload?.ids?.trim()) return json({ error: '本游戏按完整资源目录更新，请将编号框留空。' }, 400);
    let release; try { release = acquirePackLock(root); } catch { return json({ error: '闪耀星骑士资源正在处理。' }, 409); }
    const initial = { state: 'running', scope, roles: scope === 'catalog' ? [] : [payload.id], pid: process.pid };
    try { writeJson(file, initial); } catch (error) { release(); throw error; }
    Promise.resolve().then(() => collect(root, { roles: initial.roles, scope, fetchResource })).catch(error => writeJson(file, { ...initial, state: 'failed', error: error.message })).finally(release);
    return json(initial, 202);
  } };
}
async function extract(root, progress) { const index = await extractLibrary(root, progress); return { state: 'ready', stats: index.stats }; }
export { createService, createService as createDiscoveryService, extract };
