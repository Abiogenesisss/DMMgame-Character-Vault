const path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const ORIGIN = 'https://minasigo-no-shigoto-pd-c-res.orphans-order.com';
const API = 'https://minasigo-no-shigoto-web-r-server.orphans-order.com';
const VERSION_URL = API + '/mnsg/user/getVersion';
const validId = value => typeof value === 'string' && /^\d{6}$/.test(value);
const validVersion = value => typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(value);
const hash = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');
const logicalPath = value => typeof value === 'string' && /^\/?(?:image|sound|sp|spine|video|adv|dummy)\/[A-Za-z0-9_./-]+$/.test(value)
  && !value.split('/').some(part => part === '.' || part === '..') ? value.replace(/^\//, '') : null;

// Field numbers and types from the client's generated Protocol Buffers schema.
// Decode only character/catalog fields; account and battle data are excluded.
const SCHEMAS = {
  CharacterMain: { 2: 'groupId', 3: 'id', 5: 'unitType', 6: 'name$', 7: 'shortName$', 12: 'rarity', 22: 'contentsGroupId' },
  SummonMain: { 2: 'groupId', 3: 'id', 5: 'unitType', 6: 'name$', 7: 'shortName$', 12: 'rarity', 25: 'contentsGroupId' },
  CharacterText: { 1: 'id', 2: 'sceneType', 3: 'groupType', 4: 'title$', 6: 'voiceFile$', 7: 'order' },
  SummonText: { 1: 'id', 2: 'sceneType', 3: 'groupType', 4: 'title$', 6: 'voiceFile$' },
  StoryMain: { 2: 'storyId', 3: 'category', 5: 'unitId', 6: 'title$', 7: 'name$', 9: 'resourcePath$', 10: 'resourcePathR18$', 15: 'contentType' }
};
const TABLES = Object.keys(SCHEMAS);
function protobufFields(bytes) {
  let offset = 0; const fields = [];
  function variable() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      if (offset >= bytes.length) throw new Error('主数据截断。');
      const next = bytes[offset++]; value |= BigInt(next & 127) << BigInt(i * 7);
      if (!(next & 128)) { if (i === 9 && next > 1) throw new Error('主数据整数溢出。'); return value; }
    }
    throw new Error('主数据整数无效。');
  }
  while (offset < bytes.length) {
    if (fields.length >= 100000) throw new Error('主数据字段过多。');
    const tag = Number(variable()); if (!Number.isSafeInteger(tag) || tag > 0xffffffff || tag < 8) throw new Error('主数据字段无效。');
    const wire = tag & 7; let value;
    if (wire === 0) value = variable();
    else if (wire === 2) {
      const size = Number(variable()); if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - offset) throw new Error('主数据长度无效。');
      value = bytes.subarray(offset, offset + size); offset += size;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4; if (offset + size > bytes.length) throw new Error('主数据截断。'); offset += size;
    } else throw new Error('主数据字段类型无效。');
    fields.push({ id: tag >>> 3, wire, value });
  }
  return fields;
}
function decodeTable(bytes, name) {
  const schema = SCHEMAS[name]; if (!schema) throw new Error('不支持的主数据表。');
  let data; try { data = zlib.inflateSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }); } catch { throw new Error('主数据压缩格式无效。'); }
  return protobufFields(data).map(field => {
    if (field.id !== 1 || field.wire !== 2) throw new Error('主数据列表格式无效。');
    const row = Object.fromEntries(Object.values<string>(schema).map(key => [key.replace(/\$$/, ''), key.endsWith('$') ? '' : 0]));
    for (const item of protobufFields(field.value)) {
      const key = schema[item.id]; if (!key) continue;
      if (item.wire !== (key.endsWith('$') ? 2 : 0)) throw new Error('主数据字段与格式不符。');
      row[key.replace(/\$$/, '')] = key.endsWith('$') ? new TextDecoder('utf-8', { fatal: true }).decode(item.value) : Number(BigInt.asIntN(32, item.value));
    }
    return row;
  });
}

