/** Addressables 1.x compact JSON tables. Parse data, never instantiate CLR types. */
export function parseAddressables(catalog: any) {
  const keys = Buffer.from(catalog.m_KeyDataString, 'base64'), buckets = Buffer.from(catalog.m_BucketDataString, 'base64'), entries = Buffer.from(catalog.m_EntryDataString, 'base64');
  const int = (b: Buffer, p: number) => { if (!Number.isInteger(p) || p < 0 || p + 4 > b.length) throw new Error('资源目录偏移越界。'); return b.readInt32LE(p); };
  const keyCount = int(buckets, 0), entryCount = int(entries, 0);
  if (keyCount < 0 || keyCount > 1000000 || entryCount < 0 || entryCount > 1000000 || entries.length !== 4 + entryCount * 28) throw new Error('资源目录长度无效。');
  const table: { key: string | null; indices: number[] }[] = []; let offset = 4;
  for (let i = 0; i < keyCount; i++) {
    const keyOffset = int(buckets, offset), count = int(buckets, offset + 4); offset += 8;
    if (keyOffset < 0 || keyOffset >= keys.length || count < 0 || count > entryCount || offset + count * 4 > buckets.length) throw new Error('资源目录键无效。');
    let key = null;
    if (keys[keyOffset] === 0 || keys[keyOffset] === 1) {
      const length = int(keys, keyOffset + 1);
      if (length < 0 || length > 1024 * 1024 || keyOffset + 5 + length > keys.length) throw new Error('资源目录字符串无效。');
      key = keys.subarray(keyOffset + 5, keyOffset + 5 + length).toString(keys[keyOffset] === 0 ? 'utf8' : 'utf16le');
    }
    const indices = [];
    for (let n = 0; n < count; n++, offset += 4) { const id = int(buckets, offset); if (id < 0 || id >= entryCount) throw new Error('资源索引越界。'); indices.push(id); }
    table.push({ key, indices });
  }
  if (offset !== buckets.length) throw new Error('资源目录尾部无效。');
  return Array.from({ length: entryCount }, (_, index) => {
    const row = Array.from({ length: 7 }, (_, n) => int(entries, 4 + index * 28 + n * 4));
    const raw = catalog.m_InternalIds[row[0]], type = catalog.m_resourceTypes[row[6]]?.m_ClassName;
    if (typeof raw !== 'string' || typeof type !== 'string' || !table[row[5]] || row[2] >= table.length || row[2] < -1) throw new Error('资源目录条目无效。');
    const internalId = raw.replace(/^(\d+)#/, (_, n) => { const prefix = catalog.m_InternalIdPrefixes[n]; if (typeof prefix !== 'string') throw new Error('资源前缀无效。'); return prefix; });
    return { index, internalId, type, dependencies: row[2] === -1 ? [] : table[row[2]].indices };
  });
}
