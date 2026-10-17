import { MinashigoStoryUi } from './story-ui.ts';
import { StoryControls } from '../../../app/viewer/story-controls.ts';
const node = (tag, className = '', text = '') => { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; };
const clean = text => String(text || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/\\n/g, '\n');
export class MinashigoStoryPlayer {
  story; cursor = 0; destroyed = false; auto = false; fast = false; uiHidden = false; typing = false; audioOnly = false; timer; typeTimer; ui; musicFile = null; voiceFile = null;
  levels = { bgm: .5, voice: .5, se: .5 };
  voice = new Audio(); music = new Audio(); sound = new Audio(); events = new AbortController();
  stage = node('div', 'minashigo-story-stage'); background = node('img', 'minashigo-story-background'); actors = node('div', 'minashigo-story-actors');
  dialogue = node('div', 'dialogue'); speaker = node('strong'); text = node('p'); position = node('span', 'minashigo-position');
  previous: HTMLButtonElement; next: HTMLButtonElement; toolbar: StoryControls; controls: HTMLElement;
  extras = node('div', 'minashigo-story-extras');
  constructor(public container: HTMLElement, public options: any) {
    container.className = 'minashigo-reader'; this.background.alt = '剧情背景'; this.background.hidden = true;
    this.stage.tabIndex = 0; this.stage.setAttribute('aria-label', '剧情画面，点击或按空格继续');
    this.stage.append(this.background, this.actors); this.dialogue.append(this.speaker, this.text); this.stage.append(this.dialogue);
    this.toolbar = new StoryControls(container, { previous: () => this.move(-1), next: () => this.advance(), restart: () => this.restart() }, { className: 'reader-controls', position: this.position, onError: options.onError });
    this.controls = this.toolbar.element; this.previous = this.toolbar.previous; this.next = this.toolbar.next;
    container.replaceChildren(this.stage, this.extras, this.controls); this.stage.addEventListener('click', () => this.advance());
    this.stage.addEventListener('keydown', event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (['ArrowRight', ' ', 'ArrowLeft', 'h', 'H'].includes(event.key)) { event.preventDefault(); if (event.key.toLowerCase() === 'h') this.toggleUi(); else if (event.key === 'ArrowLeft') this.move(-1); else this.advance(); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.pauseFlow(); for (const audio of [this.voice, this.music, this.sound]) audio.pause(); }
      else this.schedule();
    }, { signal: this.events.signal });
    for (const type of ['play', 'pause', 'ended']) this.voice.addEventListener(type, () => this.ui?.update(), { signal: this.events.signal });
    this.music.loop = true;
    try { const levels = JSON.parse(localStorage.getItem('minashigo-story-sound-v1')); for (const key of Object.keys(this.levels)) if (Number.isFinite(levels?.[key]) && levels[key] >= 0 && levels[key] <= 1) this.levels[key] = levels[key]; } catch {}
    this.applyLevels(this.levels);
  }
  async load(story) {
    this.audioOnly = story?.kind === 'audio';
    if (!story?.resources || !this.audioOnly && (!Array.isArray(story.lines) || !story.lines.length)) throw new Error('剧情文件格式无效。');
    this.story = story;
    if (this.audioOnly) {
      const file = this.file(story.audio); if (!file) throw new Error('日记语音文件无效。');
      this.voice.controls = true; this.voice.preload = 'metadata'; this.voice.src = file; this.voiceFile = file;
      this.voice.setAttribute('aria-label', clean(story.title) || '日记语音'); this.voice.className = 'minashigo-diary-audio'; this.extras.append(this.voice);
      this.voice.addEventListener('loadedmetadata', () => { let saved; try { saved = Number(localStorage.getItem(this.options.positionKey + '-audio')); } catch {} if (Number.isFinite(saved) && saved > 0 && saved < this.voice.duration) this.voice.currentTime = saved; }, { once: true, signal: this.events.signal });
      this.voice.addEventListener('timeupdate', () => { try { localStorage.setItem(this.options.positionKey + '-audio', String(this.voice.currentTime)); } catch {} }, { signal: this.events.signal });
    } else {
      let saved; try { saved = Number(localStorage.getItem(this.options.positionKey)); } catch {}
      this.cursor = Number.isSafeInteger(saved) && saved >= 0 && saved < story.lines.length ? saved : 0;
    }
    let theme = this.options.theme;
    if (!theme && this.options.library.storyUi?.file) {
      const file = this.options.library.storyUi.file;
      if (!/^story-ui\/minashigo\/theme\.json$/.test(file)) throw new Error('播放器界面路径无效。');
      const response = await fetch(this.options.asset(file)); if (!response.ok) throw new Error('播放器界面读取失败，请重新下载播放器 UI。'); theme = await response.json();
    }
    if (this.destroyed) return;
    if (theme) this.ui = new MinashigoStoryUi(this, theme);
    this.show();
    if (this.audioOnly) this.voice.play().catch(() => {});
  }
  file(reference) { const file = this.story.resources[reference]; return typeof file === 'string' && !file.split(/[\\/]/).includes('..') && !/^(?:[a-z]+:|\/)/i.test(file) ? this.options.asset(file) : null; }
  currentLine() { return this.audioOnly ? { speaker: this.options.characterName?.(this.story.character) || '', text: this.story.title, voice: this.story.audio, actors: {} } : this.story.lines[this.cursor]; }
  history() { return this.audioOnly ? [this.currentLine()] : this.story.lines.slice(0, this.cursor + 1); }
  advance() { if (this.ui?.popup) return; if (this.uiHidden) { this.toggleUi(); return; } if (this.typing) { this.finishText(); return; } this.move(1); }
  move(delta) {
    if (!this.story || this.destroyed || this.audioOnly || this.ui?.popup) return;
    const next = Math.max(0, Math.min(this.story.lines.length - 1, this.cursor + delta)); if (next !== this.cursor) { this.cursor = next; this.show(); }
  }
  seek(index) {
    if (!this.story || this.destroyed || this.audioOnly || !Number.isInteger(index) || index < 0 || index >= this.story.lines.length) return;
    this.auto = false; this.fast = false;
    this.cursor = index; this.show(); this.finishText(); this.stage.focus({ preventScroll: true });
  }
  restart() {
    if (!this.story || this.destroyed) return;
    this.auto = false; this.fast = false; this.ui?.close(); if (this.uiHidden) this.toggleUi();
    if (this.audioOnly) { this.voice.currentTime = 0; this.voice.playbackRate = 1; try { localStorage.setItem(this.options.positionKey + '-audio', '0'); } catch {} this.ui?.update(); return this.voice.play(); }
    this.seek(0);
  }
  show() {
    if (this.destroyed || !this.story) return;
    const line = this.currentLine(); this.pauseFlow(); clearTimeout(this.typeTimer);
    if (!this.audioOnly) { this.voice.pause(); this.sound.pause(); }
    this.speaker.textContent = clean(line.speaker); this.text.textContent = clean(line.text);
    this.position.textContent = this.audioOnly ? '语音短篇' : (this.cursor + 1) + ' / ' + this.story.lines.length;
    this.previous.disabled = this.audioOnly || this.cursor === 0; this.next.disabled = this.audioOnly || this.cursor === this.story.lines.length - 1;
    this.toolbar.restart.disabled = false;
    if (!this.audioOnly) try { localStorage.setItem(this.options.positionKey, String(this.cursor)); } catch {}
    this.stage.style.backgroundColor = line.color || '#000'; const background = line.background && this.file(line.background);
    this.background.hidden = !background; if (background) this.background.src = background; else this.background.removeAttribute('src');
    this.actors.replaceChildren(...Object.values<any>(line.actors || {}).map(actor => {
      const file = this.file(actor.resource); if (!file) return null;
      const image = node('img', 'minashigo-story-actor'); image.src = file; image.alt = '剧情画面';
      const original = this.options.library.images?.find(item => item.file === this.story.resources[actor.resource]), width = original?.width || 2048;
      image.style.width = width / 1280 * 100 + '%'; image.style.left = (50 + actor.x / 1280 * 100) + '%'; image.style.top = (50 - actor.y / 720 * 100) + '%';
      image.style.transform = 'translate(-50%,-50%) rotate(' + actor.rotation + 'deg) scale(' + actor.scaleX + ',' + actor.scaleY + ')'; image.style.opacity = String(actor.opacity ?? 1); return image;
    }).filter(Boolean));
    if (!this.audioOnly) {
      const music = line.music && this.file(line.music);
      if (music !== this.musicFile) { this.music.pause(); this.musicFile = music; if (music) { this.music.src = music; this.music.play().catch(() => {}); } else this.music.removeAttribute('src'); }
      this.voiceFile = line.voice && this.file(line.voice); if (this.voiceFile) this.playVoice(line.voice); else this.voice.removeAttribute('src');
      const sound = line.sound && this.file(line.sound); if (sound && !this.fast) { this.sound.src = sound; this.sound.play().catch(() => {}); }
    }
    const reduced = this.options.instantText || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.ui && !this.audioOnly && !this.fast && !reduced) {
      const characters = Array.from(clean(line.text)); let length = 0; this.typing = true; this.text.textContent = '';
      const tick = () => { if (this.destroyed) return; this.text.textContent = characters.slice(0, ++length).join(''); if (length < characters.length) this.typeTimer = setTimeout(tick, 30); else { this.typing = false; this.ui?.update(); this.schedule(); } }; tick();
    } else this.typing = false;
    this.ui?.update(); this.schedule();
  }
  finishText() { clearTimeout(this.typeTimer); this.typing = false; if (this.story) this.text.textContent = clean(this.currentLine().text); this.ui?.update(); this.schedule(); }
  playVoice(reference) { const file = this.file(reference); if (file) { this.voice.src = file; this.voice.playbackRate = this.audioOnly && this.fast ? 2 : 1; if (!this.fast || this.audioOnly) this.voice.play().catch(() => {}); } }
  toggleAuto() {
    if (this.audioOnly) { if (this.voice.paused) this.voice.play().catch(() => {}); else this.voice.pause(); }
    else { this.auto = !this.auto; this.fast = false; this.schedule(); }
    this.ui?.update();
  }
  toggleFast() { this.fast = !this.fast; if (this.audioOnly) this.voice.playbackRate = this.fast ? 2 : 1; else { this.auto = false; if (this.fast) { this.voice.pause(); this.sound.pause(); this.finishText(); } this.schedule(); } this.ui?.update(); }
  toggleUi() { this.uiHidden = !this.uiHidden; if (this.ui) this.ui.update(); else this.dialogue.hidden = this.uiHidden; this.stage.setAttribute('aria-label', this.uiHidden ? '剧情画面，点击恢复界面' : '剧情画面，点击或按空格继续'); }
  pauseFlow() { clearTimeout(this.timer); }
  schedule() {
    this.pauseFlow();
    if (this.audioOnly || !this.auto && !this.fast || this.typing || document.hidden || this.destroyed || this.ui?.popup || !this.story || this.cursor >= this.story.lines.length - 1) return;
    const advance = () => { if (!this.fast && this.voiceFile && !this.voice.ended && !this.voice.paused) this.timer = setTimeout(advance, 200); else this.move(1); };
    this.timer = setTimeout(advance, this.fast ? 120 : Math.max(1800, clean(this.currentLine().text).length * 65));
  }
  applyLevels(levels) { this.music.volume = levels.bgm; this.voice.volume = levels.voice; this.sound.volume = levels.se; }
  saveLevels(levels) { this.levels = { ...levels }; this.applyLevels(this.levels); try { localStorage.setItem('minashigo-story-sound-v1', JSON.stringify(this.levels)); } catch {} }
  skip() { if (!this.audioOnly) { this.cursor = this.story.lines.length - 1; this.show(); this.finishText(); } else this.voice.pause(); this.container.closest('dialog')?.close(); }
  fail(error) { this.pauseFlow(); this.ui?.destroy(); this.ui = null; this.text.textContent = error.message; this.text.setAttribute('role', 'alert'); this.dialogue.className = 'dialogue'; this.dialogue.replaceChildren(this.text); this.stage.append(this.dialogue); }
  destroy() { this.destroyed = true; this.pauseFlow(); clearTimeout(this.typeTimer); this.toolbar.destroy(); this.events.abort(); this.ui?.destroy(); for (const audio of [this.voice, this.music, this.sound]) { audio.pause(); audio.removeAttribute('src'); audio.load(); } this.story = null; this.container.replaceChildren(); }
}