function decryptPayload(value, password) {
  if (typeof value !== 'string' || value.length > 64 * 1024 * 1024 || !/^[A-Za-z0-9+/=\r\n]+$/.test(value)) throw new Error('资源清单编码无效。');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.subarray(0, 8).toString() !== 'Salted__' || bytes.length < 32) throw new Error('资源清单格式无效。');
  // CryptoJS password-based AES uses the OpenSSL salted key derivation. The
  // manifest passphrase is a public client-format constant, never an account key.
  let material = Buffer.alloc(0), previous = Buffer.alloc(0);
  while (material.length < 48) {
    previous = crypto.createHash('md5').update(previous).update(password).update(bytes.subarray(8, 16)).digest();
    material = Buffer.concat([material, previous]);
  }
  const cipher = crypto.createDecipheriv('aes-256-ctr', material.subarray(0, 32), material.subarray(32, 48));
  let plain = Buffer.concat([cipher.update(bytes.subarray(16)), cipher.final()]);
  const padding = plain.at(-1);
  if (!(padding >= 1 && padding <= 16) || !plain.subarray(-padding).every(byte => byte === padding)) throw new Error('资源清单校验失败。');
  plain = plain.subarray(0, -padding);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)); } catch { throw new Error('资源清单正文无效。'); }
}
function encryptPayload(value, password) {
  const salt = crypto.randomBytes(8); let material = Buffer.alloc(0), previous = Buffer.alloc(0);
  while (material.length < 48) {
    previous = crypto.createHash('md5').update(previous).update(password).update(salt).digest();
    material = Buffer.concat([material, previous]);
  }
  const plain = Buffer.from(JSON.stringify(value)), padding = 16 - plain.length % 16;
  const cipher = crypto.createCipheriv('aes-256-ctr', material.subarray(0, 32), material.subarray(32, 48));
  return Buffer.concat([Buffer.from('Salted__'), salt, cipher.update(Buffer.concat([plain, Buffer.alloc(padding, padding)])), cipher.final()]).toString('base64');
}
function decodeManifest(bytes) {
  let text = bytes.toString('utf8').trim(); if (text.startsWith('"')) { try { text = JSON.parse(text); } catch { throw new Error('资源清单格式无效。'); } }
  const password = crypto.createHash('sha256').update('#mnsg#manifest').digest('base64').slice(0, 32);
  const data = decryptPayload(text, password);
  if (!validVersion(data?.version) || !data.assets || typeof data.assets !== 'object' || Array.isArray(data.assets) || !Object.keys(data.assets).length) throw new Error('资源清单缺少有效版本或素材。');
  return data;
}
function resourceSpec(record, version) {
  const logical = logicalPath(record.path);
  if (!logical || !validVersion(version) || !/^[a-f0-9]{32}$/.test(record.md5 || '')) throw new Error('素材路径、版本或校验值无效。');
  const extension = path.posix.extname(record.path); if (!/^\.(png|jpg|jpeg|mp3|mp4|json|bin|skel|atlas|txt|plist)$/.test(extension)) throw new Error('不支持的素材类型。');
  const stem = record.path.slice(0, -extension.length), directory = hash(stem, 'md5');
  const mode = parseInt(directory[0], 16), offsets = mode < 4 ? [0, 4] : mode < 8 ? [2, 6, 0] : mode < 12 ? [4, 0, 6, 2] : [6, 2, 4, 0];
  return { path: record.path, logical, md5: record.md5,
    url: ORIGIN + '/' + version + '/' + hash(record.path, 'md5') + '/' + offsets.map(offset => directory.slice(offset, offset + 2)).join('/') + '/' + record.md5 + extension };
}
function resourceKind(value) {
  let url; try { url = new URL(value); } catch { return null; }
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash) return null;
  if (/^\/\d+\.\d+\.\d+\/[a-f0-9]{32}\/(?:[a-f0-9]{2}\/){2,4}[a-f0-9]{32}\.(png|jpg|jpeg|mp3|mp4|json|bin|skel|atlas|txt|plist)$/.test(url.pathname)) return 'asset';
  if (/^\/\d+\.\d+\.\d+\/resource\.json$/.test(url.pathname)) return 'manifest';
  if (TABLES.some(name => url.pathname === '/bin/' + name + '.bin')) return 'master';
  return null;
}
async function requestBytes(fetchResource, url, limit = 64 * 1024 * 1024, init: RequestInit = {}) {
  let response; try { response = await fetchResource(url, { ...init, signal: AbortSignal.timeout(60000) }); } catch { throw new Error('游戏资源请求失败，请检查网络。'); }
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('游戏资源 HTTP ' + response.status + '。'), { status: response.status }); }
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('游戏资源超过大小限制。'); }
  const chunks = []; let size = 0;
  try { for await (const chunk of response.body || []) { size += chunk.length; if (size > limit) throw new Error('size'); chunks.push(chunk); } }
  catch { throw new Error(size > limit ? '游戏资源超过大小限制。' : '游戏资源读取失败。'); }
  if (!size) throw new Error('游戏资源为空。'); return Buffer.concat(chunks);
}
export { ORIGIN, API, VERSION_URL, TABLES, validId, validVersion, logicalPath, hash, decodeTable, decryptPayload, encryptPayload, decodeManifest, resourceSpec, resourceKind, requestBytes };
