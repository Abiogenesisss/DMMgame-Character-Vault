'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { loadPack, normalizedUrl, routeKey, sha256, saveManifest } = require('./pack.ts');
const { fetchPublicResource } = require('./public-fetch.ts');

function parseUrlList(input) {
  if (typeof input === 'string') {
    const text = input.replace(/^\uFEFF/, '').trim();
    if (/^[\[{]/.test(text)) {
      try { input = JSON.parse(text); } catch { throw new Error('JSON 清单格式有误。'); }
    } else input = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  }
  const entries = Array.isArray(input) ? input : input?.entries || input?.urls;
  if (!Array.isArray(entries) || !entries.length || entries.length > 100000) throw new Error('清单需要包含 1 至 100000 个资源 URL。');
  const unique = new Map();
  for (const entry of entries) {
    const item = typeof entry === 'string' ? { url: entry } : entry;
    if (!item || typeof item.url !== 'string') throw new Error('每项资源都需要一个 URL。');
    let url;
    try { url = normalizedUrl(item.url); }
    catch { throw new Error('请使用不含账号凭据的完整 HTTP(S) 资源地址。'); }
    if (item.size != null && (!Number.isSafeInteger(item.size) || item.size < 0)) throw new Error('资源 size 必须是非负整数。');
    if (item.sha256 != null && !/^[a-f0-9]{64}$/i.test(item.sha256)) throw new Error('资源 sha256 必须是 64 位十六进制。');
    const normalized = { url, ...(item.size == null ? {} : { size: item.size }),
      ...(item.sha256 == null ? {} : { sha256: item.sha256.toLowerCase() }) };
    const previous = unique.get(url);
    if (previous && ((previous.size != null && normalized.size != null && previous.size !== normalized.size)
      || (previous.sha256 && normalized.sha256 && previous.sha256 !== normalized.sha256))) throw new Error('同一 URL 的资源校验信息发生冲突。');
    unique.set(url, { ...previous, ...normalized });
  }
  return [...unique.values()];
}

async function intact(pack, record, entry) {
  if (!record || record.status !== 200 || !/^[a-f0-9]{64}$/.test(record.body)
    || (entry.size != null && record.size !== entry.size) || (entry.sha256 && record.body !== entry.sha256)) return false;
  const file = path.join(pack.root, 'bodies', record.body);
  if (!fs.existsSync(file) || fs.statSync(file).size !== record.size) return false;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === record.body;
}

async function downloadUrls(root, entries, { fetchResource = fetchPublicResource, onProgress = () => {}, maxBytes = 1024 ** 3, validate, refresh = false, concurrency = 1 }: any = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('下载并发数需要在 1 至 8 之间。');
  const pack = loadPack(path.join(root, 'cache'));
  const state = { state: 'downloading', total: entries.length, done: 0, saved: 0, skipped: 0, failed: 0, bytes: 0, errors: [] };
  onProgress({ ...state });
  async function downloadEntry(entry) {
    const key = routeKey('GET', entry.url);
    const temporary = path.join(pack.root, 'bodies', '.download-' + randomUUID());
    try {
      const previous = pack.manifest.routes[key]?.at(-1);
      let cached = !refresh && await intact(pack, previous, entry);
      if (cached && validate) {
        try { await validate(fs.readFileSync(path.join(pack.root, 'bodies', previous.body)), entry); }
        catch { cached = false; }
      }
      if (cached) { state.skipped++; }
      else {
        let response;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { response = await fetchResource(entry.url, { redirect: 'error', signal: AbortSignal.timeout(60000) }); }
          catch (error) { if (attempt === 2) throw error; continue; }
          if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
          await response.body?.cancel();
        }
        if (response.status !== 200) { await response.body?.cancel(); throw new Error('HTTP ' + response.status); }
        if (Number(response.headers.get('content-length')) > maxBytes || (entry.size != null && entry.size > maxBytes)) {
          await response.body?.cancel(); throw new Error('单个资源超过 1 GiB 限制。');
        }
        const descriptor = fs.openSync(temporary, 'wx');
        const hash = createHash('sha256'); let size = 0;
        try {
          if (response.body) for await (const chunk of response.body) {
            size += chunk.length;
            if (size > maxBytes) throw new Error('单个资源超过大小限制。');
            hash.update(chunk); fs.writeFileSync(descriptor, chunk);
          }
        } finally { fs.closeSync(descriptor); }
        const digest = hash.digest('hex');
        if (entry.size != null && size !== entry.size) throw new Error('资源长度与清单不符。');
        if (entry.sha256 && entry.sha256 !== digest) throw new Error('资源 SHA-256 与清单不符。');
        if (validate) await validate(fs.readFileSync(temporary), entry);
        const target = path.join(pack.root, 'bodies', digest);
        // Replace a corrupted previous blob as well as saving new content.
        fs.renameSync(temporary, target);
        const mimeType = response.headers.get('content-type') || 'application/octet-stream';
        const record = { url: entry.url, method: 'GET', status: 200, body: digest, size,
          headers: [['content-type', mimeType]], mimeType, resourceType: 'fetch',
          requestBodyHash: sha256(Buffer.alloc(0)), range: '', source: 'url-list-download' };
        pack.manifest.routes[key] = [record];
        saveManifest(pack.root, pack.manifest);
        state.saved++; state.bytes += size;
      }
    } catch (error) { state.failed++; state.errors.push({ url: entry.url, error: error.message || error.code || error.cause?.code || '资源下载失败。' }); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    state.done++; onProgress({ ...state });
  }
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length) await downloadEntry(entries[cursor++]);
  }));
  state.state = state.failed ? 'partial' : 'ready';
  onProgress({ ...state });
  return state;
}
export { parseUrlList, downloadUrls };
