import { Player } from './spine-player.ts';
import { readScene } from './reader-scene.ts';
import { NativeView, node, place } from './native-ui.ts';
import { StoryControls } from '../../../app/viewer/story-controls.ts';

const THEME_FILE = 'story-ui/flower-knight-girl/theme.json';
const OPTIONS_KEY = 'flower-story-options-v1';
const defaults = () => ({ speed: 0, opacity: 75, window: 'normal', master: 100, voice: 100, music: 45, sound: 100, mute: false });
const clean = text => String(text || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/\\n/g, '\n');
const clamp = (value, fallback, max = 100) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : fallback;
function readOptions() {
  const config = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY));
    if (saved) {
      for (const key of ['master', 'voice', 'music', 'sound', 'opacity']) config[key] = clamp(saved[key], config[key]);
      config.speed = clamp(saved.speed, config.speed, 3); config.mute = saved.mute === true;
      if (['normal', 'black', 'white'].includes(saved.window)) config.window = saved.window;
    }
  } catch {}
  return config;
}
export class FlowerStoryPlayer {
  asset; assetRoot; positionKey; library; characterName; onError; createMotionPlayer;
  events = new AbortController(); observer: ResizeObserver; views: NativeView[] = [];
  stage = node('div', 'flower-frame'); viewport = node('div', 'flower-viewport');
  image = node('img', 'flower-story-image'); motion = node('div', 'flower-story-motion');
  placeholder = node('span', 'flower-story-placeholder', '✿');
  menuHost = node('div', 'flower-native-menu'); messageHost = node('div', 'flower-native-message');
  error = node('p', 'flower-story-error'); footer: HTMLElement;
  position = node('span', 'flower-position'); speaker: HTMLElement; text: HTMLElement; marker: HTMLElement;
  previous: HTMLButtonElement; next: HTMLButtonElement; toolbar: StoryControls;
  menu: NativeView; message: NativeView; theme; story; indices: number[] = []; cursor = 0;
  voice = new Audio(); music = new Audio(); sound = new Audio(); logVoice = new Audio();
  director; modelFile: string = null; modelPromise: Promise<unknown>; generation = 0;
  config = readOptions(); modal: HTMLElement = null; modalView: NativeView; popupEvents: AbortController; savedConfig;
  auto = false; fast = false; hiddenUi = false; windowUp = false; destroyed = false; loading = false;
  typing = false; typeTimer = 0; playbackTimer = 0; shownAt = 0; voiceFile: string = null;
  fullText = ''; musicFile: string = null; soundToken; transitionToken; returnFocus: HTMLElement;

