import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';
import '@pixi/unsafe-eval';
import { MosaicCapture } from './mosaic.ts';

const leases = new Map<string, any>();
async function acquire(url: string) {
  let lease = leases.get(url);
  if (lease?.unloading) { await lease.unloading; lease = leases.get(url); }
  if (!lease) { lease = { url, users: 0, promise: PIXI.Assets.load(url) }; leases.set(url, lease); }
  lease.users++; return lease;
}
function release(lease) {
  if (!lease) return;
  lease.users--;
  lease.promise.then(() => {
    if (lease.users || lease.unloading || leases.get(lease.url) !== lease) return;
    lease.unloading = PIXI.Assets.unload(lease.url).catch(() => {}).finally(() => { if (leases.get(lease.url) === lease) leases.delete(lease.url); });
  }, () => { if (!lease.users && leases.get(lease.url) === lease) leases.delete(lease.url); });
}
class GameSpine extends Spine {
  declare capture: MosaicCapture;
  createMesh(slot, attachment) {
    const mesh = super.createMesh(slot, attachment);
    if (/mosaic|mos_/i.test(slot.data.name + ' ' + attachment.name + ' ' + (attachment.path || ''))) {
      this.capture ||= new MosaicCapture(); this.capture.attach(mesh, { renderSource: true });
    }
    return mesh;
  }
  destroy(options) { this.capture?.destroy(); super.destroy(options); }
}
export class Player {
  app: PIXI.Application;
  spine: any;
  model: any;
  lease: any;
  generation = 0;
  observer: ResizeObserver;
  bounds: any;
  pose: any;
  options: any;
  suspended = false;
  constructor(public container: HTMLElement) { this.observer = new ResizeObserver(() => this.fit()); this.observer.observe(container); }
  async load(model, options: any = {}) {
    this.clear(); const generation = ++this.generation; this.model = model; this.options = options; this.suspended = !!options.paused;
    PIXI.Assets.setPreferences({ preferCreateImageBitmap: false });
    const url = new URL((options.assetRoot || 'library/') + model.file.split('/').map(encodeURIComponent).join('/'), location.href).href;
    const lease = await acquire(url);
    if (generation !== this.generation) { release(lease); return; }
    this.lease = lease;
    try {
      const data = await lease.promise;
      if (generation !== this.generation || !this.container.isConnected) return;
      this.app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio || 1, 2) });
      this.spine = new GameSpine(data.spineData); this.app.stage.addChild(this.spine);
      this.setPose({ skin: model.defaultSkin, animation: options.animation || model.defaultAnimation, ...options.pose });
      this.spine.update(0); this.bounds = this.spine.getLocalBounds().clone(); this.fit();
      this.container.replaceChildren(this.app.view as HTMLCanvasElement);
    } catch (error) { if (generation === this.generation) this.clear(); throw error; }
  }
  setPose(pose: any) {
    this.pose ||= {};
    const changed = pose.animation && pose.animation !== this.pose.animation;
    for (const key of ['skin', 'animation', 'subAnimation']) if (typeof pose[key] === 'string' && pose[key]) this.pose[key] = pose[key];
    if (changed) {
      // A new authored clip starts with its own playback mode; start/stop below
      // only control its clock and must never convert a loop into a one-shot.
      this.pose.loop = !(this.options?.scene === 'cg' || this.model?.kind === 'cg') || /loop/i.test(pose.animation);
      this.pose.speed = 1;
    }
    if (typeof pose.loop === 'boolean') this.pose.loop = pose.loop;
    if (Number.isFinite(pose.speed) && pose.speed >= 0) this.pose.speed = pose.speed;
    const completion = String(pose.completion || '').toLowerCase();
    if (completion === 'loop') this.pose.loop = true;
    if (['keep', 'delete'].includes(completion)) this.pose.loop = false;
    if (completion === 'stop') this.pose.speed = 0;
    if (completion === 'start') this.pose.speed = pose.speed ?? 1;
    if (!this.spine) return;
    const skin = this.pose.skin || this.model.defaultSkin;
    if (skin && this.model.skins.includes(skin) && this.spine.skeleton.skin?.name !== skin) {
      this.spine.skeleton.setSkinByName(skin); this.spine.skeleton.setSlotsToSetupPose();
    }
    this.setAnimation(this.pose.animation || this.model.defaultAnimation, this.pose.loop !== false);
    const sub = this.pose.subAnimation;
    if (sub && this.model.animations.includes(sub)) { if (this.spine.state.getCurrent(1)?.animation?.name !== sub) this.spine.state.setAnimation(1, sub, true); }
    else this.spine.state.clearTrack(1);
    this.spine.state.timeScale = this.suspended ? 0 : this.pose.speed ?? 1; this.spine.update(0);
    if (this.options.scene === true) this.fit();
  }
  setPaused(value: boolean) { this.suspended = value; if (this.spine) this.spine.state.timeScale = value ? 0 : this.pose.speed ?? 1; }
  remaining() {
    const track = this.spine?.state.getCurrent(0), speed = this.spine?.state.timeScale;
    if (!track || !speed || !(track.animation.duration > 0)) return 0;
    return Math.max(0, track.animation.duration - (track.loop ? track.trackTime % track.animation.duration : track.trackTime)) * 1000 / speed;
  }
  setAnimation(name: string, loop = true) {
    if (!this.spine) return;
    const resolved = name || this.model.defaultAnimation;
    if (resolved && !this.model.animations.includes(resolved)) throw new Error('剧情引用了不存在的动画：' + resolved);
    const track = this.spine.state.getCurrent(0);
    if (resolved && track?.animation?.name !== resolved) {
      this.spine.skeleton.setToSetupPose(); this.spine.state.clearTracks(); this.spine.state.setAnimation(0, resolved, loop);
    } else if (track) track.loop = loop;
  }
  fit() {
    if (!this.app || !this.spine) return;
    const { width, height } = this.options.logicalSize
      ? { width: this.container.clientWidth, height: this.container.clientHeight } : this.container.getBoundingClientRect();
    if (!width || !height) return;
    if (this.options.scene === true) {
      // The 640 x 720 actor node is a coordinate anchor, not a crop. Native
      // bodies and wide accessories extend beyond it (including below y=720).
      // Keep the camera origin fixed while giving the canvas the whole mesh.
      const scale = Math.min(width / 640, height / 720) * (this.model.scale || .01) * 100;
      const live = this.spine.getLocalBounds(), authored = this.model.bounds || live;
      const left = Math.floor(Math.min(0, width / 2 + Math.min(live.x, authored.x) * scale - 2));
      const top = Math.floor(Math.min(0, height / 2 + Math.min(live.y, authored.y) * scale - 2));
      const right = Math.ceil(Math.max(width, width / 2 + Math.max(live.x + live.width, authored.x + authored.width) * scale + 2));
      const bottom = Math.ceil(Math.max(height, height / 2 + Math.max(live.y + live.height, authored.y + authored.height) * scale + 2));
      const view = this.app.view as HTMLCanvasElement;
      view.style.position = 'absolute'; view.style.left = left + 'px'; view.style.top = top + 'px';
      this.app.renderer.resize(right - left, bottom - top);
      this.spine.scale.set(scale); this.spine.position.set(width / 2 - left, height / 2 - top); return;
    }
    this.app.renderer.resize(width, height);
    if (this.options.scene === 'cg' || this.model.kind === 'cg') {
      // Native AdvGraphicObjectSpineStill scales by UiManager.width / 1280.
      // Its background pieces, atlas trim offsets and animated bones already
      // define the composition. Center the skeleton origin, never its bounds.
      // The outer scene node applies script X/Y/Scale and camera movements.
      const scale = width / 1280 * (this.model.scale || .01) * 100;
      this.spine.scale.set(scale); this.spine.position.set(width / 2, height / 2); return;
    }
    if (this.options.scene) {
      const scale = (this.options.scene === 'sprite' ? Math.min(width / 1600, height / 900) : Math.min(width / 640, height / 720)) * (this.model.scale || .01) * 100;
      this.spine.scale.set(scale); this.spine.position.set(width / 2, height / 2); return;
    }
    const b = this.bounds || this.spine.getLocalBounds(); if (!(b.width > 0 && b.height > 0)) return;
    const scale = Math.min(width / b.width, height / b.height) * .96;
    this.spine.scale.set(scale); this.spine.position.set(width / 2 - (b.x + b.width / 2) * scale, height / 2 - (b.y + b.height / 2) * scale);
  }
  clear() { this.app?.destroy(true, { children: true, texture: false, baseTexture: false }); this.app = null; this.spine = null; this.bounds = null; this.pose = null; release(this.lease); this.lease = null; }
  destroy() { this.generation++; this.observer.disconnect(); this.clear(); this.container.replaceChildren(); }
}
