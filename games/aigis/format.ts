'use strict';
const zlib = require('node:zlib');
const BASE = 'https://drc1bk94f7rq8.cloudfront.net/';
const MAX_BYTES = 128 * 1024 * 1024;
const align = value => (value + 3) & ~3;
function check(bytes, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) throw new Error('千年战争资源已截断或偏移无效。');
}
function stringAt(bytes, offset, limit = 256) {
  check(bytes, offset, 1);
  const end = bytes.indexOf(0, offset), stop = Math.min(bytes.length, offset + limit);
  return bytes.toString('utf8', offset, end >= offset && end < stop ? end : stop);
}
function allocated(size) {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) throw new Error('千年战争资源大小超出限制。');
  return Buffer.alloc(size);
}
function lz4(bytes, size) {
  check(bytes, 0, 7);
  if (bytes.readUInt32LE(0) !== 0x184d2204) throw new Error('无效的 LZ4 帧。');
  const flags = bytes[4];
  if (flags >>> 6 !== 1) throw new Error('不支持的 LZ4 帧版本。');
  let cursor = 6;
  if (flags & 8) { check(bytes, cursor, 8); if (bytes.readBigUInt64LE(cursor) !== BigInt(size)) throw new Error('LZ4 解包大小不符。'); cursor += 8; }
  if (flags & 1) cursor += 4;
  check(bytes, cursor, 1); cursor++;
  const output = allocated(size); let written = 0;
  while (true) {
    check(bytes, cursor, 4); const header = bytes.readUInt32LE(cursor); cursor += 4;
    if (!header) break;
    const count = header & 0x7fffffff, end = cursor + count, blockStart = written;
    check(bytes, cursor, count);
    if (header & 0x80000000) {
      check(output, written, count); bytes.copy(output, written, cursor, end); written += count; cursor = end;
    } else while (cursor < end) {
      const token = bytes[cursor++]; let literals = token >>> 4;
      if (literals === 15) { let value; do { check(bytes, cursor, 1); if (cursor >= end) throw new Error('LZ4 字面段已截断。'); value = bytes[cursor++]; literals += value; } while (value === 255); }
      if (cursor + literals > end) throw new Error('LZ4 字面段越界。');
      check(output, written, literals); bytes.copy(output, written, cursor, cursor + literals); written += literals; cursor += literals;
      if (cursor === end) break;
      if (cursor + 2 > end) throw new Error('LZ4 引用已截断。');
      const distance = bytes.readUInt16LE(cursor); cursor += 2;
      if (!distance || written - distance < (flags & 32 ? blockStart : 0)) throw new Error('LZ4 引用越界。');
      let length = (token & 15) + 4;
      if ((token & 15) === 15) { let value; do { if (cursor >= end) throw new Error('LZ4 引用长度已截断。'); value = bytes[cursor++]; length += value; } while (value === 255); }
      check(output, written, length);
      for (let i = 0; i < length; i++) { output[written] = output[written - distance]; written++; }
    }
    if (flags & 16) { check(bytes, cursor, 4); cursor += 4; }
  }
  if (flags & 4) check(bytes, cursor, 4);
  if (written !== size) throw new Error('LZ4 解包长度不符。');
  return output;
}
// ALLZ/ALAR/ALTX/ALTB layout follows Lzlis's public-domain format notes and
// parser. The decoder only reads data; captured Lua or scripts are never run.
function allz(bytes) {
  check(bytes, 0, 12);
  if (bytes[4] !== 1 || [bytes[5], bytes[6], bytes[7]].some(bits => bits > 24)) throw new Error('不支持的 ALLZ 头。');
  const output = allocated(bytes.readUInt32LE(8)); let cursor = 12, written = 0, bits = 0, available = 0;
  const readBits = count => {
    if (count > 24) throw new Error('ALLZ 控制段过长。');
    while (available < count) { check(bytes, cursor, 1); bits = (bits | (bytes[cursor++] << available)) >>> 0; available += 8; }
    const result = bits & ((2 ** count) - 1); bits >>>= count; available -= count; return result;
  };
  const control = minimum => {
    let unary = 0; while (readBits(1)) { if (++unary + minimum > 24) throw new Error('ALLZ 控制段无效。'); }
    return readBits(unary + minimum) + ((2 ** unary) - 1) * (2 ** minimum);
  };
  const literal = length => { check(bytes, cursor, length); check(output, written, length); bytes.copy(output, written, cursor, cursor + length); written += length; cursor += length; };
  const word = (distance, length) => {
    if (written + distance < 0 || distance >= 0) throw new Error('ALLZ 引用越界。');
    check(output, written, length); for (let i = 0; i < length; i++) { output[written] = output[written + distance]; written++; }
  };
  literal(1 + control(bytes[7]));
  if (written === output.length) return output;
  let distance = -1 - control(bytes[6]), length = 3 + control(bytes[5]);
  while (written < output.length) {
    if (written + length >= output.length) { word(distance, length); break; }
    if (!readBits(1)) {
      const count = 1 + control(bytes[7]);
      if (written + length + count >= output.length) { word(distance, length); literal(count); break; }
      const literalStart = cursor; check(bytes, cursor, count); cursor += count;
      const nextDistance = -1 - control(bytes[6]), nextLength = 3 + control(bytes[5]), controlEnd = cursor;
      word(distance, length); cursor = literalStart; literal(count); cursor = controlEnd;
      distance = nextDistance; length = nextLength;
    } else {
      const nextDistance = -1 - control(bytes[6]), nextLength = 3 + control(bytes[5]);
      word(distance, length); distance = nextDistance; length = nextLength;
    }
  }
  if (written !== output.length) throw new Error('ALLZ 解包长度不符。');
  return output;
}
function decompress(bytes) {
  for (let depth = 0; depth < 8; depth++) {
    const magic = bytes.toString('ascii', 0, 4);
    if (magic === 'ALL4') { check(bytes, 0, 12); if (bytes[4] !== 1) throw new Error('不支持的 ALL4 版本。'); bytes = lz4(bytes.subarray(12), bytes.readUInt32LE(8)); }
    else if (magic === 'ALLZ') bytes = allz(bytes);
    else return bytes;
  }
  throw new Error('资源压缩嵌套过深。');
}
function archive(input) {
  const bytes = decompress(input); check(bytes, 0, 16);
  if (bytes.toString('ascii', 0, 4) !== 'ALAR' || ![2, 3].includes(bytes[4])) throw new Error('资源不是支持的 ALAR 归档。');
  const version = bytes[4], count = bytes.readUInt16LE(6);
  let cursor = version === 3 ? align(18 + count * 2) : 16;
  const entries = [];
  for (let i = 0; i < count; i++) {
    check(bytes, cursor, version === 3 ? 19 : 16);
    const index = bytes.readUInt16LE(cursor), offset = bytes.readUInt32LE(cursor + 4), size = bytes.readUInt32LE(cursor + 8);
    const nameOffset = version === 3 ? cursor + 18 : offset - 0x22;
    const name = stringAt(bytes, nameOffset, version === 3 ? 256 : 32);
    if (!name || /[\/\\\x00-\x1f]/.test(name) || name === '..') throw new Error('归档成员名称无效。');
    check(bytes, offset, size);
    entries.push({ index, name, bytes: bytes.subarray(offset, offset + size) });
    cursor = version === 3 ? align(nameOffset + Buffer.byteLength(name) + 1) : cursor + 16;
  }
  return entries;
}
function image(input) {
  const bytes = decompress(input); check(bytes, 0, 32);
  if (bytes.toString('ascii', 0, 4) !== 'ALIG' || bytes[4] !== 1) throw new Error('资源不是支持的 ALIG 图片。');
  const form = bytes.toString('ascii', 8, 12), width = bytes.readUInt32LE(16), height = bytes.readUInt32LE(20);
  if (!width || !height || width > 16384 || height > 16384) throw new Error('图片尺寸无效。');
  const rgba = allocated(width * height * 4), pixels = width * height;
  let cursor = bytes.readUInt32LE(28);
  if (form === 'RGBA' || form === 'BGRA') {
    check(bytes, cursor, rgba.length); bytes.copy(rgba, 0, cursor, cursor + rgba.length);
    if (form === 'BGRA') for (let i = 0; i < rgba.length; i += 4) { const red = rgba[i + 2]; rgba[i + 2] = rgba[i]; rgba[i] = red; }
  } else if (['PAL1', 'PAL4', 'PAL8', 'PAL6'].includes(form)) {
    // New ALIG files store the pixel offset after a variable length palette.
    // PAL6 uses little-endian 16-bit indices; its palette can be smaller than
    // 65536 entries. PAL8/PAL4 use 8-bit/4-bit indices respectively. PAL1
    // packs 1-bit indices into byte-aligned rows (79 pixels occupy 10 bytes).
    const colors = cursor > 32 ? (cursor - 32) / 4 : form === 'PAL1' ? 2 : form === 'PAL4' ? 16 : 256;
    if (!Number.isInteger(colors) || colors < 1 || colors > 65536) throw new Error('调色板长度无效。');
    if (bytes.toString('ascii', 12, 16) !== 'RGBA') throw new Error('不支持的调色板格式。');
    check(bytes, 32, colors * 4); const palette = bytes.subarray(32, 32 + colors * 4); cursor = 32 + colors * 4;
    const rowBytes = Math.ceil(width / 8);
    check(bytes, cursor, form === 'PAL1' ? rowBytes * height : form === 'PAL6' ? pixels * 2 : Math.ceil(pixels / (form === 'PAL4' ? 2 : 1)));
    for (let i = 0; i < pixels; i++) {
      const x = i % width;
      const index = form === 'PAL1' ? (bytes[cursor + Math.floor(i / width) * rowBytes + (x >> 3)] >>> (7 - (x & 7))) & 1
        : form === 'PAL4' ? i % 2 ? bytes[cursor + (i >> 1)] & 15 : bytes[cursor + (i >> 1)] >>> 4 : form === 'PAL6' ? bytes.readUInt16LE(cursor + i * 2) : bytes[cursor + i];
      if (index >= colors) throw new Error('调色板索引越界。');
      palette.copy(rgba, i * 4, index * 4, index * 4 + 4);
    }
  } else if (['ABG4', 'BGR4', 'ABG5', 'BGR5'].includes(form)) {
    check(bytes, cursor, pixels * 2);
    const expand5 = value => Math.floor(value / 8) * 64 + (value % 8) * 9;
    for (let i = 0; i < pixels; i++) {
      const value = bytes.readUInt16LE(cursor + i * 2), out = i * 4;
      if (form === 'ABG4') rgba.set([(value >>> 12) * 17, ((value >>> 8) & 15) * 17, ((value >>> 4) & 15) * 17, (value & 15) * 17], out);
      if (form === 'BGR4') rgba.set([((value >>> 8) & 15) * 17, ((value >>> 4) & 15) * 17, (value & 15) * 17, (value >>> 12) * 17], out);
      if (form === 'ABG5') rgba.set([expand5(value >>> 11), expand5((value >>> 6) & 31), expand5((value >>> 1) & 31), (value & 1) * 255], out);
      if (form === 'BGR5') rgba.set([expand5((value >>> 10) & 31), expand5((value >>> 5) & 31), expand5(value & 31), (value >>> 15) * 255], out);
    }
  } else throw new Error('不支持的图片格式：' + form);
  // The game supplies uniform PAL1 images for absent art: transparent portrait
  // slots and solid-colour CG canvases. They are not collectible illustrations.
  const placeholder = form === 'PAL1' && rgba.every((value, index) => value === rgba[index & 3]);
  return { width, height, rgba, placeholder };
}
function texture(input) {
  const bytes = decompress(input); check(bytes, 0, 12);
  if (bytes.toString('ascii', 0, 4) === 'ALIG') { const raw = image(bytes); return { ...raw, frames: [{ id: 0, x: 0, y: 0, width: raw.width, height: raw.height }] }; }
  if (bytes.toString('ascii', 0, 4) !== 'ALTX' || ![0, 1].includes(bytes[4]) || bytes[5] !== 0) throw new Error('资源不是内嵌图片的 ALTX 纹理。');
  const count = bytes.readUInt16LE(6), imageOffset = bytes.readUInt32LE(8), frames = [];
  check(bytes, 12, count * 2); let cursor = align(12 + count * 2);
  let previousBlock = 0;
  for (let i = 0; i < count; i++) {
    const block = bytes.readUInt16LE(12 + i * 2) + (bytes[4] === 1 ? previousBlock : 0); previousBlock = block;
    const name = cursor === block - 32 ? stringAt(bytes, cursor, 32) : null;
    if (name !== null) cursor += 32;
    if (cursor !== block) throw new Error('ALTX 精灵偏移无效。');
    check(bytes, cursor, 8); const id = bytes.readUInt16LE(cursor), total = bytes.readUInt16LE(cursor + 4); cursor += 8;
    check(bytes, cursor, total * 12);
    if (total) frames.push({ id, name, x: bytes.readUInt16LE(cursor), y: bytes.readUInt16LE(cursor + 2), width: bytes.readUInt16LE(cursor + 4), height: bytes.readUInt16LE(cursor + 6),
      originX: bytes.readInt16LE(cursor + total * 8), originY: bytes.readInt16LE(cursor + total * 8 + 2) });
    cursor += total * 12;
  }
  const raw = image(bytes.subarray(imageOffset));
  if (!count) frames.push({ id: 0, x: 0, y: 0, width: raw.width, height: raw.height });
  // Atlas slots for absent units have empty rectangles, not saved images.
  for (let i = frames.length - 1; i >= 0; i--) if (!frames[i].width || !frames[i].height) frames.splice(i, 1);
  for (const frame of frames) if (frame.x + frame.width > raw.width || frame.y + frame.height > raw.height) throw new Error('ALTX 图片裁切范围无效。');
  return { ...raw, frames };
}
function table(input) {
  const bytes = decompress(input); check(bytes, 0, 20);
  if (bytes.toString('ascii', 0, 4) !== 'ALTB' || bytes[4] !== 1 || ![0x10, 0x14, 0x1e].includes(bytes[5])) throw new Error('资源不是支持的 ALTB 表。');
  const form = bytes[5], count = bytes.readUInt16LE(6), headerSize = bytes.readUInt16LE(8), offset = bytes.readUInt16LE(10), stride = bytes.readUInt32LE(12);
  const strings = form === 0x10 ? null : bytes.readUInt32LE(20);
  let cursor = headerSize;
  check(bytes, cursor, 10); if (bytes.toString('ascii', cursor, cursor + 4) !== 'ALRD') throw new Error('ALTB 缺少字段定义。');
  const fieldCount = bytes[cursor + 6], fields = []; cursor += 10;
  for (let i = 0; i < fieldCount; i++) {
    check(bytes, cursor, 6); const fieldOffset = bytes.readUInt16LE(cursor), type = bytes[cursor + 2], skip = bytes[cursor + 3], english = bytes[cursor + 4], japanese = bytes[cursor + 5];
    cursor += 6; check(bytes, cursor, english + japanese + 2);
    const name = stringAt(bytes, cursor, english); cursor += english + japanese + 2; cursor = align(align(cursor) + skip);
    if (fieldOffset + (type === 5 ? 1 : 4) > stride) throw new Error('ALTB 字段越界。');
    fields.push({ name, offset: fieldOffset, type });
  }
  if (!stride) throw new Error('ALTB 行长度无效。'); check(bytes, offset, count * stride);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = Object.create(null);
    for (const field of fields) {
      const position = offset + i * stride + field.offset;
      let value;
      if (field.type === 1 || field.type === 0x20) value = bytes.readInt32LE(position);
      else if (field.type === 4) value = bytes.readFloatLE(position);
      else if (field.type === 5) value = bytes[position];
      else throw new Error('不支持的 ALTB 字段类型：' + field.type);
      if (field.type === 0x20 && strings !== null) value = stringAt(bytes, strings + value, 65536);
      row[field.name] = value;
    }
    rows.push(row);
  }
  return { fields, rows };
}
const crcTable = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; return value >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function png(raw, frame: any = { x: 0, y: 0, width: raw.width, height: raw.height }) {
  const { x, y, width, height } = frame;
  if (!width || !height || x < 0 || y < 0 || x + width > raw.width || y + height > raw.height) throw new Error('图片裁切范围无效。');
  const rows = allocated((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) raw.rgba.copy(rows, row * (width * 4 + 1) + 1, ((row + y) * raw.width + x) * 4, ((row + y) * raw.width + x + width) * 4);
  const chunk = (type, data) => { const buffer = Buffer.alloc(12 + data.length); buffer.writeUInt32BE(data.length); buffer.write(type, 4, 4, 'ascii'); data.copy(buffer, 8); buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4); return buffer; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
export { BASE, MAX_BYTES, decompress, archive, image, texture, table, png };
