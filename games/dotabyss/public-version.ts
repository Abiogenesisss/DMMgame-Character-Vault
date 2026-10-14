'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), zlib = require('node:zlib');
const { ORIGIN } = require('./format.ts');
const { readJson, writeJson } = require('./catalog.ts');
const { fetchPublicResource } = require('../../app/public-fetch.ts');
const CLIENT_URL = ORIGIN + '/resources/webgl/r18/app/Build/WebGL.data.br';
const VERSION_URL = ORIGIN + '/version';
const MAX_CLIENT = 180 * 1024 * 1024;

async function readResponse(response, limit, label) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(label + ' HTTP ' + response.status); }
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error(label + '超过大小限制。'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length; if (size > limit) throw new Error(label + '超过大小限制。'); chunks.push(chunk);
  }
  if (!size) throw new Error(label + '为空。');
  return Buffer.concat(chunks);
}
function decodeBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('公开版本配置编码无效。');
  return Buffer.from(value, 'base64');
}
function decrypt(key, iv, bytes) {
  if (key.length !== 32 || iv.length !== 16 || !bytes.length || bytes.length % 16) throw new Error('公开版本配置密文无效。');
  const cipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}
function unpackClient(input) {
  const magic = 'UnityWebData1.0\0';
  const bytes = input.subarray(0, 16).toString('ascii') === magic ? input : zlib.brotliDecompressSync(input, { maxOutputLength: MAX_CLIENT });
  if (bytes.length < 20 || bytes.subarray(0, 16).toString('ascii') !== magic) throw new Error('公开客户端数据格式无效。');
  const header = bytes.readUInt32LE(16), files = {}; let at = 20;
  if (header < at || header > bytes.length) throw new Error('公开客户端目录越界。');
  while (at < header) {
    if (at + 12 > header) throw new Error('公开客户端目录越界。');
    const offset = bytes.readUInt32LE(at), length = bytes.readUInt32LE(at + 4), size = bytes.readUInt32LE(at + 8); at += 12;
    if (!size || size > 4096 || at + size > header || offset < header || offset + length > bytes.length) throw new Error('公开客户端文件越界。');
    const name = bytes.toString('utf8', at, at + size); at += size;
    if (['data.unity3d', 'Il2CppData/Metadata/global-metadata.dat'].includes(name)) {
      if (files[name]) throw new Error('公开客户端包含重复文件。');
      files[name] = bytes.subarray(offset, offset + length);
    }
  }
  if (Object.keys(files).length !== 2) throw new Error('公开客户端缺少版本配置。');
  return { player: files['data.unity3d'], metadata: files['Il2CppData/Metadata/global-metadata.dat'] };
}
function metadataConstants(bytes) {
  // IL2CPP 39 uses offset/size/count triples. Reject changed layouts instead of
  // guessing offsets or caching an incorrectly decoded client key.
  if (bytes.length < 380 || bytes.readUInt32LE(0) !== 0xfab11baf || bytes.readUInt32LE(4) !== 39) throw new Error('暂不支持此客户端元数据版本。');
  const section = index => {
    const at = 8 + index * 12, offset = bytes.readUInt32LE(at), size = bytes.readUInt32LE(at + 4), count = bytes.readUInt32LE(at + 8);
    if (offset + size > bytes.length) throw new Error('客户端元数据越界。');
    return { bytes: bytes.subarray(offset, offset + size), count };
  };
  const strings = section(2).bytes, types = section(19), fields = section(11), defaults = section(7), data = section(8).bytes;
  if (types.bytes.length !== types.count * 82 || fields.bytes.length !== fields.count * 12 || defaults.bytes.length !== defaults.count * 12) throw new Error('客户端元数据布局已变化。');
  const name = index => {
    const end = strings.indexOf(0, index);
    if (index >= strings.length || end < index) throw new Error('客户端元数据名称无效。');
    return strings.toString('utf8', index, end);
  };
  const selected = new Map();
  for (let at = 0; at < types.bytes.length; at += 82) {
    if (name(types.bytes.readUInt32LE(at)) !== 'Crypto' || name(types.bytes.readUInt32LE(at + 4)) !== 'Absl.Cryptography') continue;
    const first = types.bytes.readInt32LE(at + 26), count = types.bytes.readUInt16LE(at + 62);
    if (first < 0 || first + count > fields.count) throw new Error('客户端字段越界。');
    for (let i = first; i < first + count; i++) {
      const field = name(fields.bytes.readUInt32LE(i * 12));
      if (['SecretKey', 'CryptoKey'].includes(field)) selected.set(i, field);
    }
  }
  const result: {SecretKey?: string; CryptoKey?: string; } = {};
  for (let at = 0; at < defaults.bytes.length; at += 12) {
    const field = selected.get(defaults.bytes.readInt32LE(at)); if (!field) continue;
    const offset = defaults.bytes.readInt32LE(at + 8), encoded = data[offset];
    // The two short string constants use a one-byte compressed signed length.
    if (offset < 0 || encoded === undefined || encoded >= 128 || encoded % 2 || !encoded || offset + 1 + encoded / 2 > data.length) throw new Error('客户端版本常量格式已变化。');
    result[field] = data.subarray(offset + 1, offset + 1 + encoded / 2);
  }
  if (!result.SecretKey || !result.CryptoKey) throw new Error('客户端缺少公开版本常量。');
  return result;
}
function configAppKey(bytes, constants) {
  const key = crypto.createHmac('sha256', constants.SecretKey).update(constants.CryptoKey).digest();
  const values = []; let at = 0;
  while (at < bytes.length) {
    let size = 0, shift = 0, byte;
    do {
      if (at >= bytes.length || shift > 28) throw new Error('客户端配置长度无效。');
      byte = bytes[at++]; size += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    if (!size || size > 65536 || at + size > bytes.length || values.length > 2048) throw new Error('客户端配置越界。');
    const encrypted = decodeBase64(bytes.toString('utf8', at, at + size)); at += size;
    values.push(decrypt(key, encrypted.subarray(0, 16), encrypted.subarray(16)).toString('utf8'));
  }
  if (values.length % 2 !== 1) throw new Error('客户端配置字段不完整。');
  for (let i = 1; i < values.length; i += 2) if (values[i] === 'OlgBaseApi_AppKey') {
    if (!/^base64:[A-Za-z0-9+/]{43}=$/.test(values[i + 1])) break;
    return decodeBase64(values[i + 1].slice(7));
  }
  throw new Error('客户端缺少公开版本密钥。');
}
async function extractConfig(player) {
  const parent = fs.realpathSync(os.tmpdir()), directory = fs.mkdtempSync(path.join(parent, 'dotabyss-bootstrap-'));
  try {
    const input = path.join(directory, 'data.unity3d'); fs.writeFileSync(input, player);
    const result = await require('./unity.ts').runUnity({ input }, { worker: path.join(__dirname, 'export_bootstrap.py'), pythonEnv: 'DOTABYSS_PYTHON' });
    if (typeof result.production !== 'string' || result.production.length > 1024 * 1024) throw new Error('客户端配置提取失败。');
    return decodeBase64(result.production);
  } finally {
    if (path.dirname(directory) === parent && path.basename(directory).startsWith('dotabyss-bootstrap-') && fs.realpathSync(directory) === directory) fs.rmSync(directory, { recursive: true, force: true });
  }
}
async function bootstrap(root, { fetchResource, onProgress, extractProduction = extractConfig }) {
  onProgress({ phase: 'client', targets: 0, checked: 0 });
  const response = await fetchResource(CLIENT_URL, { signal: AbortSignal.timeout(120000) });
  const bytes = await readResponse(response, MAX_CLIENT, '公开客户端'), client = unpackClient(bytes);
  const key = configAppKey(await extractProduction(client.player), metadataConstants(client.metadata));
  // Keep only the public-client key needed for /version; never persist session
  // headers, API tokens or unrelated values from the production configuration.
  writeJson(path.join(root, 'metadata/public-bootstrap.json'), { version: 1, key: key.toString('base64'), clientDigest: crypto.createHash('sha256').update(bytes).digest('hex') });
  return key;
}
function decodeVersion(bytes, header, key) {
  if (typeof header !== 'string' || header.length > 8192) throw new Error('版本接口缺少公开会话封包。');
  const envelope = JSON.parse(decodeBase64(decodeURIComponent(header)).toString('utf8'));
  if (typeof envelope.iv !== 'string' || typeof envelope.value !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.mac) || envelope.tag) throw new Error('版本接口封包无效。');
  const mac = crypto.createHmac('sha256', key).update(envelope.iv + envelope.value).digest();
  if (!crypto.timingSafeEqual(mac, Buffer.from(envelope.mac, 'hex'))) throw new Error('版本接口封包校验失败。');
  const serialized = decrypt(key, decodeBase64(envelope.iv), decodeBase64(envelope.value)).toString('utf8');
  const match = /^s:(\d{1,4}):"([^"\r\n]+)";$/.exec(serialized);
  if (!match || Buffer.byteLength(match[2]) !== Number(match[1])) throw new Error('版本接口公开会话格式无效。');
  const bodyKey = crypto.createHmac('sha256', key).update(match[2]).digest();
  const payload = JSON.parse(decrypt(bodyKey, bytes.subarray(0, 16), bytes.subarray(16)).toString('utf8'));
  const versions = payload.versions?.AssetVersionWebDmmR18;
  if (payload.status !== 'OK' || !Array.isArray(versions) || versions.length !== 1 || typeof versions[0] !== 'string' || !/^[1-9]\d{0,11}$/.test(versions[0])) throw new Error('版本接口未返回有效的 DOTABYSS 资源版本。');
  const assetVersion = versions[0], bundleBase = ORIGIN + '/resources/webgl/r18/aas/' + assetVersion + '/aa/';
  return { assetVersion, bundleBase, catalogUrl: bundleBase + 'catalog_1.bin', hashUrl: bundleBase + 'catalog_1.hash' };
}
async function publicVersion(root, { fetchResource = fetchPublicResource, onProgress = () => {}, extractProduction }: any = {}) {
  let cached; try { cached = readJson(path.join(root, 'metadata/public-bootstrap.json'), {}); } catch { cached = {}; }
  let key = cached.version === 1 && /^[A-Za-z0-9+/]{43}=$/.test(cached.key) ? Buffer.from(cached.key, 'base64') : null;
  let refreshed = !key;
  if (!key) key = await bootstrap(root, { fetchResource, onProgress, extractProduction });
  for (;;) {
    onProgress({ phase: 'version', targets: 0, checked: 0 });
    const response = await fetchResource(VERSION_URL, { signal: AbortSignal.timeout(30000) });
    const bytes = await readResponse(response, 128 * 1024, '公开版本接口');
    try { return decodeVersion(bytes, response.headers.get('x-olg-session'), key); }
    catch {
      if (refreshed) throw new Error('DOTABYSS 版本协议已变化，更新失败；已保存的资源仍可使用。');
      refreshed = true; key = await bootstrap(root, { fetchResource, onProgress, extractProduction });
    }
  }
}
export { publicVersion, decodeVersion, unpackClient, metadataConstants, configAppKey, readResponse, CLIENT_URL, VERSION_URL };
