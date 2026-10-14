'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { rangeSlice } = require('./pack.ts');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.atlas': 'text/plain; charset=utf-8', '.ttf': 'font/ttf' };

function sendFile(req, res, root, relative, { mimeType, downloadName, trusted = false }: any = {}) {
  const target = path.resolve(root, relative);
  const safe = path.relative(root, target);
  if (!safe || safe.startsWith('..') || path.isAbsolute(safe) || relative.includes('\0')) {
    res.writeHead(400); res.end('BAD_PATH'); return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); res.end('FILE_MISSING'); return; }
  const realSafe = path.relative(fs.realpathSync(root), fs.realpathSync(target));
  if (realSafe.startsWith('..') || path.isAbsolute(realSafe)) { res.writeHead(400); res.end('BAD_PATH'); return; }
  const size = fs.statSync(target).size;
  const headers = { 'content-type': mimeType || TYPES[path.extname(target)] || 'application/octet-stream',
    'cache-control': 'no-cache', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin' };
  if (trusted) headers['content-security-policy'] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
  if (downloadName) headers['content-disposition'] = "attachment; filename*=UTF-8''" + encodeURIComponent(downloadName.replace(/[\r\n\\/]/g, '_'));
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    const slice = rangeSlice(req.headers.range, size);
    if (!slice) { res.writeHead(416, { ...headers, 'content-range': 'bytes */' + size }); res.end(); return; }
    ({ start, end } = slice); status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['content-length'] = String(Math.max(0, end - start + 1));
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || size === 0) { res.end(); return; }
  const stream = fs.createReadStream(target, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
export { sendFile };
