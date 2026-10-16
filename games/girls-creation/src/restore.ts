import fs from 'node:fs';
import path from 'node:path';
import { downloadUrls } from '../../../app/download.ts';
import { BASE, resourceName } from './format.ts';

export function supportedCapture(name: string) {
  return name === 'master.dmm' || /^(?:image_(?:sub_)?unit_(?:full|icon)\/|notinit\/(?:standing_spine\/|novelchara_(?:main|sub)(?:_r18)?\/|image_novel_background\/|voice\/)|sound\/bgm\/)/.test(name);
}

// HARs often omit responses already in the browser cache. Restore only exact
// resource GETs that were captured; never replay account APIs or game actions.
export async function restoreCaptured(root, { fetchResource = require('../../../app/public-fetch.ts').fetchPublicResource, onProgress, capturedNames, source }: any = {}) {
  const file = path.join(root, 'metadata/private-urls.json');
  const urls = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const names = Object.keys(urls).filter(name => (!capturedNames || capturedNames.includes(name)) && resourceName(urls[name]) === name && supportedCapture(name));
  if (!names.length) return { saved: 0, failed: 0, authRequired: false };
  const assets=Object.fromEntries(names.map(name=>[name,{hash:new URL(urls[name]).searchParams.get('h')}]));
  const transport=require('./source.ts').resourceTransport(root,assets,{fetchResource,source});
  let denied = false;
  const result = await downloadUrls(root, names.map(name => ({ url: BASE + name })), {
    concurrency: 1, maxBytes: 160 * 1024 * 1024, onProgress,
    fetchResource: async (url, options) => {
      if (denied) return new Response(null, { status: 403 });
      const name = resourceName(url); if (!names.includes(name)) throw Error('不支持此资源地址。');
      const response = await transport(url, options);
      if ([401, 403].includes(response.status)) denied = true;
      return response;
    },
    validate: bytes => { if (bytes.length < 48 || bytes.toString('ascii', 0, 8) !== 'UnityFS\0') throw Error('捕获资源不是有效的 Unity 素材包。'); }
  });
  return { saved: result.saved, failed: result.failed, authRequired: denied };
}
