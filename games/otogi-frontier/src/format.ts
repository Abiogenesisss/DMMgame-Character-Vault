'use strict';
const crypto = require('node:crypto'), zlib = require('node:zlib');
const ORIGIN = 'https://web-assets.otogi-frontier.com';
const BASE = ORIGIN + '/prodassets/GeneralWebGL/Assets/';
const MASTER = ORIGIN + '/prodassets/MasterData/MMonsters.gz';
const { RARITIES } = require('./rarity.ts');
const validId = value => /^\d{4,8}$/.test(String(value));
function resourceKind(input) {
  const url = new URL(input); if (url.origin !== ORIGIN || url.username || url.password) return null;
  if (url.pathname === '/prodassets/MasterData/MMonsters.gz') return 'master';
  if (url.href.split('?')[0] === BASE + 'chara_icon') return 'icons';
  const relative = url.pathname.slice(new URL(BASE).pathname.length);
  if (!url.pathname.startsWith(new URL(BASE).pathname)) return null;
  if (/^chara\/(homestand|standimagelarge)\/\d{4,8}$/.test(relative)) return 'portraits';
  if (/^chara\/still\/\d{4,8}$/.test(relative)) return 'cg';
  if (/^sound\/voice\/(still|adventure)\/voice_(still|adventure)_\d{4,8}$/.test(relative)) return 'voices';
  if (/^bg\/adventure\/bg_adventure_[a-zA-Z0-9_-]+$/.test(relative)) return 'backgrounds';
  if (/^sound\/bgm\/bgm_[a-zA-Z0-9_-]+$/.test(relative)) return 'music';
  if (/^sound\/se\/[a-zA-Z0-9_-]+$/.test(relative)) return 'sound';
  return null;
}
function readMaster(bytes) {
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(zlib.gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 })));
  if (!Array.isArray(data) || data.length > 50000) throw new Error('童话边境角色表格式无效。');
  return data;
}
function decodeBundle(bytes, codec) {
  if (bytes.length > 80 * 1024 * 1024) throw new Error('童话边境资源超出大小限制。');
  if (bytes.subarray(0, 8).toString() === 'UnityFS\0') return bytes;
  if (!codec || !/^[a-f0-9]{32}$/.test(codec.key) || !/^[a-f0-9]{32}$/.test(codec.iv) || codec.mode !== 'cbc' || codec.skip !== 0) throw new Error('童话边境 CG 解码资料未就绪，请重新导入抓包。');
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(codec.key, 'hex'), Buffer.from(codec.iv, 'hex'));
  const decoded = Buffer.concat([decipher.update(bytes), decipher.final()]);
  if (decoded.subarray(0, 8).toString() !== 'UnityFS\0') throw new Error('童话边境资源格式无效。');
  return decoded;
}
// The public Unity metadata contains the asset cipher constants. Read its
// literal table as data; never run the captured loader, WASM or game code.
function metadataLiterals(packageBytes) {
  const data = packageBytes.subarray(0, 15).toString() === 'UnityWebData1.0' ? packageBytes
    : packageBytes[0] === 31 && packageBytes[1] === 139 ? zlib.gunzipSync(packageBytes, { maxOutputLength: 100 * 1024 * 1024 })
      : zlib.brotliDecompressSync(packageBytes, { maxOutputLength: 100 * 1024 * 1024 });
  if (data.subarray(0, 15).toString() !== 'UnityWebData1.0') throw new Error('无法识别童话边境公开资源资料。');
  const end = data.readUInt32LE(16); let position = 20, metadata;
  if (end > data.length) throw new Error('资源资料头部不完整。');
  while (position < end) {
    if (position + 12 > end) throw new Error('资源资料目录不完整。');
    const offset = data.readUInt32LE(position), size = data.readUInt32LE(position + 4), length = data.readUInt32LE(position + 8); position += 12;
    if (position + length > end || offset + size > data.length) throw new Error('资源资料目录越界。');
    const name = data.subarray(position, position + length).toString(); position += length;
    if (name === 'Il2CppData/Metadata/global-metadata.dat') metadata = data.subarray(offset, offset + size);
  }
  if (!metadata || metadata.length < 24 || metadata.readUInt32LE(0) !== 0xfab11baf) throw new Error('缺少 Unity 静态资料。');
  const table = metadata.readUInt32LE(8), size = metadata.readUInt32LE(12), strings = metadata.readUInt32LE(16), stringSize = metadata.readUInt32LE(20);
  if (table + size > metadata.length || strings + stringSize > metadata.length || size % 8) throw new Error('Unity 静态资料越界。');
  const literals = [];
  for (let offset = table; offset < table + size; offset += 8) {
    const length = metadata.readUInt32LE(offset), start = metadata.readUInt32LE(offset + 4);
    if (start + length > stringSize) throw new Error('Unity 字面量越界。');
    if (length >= 3 && length <= 256) literals.push(metadata.subarray(strings + start, strings + start + length).toString('utf8'));
  }
  return literals;
}
function discoverCodec(literals, encrypted) {
  const keys = new Map(), add = key => { if (key.length === 16) keys.set(key.toString('hex'), key); };
  for (const value of literals) {
    add(Buffer.from(value)); add(Buffer.from(value, 'utf16le'));
    if (/^[a-f0-9]{32}$/i.test(value)) add(Buffer.from(value, 'hex'));
    if (/^[A-Za-z0-9+/]{22}={0,2}$/.test(value)) add(Buffer.from(value, 'base64'));
    add(crypto.createHash('md5').update(value).digest());
  }
  if (encrypted.length < 80 || encrypted.length % 16) throw new Error('CG 资源正文不完整。');
  for (const key of keys.values()) {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16)); decipher.setAutoPadding(false);
    const prefix = decipher.update(encrypted.subarray(0, 80));
    if (!/^x\x00(?:20\d\d|5)\./.test(prefix.subarray(16, 40).toString('latin1'))) continue;
    const iv = Buffer.from(prefix.subarray(0, 16)), header = Buffer.from('UnityFS\0\0\0\0\x085.x.', 'latin1');
    for (let i = 0; i < 16; i++) iv[i] ^= header[i];
    const codec = { key: key.toString('hex'), iv: iv.toString('hex'), mode: 'cbc', skip: 0 };
    const bytes = decodeBundle(encrypted, codec);
    // Check the public bundle header and length as well as cipher padding.
    let offset = 12; while (offset < 128 && bytes[offset++]) {} while (offset < 128 && bytes[offset++]) {}
    if (offset + 8 <= bytes.length && bytes.readBigUInt64BE(offset) === BigInt(bytes.length)) return codec;
  }
  throw new Error('未能确认童话边境资源编码。原始资源已保留。');
}
export { ORIGIN, BASE, MASTER, RARITIES, validId, resourceKind, readMaster, decodeBundle, metadataLiterals, discoverCodec };
