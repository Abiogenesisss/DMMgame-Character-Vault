import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const { acquirePackLock } = require('../../../app/projects.ts');
const lock = require('../../../app/download-lock.ts');
const { canonicalId, readCatalog } = require('./catalog.ts');
const { collectionScope } = require('./collect.ts');
function runExtraction(root, progress) {
  progress({ state: 'extracting', message: '正在更新千年战争图片库…' });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import','tsx',path.join(__dirname, 'extract.ts')], { windowsHide: true,
      env: { ...process.env, RESOURCE_PROJECT_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', data => { output = (output + data).slice(-8000); }); child.stderr.on('data', data => { error = (error + data).slice(-2000); });
    child.on('error', reject); child.on('exit', code => {
      if (code) reject(new Error(error || '千年战争提取失败。'));
      else { try { resolve({ state: 'ready', stats: JSON.parse(output.trim().split('\n').at(-1)) }); } catch { reject(new Error('千年战争提取结果无效。')); } }
    });
  });
}
function createService({ root, origin, fetchResource }) {
  return { async handle(request) {
    const url = new URL(request.url);
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) return null;
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    const file = path.join(root, 'state/aigis-status.json');
    if (url.pathname === '/api/status' && request.method === 'GET') {
      const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      if (state?.state === 'running' && !lock.busy(path.join(root, 'state/pack.lock'))) state.state = 'interrupted';
      return json(state);
    }
    if (url.pathname === '/api/collect' && request.method === 'POST') {
      let payload; try { payload = await request.json(); } catch { return json({ error: '请求格式有误。' }, 400); }
      if (payload?.voicesOnly) return json({ error: '千年战争只支持立绘和 CG 下载。' }, 400);
      const id = canonicalId(payload?.id); if (!id) return json({ error: '角色编号有误。' }, 400);
      let scope; try { scope = collectionScope(payload.scope); } catch (error) { return json({ error: error.message }, 400); }
      if (!readCatalog(root).characters.some(character => character.id === id)) return json({ error: '角色未被索引。' }, 404);
      let release; try { release = acquirePackLock(root); } catch { return json({ error: '千年战争资源正在处理，请等当前任务完成。' }, 409); }
      const initial = { state: 'running', roles: [id], scope, targets: 0, checked: 0, failed: 0, pid: process.pid };
      const save = state => writeAtomicFileSync(file, JSON.stringify(state));
      try { save(initial); } catch (error) { release(); throw error; }
      Promise.resolve().then(async () => {
        try { await require('./collect.ts').collect(root, { roles: [id], scope, retryMissing: payload.retryMissing === true, fetchResource }); }
        catch (error) { save({ state: 'failed', roles: [id], scope, error: error.message }); }
        finally { release(); }
      }).catch(error => console.error(error.message));
      return json(initial, 202);
    }
    return json({ error: '接口不存在。' }, 404);
  } };
}
export = { webRoot: path.join(__dirname, '../../../../app/viewer'), extract: runExtraction, createService,
  catalogHarImport: true, createDiscoveryService: options => require('./import-catalog.ts').createDiscoveryService(options) };
