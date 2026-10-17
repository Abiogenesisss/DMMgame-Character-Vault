import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';
import { MosaicCapture } from './mosaic.ts';
import { spinePlacement, fitScene } from './reader-scene.ts';
import { loadSpine42, VaultSpine42 } from './spine42.ts';
import { portalPlacement } from './portal-framing.ts';
import '@pixi/unsafe-eval';

const asset = file => 'library/' + file.split('/').map(encodeURIComponent).join('/');

const mosaic = (slot, attachment) => /mosaic/i.test(slot.data.name + ' ' + attachment.name + ' ' + (attachment.path || ''));
class GameSpine extends Spine {
  declare allMosaic: any;
  declare skeleton: any;
  declare capture: any;

  constructor(data, options: any = {}) {
    super(data); this.allMosaic = !!options.mosaic;
    if (this.allMosaic) for (const slot of this.skeleton?.slots || []) {
      if (slot.currentMesh) this.attachMaskMesh(slot.currentMesh);
      if (slot.currentSprite) this.attachMaskSprite(slot.currentSprite);
    }
  }
  attachMaskMesh(mesh) { this.capture ||= new MosaicCapture(); this.capture.attach(mesh, { renderSource: true }); }
  attachMaskSprite(sprite) {
    this.capture ||= new MosaicCapture();
    if (sprite.gameMosaic) { this.capture.attach(sprite.gameMosaic, { renderSource: true }); return; }
    const mesh = new PIXI.SimpleMesh(sprite.texture, new Float32Array(8) as unknown as PIXI.IArrayBuffer, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) as unknown as PIXI.IArrayBuffer, new Uint16Array([0, 1, 2, 0, 2, 3]) as unknown as PIXI.IArrayBuffer);
    sprite.gameMosaic = mesh; this.capture.attach(mesh, { renderSource: true });
    sprite._render = renderer => { sprite.calculateVertices(); (mesh.vertices as unknown as Float32Array).set(sprite.vertexData); mesh.worldTransform.identity(); mesh.texture = sprite.texture; mesh.tint = sprite.tint; mesh.blendMode = sprite.blendMode; mesh.worldAlpha = sprite.worldAlpha; mesh._render(renderer); };
    const destroy = sprite.destroy; sprite.destroy = function(options) { mesh.destroy({ texture: false, baseTexture: false }); destroy.call(this, options); };
  }
  createMesh(slot, attachment) {
    const mesh = super.createMesh(slot, attachment);
    if (this.allMosaic || mosaic(slot, attachment)) this.attachMaskMesh(mesh);
    return mesh;
  }
  createSprite(slot, attachment, name) {
    const sprite = super.createSprite(slot, attachment, name);
    if (this.allMosaic || mosaic(slot, attachment)) this.attachMaskSprite(sprite);
    return sprite;
  }
  destroy(options) { this.capture?.destroy(); super.destroy(options); }
}
const assetLeases = new Map();
async function leaseAsset(url, modern = false) {
  let lease = assetLeases.get(url);
  if (lease?.unloading) { await lease.unloading; lease = assetLeases.get(url); }
  if (!lease) { lease = { url, modern, users: 0, loading: modern ? loadSpine42(url, leaseAsset, releaseAsset) : PIXI.Assets.load(url) }; assetLeases.set(url, lease); }
  lease.users++; return lease;
}
function releaseAsset(lease) {
  if (!lease) return; lease.users--;
  lease.loading.then(data => {
    if (lease.users || assetLeases.get(lease.url) !== lease || lease.unloading) return;
    lease.unloading = (lease.modern ? Promise.resolve().then(() => data.dispose()) : PIXI.Assets.unload(lease.url)).catch(() => {}).finally(() => { if (assetLeases.get(lease.url) === lease) assetLeases.delete(lease.url); });
  }).catch(() => { if (!lease.users && assetLeases.get(lease.url) === lease) assetLeases.delete(lease.url); });
}
export class Player {
  declare container: any;
  declare generation: any;
  declare observer: any;
  declare model: any;
  declare placement: any;
  declare pendingPlayback: any;
  declare leases: any;
  declare app: any;
  declare spines: any;
  declare spine: any;
  declare scene: any;
  declare animation: any;
  declare loop: any;
  declare animationToken: any;

