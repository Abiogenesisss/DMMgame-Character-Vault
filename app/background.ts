import { fork } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchPublicResource } from './public-fetch.ts';

/** Heavy game work must never occupy the HTTP process serving saved media. */
export function createBackgroundTasks(fetchResource = fetchPublicResource) {
  const workers = new Map<string, any>();
  let closed = false;
  function worker(project, game) {
    if (closed) throw new Error('本地服务已关闭。');
    const key = project.root + '|' + (game?.revision || 'workbench');
    if (workers.has(key)) return workers.get(key);
    const child = fork(path.join(__dirname, 'background-worker.ts'), [], {
      execArgv: ['--import', pathToFileURL(require.resolve('tsx')).href],
      cwd: path.resolve(__dirname, '..'), windowsHide: true, serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const pending = new Map<number, any>(), fetches = new Map<number, AbortController>();
    let next = 0, stopped = false;
    const send = message => { if (child.connected) child.send(message, error => { if (error) stop(error); }); };
    function stop(error) {
      if (stopped) return;
      stopped = true; workers.delete(key);
      for (const request of pending.values()) request.reject(error);
      pending.clear(); for (const controller of fetches.values()) controller.abort(); fetches.clear();
    }
    child.on('error', stop);
    child.on('exit', () => stop(new Error('后台资源进程已退出，请重试下载。')));
    child.on('disconnect', () => stop(new Error('后台资源进程已断开。')));
    child.on('message', async (message: any) => {
      if (message.type === 'fetch-abort') { fetches.get(message.id)?.abort(); return; }
      // Only injected transports use IPC (e.g. deterministic tests). Production
      // downloads and their response bodies stay entirely in the child process.
      if (message.type === 'fetch' && fetchResource !== fetchPublicResource) {
        const controller = new AbortController(); fetches.set(message.id, controller);
        try {
          const response = await fetchResource(message.url, { ...message.options, signal: controller.signal });
          send({ type: 'fetch-result', id: message.id, status: response.status, headers: [...response.headers], body: Buffer.from(await response.arrayBuffer()) });
        } catch (error) { send({ type: 'fetch-result', id: message.id, error: error.message }); }
        finally { fetches.delete(message.id); }
        return;
      }
      if (message.type !== 'result') return;
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(Object.assign(new Error(message.error), { status: message.status }));
      else request.resolve(message.response);
    });
    send({ type: 'init', root: project.root, gameRoot: game?.root, proxyFetch: fetchResource !== fetchPublicResource });
    const value = {
      request(command): Promise<any> {
        if (stopped || !child.connected) return Promise.reject(new Error('后台资源进程不可用，请重试。'));
        return new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); send({ type: 'request', id, ...command }); });
      },
      close() {
        stop(new Error('本地服务已关闭。'));
        // Allow an in-flight Python export to finish before its owner releases
        // the pack lock; killing only Node could leave a writer running alone.
        if (child.connected) child.disconnect();
        child.unref();
      },
    };
    workers.set(key, value); return value;
  }
  return {
    async handle(project, game, request: Request, discovery: boolean) {
      const response = await worker(project, game).request({ action: 'api', discovery, url: request.url,
        method: request.method, headers: [...request.headers], body: await request.text() });
      return response ? new Response(response.body, { status: response.status, headers: response.headers }) : null;
    },
    run(project, game, action: 'download' | 'extract', entries?) { return worker(project, game).request({ action, entries }); },
    close() { closed = true; for (const value of [...workers.values()]) value.close(); workers.clear(); },
  };
}
