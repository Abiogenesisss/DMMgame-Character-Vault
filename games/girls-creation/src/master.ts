import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inflateRawSync, brotliDecompressSync } from 'node:zlib';
import { loadPack, routeKey, sha256 } from '../../../app/pack.ts';
import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
import { BASE, ORIGIN } from './format.ts';
import { runUnity } from './unity.ts';

export const MASTER_TABLES = ['mUnits', 'mLayers', 'mSubunits', 'mNovels', 'mLayerOpenNovels', 'mSubunitOpenNovels', 'mUnitLovePointOpenNovels', 'mUnitWords', 'mSubunitWords'];
export const CLIENT = ORIGIN + '/files/bin/production/webgl/r18/r18.data.br';
const LIMIT = 128 * 1024 * 1024;

// Read the public client's MasterLoader.Key constant. It is a resource codec,
// unrelated to the account/session credentials carried by a HAR.
export function clientFiles(input: Buffer) {
  const bytes = input.toString('ascii', 0, 16) === 'UnityWebData1.0\0' ? input : brotliDecompressSync(input, { maxOutputLength: LIMIT });
  if (bytes.length < 20 || bytes.toString('ascii', 0, 16) !== 'UnityWebData1.0\0') throw Error('少女艺术客户端数据格式无效。');
  const end = bytes.readUInt32LE(16); let at = 20, metadata: Buffer, player: Buffer;
  if (end < at || end > bytes.length) throw Error('客户端目录越界。');
  while (at < end) {
    if (at + 12 > end) throw Error('客户端目录越界。');
    const offset = bytes.readUInt32LE(at), size = bytes.readUInt32LE(at + 4), length = bytes.readUInt32LE(at + 8); at += 12;
    if (!length || length > 4096 || at + length > end || offset < end || offset + size > bytes.length) throw Error('客户端文件越界。');
    const name = bytes.toString('utf8', at, at + length); at += length;
    if (name === 'Il2CppData/Metadata/global-metadata.dat') metadata = bytes.subarray(offset, offset + size);
    if (name === 'data.unity3d') player = bytes.subarray(offset, offset + size);
  }
  return {metadata,player};
}
export function clientConstant(metadata: Buffer, typeName: string, fieldName: string) {
  if (!metadata || metadata.length < 380 || metadata.readUInt32LE(0) !== 0xfab11baf || metadata.readUInt32LE(4) !== 39) throw Error('暂不支持此客户端元数据版本。');
  const section = (index, stride?) => {
    const at = 8 + index * 12, offset = metadata.readUInt32LE(at), size = metadata.readUInt32LE(at + 4), count = metadata.readUInt32LE(at + 8);
    if (offset + size > metadata.length || (stride && size !== count * stride)) throw Error('客户端元数据布局已变化。');
    return metadata.subarray(offset, offset + size);
  };
  const strings = section(2), types = section(19, 82), fields = section(11, 12), defaults = section(7, 12), data = section(8);
  const name = offset => { const end = strings.indexOf(0, offset); if (end < offset || offset >= strings.length) throw Error('客户端字段名越界。'); return strings.toString('utf8', offset, end); };
  let field = -1;
  for (let at = 0; at < types.length; at += 82) {
    if (name(types.readUInt32LE(at)) !== typeName || name(types.readUInt32LE(at + 4)) !== 'DMM.OLG.Unity.Engine') continue;
    const first = types.readInt32LE(at + 26), count = types.readUInt16LE(at + 62);
    if (first < 0 || (first + count) * 12 > fields.length) throw Error('客户端字段越界。');
    for (let i = first; i < first + count; i++) if (name(fields.readUInt32LE(i * 12)) === fieldName) field = i;
  }
  for (let at = 0; at < defaults.length; at += 12) if (defaults.readInt32LE(at) === field && field >= 0) {
    const offset = defaults.readInt32LE(at + 8), length = data[offset] / 2;
    if (offset < 0 || !Number.isInteger(length) || length < 1 || length >= 64 || offset + 1 + length > data.length) throw Error('主数据编码常量无效。');
    return data.subarray(offset + 1, offset + 1 + length);
  }
  throw Error('客户端缺少主数据编码常量。');
}
export function masterKey(input: Buffer) {
  return crypto.createHash('md5').update(clientConstant(clientFiles(input).metadata,'MasterLoader','Key')).digest('hex');
}

export function decodeMaster(tables, key: string) {
  if (!/^[a-f0-9]{32}$/.test(key)) throw Error('主数据编码无效。');
  const result = {};
  for (const name of MASTER_TABLES) {
    const text = tables[name]?.trim();
    if (typeof text !== 'string' || text.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw Error('主数据表缺失或格式无效：' + name);
    const decipher = crypto.createDecipheriv('des-ede', Buffer.from(key, 'hex'), null);
    const compressed = Buffer.concat([decipher.update(Buffer.from(text, 'base64')), decipher.final()]).toString('utf8');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compressed)) throw Error('主数据编码已变化。');
    const rows = JSON.parse(inflateRawSync(Buffer.from(compressed, 'base64'), { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'));
    if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row?.id))) throw Error('主数据表内容无效：' + name);
    result[name] = rows;
  }
  return result;
}

export async function prepareMaster(root, { fetchResource = require('../../../app/public-fetch.ts').fetchPublicResource, exportResources = runUnity }: any = {}) {
  const file = path.join(root, 'metadata/master-data.json'), previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const pack = loadPack(path.join(root, 'cache')), record = pack.manifest.routes[routeKey('GET', BASE + 'master.dmm')]?.at(-1);
  if (!record || record.status !== 200) return previous?.tables;
  if (previous?.fingerprint === record.body) return previous.tables;
  if (!/^[a-f0-9]{64}$/.test(record.body)) throw Error('主数据文件校验失败。');
  const input = path.join(pack.root, 'bodies', record.body);
  if (!fs.existsSync(input) || sha256(fs.readFileSync(input)) !== record.body) throw Error('主数据文件校验失败。');
  const codecFile = path.join(root, 'metadata/master-codec.json');
  let key = fs.existsSync(codecFile) ? JSON.parse(fs.readFileSync(codecFile, 'utf8')).key : null;
  if (!key) {
    const response = await fetchResource(CLIENT, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) { await response.body?.cancel(); throw Error('公开客户端 HTTP ' + response.status); }
    const parts = []; let size = 0;
    for await (const part of response.body) { size += part.length; if (size > LIMIT) throw Error('公开客户端过大。'); parts.push(part); }
    key = masterKey(Buffer.concat(parts)); writeAtomicFileSync(codecFile, JSON.stringify({ key }));
  }
  const result: any = await exportResources({ output: path.join(root, 'library'), assets: [{ name: 'master.dmm', kind: 'master', input, fingerprint: record.body, tables: MASTER_TABLES }] });
  const tables = decodeMaster(result.resources?.[0]?.tables || {}, key);
  writeAtomicFileSync(file, JSON.stringify({ fingerprint: record.body, tables }));
  return tables;
}
