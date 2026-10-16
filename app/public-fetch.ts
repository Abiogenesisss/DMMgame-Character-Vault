'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const { Readable } = require('node:stream');
const zlib = require('node:zlib');

// Exact built-in resource/API hosts only. Never derive this allowlist from
// imported catalogs, request headers or caller options, or match whole suffixes.
const fakeIpHosts = new Set([
  'api.abyss-prod-r18.dotabyss.dmmgames.com',
  'drc1bk94f7rq8.cloudfront.net',
  'dugrqaqinbtcq.cloudfront.net',
  'web-assets.otogi-frontier.com',
  'otogi-rest.otogi-frontier.com',
  'assets.muvluv-girls-garden.com',
  'api-game.muvluv-girls-garden.com',
  'cdn-r18.gc.dmmgames.com',
  'www-r18.gc.dmmgames.com',
  'd3mya90gbacu0m.cloudfront.net'
]);

// Conservatively exclude special-purpose IPv6, including 6to4/Teredo which can
// embed a private IPv4 destination. BlockList also handles expanded spellings.
const restrictedV6 = new net.BlockList();
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  restrictedV6.addSubnet(network, prefix, 'ipv6');
}
const benchmarkV6 = new net.BlockList();
benchmarkV6.addSubnet('2001:2::', 48, 'ipv6');

function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  return net.isIP(address) === 6 && /^[23]/i.test(address) && !restrictedV6.check(address, 'ipv6');
}

function isFakeIpAddress(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 198 && (b === 18 || b === 19);
}

async function fetchPublicResource(input, { signal, headers = {} }: any = {}) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持无账号凭据的 HTTP(S) 资源地址。');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literal = net.isIP(hostname);
  const resolved = literal ? [{ address: hostname, family: literal }] : await dns.lookup(hostname, { all: true });
  // Some proxy DNS configurations pair a usable A record with a benchmarking
  // AAAA record. Drop that reserved IPv6 candidate instead of rejecting the A
  // record too; it must never reach the connection's pinned lookup results.
  const addresses = resolved.filter(item => !(net.isIP(item.address) === 6 && benchmarkV6.check(item.address, 'ipv6')));
  // DNS cannot prove a proxy owns an address. Limit the benchmark-pool exception
  // to known game hosts over HTTPS/443 and authenticate that same host below.
  // Literal IPs, arbitrary domains and every IPv6 private range stay blocked.
  const allowFakeIp = !literal && url.protocol === 'https:' && !url.port && fakeIpHosts.has(hostname);
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address)
    && !(allowFakeIp && isFakeIpAddress(item.address)))) throw new Error('资源 URL 需要指向公网地址。');
  const requestHeaders = new Headers(headers);
  requestHeaders.set('host', url.host);
  requestHeaders.set('accept-encoding', 'identity');
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET', agent: false, signal, headers: Object.fromEntries(requestHeaders),
      ...(url.protocol === 'https:' ? { rejectUnauthorized: true, ...(!literal ? { servername: hostname } : {}) } : {}),
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
