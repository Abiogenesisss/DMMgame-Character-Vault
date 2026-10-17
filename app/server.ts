import { writeAtomicFileSync } from './atomic-file.ts';
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { loadPack, sha256 } = require('./pack.ts');
const { DEFAULT_DATA, projectPath, readProject, createProject, listProjects, acquirePackLock, listResources } = require('./projects.ts');
const { parseUrlList } = require('./download.ts');
const { fetchPublicResource } = require('./public-fetch.ts');
const { sendFile } = require('./http-files.ts');
const { createRegistry, DEFAULT_GAMES } = require('./index.ts');
const { initializeGameData } = require('./initialize.ts');
const lock = require('./download-lock.ts');
const { createBackgroundTasks } = require('./background.ts');

const identity = { app: 'webgame-resource-workspace', workspace: sha256(Buffer.from(path.resolve(__dirname, '..'))) };
const json = (res, data, status = 200) => { res.writeHead(status, {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' }); res.end(JSON.stringify(data)); };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function readJson(req, limit = 1024 ** 2) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail('需要 application/json 格式。', 415);
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw fail('提交内容超过大小限制。', 413); }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail('提交内容超过大小限制。', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw fail('JSON 格式有误。'); }
}

function createServer({ dataRoot = DEFAULT_DATA, gamesRoot = DEFAULT_GAMES, fetchResource = fetchPublicResource }: any = {}) {
  const registry = createRegistry(gamesRoot);
  const getAdapter = id => registry.get(id)?.adapter || null;
  function gameProject(id) {
    try {
      const project = readProject(id, dataRoot), game = registry.list().find(game => game.id === (project.adapter || id));
      if (game) initializeGameData(game, project.root);
      return project;
    }
    catch (error) {
      const game = registry.list().find(game => game.id === id);
      if (error.status !== 404 || !game) throw error;
      initializeGameData(game, projectPath(id, dataRoot));
      return { id, adapter: id, name: game.name, root: projectPath(id, dataRoot) };
    }
  }
  const background = createBackgroundTasks(fetchResource), adapterServices = new Map();
  function startJob(project, type, work) {
    const release = acquirePackLock(project.root);
    const job = { id: randomUUID(), type, state: 'queued', started: new Date().toISOString() };
    const file = path.join(project.root, 'state/workbench-job.json');
    const persist = patch => {
      Object.assign(job, patch);
      writeAtomicFileSync(file, JSON.stringify(job));
    };
    try { persist({}); } catch (error) { release(); throw error; }
    Promise.resolve().then(async () => {
      try { const result = await work(persist); persist({ ...result, finished: new Date().toISOString() }); }
      catch (error) { persist({ state: 'failed', error: error.message, finished: new Date().toISOString() }); }
      finally { release(); }
    }).catch(error => console.error('任务状态保存失败：', error.message));
    return { ...job };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const port = server.address().port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(req.headers.host)) throw fail('BAD_HOST', 403);
      const origin = 'http://' + req.headers.host;
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw fail('BAD_ORIGIN', 403);
      const url = new URL(req.url, origin);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) throw fail('BAD_PATH');
      if (pathname === '/api/health' && req.method === 'GET') { json(res, identity); return; }
      if (['/shared/app.js', '/shared/viewer.css'].includes(pathname) && ['GET', 'HEAD'].includes(req.method)) {
        sendFile(req, res, path.join(__dirname, 'viewer'), pathname.split('/').at(-1), { trusted: true }); return;
      }

      if (pathname === '/api/games' && req.method === 'GET') {
        const projects = listProjects(dataRoot);
        json(res, registry.list().flatMap(game => {
          const saved = projects.filter(project => (project.adapter || project.id) === game.id);
          return (saved.length ? saved : [{ id: game.id, adapter: game.id, name: game.name }]).map(project => ({ ...project, adapter: game.id, label: game.label,
            moduleUrl: '/modules/' + game.id + '/module.js?v=' + encodeURIComponent(game.revision),
            stylesheet: game.stylesheet ? '/modules/' + game.id + '/styles.css?v=' + encodeURIComponent(game.revision) : null, revision: game.revision }));
        })); return;
      }
      const moduleFile = /^\/modules\/([a-z0-9][a-z0-9_-]{0,63})\/(module\.js|styles\.css|vendor\/[a-zA-Z0-9_.-]+)$/.exec(pathname);
      if (moduleFile && ['GET', 'HEAD'].includes(req.method)) {
        const game = registry.list().find(game => game.id === moduleFile[1]); if (!game) throw fail('游戏模块未安装。', 404);
        const relative = moduleFile[2];
        sendFile(req, res, game.root, relative === 'module.js' ? 'dist/module.js' : 'viewer/' + relative, { trusted: true }); return;
      }
      if (pathname === '/api/projects') {
        if (req.method === 'GET') { const installed = new Set<string>(registry.list().map(game => game.id)); json(res, listProjects(dataRoot).filter(project => !project.adapter || installed.has(project.adapter))); return; }
        if (req.method === 'POST') { const { root, ...project } = createProject(await readJson(req), dataRoot); json(res, project, 201); return; }
        throw fail('METHOD_NOT_ALLOWED', 405);
      }
      const api = /^\/api\/projects\/([^/]+)\/(resources|import|download|job|extract|files\/([a-f0-9]{64}))$/.exec(pathname);
      if (api) {
        const project = readProject(api[1], dataRoot);
        if (project.adapter && !getAdapter(project.adapter)) throw fail('游戏模块未安装。', 404);
        const action = api[2];
        if (action === 'resources' && req.method === 'GET') {
          json(res, listResources(project.root, { query: url.searchParams.get('q') || '', category: url.searchParams.get('type') || '',
            offset: url.searchParams.get('offset'), limit: url.searchParams.get('limit') })); return;
        }
        if (action === 'job' && req.method === 'GET') {
          const file = path.join(project.root, 'state/workbench-job.json');
          const job = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
          if (job && ['queued', 'downloading', 'importing', 'extracting'].includes(job.state)
            && !lock.busy(path.join(project.root, 'state/pack.lock'))) job.state = 'interrupted';
          json(res, job); return;
        }
        if (action === 'import' && req.method === 'POST') {
          const importer = path.join(__dirname, 'dev/import-service.cjs');
          if (!fs.existsSync(importer)) throw fail('接口不存在。', 404);
          json(res, await require(importer).importProject({ req, project, registry, startJob }), 202); return;
        }
        if (action === 'download' && req.method === 'POST') {
          let entries;
          try { entries = parseUrlList(await readJson(req, 64 * 1024 ** 2)); }
          catch (error) { error.status ||= 400; throw error; }
          json(res, await background.run(project, registry.get(project.adapter), 'download', entries), 202); return;
        }
        if (action === 'extract' && req.method === 'POST') {
          const adapter = getAdapter(project.adapter);
          if (typeof adapter?.extract !== 'function') throw fail('此项目没有配置解包适配器。');
          json(res, await background.run(project, registry.get(project.adapter), 'extract'), 202); return;
        }
        if (action.startsWith('files/') && ['GET', 'HEAD'].includes(req.method)) {
          const pack = loadPack(path.join(project.root, 'cache'));
          const record = Object.values<any>(pack.manifest.routes).flat().find(item => item.body === api[3]);
          if (!record) throw fail('资源不存在。', 404);
          const inline = !url.searchParams.has('download') && /^(image\/(png|jpeg|gif|webp|avif|bmp)|audio\/[a-z0-9.+-]+|video\/(mp4|webm))(;|$)/i.test(record.mimeType);
          let name; try { name = decodeURIComponent(new URL(record.url).pathname.split('/').at(-1)); } catch { name = record.body; }
          sendFile(req, res, path.join(pack.root, 'bodies'), record.body, {
            mimeType: inline ? record.mimeType : 'application/octet-stream', downloadName: inline ? undefined : name || record.body }); return;
        }
        throw fail('METHOD_NOT_ALLOWED', 405);
      }

      const viewer = /^\/games\/([^/]+)(?:\/(.*))?$/.exec(pathname);
      if (viewer) {
        const project = gameProject(viewer[1]);
        const game = registry.get(project.adapter), adapter = game?.adapter;
        if (!adapter) throw fail('内容查看器未配置。', 404);
        if (viewer[2] == null) { res.writeHead(302, { location: '/games/' + project.id + '/' }); res.end(); return; }
        const relative = viewer[2];
        if (relative.startsWith('api/')) {
          const key = project.id + '|' + origin + '|' + game.revision;
          const discovery = relative === 'api/discover';
          const serviceKey = discovery ? key + '|discover' : key;
          if (discovery && !adapter.createDiscoveryService) throw fail('这款游戏暂不支持拉取新角色。', 400);
          const payload = req.method === 'POST' ? JSON.stringify(await readJson(req, discovery && adapter.catalogHarImport ? 24 * 1024 ** 2 : 8192)) : undefined;
          const request = new Request(origin + '/' + relative + url.search, { method: req.method, headers: req.headers, body: payload });
          let response;
          if (req.method === 'POST') response = await background.handle(project, game, request, discovery);
          else {
            if (!adapterServices.has(serviceKey)) adapterServices.set(serviceKey, discovery
              ? adapter.createDiscoveryService({ root: project.root, origin, fetchResource })
              : adapter.createService({ root: project.root, origin, fetchResource }));
            response = await adapterServices.get(serviceKey).handle(request);
          }
          if (!response) throw fail('接口不存在。', 404);
          res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
        }
        if (!['GET', 'HEAD'].includes(req.method)) throw fail('METHOD_NOT_ALLOWED', 405);
        if (relative.startsWith('library/')) sendFile(req, res, path.join(project.root, 'library'), relative.slice(8), { trusted: true });
        else if (relative.startsWith('vendor/')) sendFile(req, res, path.join(game.root, 'viewer'), relative, { trusted: true });
        else if (['', 'index.html', 'app.js', 'viewer.css'].includes(relative)) sendFile(req, res, path.join(__dirname, 'viewer'), relative || 'index.html', { trusted: true });
        else throw fail('页面不存在。', 404);
        return;
      }
      if (pathname.startsWith('/api/')) throw fail('接口不存在。', 404);
      if (!['GET', 'HEAD'].includes(req.method)) throw fail('METHOD_NOT_ALLOWED', 405);
      if (pathname === '/' || pathname === '/index.html') {
        sendFile(req, res, path.join(__dirname, 'viewer'), 'index.html', { trusted: true }); return;
      }
      throw fail('页面不存在。', 404);
    } catch (error) {
      if (!res.headersSent) json(res, { error: error.message }, error.status || (error instanceof SyntaxError || error instanceof URIError ? 400 : 500));
      else res.destroy();
    }
  });
  server.requestTimeout = 10 * 60 * 1000;
  server.on('close', () => background.close());
  return server;
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' });
  child.on('error', error => console.error('浏览器打开失败，请手动打开上面的地址：', error.message)); child.unref();
}

if (require.main === module) {
  const index = process.argv.indexOf('--port');
  const port = Number(index >= 0 ? process.argv[index + 1] : process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error('端口需要在 0 至 65535 之间。'); process.exitCode = 1; }
  else {
    const server = createServer();
    server.on('error', async error => {
      if (error.code === 'EADDRINUSE') {
        const url = `http://127.0.0.1:${port}`;
        try {
          const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(2000) });
          const existing = await response.json();
          if (existing.app === identity.app && existing.workspace === identity.workspace) {
            console.log(`已连接正在运行的资源库：${url}/\n当前命令复用已有服务。更新后台代码后，请先停止旧进程，再运行 npm start。`);
            if (process.argv.includes('--open')) openBrowser(url);
            return;
          }
        } catch { /* A different service may be using this port. */ }
      }
      console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，可以使用 npm start -- --port 8788。` : error.message); process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      console.log(`角色资源库：${url}/\n按 Ctrl+C 停止本地服务。`);
      if (process.argv.includes('--open')) openBrowser(url);
    });
  }
}
export { createServer };
