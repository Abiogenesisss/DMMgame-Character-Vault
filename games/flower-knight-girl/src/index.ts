import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const lock = require('../../../app/download-lock.ts');
const { acquirePackLock } = require('../../../app/projects.ts');
const { baseId } = require('./character-identity.ts');
const { COLLECTION_SCOPES, collectionScope } = require('./collection-scope.ts');
function runExtraction(root, progress) {
  progress({ state: 'extracting', message: '正在更新花骑士内容库…' });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import','tsx',path.join(__dirname, 'extract.ts')], { windowsHide: true,
      env: { ...process.env, RESOURCE_PROJECT_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', data => { output = (output + data).slice(-8000); });
    child.stderr.on('data', data => { error = (error + data).slice(-2000); });
    child.on('error', reject); child.on('exit', code => {
      if (code !== 0) reject(new Error(error || '花骑士提取失败。'));
      else { try { resolve(JSON.parse(output.trim().split('\n').at(-1))); } catch { reject(new Error('花骑士提取结果无效。')); } }
    });
  });
}
function createService({ root, origin, fetchResource, prepareUi }: any) {
  return { async handle(request) {
    const url = new URL(request.url);
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) return null;
    const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    if (request.method === 'GET' && url.pathname === '/api/status') {
      const file = path.join(root, 'state/flower-status.json');
      const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      if (state?.state === 'running' && !lock.busy(path.join(root, 'state/pack.lock'))) state.state = 'interrupted';
      return response(state?.roles ? state : null);
    }
    if (request.method === 'POST' && url.pathname === '/api/collect') {
      let payload;
      try { payload = await request.json(); } catch { return response({ error: '请求格式有误。' }, 400); }
      if (typeof payload?.id !== 'string' || !/^1\d{5}$/.test(payload.id)) return response({ error: '角色编号有误。' }, 400);
      let scope;
      try { scope = collectionScope(payload); } catch (error) { return response({ error: error.message }, 400); }
      const catalog = JSON.parse(fs.readFileSync(path.join(root, 'metadata/catalog.json'), 'utf8'));
      payload.id = baseId(payload.id, catalog);
      if (!catalog.characters.some(character => character.id === payload.id)) return response({ error: '角色未被索引。' }, 404);
      let release;
      try { release = acquirePackLock(root); } catch (error) { return response({ error: '其他资源正在收集或保存，请等当前任务完成。' }, 409); }
      const file = path.join(root, 'state/flower-status.json');
      const save = state => writeAtomicFileSync(file, JSON.stringify(state));
      const initial = { state: 'running', roles: [payload.id], scope, voicesOnly: scope === 'voices', phase: COLLECTION_SCOPES[scope].phase, targets: 0, checked: 0, stories: 0, failed: 0, pid: process.pid };
      try { save(initial); }
      catch (error) { release(); throw error; }
      Promise.resolve().then(async () => {
        try { await require('./collect.ts').collect(root, { roles: [payload.id], retryMissing: payload.retryMissing === true, scope, fetchResource, prepareUi }); }
        catch (error) { save({ state: 'failed', roles: [payload.id], scope, error: error.message, finished: new Date().toISOString() }); }
        finally { release(); }
      }).catch(error => console.error(error.message));
      return response(initial, 202);
    }
    return response({ error: '接口不存在。' }, 404);
  } };
}
const adapter = { webRoot: path.join(__dirname, '../../../../app/viewer'), extract: runExtraction, createService,
  refreshCharacters: (root, options) => require('./refresh-catalog.ts').refreshCatalog(root, { ...options, refresh: true, allowCachedMetadata: true }) };

const createDiscoveryService =options=>require('./discovery.ts').createDiscoveryService({...options,refreshCharacters:adapter.refreshCharacters});

export = { ...adapter, createDiscoveryService };
