import * as PIXI from 'pixi.js';
// Each game has its own Pixi bundle; enable the CSP-safe shader path here too.
import '@pixi/unsafe-eval';
import { NativeMotionState } from './motion-state.ts';
import { DotabyssMaterialRenderer } from './material-renderer.ts';

let coreLoading, runtimeLoading;
function loadCore(url) {
  if (coreLoading) return coreLoading;
  try { if (window.Live2DCubismCore?.Version.csmGetVersion()) return Promise.resolve(); } catch {}
  if (!coreLoading) coreLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = url; script.async = true;
    const timeout = setTimeout(() => fail(new Error('Live2D 运行库加载超时。')), 30000);
    function fail(error) { clearTimeout(timeout); script.remove(); coreLoading = null; reject(error); }
    script.onerror = () => fail(new Error('Live2D 运行库加载失败。'));
    script.onload = () => {
      // The script can finish before its embedded WASM has initialized.
      const ready = () => {
        if (!script.isConnected) return;
        try { if (window.Live2DCubismCore?.Version.csmGetVersion()) { clearTimeout(timeout); resolve(); return; } } catch {}
        setTimeout(ready, 25);
      };
      ready();
    };
    document.head.append(script);
  });
  return coreLoading;
}
export class Live2DPlayer {
  declare container: any;
  declare generation: any;
  declare playbackGeneration: any;
  declare observer: any;
  declare model: any;
  declare fitMode: any;
  declare display: any;
  declare materialRenderer: any;
  declare nativeMotion: any;
  declare storyClock: any;
  declare app: any;
  declare nativeSize: any;
  declare animation: any;
  declare loop: any;
  declare animationToken: any;

  constructor(container) {
    this.container = container; this.generation = 0; this.playbackGeneration = 0;
    this.observer = new ResizeObserver(() => this.fit()); this.observer.observe(container);
  }
  async load(model, options: any = {}) {
    const generation = ++this.generation; this.dispose(); this.model = model; this.fitMode = options.fit || 'contain';
    const root = new URL(options.assetRoot || 'library/', location.href);
    const source = new URL(model.file.split('/').map(encodeURIComponent).join('/'), root).href;
    await loadCore(new URL('../vendor/live2dcubismcore.min.js', root).href);
    runtimeLoading ||= import('pixi-live2d-display-advanced/cubism4');
    const { Live2DModel } = await runtimeLoading;
    Live2DModel.registerTicker(PIXI.Ticker);
    if (generation !== this.generation || !this.container.isConnected) return;
    const display = await Live2DModel.from(source, { autoInteract: false, autoUpdate: true, motionPreload: options.scripted ? 'NONE' : 'ALL', idleMotionGroup: '', preserveExpression: true });
    if (generation !== this.generation || !this.container.isConnected) { display.destroy({ children: true, texture: true, baseTexture: true }); return; }
    this.display = display;
    if(model.materials){
      const response=await fetch(new URL(model.materials.split('/').map(encodeURIComponent).join('/'),root));if(!response.ok)throw new Error('动态 CG 材质读取失败，请重新整理素材。');
      const materials=await response.json();if(generation!==this.generation)return;
      // The original atlases use bilinear sampling and contain one mip level.
      for(const texture of display.textures||[]){texture.baseTexture.scaleMode=PIXI.SCALE_MODES.LINEAR;texture.baseTexture.mipmap=PIXI.MIPMAP_MODES.OFF;}
      this.materialRenderer=new DotabyssMaterialRenderer(display.internalModel,materials);
    }
    if(options.scripted){
      if(!model.performance)throw new Error('动态 CG 需要更新演出素材。');
      const response=await fetch(new URL(model.performance.split('/').map(encodeURIComponent).join('/'),root));if(!response.ok)throw new Error('演出动作读取失败。');
      const data=await response.json();if(generation!==this.generation)return;
      this.nativeMotion=new NativeMotionState(data);this.storyClock=options.clock||(()=>performance.now()/1000);
      this.nativeMotion.initialize(Number.isFinite(options.initialTime)?options.initialTime:this.storyClock());
      display.internalModel.motionManager.stopAllMotions();
      display.internalModel.on('beforeModelUpdate',()=>{
        if(!this.nativeMotion)return;const core=display.internalModel.coreModel;
        for(const channel of this.nativeMotion.values(this.storyClock()))if(channel.target==='ModelOpacity')display.alpha=channel.value;else if(channel.target==='PartOpacity')core.setPartOpacityById(channel.id,channel.value);else core.setParameterValueById(channel.id,channel.value);
      });
    }
    this.app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio, 2) });
    this.app.stage.addChild(display); this.container.replaceChildren(this.app.view);
    const size = display.internalModel; this.nativeSize = { width: size.width, height: size.height };
    if(!options.scripted)this.setAnimation(options.animation || model.animations.find(name => /_loop$/.test(name)) || model.animations[0], options.loop ?? true, options.token);
    this.fit();
  }
  setAnimation(name, loop = true, token = null) {
    const resolved = this.model?.animations?.includes(name) ? name : this.model?.animations?.find(item => /_loop$/.test(item)) || this.model?.animations?.[0];
    if (!this.display || !resolved || this.animation === resolved && this.loop === loop && this.animationToken === token) return;
    this.animation = resolved; this.loop = loop; this.animationToken = token;
    const display = this.display, generation = ++this.playbackGeneration;
    display.internalModel.motionManager.loadMotion(resolved, 0).then(motion => {
      if (this.display !== display || generation !== this.playbackGeneration || !motion) return;
      // Converted DOTABYSS clips already contain the authored movement. The
      // runtime treats definition-level zero fades as its one-second default.
      if (this.model.performance) { motion.setFadeInTime(0); motion.setFadeOutTime(0); motion.setIsLoopFadeIn(false); }
      motion.setIsLoop(loop); display.motion(resolved, 0, 3, { sound: false }).catch(() => {});
    }).catch(() => {});
  }
  playCommand(name,loop=false,time=this.storyClock?.()){return this.nativeMotion?.play(name,{time,loop})||false;}
  resetCommands(){this.nativeMotion?.clear();}
  fit() {
    if (!this.app || !this.display || !this.nativeSize) return;
    const { width, height } = this.container.getBoundingClientRect(); if (!width || !height) return;
    this.app.renderer.resize(width, height);
    const size = this.nativeSize, cover = this.fitMode === 'cover';
    // DOTABYSS CGs include animation overscan in their 2176x1696 authoring
    // canvas. Use the novel's central 1920x1080 reference area; fitting the full
    // canvas exposes unfinished limb edges when those layers move inward.
    // Normalize by canvas height for the alternate 2575x2000 export too.
    const sceneFrame=cover&&this.model?.performance?{width:1920*size.height/1696,height:1080*size.height/1696}:size;
    const scale = (cover ? Math.max(width / sceneFrame.width, height / sceneFrame.height) : Math.min(width / size.width, height / size.height) * (this.nativeMotion?1:0.94));
    this.display.scale.set(scale); this.display.position.set((width - size.width * scale) / 2, (height - size.height * scale) / 2);
  }
  dispose() {
    this.materialRenderer?.destroy();this.materialRenderer=null;
    this.playbackGeneration++; if (this.app) this.app.destroy(true, { children: true, texture: true, baseTexture: true }); else this.display?.destroy({ children: true, texture: true, baseTexture: true });
    this.app = null; this.display = null; this.nativeSize = null; this.animation = null;this.nativeMotion=null;
  }
  destroy() { this.generation++; this.observer.disconnect(); this.dispose(); this.container.replaceChildren(); }
}
