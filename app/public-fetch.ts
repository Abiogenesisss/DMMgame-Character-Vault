'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const { Readable } = require('node:stream');
const zlib = require('node:zlib');

function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  return net.isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}

async function fetchPublicResource(input, { signal, headers = {} }: any = {}) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持无账号凭据的 HTTP(S) 资源地址。');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('资源 URL 需要指向公网地址。');
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET', agent: false, signal, headers: { ...Object.fromEntries(new Headers(headers)), 'accept-encoding': 'identity' },
      // Pin the validated addresses for this connection; do not resolve the host again.
      lookup: (_host, options, callback) => options.all
        ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)
    }, response => {
      try {
        const headers = new Headers(Object.entries<any>(response.headers).filter(([, value]) => value != null)
          .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]));
        if ([204, 205, 304].includes(response.statusCode)) { response.resume(); resolve(new Response(null, { status: response.statusCode, headers })); return; }
        let stream = response;
        const compression = { gzip: zlib.createGunzip, br: zlib.createBrotliDecompress, deflate: zlib.createInflate }[headers.get('content-encoding')];
        if (compression) {
          stream = compression(); response.on('error', error => stream.destroy(error)); response.pipe(stream);
          stream.on('close', () => response.destroy());
          headers.delete('content-length'); headers.delete('content-encoding');
        }
        resolve(new Response(Readable.toWeb(stream), { status: response.statusCode, headers }));
      } catch (error) { response.destroy(); reject(error); }
    });
    request.on('error', reject); request.end();
  });
}
export { fetchPublicResource, isPublicAddress };
