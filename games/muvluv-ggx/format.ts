'use strict';
const { decode, decodeMulti, ExtData } = require('@msgpack/msgpack');
const ORIGIN = 'https://assets.muvluv-girls-garden.com';
const validId = id => typeof id === 'string' && /^\d{5,8}$/.test(id);
function resourceKind(input) {
  let url; try { url = new URL(input); } catch { return null; }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash) return null;
  const prefix = /^\/production-public\/[a-f0-9-]{36}\//;
  if (!prefix.test(url.pathname) || url.pathname.split('/').some(part => part === '..' || part === '.')) return null;
  const part = url.pathname.replace(prefix, '');
  if (/^(?:BundleAssets\/X\/WebGL\/DXT|WebGL\/Desktop\/StreamingAssets\/aa)(?:\/WebGL)?\/[a-f0-9]{32}\.bundle$/.test(part)) return 'bundle';
  if (/^(?:BundleAssets\/X\/WebGL\/DXT|WebGL\/Desktop\/StreamingAssets\/aa)\/(?:settings\.json|(?:ui_|spine_|sound_|vfx_)?catalog\.(?:bin|hash))$/.test(part)) return 'catalog';
  if (/^DirectAssets\/X\/(?:DDS|GZ|Origin)\/(?:ImageFiles|TextFiles|VideoFiles|AudioFiles|SoundFiles)\/[A-Za-z0-9_./-]+\.(?:dds\.gz|json(?:\.gz)?|png|jpg|webp|mp4|ogg|wav|mp3)$/.test(part)) return 'direct';
  return null;
}
function lz4Block(input, size) {
  if (!Number.isInteger(size) || size < 0 || size > 64 * 1024 * 1024) throw new Error('压缩数据长度无效。');
  const source = Buffer.from(input), output = Buffer.alloc(size); let read = 0, written = 0;
  function length(initial) {
    let value = initial;
    if (initial === 15) { let extra; do { if (read >= source.length) throw new Error('压缩数据截断。'); extra = source[read++]; value += extra; } while (extra === 255); }
    return value;
  }
  while (read < source.length) {
    const token = source[read++], literals = length(token >>> 4);
    if (read + literals > source.length || written + literals > size) throw new Error('压缩数据越界。');
    source.copy(output, written, read, read + literals); written += literals; read += literals;
    if (read === source.length) break;
    if (read + 2 > source.length) throw new Error('压缩数据截断。');
    const offset = source.readUInt16LE(read); read += 2;
    if (!offset || offset > written) throw new Error('压缩数据回溯偏移无效。');
    const match = length(token & 15) + 4;
    if (written + match > size) throw new Error('压缩数据越界。');
    for (let index = 0; index < match; index++) output[written + index] = output[written + index - offset];
    written += match;
  }
  if (written !== size) throw new Error('压缩数据长度不符。');
  return output;
}
function decodeData(input) {
  const limits = { maxStrLength: 64 * 1024 * 1024, maxArrayLength: 1000000, maxMapLength: 1000000 };
  let value = decode(input, limits);
  if (Array.isArray(value) && value[0] instanceof ExtData && value[0].type === 98) {
    const sizes = [...decodeMulti(value[0].data, limits)];
    if (sizes.length !== value.length - 1 || sizes.some(size => !Number.isInteger(size) || size < 0)
      || sizes.reduce((sum, size) => sum + size, 0) > 128 * 1024 * 1024) throw new Error('MessagePack 压缩头无效。');
    const parts = value.slice(1).map((block, index) => {
      if (!(block instanceof Uint8Array)) throw new Error('MessagePack 压缩块无效。');
      return lz4Block(block, sizes[index]);
    });
    value = decode(Buffer.concat(parts), limits);
  }
  return value;
}
export { ORIGIN, validId, resourceKind, lz4Block, decodeData };
