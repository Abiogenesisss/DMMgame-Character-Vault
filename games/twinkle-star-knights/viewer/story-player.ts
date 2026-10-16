import { Player } from './spine-player.ts';
import { NativeUi, DEFAULT_SETTINGS } from './native-ui.ts';
import { ParticleEffect } from './effects.ts';

const element = (tag: string, name = '', text = '') => { const node = document.createElement(tag); node.className = name; node.textContent = text; return node; };
export class StoryPlayer {
  data: any;
  position = 0;
  history: { position: number; length: number }[] = [];
  trace: number[] = [];
  players = new Map<string, any>();
  tracks = new Map<string, HTMLAudioElement>();
  labels = new Map<string, number>();
  timer: any;
  generation = 0;
  auto = false;
  muted = false;
  stage: HTMLElement;
  dialogue: HTMLElement;
  speaker: HTMLElement;
  text: HTMLElement;
  choices: HTMLElement;
  status: HTMLElement;
  controls: HTMLElement;
  fullscreenButton: HTMLButtonElement;
  observer: ResizeObserver;
  canvas: HTMLElement;
  fade: HTMLElement;
  waits = new Map<any, () => void>();
  animations = new Set<Animation>();
  onKey: (event: KeyboardEvent) => void;
  onStage: (event: MouseEvent) => void;
  ui: NativeUi;
  world: HTMLElement;
  fast = false;
  modal = false;
  busy = false;
  skipPending = false;
  typing: any;
  fullText = '';
  settings = { ...DEFAULT_SETTINGS };
  lastVisual: any;
  cgMode = false;
  camera = { scale: 1, x: 0, y: 0 };
  requests = new AbortController();
  constructor(public host: HTMLElement, public options: any) {
    this.host.classList.add('twinkle-reader'); this.host.tabIndex = 0;
    this.stage = element('div', 'twinkle-stage'); this.canvas = element('div', 'twinkle-canvas'); this.stage.append(this.canvas);
    this.fullscreenButton = element('button', 'twinkle-fullscreen') as HTMLButtonElement;
    this.fullscreenButton.type = 'button'; this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
    this.stage.append(this.fullscreenButton); this.updateFullscreen();
    document.addEventListener('fullscreenchange', () => this.updateFullscreen(), { signal: this.requests.signal });
    this.world = element('div', 'twinkle-world'); this.canvas.append(this.world);
    this.fade = element('div', 'twinkle-fade'); this.fade.style.opacity = '0'; this.canvas.append(this.fade);
    this.ui = new NativeUi(this.canvas, options, {
      auto: () => this.setPlayback(this.auto ? 'manual' : 'auto'),
      speed: () => this.setPlayback(this.fast ? 'manual' : 'fast'),
      hide: () => this.hide(), log: () => this.ui.showLog(this.history.map(h => ({ ...this.data.steps[h.position], length: h.length }))),
      skip: () => { this.generation++; this.cancelEffects(); this.position = this.data.steps.length; this.finish(); },
      restore: length => this.restore(this.trace.slice(0, length)).catch(error => this.fail(error)),
      voice: asset => this.audio('voice', asset, false, true),
      settings: value => { this.settings = { ...value }; this.updateVolumes(); this.schedule(); },
      modal: value => { this.modal = value; this.schedule(); }
    });
    this.settings = { ...this.ui.settings }; this.ui.opacity(this.settings.opacity);
    this.dialogue = this.ui.dialogue; this.speaker = this.ui.speaker; this.text = this.ui.text; this.choices = this.ui.choices;
    this.controls = element('div', 'twinkle-controls'); this.status = element('span', 'twinkle-status'); this.status.setAttribute('aria-live', 'polite');
    const button = (label: string, action) => { const b = element('button', 'secondary-button', label) as HTMLButtonElement; b.type = 'button'; b.addEventListener('click', action); this.controls.append(b); return b; };
    button('上一句', () => this.previous()); button('下一句', () => this.next());
    button('从头播放', () => this.ui.confirm('从本章开头重新播放？', '重新播放', () => this.restore([]).then(() => this.advance()).catch(error => this.fail(error)))); this.controls.append(this.status);
    this.host.replaceChildren(this.stage, this.controls);
    this.onKey = event => {
      if (event.key === 'Escape' && document.fullscreenElement === this.host) { event.preventDefault(); event.stopPropagation(); this.toggleFullscreen(); return; }
      if (this.modal || (event.target as HTMLElement)?.closest('button,input,select')) return;
      if ([' ', 'ArrowRight', 'Enter'].includes(event.key)) { event.preventDefault(); this.next(); } else if (event.key === 'ArrowLeft') { event.preventDefault(); this.previous(); } else if (event.key.toLowerCase() === 'h') this.hide();
    };
    this.onStage = event => { if (!(event.target as HTMLElement)?.closest('button,input,.twinkle-overlay')) this.next(); }; this.stage.addEventListener('click', this.onStage);
    host.addEventListener('keydown', this.onKey);
    this.observer = new ResizeObserver(() => this.fit()); this.observer.observe(this.stage);
  }
  async load(data) {
    if (!Array.isArray(data?.steps)) throw new Error('剧情数据无效。'); this.data = data;
    await this.ui.load(); if (this.requests.signal.aborted) return;
    data.steps.forEach((s, i) => { if (s.op === 'label') this.labels.set(s.name, i); });
    this.canvas.style.width = data.width + 'px'; this.canvas.style.height = data.height + 'px'; this.fit();
    let saved = []; try { const record = JSON.parse(localStorage.getItem(this.options.positionKey) || 'null'); if (record?.revision === (data.revision || 'test')) saved = record.trace; } catch {}
    if (!Array.isArray(saved) || saved.length > 20000 || saved.some(i => !Number.isInteger(i) || i < 0 || i >= data.steps.length)) saved = [];
    await this.restore(saved); if (!saved.length) await this.advance();
  }
  fit() { if (!this.data) return; this.canvas.style.transform = 'scale(' + this.stage.clientWidth / this.data.width + ')'; }
  updateFullscreen() {
    const active = document.fullscreenElement === this.host, label = active ? '退出全屏' : '全屏';
    this.fullscreenButton.title = label; this.fullscreenButton.setAttribute('aria-label', label); this.fullscreenButton.setAttribute('aria-pressed', String(active));
    const path = active ? 'M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3' : 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5';
    this.fullscreenButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
    this.fit();
  }
  async toggleFullscreen() {
    try {
      // A dialog itself cannot enter fullscreen; its player host can.
      if (document.fullscreenElement === this.host) await document.exitFullscreen();
      else await this.host.requestFullscreen();
    } catch { if (!this.requests.signal.aborted) this.options.onError?.(new Error('当前浏览器无法切换全屏。')); }
  }
  setPlayback(mode: 'manual' | 'auto' | 'fast') {
    this.auto = mode === 'auto'; this.fast = mode === 'fast';
    this.ui.pressed('auto', this.auto); this.ui.pressed('speed', this.fast);
    for (const animation of this.animations) animation.playbackRate = this.fast ? 4 : 1;
    if (this.fast) { this.stopTrack('voice'); this.reveal(); }
    this.schedule();
  }
  audio(track: string, asset: string, loop = false, replay = false) {
    const item = this.data.media[asset]; let audio = this.tracks.get(track);
    if (!item) { this.stopTrack(track); return; }
    const url = this.options.asset(item.file);
    if (audio?.getAttribute('src') === url && !replay) return;
    this.stopTrack(track); audio = new Audio(); audio.src = url; audio.loop = loop; audio.muted = this.muted; audio.volume = track === 'voice' ? 1 : .45;
    this.tracks.set(track, audio); this.updateVolumes();
    const settled = (failed = false) => {
      // Events from a replaced voice or background track must not postpone the
      // next line's auto timer or wake playback after closing the reader.
      if (this.requests.signal.aborted || this.tracks.get(track) !== audio) return;
      if (failed) audio.dataset.failed = 'true';
      this.updateVolumes(); if (track === 'voice') this.schedule();
    };
    audio.addEventListener('ended', () => settled());
    audio.addEventListener('error', () => settled(true));
    audio.play().catch(() => settled(true));
  }
  updateVolumes() {
    const voice = this.tracks.get('voice'), speaking = voice && !voice.ended && !voice.dataset.failed;
    for (const [track, audio] of this.tracks) {
      const specialScene = [...this.players.values()].some(e => e.asset.includes('/Stills/'));
      const key = track === 'voice' ? 'voice' : track === 'Bgm' ? 'bgm' : track === 'BgVoice' ? 'bgVoice' : track === 'BgSe' && specialScene ? 'special' : 'se';
      audio.volume = this.settings[key] / 100; audio.muted = this.muted || track === 'BgVoice' && this.settings.bgVoiceDuck && !!speaking;
    }
  }
  stopTrack(track: string) { const a = this.tracks.get(track); if (a) { a.pause(); a.removeAttribute('src'); a.load(); this.tracks.delete(track); this.updateVolumes(); } }
  clearVisuals() { for (const item of this.players.values()) { item.player?.destroy(); item.effect?.destroy(); item.node.remove(); } this.players.clear(); }
  cancelEffects() { for (const [id, resolve] of this.waits) { clearTimeout(id); resolve(); } this.waits.clear(); for (const animation of this.animations) animation.cancel(); this.animations.clear(); }
  delay(ms: number) { return new Promise<void>(resolve => { const id = setTimeout(() => { this.waits.delete(id); resolve(); }, Math.min(30000, Math.max(0, ms))); this.waits.set(id, resolve); }); }
  async animate(node: HTMLElement, frames: Keyframe[], duration: number, silent = false) {
    if (silent || duration <= 0 || this.skipPending || !node.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const animation = node.animate(frames, { duration: Math.min(30000, Math.max(0, duration)), easing: 'ease-in-out' }); animation.playbackRate = this.fast ? 4 : 1; this.animations.add(animation);
    try { await animation.finished; } catch {} finally { this.animations.delete(animation); }
  }
  remove(name: string, actorsOnly = false) {
    for (const [key, item] of this.players) if ((!name || key === name) && (!actorsOnly || key.startsWith('actor:'))) { item.player?.destroy(); item.effect?.destroy(); item.node.remove(); this.players.delete(key); }
    this.updateVolumes();
  }
  async visual(key: string, asset: string, step: any, actor: any = null, silent = false) {
    const model = this.data.media[asset]; if (!model) return;
    if (silent && (model.effectKind || step.completion === 'Delete')) { this.remove(key); return; }
    let entry = this.players.get(key);
    if (actor?.layer) for (const [other, current] of this.players) if (other !== key && current.layer === actor.layer) this.remove(other);
    const created = entry?.asset !== asset;
    if (created) {
      this.remove(key); const node = element('div', actor ? 'twinkle-actor' : step.op === 'sprite' ? 'twinkle-sprite' : 'twinkle-scene');
      entry = { node, asset, layer: actor?.layer || step.layer || '', x: actor ? actor.x ?? actor.defaultX : step.x || 0, y: actor ? actor.y ?? actor.defaultY : step.y || 0,
        scale: actor?.scale || step.scale || 1, rotation: 0, opacity: 1, actor: !!actor }; this.players.set(key, entry); this.world.append(node);
      node.style.zIndex = String(this.data.layers?.[entry.layer] ?? (actor ? 400 : step.op === 'sprite' ? 500 : 100));
      if (model.animations) {
        const player = new Player(node); entry.player = player;
        await player.load(model, { assetRoot: this.options.assetRoot, animation: step.animation || model.defaultAnimation, pose: step, paused: silent, logicalSize: true,
          scene: actor ? true : step.op === 'sprite' ? 'sprite' : step.scene === 'cg' || asset.includes('/Stills/') ? 'cg' : false });
      } else if (model.effectKind) {
        const response = await fetch(this.options.asset(model.file), { signal: this.requests.signal }); if (!response.ok) throw new Error('演出文件读取失败。');
        const data = await response.json(); if (this.players.get(key) !== entry) return;
        if (data.kind === 'title') {
          const title = step.title || String(step.text || '').split(','), variant = title[2] === 'P';
          node.classList.add('twinkle-title-effect'); const band = element('div', 'twinkle-title-band'), text = element('p', '', title[1] || title[0] || ''), heading = element('strong', 'twinkle-title-heading', title[1] ? title[0] : '');
          const background = document.createElement('img'); background.src = this.options.asset(data.sprites.bg.file); background.className = 'twinkle-title-background'; background.alt = ''; node.append(background);
          for (const [name, cls] of [[variant ? 'frame_half_lr_p' : 'frame_half', 'left'], [variant ? 'frame_half_lr_p' : 'frame_half', 'right'], [variant ? 'pattern_p' : 'pattern', 'pattern']]) { const img = document.createElement('img'); img.src = this.options.asset(data.sprites[name].file); img.className = cls; img.alt = ''; band.append(img); }
          band.append(heading, text); node.append(band); entry.remaining = () => data.duration * 1000;
          this.delay(data.duration * 1000).then(() => { if (this.players.get(key) === entry) this.remove(key); });
        } else { entry.effect = new ParticleEffect(node, data, this.options.asset); await entry.effect.load(); }
      } else { const img = document.createElement('img'); img.src = this.options.asset(model.file); img.alt = ''; node.append(img); }
    }
    if (this.players.get(key) !== entry) return;
    if (actor) {
      if (created || actor.x != null) entry.x = actor.x ?? actor.defaultX;
      if (created || actor.y != null) entry.y = actor.y ?? actor.defaultY;
      entry.scale = actor.scale || 1; entry.layer ||= actor.layer;
    } else if (!created) {
      // Repeated BgEvent rows can reposition the same skeleton. Empty cells
      // keep its current transform, including movements made by Tween.
      if (step.args?.[3] !== '' && step.args?.[3] != null) entry.x = step.x;
      if (step.args?.[4] !== '' && step.args?.[4] != null) entry.y = step.y;
    }
    this.place(entry);
    entry.player?.setPose(step);
    this.updateVolumes();
    this.lastVisual = entry;
    if (step.completion === 'Delete') this.delay(entry.player?.remaining() || entry.effect?.remaining() || 0).then(() => { if (this.players.get(key) === entry) this.remove(key); });
    return entry;
  }
  place(entry) {
    entry.node.style.left = (entry.x + (entry.actor ? this.data.width / 2 - 320 : 0)) + 'px'; entry.node.style.top = -entry.y + 'px';
    entry.node.style.transform = `scale(${entry.scale}) rotate(${entry.rotation}deg)`; entry.node.style.opacity = String(entry.opacity);
  }
  async apply(step, silent = false) {
    const args = step.args || [], generation = this.generation;
    const run = async (promise: Promise<unknown>) => { if (!step.noWait || silent) await promise; else promise.catch(error => { if (generation === this.generation) this.fail(error); }); };
    if (step.op === 'line') {
      if (step.actorOff) {
        const key = 'actor:' + step.actor?.name, entry = this.players.get(key);
        if (entry) await run(this.animate(entry.node, [{ opacity: entry.opacity }, { opacity: 0 }], Number(args[5] || 0) * 1000, silent)
          .then(() => { if (this.players.get(key) === entry) this.remove(key); }));
      } else if (step.actor?.asset && !this.cgMode) await this.visual('actor:' + step.actor.name, step.actor.asset, step, step.actor, silent);
      if (generation !== this.generation) return;
      if (step.text) {
        this.speaker.textContent = step.speaker || ''; this.speaker.hidden = !step.speaker;
        this.dialogue.dataset.window = step.window || ''; this.showText(step.text, silent);
        if (!silent && !this.fast && (step.voice || this.settings.stopVoice)) this.audio('voice', step.voice, false, true);
      }
    } else if (step.op === 'background') {
      // Native BgEvent clears CharacterManager and sets isEventMode: dialogue
      // names keep working, but cannot recreate portraits until a normal Bg.
      this.cgMode = step.scene === 'cg';
      const retiring = this.cgMode ? [...this.players].filter(([key]) => key.startsWith('actor:')).map(([key, entry]) =>
        this.animate(entry.node, [{ opacity: entry.opacity }, { opacity: 0 }], Number(args[5] === '' || args[5] == null ? .2 : args[5]) * 1000, silent)
          .then(() => { if (this.players.get(key) === entry) this.remove(key); })) : [];
      const key = 'background:' + (step.layer || 'BackGround');
      if (step.asset) { const previous = this.players.get(key)?.asset; const entry = await this.visual(key, step.asset, step, null, silent); if (entry && previous !== step.asset) await run(this.animate(entry.node, [{ opacity: 0 }, { opacity: 1 }], Number(args[5] ?? .2) * 1000, silent)); }
      else this.remove(key);
      await run(Promise.all(retiring));
    } else if (step.op === 'sprite' && step.asset) await this.visual('sprite:' + args[0], step.asset, step, null, silent);
    else if (['CharacterOff', 'SpriteOff', 'BgOff'].includes(step.op)) {
      const prefix = step.op === 'CharacterOff' ? 'actor:' : step.op === 'SpriteOff' ? 'sprite:' : 'background:';
      const removals = [];
      for (const [key, entry] of this.players) if (key.startsWith(prefix) && (!args[0] || key === prefix + args[0] || entry.layer === args[0])) {
        removals.push(this.animate(entry.node, [{ opacity: entry.opacity }, { opacity: 0 }], Number(args[5] || 0) * 1000, silent).then(() => { if (this.players.get(key) === entry) this.remove(key); }));
      }
      await run(Promise.all(removals));
    } else if (['Bgm', 'BgSe', 'BgVoice', 'Se'].includes(step.op) && !silent) this.audio(step.op, step.asset, step.loop ?? step.op !== 'Se');
    else if (step.op.startsWith('Stop')) {
      const key = step.op.slice(4), audio = this.tracks.get(key), duration = Number(args[5]) * 1000;
      if (audio && duration && !silent) await run((async () => {
        const volume = audio.volume, start = performance.now();
        while (!this.skipPending && this.tracks.get(key) === audio && generation === this.generation && performance.now() - start < duration) { audio.volume = volume * Math.max(0, 1 - (performance.now() - start) / duration); await this.delay(40); }
        if (this.tracks.get(key) === audio) this.stopTrack(key);
      })()); else this.stopTrack(key);
    }
    else if (step.op === 'HideMessageWindow') this.dialogue.hidden = true;
    else if (step.op === 'ShowMessageWindow') this.dialogue.hidden = false;
    else if (step.op === 'Wait' && !silent) await this.delay((Number(args[5] || args[0]) || 0) * 1000 / (this.fast ? 4 : 1));
    else if (step.op === 'WaitCustom' && !silent) await this.delay((this.lastVisual?.player?.remaining() || this.lastVisual?.effect?.remaining() || this.lastVisual?.remaining?.() || 0) / (this.fast ? 4 : 1));
    else if (['FadeOut', 'FadeIn'].includes(step.op)) {
      const from = Number(this.fade.style.opacity) || 0, to = step.op === 'FadeOut' ? 1 : 0;
      if (/^(?:#[a-f\d]{3,8}|black|white|red|blue)$/i.test(args[0])) this.fade.style.backgroundColor = args[0];
      this.fade.style.opacity = String(to); await run(this.animate(this.fade, [{ opacity: from }, { opacity: to }], (args[5] === '' ? .3 : Number(args[5]) || 0) * 1000, silent));
    } else if (['Tween', 'Shake'].includes(step.op)) {
      const entry = this.players.get('actor:' + args[0]) || this.players.get('sprite:' + args[0]) || [...this.players.values()].find(e => e.layer === args[0]);
      if (!entry && !['Camera', 'SpriteCamera', ''].includes(args[0])) return;
      const node = entry?.node || this.world, values: Record<string, number> = {};
      for (const match of String(args.slice(2).join(' ')).matchAll(/\b(time|x|y|alpha|scale|z|pingPong)=(-?\d*\.?\d+)/g)) values[match[1]] = Number(match[2]);
      let frames: Keyframe[], duration = (values.time ?? .3) * 1000;
      if (step.op === 'Shake') {
        frames = Array.from({ length: 12 }, (_, i) => ({ translate: i === 0 || i === 11 ? '0px 0px' : `${Math.sin(i * 2.7) * (values.x || 0)}px ${Math.cos(i * 1.8) * (values.y || 0)}px` }));
      } else {
        if (!entry) return;
        const from = { x: entry.x, y: entry.y, scale: entry.scale, rotation: entry.rotation, opacity: entry.opacity }, to = { ...from };
        const by = args[1].endsWith('By');
        if (/^Move/.test(args[1])) { if (values.x != null) to.x = values.x + (by ? from.x : 0); if (values.y != null) to.y = values.y + (by ? from.y : 0); }
        else if (/^Scale/.test(args[1])) to.scale = (values.scale ?? values.x ?? 1) * (by ? from.scale : 1);
        else if (/^Rotate/.test(args[1])) to.rotation = -(values.z ?? 0) + (by ? from.rotation : 0);
        else if (/^(Fade|Alpha)/.test(args[1])) to.opacity = Math.max(0, Math.min(1, values.alpha ?? 1));
        const keyframe = p => ({ left: (p.x + (entry.actor ? this.data.width / 2 - 320 : 0)) + 'px', top: -p.y + 'px', transform: `scale(${p.scale}) rotate(${p.rotation}deg)`, opacity: p.opacity });
        frames = [keyframe(from), keyframe(to)];
        if (values.pingPong) { const count = Math.min(20, Math.max(2, Math.floor(values.pingPong))); frames = Array.from({ length: count + 1 }, (_, i) => keyframe(i % 2 ? to : from)); duration *= count; Object.assign(entry, count % 2 ? to : from); }
        else Object.assign(entry, to);
        this.place(entry);
        const easing = { linear: 'linear', easeOutQuad: 'cubic-bezier(.25,.46,.45,.94)', easeInQuad: 'cubic-bezier(.55,.085,.68,.53)', easeInOutQuad: 'ease-in-out' }[args[3]];
        if (easing) for (const frame of frames) frame.easing = easing;
      }
      await run(this.animate(node, frames, duration, silent));
    } else if (step.op === 'ZoomCamera') {
      const before = this.world.style.transform || 'scale(1) translate(0px,0px)';
      this.camera = { scale: Number(args[1]) || 1, x: Number(args[3]) || 0, y: Number(args[4]) || 0 };
      const after = `scale(${this.camera.scale}) translate(${-this.camera.x}px,${this.camera.y}px)`; this.world.style.transform = after;
      await run(this.animate(this.world, [{ transform: before }, { transform: after }], (Number(args[5]) || 0) * 1000, silent));
    }
  }
  showText(value: string, instant = false) {
    clearTimeout(this.typing); this.typing = null; this.fullText = value;
    if (instant || this.fast || this.settings.textSpeed >= 100) { this.reveal(); return; }
    let index = 0; const generation = this.generation, letters = Array.from(value); this.text.textContent = ''; this.ui.next.hidden = true;
    const tick = () => {
      if (generation !== this.generation) return;
      this.text.textContent = letters.slice(0, ++index).join('');
      if (index < letters.length) this.typing = setTimeout(tick, Math.max(5, 65 - this.settings.textSpeed * .6)); else { this.typing = null; this.reveal(); this.schedule(); }
    }; tick();
  }
  reveal() { clearTimeout(this.typing); this.typing = null; this.text.textContent = this.fullText; this.ui.next.hidden = false; this.text.append(this.ui.next); }
  hide() { this.ui.dialogue.hidden = !this.ui.dialogue.hidden; this.ui.controls.hidden = this.ui.dialogue.hidden; this.schedule(); }
  finish() { this.setPlayback('manual'); this.reveal(); this.status.textContent = '本章结束'; for (const track of [...this.tracks.keys()]) this.stopTrack(track); }
  async restore(trace: number[]) {
    this.stage.dataset.loading = 'true'; this.canvas.style.visibility = 'hidden';
    const generation = ++this.generation; this.busy = true; clearTimeout(this.typing); this.typing = null; clearTimeout(this.timer); this.cancelEffects(); this.clearVisuals(); this.fade.style.opacity = '0'; this.world.style.transform = '';
    this.dialogue.hidden = false; this.ui.controls.hidden = false; this.fullText = ''; this.text.textContent = ''; this.speaker.textContent = ''; this.speaker.hidden = true; this.lastVisual = null;
    for (const track of [...this.tracks.keys()]) this.stopTrack(track);
    this.position = 0; this.trace = []; this.history = []; this.choices.replaceChildren(); this.cgMode = false;
    const backgroundTracks = new Map<string, string>();
    for (const index of trace) {
      const step = this.data.steps[index]; this.trace.push(index);
      await this.apply(step, true); if (generation !== this.generation) return;
      if (['Bgm', 'BgSe', 'BgVoice'].includes(step.op)) backgroundTracks.set(step.op, step.asset);
      else if (step.op.startsWith('Stop')) backgroundTracks.delete(step.op.slice(4));
      if (step.op === 'line' && step.text) this.history.push({ position: index, length: this.trace.length });
      this.position = index + 1;
    }
    if (generation !== this.generation || this.requests.signal.aborted) return;
    for (const entry of this.players.values()) entry.player?.setPaused(false);
    this.canvas.style.visibility = ''; delete this.stage.dataset.loading;
    for (const [track, asset] of backgroundTracks) this.audio(track, asset, true);
    const last = this.data.steps[trace.at(-1)]; if (last?.voice && !this.fast) this.audio('voice', last.voice, false, true);
    this.busy = false; this.skipPending = false; this.status.textContent = this.position + ' / ' + this.data.steps.length; this.schedule();
  }
  async advance(record = true) {
    if (this.busy || this.requests.signal.aborted) return;
    this.busy = true; this.skipPending = false;
    const generation = this.generation; clearTimeout(this.timer); if (this.fast || this.settings.stopVoice) this.stopTrack('voice'); this.choices.replaceChildren();
    try {
    let traversed = 0;
    while (this.position < this.data.steps.length && traversed++ < 2000) {
      const current = this.position++, step = this.data.steps[current];
      this.trace.push(current);
      if (step.op === 'jump') { const dest = this.labels.get(step.target); if (dest != null) this.position = dest + 1; continue; }
      if (step.op === 'choice') {
        const choices = [step]; while (this.data.steps[this.position]?.op === 'choice') choices.push(this.data.steps[this.position++]);
        for (const c of choices) { const button = this.ui.button(c.text || '继续', () => { const dest = this.labels.get(c.target); if (dest != null) this.position = dest + 1; this.advance().catch(error => this.fail(error)); }, 'choice'); this.choices.append(button); }
        return;
      }
      if (step.op === 'EndScenario') { this.finish(); return; }
      await this.apply(step); if (generation !== this.generation) return;
      if (step.op === 'line' && step.text) {
        if (record) this.history.push({ position: current, length: this.trace.length }); this.status.textContent = `${current + 1} / ${this.data.steps.length}`;
        try { localStorage.setItem(this.options.positionKey, JSON.stringify({ revision: this.data.revision || 'test', trace: this.trace })); } catch {} this.schedule(); return;
      }
    }
    if (traversed >= 2000) { this.setPlayback('manual'); this.status.textContent = '剧情跳转异常'; } else this.finish();
    } finally { if (generation === this.generation) { this.busy = false; this.skipPending = false; this.schedule(); } }
  }
  next() {
    if (this.modal) return;
    if (this.ui.controls.hidden) { this.dialogue.hidden = false; this.ui.controls.hidden = false; this.schedule(); return; }
    if (this.typing) { this.reveal(); this.schedule(); return; }
    if (this.busy) { this.skipPending = true; for (const animation of this.animations) animation.finish(); for (const [id, resolve] of this.waits) { clearTimeout(id); resolve(); } this.waits.clear(); return; }
    if (!this.choices.children.length) this.advance().catch(error => this.fail(error));
  }
  previous() { if (this.history.length < 2) return; this.history.pop(); const last = this.history.at(-1); this.restore(this.trace.slice(0, last.length)).catch(error => this.fail(error)); }
  schedule() {
    clearTimeout(this.timer);
    if (this.requests.signal.aborted || (!this.auto && !this.fast) || this.typing || this.busy || this.modal || this.choices.children.length || this.ui.controls.hidden && this.settings.stopHiddenAuto) return;
    this.timer = setTimeout(() => {
      const voice = this.tracks.get('voice'); if (!this.fast && this.settings.voiceFirst && voice && !voice.ended && !voice.dataset.failed) return;
      this.advance().catch(error => this.fail(error));
    }, this.fast ? 100 : Math.max(100, 4000 * (1 - this.settings.autoSpeed / 100)));
  }
  fail(error) { if (this.requests.signal.aborted) return; this.setPlayback('manual'); this.busy = false; this.status.textContent = error.message; this.status.setAttribute('role', 'alert'); }
  destroy() { this.generation++; this.requests.abort(); if (document.fullscreenElement === this.host) document.exitFullscreen().catch(() => {}); clearTimeout(this.typing); clearTimeout(this.timer); this.cancelEffects(); this.observer.disconnect(); this.host.removeEventListener('keydown', this.onKey); this.stage.removeEventListener('click', this.onStage); this.clearVisuals(); for (const track of [...this.tracks.keys()]) this.stopTrack(track); this.ui.destroy(); this.host.replaceChildren(); }
}
