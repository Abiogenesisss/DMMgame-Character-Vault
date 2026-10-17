import { BASE, FILE_LIST_NAME, MAX_CATALOG_BYTES, parseFileList } from './file-list.ts';

function catalogUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    if (url.origin !== new URL(BASE).origin || url.username || url.password
      || !/^\/[a-f0-9]{40}\/[a-z0-9]{32}$/.test(url.pathname)) return null;
    return url.origin + url.pathname;
  } catch { return null; }
}
function harBody(content): Uint8Array | null {
  if (typeof content?.text !== 'string' || !content.text) return null;
  if (content.text.length > Math.ceil(MAX_CATALOG_BYTES / 3) * 4 + 1024) throw new Error('HAR 中的目录数据超过 8 MiB 限制。');
  let bytes: Uint8Array;
  if (content.encoding === 'base64') {
    try { bytes = Uint8Array.from(atob(content.text), char => char.charCodeAt(0)); }
    catch { throw new Error('HAR 响应的 Base64 格式有误。'); }
  } else {
    if (content.encoding) throw new Error('HAR 响应编码不受支持。');
    bytes = new TextEncoder().encode(content.text);
  }
  if (bytes.length > MAX_CATALOG_BYTES) throw new Error('HAR 中的目录数据超过 8 MiB 限制。');
  return bytes;
}
/** Discard everything except the latest list and its exact NameText response.
 * The browser uses this before upload, so account requests and media stay out
 * of the local server request as well as the saved resource cache. */
function selectCatalogHar(har) {
  if (!Array.isArray(har?.log?.entries)) throw new Error('请选择包含 log.entries 的 HAR 文件。');
  const entries = har.log.entries;
  const successful = entry => entry?.request?.method === 'GET' && [200, 304].includes(entry?.response?.status);
  const latest = entries.findLast(entry => successful(entry) && catalogUrl(entry.request.url)?.endsWith('/' + FILE_LIST_NAME));
  if (!latest) throw new Error('HAR 中没有千年战争角色资源清单。请开启网络记录后重新进入游戏，再导出 HAR。');
  const url = catalogUrl(latest.request.url);
  const list = entries.findLast(entry => successful(entry) && catalogUrl(entry.request.url) === url && entry.response.status === 200
    && typeof entry.response.content?.text === 'string' && entry.response.content.text) || latest;
  const clean = entry => ({ request: { method: 'GET', url: catalogUrl(entry.request.url) }, response: { status: 200,
    content: entry.response.status === 200 && typeof entry.response.content?.text === 'string'
      ? { text: entry.response.content.text, ...(entry.response.content.encoding ? { encoding: entry.response.content.encoding } : {}) } : {} } });
  const selected = [clean(list)], body = harBody(selected[0].response.content);
  if (!body) throw new Error('HAR 没有保存资源清单的响应正文。请禁用缓存后重新进入游戏，导出包含响应内容的 HAR。');
  const name = parseFileList(body).entries.find(entry => entry.name === 'NameText.atb');
  if (!name) throw new Error('资源清单缺少角色名称表。');
  const nameEntry = entries.findLast(entry => successful(entry) && entry.response.status === 200 && catalogUrl(entry.request.url) === name.url
    && typeof entry.response.content?.text === 'string' && entry.response.content.text);
  if (!nameEntry) throw new Error('HAR 没有保存角色名称表的响应正文。请禁用缓存后重新进入游戏，导出包含响应内容的 HAR。');
  const entry = clean(nameEntry); harBody(entry.response.content); selected.push(entry);
  return { log: { entries: selected } };
}
export { selectCatalogHar, harBody };
