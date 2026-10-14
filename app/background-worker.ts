import { writeAtomicFileSync } from './atomic-file.ts';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquirePackLock } from './projects.ts';
import { downloadUrls } from './download.ts';
import { safeLabel } from './pack.ts';
import { fetchPublicResource } from './public-fetch.ts';

let root: string, adapter: any, proxyFetch = false, nextFetch = 0;
const services = new Map(), fetches = new Map<number, any>();
const send = message => { if (process.connected) process.send(message, () => {}); };
async function fetchResource(url, options: RequestInit = {}) {
  if (!proxyFetch) return fetchPublicResource(url, options);
  if (!process.connected) throw new Error('本地服务已关闭。');
  options.signal?.throwIfAborted();
  const id = ++nextFetch, { signal, ...init } = options;
  const abort = () => { fetches.get(id)?.reject(signal.reason); fetches.delete(id); send({ type: 'fetch-abort', id }); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await new Promise<Response>((resolve, reject) => {
      fetches.set(id, { resolve, reject });
      send({ type: 'fetch', id, url, options: { ...init, headers: [...new Headers(init.headers)] } });
    });
  } finally { signal?.removeEventListener('abort', abort); }
}
function startJob(action, entries) {
  const release = acquirePackLock(root), file = path.join(root, 'state/workbench-job.json');
  const job: any = { id: randomUUID(), type: action, state: 'queued', started: new Date().toISOString() };
  const persist = patch => { Object.assign(job, patch); writeAtomicFileSync(file, JSON.stringify(job)); };
  try { persist({}); } catch (error) { release(); throw error; }
  setImmediate(async () => {
    try {
      const result = action === 'download' ? await downloadUrls(root, entries, { fetchResource,
        onProgress: state => persist({ ...state, errors: state.errors.slice(0, 30).map(item => ({ ...item, url: safeLabel(item.url) })) }) })
        : await adapter.extract(root, persist);
      persist({ ...result, finished: new Date().toISOString() });
    } catch (error) { persist({ state: 'failed', error: error.message, finished: new Date().toISOString() }); }
    finally { release(); }
  });
  return { ...job };
}
async function handle(message) {
  if (message.action !== 'api') return startJob(message.action, message.entries);
  const origin = new URL(message.url).origin, key = origin + '|' + message.discovery;
  if (!services.has(key)) {
    const factory = message.discovery ? adapter.createDiscoveryService : adapter.createService;
    services.set(key, factory({ root, origin, fetchResource }));
  }
  const response = await services.get(key).handle(new Request(message.url, {
    method: message.method, headers: message.headers, body: message.body,
  }));
  return response ? { status: response.status, headers: [...response.headers], body: Buffer.from(await response.arrayBuffer()) } : null;
}
process.on('message', async (message: any) => {
  if (message.type === 'init') {
    root = message.root; proxyFetch = message.proxyFetch;
    if (message.gameRoot) adapter = require(path.join(message.gameRoot, 'src/index.ts'));
    return;
  }
  if (message.type === 'fetch-result') {
    const request = fetches.get(message.id); if (!request) return;
    fetches.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(new Response([204, 205, 304].includes(message.status) ? null : message.body, { status: message.status, headers: message.headers }));
    return;
  }
  if (message.type !== 'request') return;
  try { send({ type: 'result', id: message.id, response: await handle(message) }); }
  catch (error) { send({ type: 'result', id: message.id, error: error.message, status: error.status }); }
});
process.on('disconnect', () => {
  for (const request of fetches.values()) request.reject(new Error('本地服务已关闭。'));
  fetches.clear();
  const finish = () => {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(path.join(root, 'state/pack.lock'), 'utf8')); } catch {}
    if (owner?.pid !== process.pid) process.exit(0);
  };
  finish(); setInterval(finish, 250);
});
