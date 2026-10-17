import { renameFileSync } from '../../../app/atomic-file.ts';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { API, VERSION_URL, validVersion, logicalPath, resourceSpec, requestBytes, decryptPayload, encryptPayload } = require('./format.ts');
// Public application-format constants shipped in the official clients. These
// identify a client, never a player. Player credentials live only in state/.
const clients = require('./client-auth.json');
const PHONE_API = 'https://minasigo-no-shigoto-app-g-server.orphans-order.com/mnsg/';
const PHONE_VERSION_URL = PHONE_API + 'user/getVersion', STORY_URL = API + '/mnsg/story/getStoryResource';
const SESSION_FILE = 'state/minashigo-guest-session.json';
const validCredential = value => typeof value === 'string' && /^[A-Za-z0-9+/_=.~-]{16,8192}$/.test(value);
const validUser = value => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)) || (Number.isSafeInteger(value) && value > 0);
const password = token => crypto.createHash('sha256').update(token + 'one-deep').digest('base64').slice(0, 32);
const encode = value => encodeURIComponent(value).replace(/[()$!*']/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function authorization(method, url, client, identity?) {
  const values: any = {};
  if (!url.endsWith('RequestToken')) values.oauth_token = identity?.token;
  values.xoauth_requestor_id = identity?.userId;
  Object.assign(values, { oauth_consumer_key: client.key, oauth_signature_method: 'HMAC-SHA256', oauth_nonce: crypto.randomInt(2 ** 48 - 1), oauth_timestamp: Math.floor(Date.now() / 1000) });
  const parameters = Object.keys(values).sort().map(key => key + '=' + values[key]).join('&');
  values.oauth_signature = crypto.createHmac('sha256', encode(client.secret) + '&' + (identity?.secret || '')).update([method, encode(url), encode(parameters)].join('&')).digest('base64');
  return 'OAuth realm="' + (/Token$/.test(url) ? 'Clients' : 'Users') + '"' + Object.keys(values).map(key => ' ' + key + '="' + values[key] + '"').join('');
}
function readSession(file) {
  if (!fs.existsSync(file)) return null;
  let value; try { if (fs.statSync(file).size > 20000) throw Error(); value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('本地游客凭据无法读取。'); }
  if (value?.version !== 1 || !validCredential(value.token) || !validCredential(value.secret) || !validUser(value.userId)) throw new Error('本地游客凭据格式无效。');
  return value;
}
function saveSession(file, identity) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, token: identity.token, secret: identity.secret, userId: identity.userId, initialized: identity.initialized === true }), { flag: 'wx', mode: 0o600 });
    renameFileSync(temporary, file);
  } catch { throw new Error('无法保存本地游客凭据，已停止下载。'); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
}
async function apiResult(fetchResource, url, version, client, identity?, data?) {
  const method = data ? 'POST' : 'GET', body = data ? JSON.stringify({ data: encryptPayload(data, password(identity.token)) }) : undefined;
  const bytes = await requestBytes(fetchResource, url, url === STORY_URL ? 4 * 1024 * 1024 : 256 * 1024, { method, body, headers: { accept: 'application/json;charset=UTF-8',
    authorization: authorization(method, url, client, identity), 'x-mnsg-app-version': JSON.stringify(version), ...(body ? { 'content-type': 'application/json;charset=UTF-8' } : {}) } });
  let value; try { value = JSON.parse(bytes.toString('utf8')); if (typeof value === 'string' && identity) value = decryptPayload(value, password(identity.token)); }
  catch { throw new Error('游戏接口未返回有效结果。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('游戏接口未返回有效结果。');
  // Never surface server error text: responses can contain private account data.
  if (value.status || value.err) throw Object.assign(new Error('游戏资源接口暂不可用' + (Number.isSafeInteger(value.status) ? '（' + value.status + '）' : '') + '。'), { code: value.status });
  return value;
}
async function versionInfo(fetchResource, url) {
  let value; try { value = JSON.parse((await requestBytes(fetchResource, url, 64 * 1024)).toString('utf8')).version; } catch { throw new Error('游戏版本信息暂不可用。'); }
  if (!['clientVersion', 'masterVersion', 'resourceVersion'].every(key => validVersion(value?.[key]))) throw new Error('游戏版本格式无效。');
  return Object.fromEntries(['clientVersion', 'masterVersion', 'resourceVersion'].map(key => [key, value[key]]));
}
// Callers hold the pack lock. Only bootstrap/renewal and the read-only resource
// lookup are used, plus a newly created guest's normal first-launch initialization.
// Ownership, story unlocks, read flags and rewards are never requested.
async function storySession(root, fetchResource = fetchPublicResource) {
  const versions = await Promise.allSettled([versionInfo(fetchResource, PHONE_VERSION_URL), versionInfo(fetchResource, VERSION_URL)]);
  const failed = versions.find(value => value.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
  const [phoneVersion, webVersion] = versions.map(value => value.status === 'fulfilled' ? value.value : null);
  const file = path.join(root, SESSION_FILE); let saved = readSession(file), access;
  async function register() {
    const result = await apiResult(fetchResource, PHONE_API + 'auth/getPhoneRequestToken', phoneVersion, clients.native);
    if (!validCredential(result.token) || !validCredential(result.secret) || !validUser(result.userId)) throw new Error('游客注册未返回有效凭据。');
    saved = { token: result.token, secret: result.secret, userId: result.userId }; saveSession(file, saved);
  }
  async function renew() {
    const result = await apiResult(fetchResource, PHONE_API + 'auth/getPhoneAccessToken', phoneVersion, clients.native, saved);
    if (!validCredential(result.token) || !validCredential(result.secret)) throw new Error('游客续期未返回有效凭据。');
    access = { token: result.token, secret: result.secret, userId: saved.userId };
  }
  const existing = !!saved; if (!saved) await register();
  try { await renew(); } catch (error) {
    if (!existing || ![401, 403].includes(error.status)) throw error;
    await register(); await renew();
  }
  if (!saved.initialized) {
    const result = await apiResult(fetchResource, PHONE_API + 'user/login', phoneVersion, clients.native, access, {});
    if (!result.user || typeof result.user !== 'object' || Array.isArray(result.user)) throw new Error('游客初始化未返回有效结果。');
    saved.initialized = true; saveSession(file, saved);
  }
  let renewed;
  async function getResource(requested) {
    const logical = logicalPath(requested);
    if (!logical?.startsWith('adv/') || !/\.(txt|png|jpg|jpeg|plist|mp3|mp4|json|atlas|skel|bin)$/.test(logical)) throw new Error('剧情素材路径无效。');
    const lookup = async () => {
      for (let attempt = 0; ; attempt++) try { return await apiResult(fetchResource, STORY_URL, webVersion, clients.web, access, { path: logical, quality: 3 }); }
      catch (error) { if (attempt >= 2 || ![429, 500, 502, 503, 504].includes(error.status)) throw error; }
    };
    let result; try { result = await lookup(); } catch (error) {
      if (![401, 403].includes(error.status) && error.code !== 13) throw error;
      renewed ||= renew(); await renewed; result = await lookup();
    }
    // Shared sound effects/BGM are returned once per scene that uses them
    // (heart_1 alone currently has 1279 identical rows). Select one mapping;
    // duplicate rows must not reject a valid resource or trigger extra downloads.
    // Leading '/'
    // must be removed from the lookup parameter, but the returned path remains
    // authoritative for the CDN hash (older captured maps may retain it).
    if (!Array.isArray(result.resources) || result.resources.length > 16384) throw new Error('剧情资源映射无效。');
    const candidates = result.resources.filter(row => logicalPath(row?.path) === logical && [0, 3].includes(row.quality));
    const row = candidates.find(row => row.quality === 3) || candidates.find(row => row.quality === 0);
    if (!row) throw new Error('该剧情素材尚未发布或暂不可用。');
    return resourceSpec({ path: row.path, md5: row.md5 }, webVersion.resourceVersion);
  }
  return { version: webVersion.resourceVersion, getResource };
}
export { storySession, authorization, password, SESSION_FILE, PHONE_API, PHONE_VERSION_URL, STORY_URL };