  constructor(public container: HTMLElement, options) {
    Object.assign(this, { asset: options.asset, assetRoot: options.assetRoot, positionKey: options.positionKey,
      library: options.library, characterName: options.characterName, onError: options.onError || (() => {}),
      createMotionPlayer: options.createMotionPlayer || (host => new Player(host)) });
    this.stage.tabIndex = 0; this.stage.setAttribute('aria-label', '花骑士剧情画面，点击或按空格继续');
    this.image.alt = '剧情画面'; this.image.hidden = true; this.motion.hidden = true;
    this.error.hidden = true; this.error.setAttribute('role', 'alert');
    this.viewport.append(this.image, this.motion, this.placeholder); this.stage.append(this.viewport, this.messageHost, this.menuHost, this.error);
    this.toolbar = new StoryControls(container, { previous: () => this.seek(this.cursor - 1, true), next: () => { if (this.hiddenUi) this.toggleUi(false); else this.advance(); }, restart: () => { this.closeModal(false); this.toggleUi(false); this.seek(0, true); } }, { className: 'flower-reader-footer', position: this.position, onError: this.onError });
    this.footer = this.toolbar.element; this.previous = this.toolbar.previous; this.next = this.toolbar.next;
    this.container.replaceChildren(this.stage, this.footer); this.position.textContent = '正在读取剧情…'; this.updateControls();
    this.observer = new ResizeObserver(() => this.fit()); this.observer.observe(this.stage);
    this.container.addEventListener('keydown', event => this.onKey(event), { signal: this.events.signal });
    this.stage.addEventListener('click', event => {
      if ((event.target as Element).closest('button,input,select,.flower-native-popup')) return;
      if (this.hiddenUi) this.toggleUi(false); else this.advance();
    }, { signal: this.events.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.setFast(false); this.setAuto(false); for (const audio of this.audio()) audio.pause(); }
    }, { signal: this.events.signal });
    window.addEventListener('blur', () => this.setFast(false), { signal: this.events.signal });
    this.playbackTimer = window.setInterval(() => this.tick(), 100);
    this.music.loop = true; this.applyOptions();
  }
  audio() { return [this.voice, this.music, this.sound, this.logVoice]; }
  button(label: string, action) {
    const button = node('button', 'flower-control', label); button.type = 'button';
    button.addEventListener('click', action, { signal: this.modal ? this.popupEvents.signal : this.events.signal }); return button;
  }
  fit() {
    if (!this.theme) return;
    const width = this.stage.getBoundingClientRect().width;
    this.stage.style.setProperty('--flower-unit', (width > 0 ? width / this.theme.width : 1) + 'px');
  }
  async load(story) {
    const generation = ++this.generation;
    if (!Array.isArray(story?.commands)) throw new Error('花骑士剧情文件无效。');
    this.story = story; this.indices = story.commands.flatMap((row, index) => row.command === 'mess' ? [index] : []);
    if (!this.indices.length) throw new Error('此剧情没有可播放的对白。');
    // Old saved scenarios can use the shared UI cache without being re-downloaded.
    const response = await fetch(this.asset(this.library.storyUi?.file || THEME_FILE), { signal: this.events.signal });
    if (!response.ok) throw new Error('请先在角色剧情页点击“下载播放器 UI”，再打开剧情。');
    const theme = await response.json(); if (this.destroyed || generation !== this.generation) return;
    if (theme.version !== 1 || !theme.views?.menu || !theme.views?.message || !theme.sprites || !theme.viewport) throw new Error('花骑士播放器 UI 不完整，请重新下载。');
    this.theme = theme; this.stage.style.aspectRatio = theme.width + ' / ' + theme.height; place(this.viewport, theme.viewport);
    this.menu = new NativeView(this.menuHost, theme.views.menu.filter(row => row.name !== 'showLayer'), theme, this.asset);
    this.message = new NativeView(this.messageHost, theme.views.message.filter(row => !['clickLayer', 'charaLayer'].includes(row.name)), theme, this.asset);
    this.views.push(this.menu, this.message);
    this.speaker = this.message.get('name'); this.speaker.id = 'speaker'; this.speaker.classList.add('flower-speaker');
    this.text = this.message.get('message'); this.text.id = 'dialogue-text'; this.text.setAttribute('aria-live', 'off');
    this.marker = node('span', 'flower-continue', '▼'); this.marker.setAttribute('aria-hidden', 'true');
    const body = theme.views.message.find(row => row.name === 'message');
    place(this.marker, { x: body.x + body.w + 8, y: body.y + body.h - 21, w: 16, h: 18 }); this.messageHost.append(this.marker);
    this.menu.bind('auto', '自动播放', () => this.setAuto(!this.auto));
    this.menu.bind('autoSkip', '连续快进', () => this.setFast(!this.fast));
    this.menu.bind('log', '对白记录', () => this.openLog());
    this.menu.bind('option', '播放设置', () => this.openSettings());
    this.menu.bind('hide', '隐藏界面，点击画面恢复', () => this.toggleUi(true));
    this.menu.bind('windowPosition', '切换对白框上下位置', () => this.moveWindow());
    this.menu.bind('fullSkip', '跳过本章', () => this.openSkip());
    this.setAuto(false); this.setFast(false); this.applyOptions(); this.fit();
    let saved = 0; try { saved = Number(localStorage.getItem(this.positionKey)); } catch {}
    this.cursor = Number.isInteger(saved) && saved >= 0 && saved < this.indices.length ? saved : 0;
    await this.showLine();
  }
  updateControls() {
    const ready = !!this.theme && !!this.indices.length && !this.destroyed;
    this.previous.disabled = !ready || this.cursor === 0;
    this.next.disabled = !ready || this.cursor === this.indices.length - 1 && !this.typing;
    this.toolbar.restart.disabled = !ready;
    if (ready) this.position.textContent = `${this.cursor + 1} / ${this.indices.length}${this.cursor === this.indices.length - 1 && !this.typing ? ' · 剧情结束' : ''}`;
  }
  async showLine(immediate = false) {
    if (this.destroyed || !this.theme) return;
    const generation = ++this.generation; this.loading = true; window.clearInterval(this.typeTimer); this.voice.pause(); this.logVoice.pause();
    const index = this.indices[this.cursor], line = this.story.commands[index], speaker = String(line.args?.[0] || '');
    this.speaker.textContent = speaker.includes('\ufffd') ? this.characterName(String(this.story.character).slice(0, 6)) : clean(speaker);
    this.fullText = clean(line.args?.[1]); this.text.textContent = ''; this.marker.hidden = true;
    try { localStorage.setItem(this.positionKey, String(this.cursor)); } catch {}
    this.voiceFile = this.story.voices?.[line.args?.[2]] || null; this.updateControls();
    const scene = readScene(this.story, index, this.library.skeletons || [], this.library.images || []), model = scene.model;
    this.image.hidden = !scene.image; if (scene.image) this.image.src = this.asset(scene.image); else this.image.removeAttribute('src');
    this.motion.hidden = !model; this.placeholder.hidden = !!scene.image || !!model;
    if (scene.music !== this.musicFile) { this.music.pause(); this.musicFile = scene.music; if (scene.music) { this.music.src = this.asset(scene.music); this.play(this.music); } else this.music.removeAttribute('src'); }
    if (scene.sound?.file && scene.sound.token !== this.soundToken && !this.fast) { this.soundToken = scene.sound.token; this.sound.src = this.asset(scene.sound.file); this.play(this.sound); }
    if (scene.transition && scene.transition.token !== this.transitionToken) {
      this.transitionToken = scene.transition.token; this.viewport.classList.remove('flower-story-fade'); void this.viewport.offsetWidth; this.viewport.classList.add('flower-story-fade');
    }
    if (model) {
      if (this.modelFile !== model.file) {
        this.director?.destroy(); this.director = this.createMotionPlayer(this.motion); this.modelFile = model.file;
        this.modelPromise = this.director.load(model, { ...scene, assetRoot: this.assetRoot });
      }
      const director = this.director;
      try { await this.modelPromise; }
      catch {
        if (this.destroyed || generation !== this.generation) return;
        director.destroy(); this.director = null; this.modelFile = null; this.motion.hidden = true;
        this.image.hidden = !scene.fallbackImage; this.placeholder.hidden = !!scene.fallbackImage;
        if (scene.fallbackImage) this.image.src = this.asset(scene.fallbackImage);
        this.onError(new Error('动态 CG 未能加载，已使用可用的静态画面。'));
      }
      if (this.destroyed || generation !== this.generation) return;
      if (this.director) { this.director.placement = scene.placement; this.director.setAnimation(scene.animation, scene.loop, scene.token); }
    } else { this.director?.destroy(); this.director = null; this.modelFile = null; }
    if (this.destroyed || generation !== this.generation) return;
    this.loading = false;
    if (this.voiceFile && !this.fast) { this.voice.src = this.asset(this.voiceFile); this.play(this.voice); } else this.voice.removeAttribute('src');
    this.typeText(immediate || this.fast);
  }
  play(audio: HTMLAudioElement) { audio.play().catch(() => {}); }
  typeText(immediate = false) {
    window.clearInterval(this.typeTimer); const letters = Array.from(this.fullText), interval = [25, 12.5, 6.25, 0][this.config.speed];
    let count = 0; this.typing = !immediate && interval > 0 && letters.length > 0;
    if (!this.typing) { this.reveal(); return; }
    this.marker.hidden = true; this.updateControls();
    this.typeTimer = window.setInterval(() => {
      if (this.destroyed || document.hidden || this.modal) return;
      this.text.textContent = letters.slice(0, ++count).join(''); if (count >= letters.length) this.reveal();
    }, interval);
  }
  reveal() {
    window.clearInterval(this.typeTimer); this.typing = false;
    if (this.text) this.text.textContent = this.fullText; if (this.marker) this.marker.hidden = false;
    this.shownAt = performance.now(); this.updateControls();
    if (this.cursor === this.indices.length - 1) { this.setAuto(false); this.setFast(false); }
  }
  advance() {
    if (!this.theme || this.loading || this.destroyed || this.modal) return;
    if (this.typing) this.reveal(); else if (this.cursor < this.indices.length - 1) { this.cursor++; this.showLine().catch(error => this.fail(error)); }
  }
  seek(cursor: number, immediate = false) {
    if (!this.theme || this.destroyed || cursor < 0 || cursor >= this.indices.length) return;
    this.setAuto(false); this.setFast(false); this.cursor = cursor; this.showLine(immediate).catch(error => this.fail(error));
  }
  tick() {
    if (this.destroyed || this.loading || this.modal || this.hiddenUi || document.hidden || !this.theme) return;
    if (this.fast) { this.advance(); return; }
    if (this.auto && !this.typing && (this.voice.paused || this.voice.ended) && performance.now() - this.shownAt >= [3000, 1500, 750, 750][this.config.speed]) this.advance();
  }
  setAuto(value: boolean) { this.auto = value; if (value) this.setFast(false); this.menu?.active('auto', value); }
  setFast(value: boolean) { this.fast = value; if (value) { this.setAuto(false); this.voice.pause(); if (this.text) this.reveal(); } this.menu?.active('autoSkip', this.fast); }
  replayVoice(file = this.voiceFile, audio = this.voice) {
    if (!file || this.destroyed) return; this.setFast(false); audio.pause(); audio.src = this.asset(file); audio.currentTime = 0; this.play(audio);
  }
  toggleUi(hidden: boolean) {
    this.hiddenUi = hidden; this.messageHost.hidden = hidden; this.menuHost.hidden = hidden;
    if (hidden) { this.setAuto(false); this.setFast(false); } this.stage.focus({ preventScroll: true });
  }
  moveWindow() {
    this.windowUp = !this.windowUp; const row = this.theme.views.message.find(row => row.name === 'windowGround');
    this.messageHost.style.transform = this.windowUp ? `translateY(calc(${this.theme.height * .0125 - row.y} * var(--flower-unit)))` : '';
    this.menu.active('windowPosition', this.windowUp);
  }
  applyOptions() {
    for (const [audio, kind] of [[this.voice, 'voice'], [this.logVoice, 'voice'], [this.music, 'music'], [this.sound, 'sound']] as const) {
      audio.volume = this.config.master * this.config[kind] / 10000; audio.muted = this.config.mute;
    }
    if (!this.message) return;
    for (const [name, color] of [['windowGround', 'normal'], ['windowGroundBlack', 'black'], ['windowGroundWhite', 'white']]) {
      const item = this.message.get(name); item.hidden = this.config.window !== color; item.style.opacity = String(this.config.opacity / 100);
    }
    this.message.get('windowFrame').style.opacity = String(Math.min(1, this.config.opacity / 50));
    this.text.style.color = this.config.window === 'black' ? '#fff' : '#2c2015';
  }
  popup(name: string, label: string) {
    this.closeModal(false); this.returnFocus = document.activeElement as HTMLElement; this.setFast(false);
    this.voice.pause(); this.logVoice.pause(); const host = node('div', 'flower-native-popup');
    host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true'); host.setAttribute('aria-label', label);
    host.dataset.popup = name; this.modal = host; this.popupEvents = new AbortController(); this.stage.append(host); return host;
  }
  closeModal(save = false) {
    if (!this.modal) return;
    if (this.savedConfig) {
      if (save) { try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.config)); } catch {} }
      else { this.config = this.savedConfig; this.applyOptions(); }
    }
    this.savedConfig = null; this.logVoice.pause(); this.popupEvents.abort(); this.modalView?.destroy(); this.modalView = null;
    this.modal.remove(); this.modal = null; this.shownAt = performance.now();
    if (!this.destroyed) (this.returnFocus?.isConnected && !this.returnFocus.closest('[hidden]') ? this.returnFocus : this.stage).focus({ preventScroll: true });
    this.returnFocus = null;
  }
  openLog() {
    if (!this.theme) return;
    const host = this.popup('log', '对白记录'); this.modalView = new NativeView(host, this.theme.views.log, this.theme, this.asset);
    this.modalView.bind('circleClose', '关闭对白记录', () => this.closeModal()).focus();
    const list = this.modalView.get('messageLayer'); list.classList.add('flower-log-list');
    for (let cursor = 0; cursor <= this.cursor; cursor++) {
      const line = this.story.commands[this.indices[cursor]], row = node('div', 'flower-log-line');
      const content = this.button('', () => { this.closeModal(); this.seek(cursor, true); }); content.classList.add('flower-log-jump');
      content.setAttribute('aria-label', '回到第 ' + (cursor + 1) + ' 句');
      content.append(node('strong', '', clean(line.args[0])), node('span', '', clean(line.args[1]))); row.append(content);
      const file = this.story.voices?.[line.args[2]];
      if (file) row.append(this.button('重听', () => this.replayVoice(file, this.logVoice)));
      list.append(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  openSettings() {
    if (!this.theme) return;
    const host = this.popup('settings', '播放设置'); this.savedConfig = { ...this.config };
    this.modalView = new NativeView(host, this.theme.views.settings, this.theme, this.asset); this.modalView.get('title').textContent = '播放设置';
    this.modalView.bind('circleCloseButton', '取消设置', () => this.closeModal(false)).focus();
    this.modalView.bind('closeButton', '保存设置并关闭', () => this.closeModal(true));
    const form = node('div', 'flower-settings'); host.append(form);
    const label = (title: string, input: HTMLElement) => { const row = node('label', 'flower-setting'); row.append(node('span', '', title), input); form.append(row); };
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const [key, title, choices] of [['speed', '文字速度', ['普通', '快速', '很快', '立即显示']], ['window', '对白窗口', ['normal', 'black', 'white']]] as const) {
      const input = node('select'); input.setAttribute('aria-label', title);
      choices.forEach((value, index) => { const option = node('option', '', key === 'window' ? ['原色', '黑色', '白色'][index] : value); option.value = key === 'speed' ? String(index) : value; input.append(option); });
      input.value = String(this.config[key]); input.addEventListener('change', () => { (this.config as any)[key] = key === 'speed' ? Number(input.value) : input.value; this.applyOptions(); if (this.typing && key === 'speed') this.typeText(); });
      label(title, input); inputs.set(key, input);
    }
    for (const [key, title] of [['opacity', '窗口不透明度'], ['master', '总音量'], ['voice', '剧情语音'], ['music', '背景音乐'], ['sound', '音效']]) {
      const group = node('div', 'flower-setting-range'), input = node('input'), output = node('output', '', this.config[key] + '%');
      input.type = 'range'; input.min = '0'; input.max = '100'; input.value = String(this.config[key]); input.setAttribute('aria-label', title);
      input.addEventListener('input', () => { this.config[key] = Number(input.value); output.value = input.value + '%'; this.applyOptions(); });
      group.append(input, output); label(title, group); inputs.set(key, input);
    }
    const mute = node('input'); mute.type = 'checkbox'; mute.checked = this.config.mute; mute.setAttribute('aria-label', '全部静音');
    mute.addEventListener('change', () => { this.config.mute = mute.checked; this.applyOptions(); }); label('全部静音', mute);
    form.append(this.button('恢复默认', () => {
      this.config = defaults(); this.applyOptions(); for (const [key, input] of inputs) { input.value = String(this.config[key]); const output = input.parentElement.querySelector('output'); if (output) output.value = input.value + '%'; } mute.checked = this.config.mute;
    }));
  }
  openSkip() {
    if (!this.theme) return;
    const host = this.popup('skip', '跳过本章'), box = node('div', 'flower-skip-box');
    box.append(node('h3', '', '跳过本章剧情？'), node('p', '', '将前往本章最后一句。'),
      this.button('继续阅读', () => this.closeModal()), this.button('跳过本章', () => { this.closeModal(); this.seek(this.indices.length - 1, true); })); host.append(box); box.querySelector('button').focus();
  }
  onKey(event: KeyboardEvent) {
    if (this.modal) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeModal(false); }
      if (event.key === 'Tab') {
        const buttons = [...this.modal.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')].filter(item => !item.closest('[hidden]'));
        const first = buttons[0], last = buttons.at(-1);
        if (buttons.length && (!this.modal.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      }
      return;
    }
    if (event.key === 'Escape' && this.hiddenUi) { event.preventDefault(); event.stopPropagation(); this.toggleUi(false); return; }
    if ((event.target as Element).closest('button,input,select,textarea,a')) return;
    if (event.code === 'Space' || event.key === 'Enter' || event.key === 'ArrowRight') { event.preventDefault(); if (this.hiddenUi) this.toggleUi(false); else this.advance(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.seek(this.cursor - 1, true); }
    if (event.key.toLowerCase() === 'h') this.toggleUi(!this.hiddenUi);
  }
  fail(error) {
    if (this.destroyed) return;
    this.loading = false; this.setAuto(false); this.setFast(false); window.clearInterval(this.typeTimer);
    this.error.textContent = error.message; this.error.hidden = false; this.position.textContent = '剧情读取失败';
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.generation++; this.toolbar.destroy(); this.events.abort(); this.observer.disconnect();
    window.clearInterval(this.playbackTimer); window.clearInterval(this.typeTimer); this.closeModal(false);
    this.director?.destroy(); this.director = null; for (const audio of this.audio()) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    for (const view of this.views) view.destroy(); this.views = []; this.story = null; this.container.replaceChildren();
  }
}
