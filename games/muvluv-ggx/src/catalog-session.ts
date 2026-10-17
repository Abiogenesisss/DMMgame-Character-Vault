import { renameFileSync } from '../../../app/atomic-file.ts';
const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const API = 'https://api-game.muvluv-girls-garden.com';
const ENV_URL = API + '/api/Environment/EnvConfiguration', MASTER_URL = API + '/api/data/master';
const NAMES = ['catalog', 'ui_catalog', 'spine_catalog', 'sound_catalog'];
const SESSION_FILE = 'state/muvluv-catalog-session.json';
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9._~-]{16,8192}$/.test(value);

async function requestBytes(fetchResource, url, limit, label, init: RequestInit = {}) {
  let response;
  try { response = await fetchResource(url, { ...init, signal: AbortSignal.timeout(60000) }); }
  catch { throw new Error(label + '请求失败，请检查网络后重试。'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(label + ' HTTP ' + response.status + '，已保留原资源库。'),
      { status: response.status, authRequired: url.startsWith(API + '/api/') && [401, 403].includes(response.status) });
  }
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error(label + '超过大小限制。'); }
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body || []) {
      size += chunk.length; if (size > limit) throw new Error('size'); chunks.push(chunk);
    }
  } catch { throw new Error(label + (size > limit ? '超过大小限制。' : '读取失败，请重试。')); }
  if (!size) throw new Error(label + '为空。');
  return { bytes: Buffer.concat(chunks), headers: response.headers };
}

function resultJson(bytes, label) {
  let data; try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(label + '格式无效。'); }
  if (!Array.isArray(data?.errors) || data.errors.length || !data.result || typeof data.result !== 'object' || Array.isArray(data.result)) throw new Error(label + '未返回有效结果。');
  if (data.result.isMaintenance === true) throw new Error('游戏服务器正在维护，请稍后更新角色列表。');
  return data.result;
}

function environmentSource(config, clientVersion) {
  if (!/^\d{1,8}$/.test(clientVersion || '') || typeof config.assetsUrl !== 'string'
    || !/^https:\/\/assets\.muvluv-girls-garden\.com\/production-public\/[a-f0-9-]{36}\/BundleAssets\/$/.test(config.assetsUrl)) throw new Error('公开客户端配置中的版本或资源目录无效。');
  const base = config.assetsUrl.slice(0, -'BundleAssets/'.length);
  const remoteBase = config.assetsUrl + 'X/WebGL/DXT/', streamingBase = base + 'WebGL/Desktop/StreamingAssets/aa/';
  const source: any = { remoteBase, streamingBase, catalogUrls: { local: streamingBase + 'catalog.bin', ...Object.fromEntries(NAMES.map(name => [name, remoteBase + name + '.bin'])) } };
  if (config.staticContentUrl) {
    if (typeof config.staticContentUrl !== 'string' || !/^https:\/\/assets\.muvluv-girls-garden\.com\/production-public\/[a-f0-9-]{36}\/DirectAssets\/$/.test(config.staticContentUrl)) throw new Error('公开客户端配置中的静态资源目录无效。');
    source.directBase = config.staticContentUrl + 'X/';
  }
  return source;
}

function readSession(file) {
  if (!fs.existsSync(file)) return null;
  let data;
  try { if (fs.statSync(file).size > 16384) throw new Error('size'); data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('本地游客凭据无法读取，已保留原资源库。'); }
  if (data?.version !== 1 || !validToken(data.refreshToken)) throw new Error('本地游客凭据格式无效，已保留原资源库。');
  return data;
}

function saveSession(file, refreshToken) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, refreshToken, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    renameFileSync(temporary, file);
  } catch { throw new Error('无法保存本地游客凭据，已停止更新。'); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
}

// The caller holds the pack lock. Refresh credentials are private local state;
// access/hello tokens and signed master URLs never enter metadata or job status.
async function catalogSession(root, fetchResource = fetchPublicResource) {
  const env = await requestBytes(fetchResource, ENV_URL, 64 * 1024, '公开客户端配置', { headers: { 'x-rating': 'adult', accept: 'application/json' } });
  const clientVersion = env.headers.get('x-client-version');
  const source = environmentSource(resultJson(env.bytes, '公开客户端配置'), clientVersion);
  const headers = { 'x-client-version': clientVersion, 'x-device': 'web', 'x-platform': 'dmm', 'x-rating': 'adult', accept: 'application/json' };
  async function post(action, payload?, token?) {
    const result = await requestBytes(fetchResource, API + '/api/Account/' + action, 64 * 1024, '游客授权', { method: 'POST',
      headers: { ...headers, ...(payload ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: payload ? JSON.stringify(payload) : undefined });
    return resultJson(result.bytes, '游客授权');
  }
  function tokenValue(token, type) {
    if (token?.isMaintenance === true) throw new Error('游戏服务器正在维护，请稍后更新角色列表。');
    if (token?.type !== type || !validToken(token.value)) throw new Error('游客授权未返回有效凭据，已保留原资源库。');
    return token.value;
  }
  const file = path.join(root, SESSION_FILE);
  async function register() {
    const hello = tokenValue((await post('getHelloToken')).token, 3);
    const refreshToken = tokenValue((await post('registerGuestAccount', { helloToken: hello }, hello)).refreshToken, 1);
    // Save immediately: a later download failure must not create another guest.
    saveSession(file, refreshToken); return { refreshToken };
  }
  const saved = readSession(file);
  let session = saved || await register(), access;
  try { access = await post('getAccessToken', { refreshToken: session.refreshToken }, session.refreshToken); }
  catch (error) {
    if (!saved || ![401, 403].includes(error.status)) throw error;
    // Replace a revoked/expired guest once, never on network, master or asset errors.
    session = await register();
    access = await post('getAccessToken', { refreshToken: session.refreshToken }, session.refreshToken);
  }
  return { source, headers: { ...headers, authorization: 'Bearer ' + tokenValue(access.token, 2), accept: 'application/vnd.msgpack' } };
}

export { catalogSession, requestBytes, environmentSource, SESSION_FILE, NAMES, ENV_URL, MASTER_URL };
