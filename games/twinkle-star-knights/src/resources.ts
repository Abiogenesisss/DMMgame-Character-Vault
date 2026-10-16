import fs from 'node:fs';
import path from 'node:path';
import { sha256, loadPack, routeKey, saveManifest } from '../../../app/pack.ts';
import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
import { fetchPublicResource } from '../../../app/public-fetch.ts';
export const BASE = 'https://d3mya90gbacu0m.cloudfront.net/prod/StreamingAssets/aa/';
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[12]\d{6}$/.test(value);
export const validBundle = (value: unknown): value is string => typeof value === 'string' && /^(?:WebGL\/[a-f0-9]{32}|catalog|catalog_sound)\.bundle$/.test(value);
export const readJson = (file: string, fallback: any = null): any => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
export const writeJson = (file: string, data: unknown) => writeAtomicFileSync(file, JSON.stringify(data));
async function readBody(response: Response, limit: number) {
  const chunks = []; let size = 0;
  for await (const part of response.body as any) {
    size += part.length; if (size > limit) throw Object.assign(new Error('资源包超过大小限制。'), { permanent: true }); chunks.push(part);
  }
  return Buffer.concat(chunks);
}
export class Resources {
  pack: any;
  records = new Map<string, any>();
  verified = new Set<string>();
  constructor(public root: string, public fetchResource = fetchPublicResource) {
    this.pack = loadPack(path.join(root, 'cache'));
    for (const rows of Object.values<any[]>(this.pack.manifest.routes)) for (const record of rows) {
      const name = record.url?.startsWith(BASE) ? record.url.slice(BASE.length) : '';
      if (validBundle(name) && record.method === 'GET' && record.status === 200 && /^[a-f0-9]{64}$/.test(record.body)) this.records.set(name, record);
    }
  }
  file(name: string) {
    const r = this.records.get(name); if (!r) return null;
    const file = path.join(this.pack.root, 'bodies', r.body);
    try {
      if (fs.statSync(file).size !== r.size) return null;
      if (!this.verified.has(r.body)) { if (sha256(fs.readFileSync(file)) !== r.body) return null; this.verified.add(r.body); }
      return file;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  put(name: string, bytes: Buffer) {
    if (!validBundle(name) || bytes.length > 128 * 1024 ** 2 || !bytes.subarray(0, 8).equals(Buffer.from('UnityFS\0'))) throw new Error('Unity 资源包无效。');
    const digest = sha256(bytes), file = path.join(this.pack.root, 'bodies', digest);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== digest) writeAtomicFileSync(file, bytes);
    const record = { url: BASE + name, method: 'GET', status: 200, body: digest, size: bytes.length, headers: [], mimeType: 'application/octet-stream', range: '' };
    this.pack.manifest.routes[routeKey('GET', record.url)] = [record]; this.records.set(name, record); this.verified.add(digest); return file;
  }
  async get(name: string, refresh = false) {
    if (!validBundle(name)) throw new Error('资源包地址无效。');
    const url = BASE + name;
    if (!refresh && this.file(name)) return this.file(name);
    for (let attempt = 0; ; attempt++) {
      let bytes: Buffer;
      try {
        const response = await this.fetchResource(url, { signal: AbortSignal.timeout(120000) });
        if (response.status !== 200) { await response.body?.cancel(); throw Object.assign(new Error(`资源下载失败（HTTP ${response.status}）：${name}`), { permanent: true }); }
        const size = Number(response.headers.get('content-length'));
        if (size > 128 * 1024 ** 2) { await response.body?.cancel(); throw Object.assign(new Error('资源包超过大小限制。'), { permanent: true }); }
        if (size > 8 * 1024 ** 2 && response.headers.get('accept-ranges') === 'bytes' && response.headers.get('etag')) {
          const etag = response.headers.get('etag'); await response.body?.cancel();
          const width = 1024 ** 2, chunks: Buffer[] = [], starts = Array.from({ length: Math.ceil(size / width) }, (_, i) => i * width);
          const parts = path.join(this.pack.root, 'parts', sha256(Buffer.from(name + '\n' + etag + '\n' + size)));
          await eachLimit(starts, async start => {
            const end = Math.min(size - 1, start + width - 1);
            const file = path.join(parts, start + '.part');
            try {
              const stored = fs.readFileSync(file), chunk = stored.subarray(32);
              if (stored.length === end - start + 33 && sha256(chunk) === stored.subarray(0, 32).toString('hex')) { chunks[start / width] = chunk; return; }
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
            const part = await this.fetchResource(url, { signal: AbortSignal.timeout(120000), headers: { range: `bytes=${start}-${end}`, 'if-range': etag } });
            if (part.status !== 206 || part.headers.get('content-range') !== `bytes ${start}-${end}/${size}` || etag && part.headers.get('etag') !== etag) {
              await part.body?.cancel(); throw Object.assign(new Error('分段响应的版本或范围不匹配。'), { permanent: true });
            }
            const chunk = await readBody(part, end - start + 1);
            if (chunk.length !== end - start + 1) throw new Error('资源分段传输不完整。');
            writeAtomicFileSync(file, Buffer.concat([Buffer.from(sha256(chunk), 'hex'), chunk]));
            chunks[start / width] = chunk;
          }, 2);
          bytes = Buffer.concat(chunks);
        } else bytes = await readBody(response, 128 * 1024 ** 2);
      } catch (error) { if (error.permanent || attempt >= 1) throw error; continue; }
      return this.put(name, bytes);
    }
  }
  save() { saveManifest(this.pack.root, this.pack.manifest); }
}
export async function eachLimit<T>(items: T[], work: (item: T) => Promise<unknown>, limit = 4) {
  let index = 0, failed = false, failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length && !failed) { try { await work(items[index++]); } catch (error) { failed = true; failure = error; } }
  }));
  if (failed) throw failure;
}
