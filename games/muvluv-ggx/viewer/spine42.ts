import { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } from '@esotericsoftware/spine-core';
// Import the classes directly: the package entry point installs 4.2 asset
// loaders globally, which would change the existing games' 3.x/4.1 loaders.
import { Spine } from '@esotericsoftware/spine-pixi-v7/dist/Spine.js';
import { SpineTexture } from '@esotericsoftware/spine-pixi-v7/dist/SpineTexture.js';
import { MosaicCapture } from './mosaic.ts';
import * as PIXI from 'pixi.js';

export async function loadSpine42(url, acquireTexture, releaseTexture) {
  const atlasUrl = url.replace(/\.json$/, '.atlas'), directory = new URL('.', url);
  const responses = await Promise.all([fetch(url), fetch(atlasUrl)]);
  if (responses.some(response => !response.ok)) throw new Error('动态素材文件读取失败。');
  const [json, atlasText] = await Promise.all([responses[0].json(), responses[1].text()]);
  if (!/^4\.2\./.test(json.skeleton?.spine || '')) throw new Error('Spine 资源版本不符。');
  const atlas = new TextureAtlas(atlasText), leases = [];
  try {
    for (const page of atlas.pages) {
      if (!/^[A-Za-z0-9_.-]+\.(png|jpg)$/.test(page.name)) throw new Error('动态素材纹理地址无效。');
      const lease = await acquireTexture(new URL(page.name, directory).href); leases.push(lease);
      const texture = await lease.loading;
      // The official 4.2 meshes always expect PMA on the GPU. Straight input
      // must be multiplied during upload, including transparent white FX texels.
      texture.baseTexture.alphaMode = page.pma ? PIXI.ALPHA_MODES.PMA : PIXI.ALPHA_MODES.UNPACK;
      page.setTexture(SpineTexture.from(texture.baseTexture));
    }
    const reader = new SkeletonJson(new AtlasAttachmentLoader(atlas));
    return { spineData: reader.readSkeletonData(json), dispose: () => leases.forEach(releaseTexture) };
  } catch (error) { leases.forEach(releaseTexture); throw error; }
}
export class VaultSpine42 extends Spine {
  declare allMosaic: any;
  declare capture: any;

  constructor(data, options: any = {}) { super({ skeletonData: data }); this.allMosaic = !!options.mosaic; }
  getMeshForSlot(slot) {
    const mesh = super.getMeshForSlot(slot), attachment = slot.getAttachment();
    if (this.allMosaic || /mosaic/i.test(slot.data.name + ' ' + (attachment?.name || '') + ' ' + (attachment?.path || ''))) {
      this.capture ||= new MosaicCapture(); this.capture.attach(mesh, { renderSource: true });
    }
    return mesh;
  }
  destroy(options) { this.capture?.destroy(); super.destroy(options); }
}
