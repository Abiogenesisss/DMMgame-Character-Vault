import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { acquirePackLock } = require('../../../app/projects.ts');
const STATUS_FILE='flower-status.json';
function parseIds(input = '') {
  const rule = {min:100000,max:199999,width:6};
  if (!rule || typeof input !== 'string' || input.length > 6000) throw new Error('角色编号格式有误。');
  const result = new Set<string>();
  const text = input.replace(/[～~—–]/g, '-').replace(/(\d+)\s*-\s*(\d+)/g, '$1-$2').trim();
  if (!text) return [];
  for (const token of text.split(/[\s,，、;；]+/)) {
    if (!/^\d+(?:-\d+)?$/.test(token)) throw new Error('请填写角色编号或编号范围，例如 10011、10021-10041。');
    const [first, last = first] = token.split('-').map(Number);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < rule.min || last > rule.max || first > last) throw new Error('编号范围不适用于当前游戏。');
    const step = false && first % 10 === 1 && last % 10 === 1 ? 10 : 1;
    if ((last - first) / step + 1 > 500) throw new Error('每次最多填写 500 个角色编号。');
    for (let id = first; id <= last; id += step) result.add(String(id).padStart(rule.width, '0'));
    if (result.size > 500) throw new Error('每次最多填写 500 个角色编号。');
  }
  return [...result];
}
function createDiscoveryService({ root, origin, refreshCharacters, fetchResource }) {
  return { async handle(request) {
    const url = new URL(request.url);
    if (url.origin !== origin || url.pathname !== '/api/discover') return null;
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    if (typeof refreshCharacters !== 'function') return json({ error: '这款游戏暂不支持拉取新角色。' }, 400);
    if (request.method !== 'POST') return json({ error: '请求方式有误。' }, 405);
    let payload, ids;
    try {
      payload = await request.json(); ids = parseIds(payload?.ids);
    } catch (error) { return json({ error: error.message }, 400); }
    let release;
    try { release = acquirePackLock(root); } catch { return json({ error: '当前游戏正在处理资源，请等任务完成后再拉取新角色。' }, 409); }
    const file = path.join(root, 'state', STATUS_FILE);
    const state = { state: 'running', type: 'catalog', scope: 'catalog', phase: 'catalog', roles: [], targets: 0, checked: 0, failed: 0, pid: process.pid, started: new Date().toISOString() };
    const save = patch => { Object.assign(state, patch); writeAtomicFileSync(file, JSON.stringify(state)); };
    try { save({}); } catch (error) { release(); throw error; }
    const initial = { ...state };
    Promise.resolve().then(async () => {
      try {
        const beforeFile = path.join(root, 'library/index.json');
        const before = fs.existsSync(beforeFile) ? JSON.parse(fs.readFileSync(beforeFile, 'utf8')) : { characters: [] };
        const known = new Set<string>(before.characters.map(character => character.id));
        const result = await refreshCharacters(root, { ids, fetchResource,
          onProgress: progress => save({ ...progress, state: 'running' }) });
        const library = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
        const addedIds = library.characters.filter(character => !known.has(character.id)).map(character => character.id);
        const present = new Set<string>(library.characters.map(character => character.id));
        const missingIds = ids.filter(id => !present.has(library.aliases?.[id] || id));
        save({ ...result, state: result.failed ? 'partial' : 'ready', checked: result.targets ?? state.targets, addedIds, added: addedIds.length, missingIds, stats: library.stats, finished: new Date().toISOString() });
      } catch (error) { save({ state: 'failed', error: error.message, finished: new Date().toISOString() }); }
      finally { release(); }
    }).catch(error => console.error(error.message));
    return json(initial, 202);
  } };
}
export { parseIds, createDiscoveryService };
