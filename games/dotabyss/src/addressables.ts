'use strict';
// Shared Unity Addressables 2.x ContentCatalogData/BinaryStorageBuffer layout.
// Decode offsets and strings as data; never load the catalog's CLR types.
function parseAddressables(input) {
  const bytes = Buffer.from(input), NIL = 0xffffffff, strings = new Map(), types = new Map(), locations = new Map();
  function check(offset, length) { if (!Number.isInteger(offset) || offset < 0 || offset + length > bytes.length) throw new Error('资源目录偏移越界。'); }
  function u32(offset) { check(offset, 4); return bytes.readUInt32LE(offset); }
  function array(offset, width = 4) {
    if (offset === NIL) return [];
    const length = u32(offset - 4); check(offset, length);
    if (length % width || length / width > 500000) throw new Error('资源目录数组无效。');
    return Array.from({ length: length / width }, (_, index) => offset + index * width);
  }
  function autoString(id) {
    if (id === NIL) return null;
    const offset = id & 0x3fffffff, length = u32(offset - 4); check(offset, length);
    if (length > 1024 * 1024 || id & 0x40000000) throw new Error('资源目录字符串无效。');
    return bytes.subarray(offset, offset + length).toString(id & 0x80000000 ? 'utf16le' : 'latin1');
  }
  function string(id, separator = '') {
    if (id === NIL) return null;
    const key = id + ':' + separator; if (strings.has(key)) return strings.get(key);
    let value;
    if (id & 0x40000000) {
      const parts = [], seen = new Set<number>(); let next = id;
      while (next !== NIL) {
        const offset = next & 0x3fffffff;
        if (seen.has(offset) || seen.size > 256 || !separator) throw new Error('资源目录字符串链无效。');
        seen.add(offset); parts.push(autoString(u32(offset))); next = u32(offset + 4);
      }
      value = parts.reverse().join(separator);
    } else value = autoString(id);
    strings.set(key, value); return value;
  }
  function type(id) {
    if (id === NIL) return null;
    if (!types.has(id)) types.set(id, string(u32(id + 4), '.'));
    return types.get(id);
  }
  function objectString(id) {
    if (id === NIL) return null;
    const kind = type(u32(id)), value = u32(id + 4);
    if (kind !== 'System.String') return null;
    check(value + 4, 2); const sep = bytes.readUInt16LE(value + 4);
    return string(u32(value), sep ? String.fromCharCode(sep) : '');
  }
  function location(id, depth = 0) {
    if (locations.has(id)) return locations.get(id);
    if (depth > 64) throw new Error('资源目录依赖层级过深。'); check(id, 28);
    const value = { id, address: string(u32(id), '/'), internalId: string(u32(id + 4), '/'),
      provider: string(u32(id + 8), '.'), type: type(u32(id + 24)), keys: [], dependencies: array(u32(id + 12)).map(u32) };
    locations.set(id, value); value.dependencies.forEach(dependency => location(dependency, depth + 1)); return value;
  }
  if (u32(0) !== 0x0de38942 || u32(4) !== 2) throw new Error('不支持的 Unity 资源目录版本。');
  for (const offset of array(u32(8), 8)) {
    const key = objectString(u32(offset));
    for (const pointer of array(u32(offset + 4))) {
      const value = location(u32(pointer)); if (key && !value.keys.includes(key)) value.keys.push(key);
    }
  }
  return { version: 2, locations: [...locations.values()] };
}
export { parseAddressables };