  constructor(container) {
    this.container = container; this.generation = 0;
    this.observer = new ResizeObserver(() => { this.fit(); if (this.app && !this.app.ticker.started) this.app.renderer.render(this.app.stage); }); this.observer.observe(container);
  }
  async load(model, options: any = {}) {
    const generation = ++this.generation; this.disposeApp(); this.model = model;
    this.placement = options.placement || model.placement || spinePlacement();
    this.pendingPlayback = { name: options.animation || 'Wait', loop: options.loop ?? true, token: options.token ?? null };
    PIXI.Assets.setPreferences({ preferCreateImageBitmap: false });
    const layers = model.layers?.length ? model.layers : [{ file: model.file }];
    const leases = await Promise.all(layers.map(layer => {
      const file = options.assetRoot ? options.assetRoot + layer.file.split('/').map(encodeURIComponent).join('/') : asset(layer.file);
      return leaseAsset(new URL(file, location.href).href, /^4\.2\./.test(layer.version || model.version || ''));
    }));
    if (generation !== this.generation) { leases.forEach(releaseAsset); return; }
    this.leases = leases; const data = await Promise.all(leases.map(lease => lease.loading));
    if (generation !== this.generation || !this.container.isConnected) return;
    this.app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio, 2) });
    this.container.replaceChildren(this.app.view);
    this.spines = data.map((item, index) => leases[index].modern ? new VaultSpine42(item.spineData, layers[index]) : new GameSpine(item.spineData, layers[index])); this.spine = this.spines[0];
    this.scene = model.layers?.length ? new PIXI.Container() : this.spine;
    if (model.layers?.length) for (const [index, layer] of layers.entries()) {
      const spine = this.spines[index]; spine.position.set(layer.x || 0, layer.y || 0); spine.scale.set(layer.scaleX ?? 1, layer.scaleY ?? 1); this.scene.addChild(spine);
    }
    this.app.stage.addChild(this.scene);
    const playback = this.pendingPlayback;
    this.setAnimation(playback.name, playback.loop, playback.token); this.fit();
    if (options.still ?? model.still) {
      for (const spine of this.spines) spine.autoUpdate = false;
      this.app.stop(); this.app.renderer.render(this.app.stage);
    }
  }
  snapshot() {
    if (!this.app) return null;
    this.app.renderer.render(this.app.stage);
    // Preserve the viewport crop, including transparent padding. Extracting the
    // scene instead crops to each stand's bounds and changes its apparent scale.
    return this.app.renderer.extract.canvas().toDataURL('image/png');
  }
  setAnimation(name, loop = true, token = null) {
    this.pendingPlayback = { name, loop, token };
    if (!this.spine) return;
    const names = this.model.animations;
    const resolved = names.includes(name) ? name : names.includes('wait1') ? 'wait1' : names.includes('Wait') ? 'Wait' : names[0];
    if (resolved && (this.animation !== resolved || this.loop !== loop || this.animationToken !== token)) {
      for (const spine of this.spines) spine.state.setAnimation(0, resolved, loop); this.animation = resolved; this.loop = loop; this.animationToken = token;
    }
    for (const spine of this.spines) spine.update(0); this.fit();
  }
  fit() {
    if (!this.app || !this.spine) return;
    const { width, height } = this.container.getBoundingClientRect(); if (!width || !height) return;
    this.app.renderer.resize(width, height);
    if (this.model.fit === 'portal') {
      const p = portalPlacement(this.scene.getLocalBounds(), width, height);
      this.scene.scale.set(p.scale); this.scene.position.set(p.x, p.y); return;
    }
    if(this.model.fit==='stage'){
      const p=this.placement,scale=Math.min(width/(p.frameWidth||1920),height/(p.frameHeight||1080));this.scene.scale.set(scale*(p.scale??1));this.scene.position.set(width/2+(p.x||0)*scale,height/2+(p.y||0)*scale);return;
    }
    if (this.model.fit === 'bounds'||this.model.fit==='cover') {
      const bounds = this.scene.getLocalBounds(); if (!(bounds.width > 0 && bounds.height > 0)) return;
      const scale = this.model.fit==='cover'?Math.max(width/bounds.width,height/bounds.height):Math.min(width / bounds.width, height / bounds.height) * 0.94;
      this.scene.scale.set(scale); this.scene.position.set(width / 2 - (bounds.x + bounds.width / 2) * scale, height / 2 - (bounds.y + bounds.height / 2) * scale); return;
    }
    const placement = fitScene(width, height, this.placement);
    this.spine.scale.set(placement.scale); this.spine.position.set(placement.x, placement.y);
  }
  disposeApp() { this.app?.destroy(true, { children: true, texture: false, baseTexture: false }); this.app = null; this.spine = null; this.spines = []; this.scene = null; this.animation = null; this.animationToken = null; this.leases?.forEach(releaseAsset); this.leases = null; }
  destroy() { this.generation++; this.observer.disconnect(); this.disposeApp(); this.container.replaceChildren(); }
}
