export const element = (tag: string, name = '', text = '') => { const node = document.createElement(tag); node.className = name; node.textContent = text; return node; };
export const DEFAULT_SETTINGS = { bgm: 20, se: 60, voice: 70, bgVoice: 50, special: 50, bgVoiceDuck: true,
  stopVoice: true, stopHiddenAuto: true, voiceFirst: true, autoSpeed: 50, textSpeed: 50, opacity: 50 };
export function readSettings(value: string) {
  let input; try { input = JSON.parse(value || '{}'); } catch {}
  // Old saves inherited the overlapping-voice default. Migrate it once;
  // versioned saves preserve any later explicit choice in native settings.
  if (input?.version !== 2) input = { ...input, bgVoiceDuck: true };
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [key, typeof fallback === 'boolean'
    ? typeof input?.[key] === 'boolean' ? input[key] : fallback : Number.isFinite(input?.[key]) ? Math.max(0, Math.min(100, input[key])) : fallback])) as typeof DEFAULT_SETTINGS;
}
export class NativeUi {
  root = element('div', 'twinkle-native-ui');
  dialogue = element('div', 'twinkle-dialogue');
  backdrop = element('div', 'twinkle-dialogue-bg');
  speaker = element('strong', 'twinkle-speaker');
  text = element('p', 'twinkle-text');
  next = element('span', 'twinkle-next');
  choices = element('div', 'twinkle-choices');
  controls = element('div', 'twinkle-native-controls');
  menu = element('div', 'twinkle-menu');
  overlay = element('div', 'twinkle-overlay');
  buttons: Record<string, HTMLButtonElement> = {};
  theme: any;
  abort = new AbortController();
  settings = readSettings(null);
  closeAction: () => void;
  previewTimer: any;
  previousFocus: HTMLElement;
  constructor(public canvas: HTMLElement, public options: any, public actions: any) {
    try { this.settings = readSettings(localStorage.getItem('twinkle-story-settings')); } catch {}
    this.paint(this.backdrop, 'message'); this.paint(this.speaker, 'name'); this.paint(this.next, 'next');
    const decoration = element('div', 'twinkle-message-decoration'); this.paint(decoration, 'messageAdd'); this.backdrop.append(decoration);
    this.speaker.hidden = true; this.dialogue.append(this.backdrop, this.speaker, this.text, this.next);
    this.menu.hidden = true; const menuBg = element('div', 'twinkle-menu-backdrop'); this.paint(menuBg, 'menuBg', true); this.menu.append(menuBg);
    const make = (key: string, label: string, y: number, action, parent = this.controls) => {
      const b = this.button(label, action, key); b.classList.add('twinkle-icon-button', 'twinkle-' + key); b.style.top = y + 'px';
      b.dataset.icon = 'true'; this.buttons[key] = b; parent.append(b); return b;
    };
    make('auto', '自动播放', 599, actions.auto).setAttribute('aria-pressed', 'false');
    make('speed', '快进', 509, actions.speed).setAttribute('aria-pressed', 'false');
    make('menu', '展开菜单', 434, () => {
      this.menu.hidden = !this.menu.hidden; const b = this.buttons.menu, label = this.menu.hidden ? '展开菜单' : '收起菜单';
      b.title = label; b.setAttribute('aria-label', label); b.setAttribute('aria-expanded', String(!this.menu.hidden)); this.paint(b, this.menu.hidden ? 'menu' : 'menuOn');
    }).setAttribute('aria-expanded', 'false');
    make('log', '对白记录', 64, actions.log, this.menu);
    make('skip', '跳过本章', 155, () => this.confirm('跳过本章剩余内容？', '跳过', actions.skip), this.menu);
    make('hide', '隐藏界面', 246, actions.hide, this.menu);
    make('settings', '设置', 335, () => this.showSettings(), this.menu);
    this.controls.append(this.menu); this.overlay.hidden = true;
    this.overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
      if (event.key === 'Tab') {
        const focusable = [...this.overlay.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])')].filter(n => !n.closest('[hidden]'));
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    this.root.append(this.dialogue, this.controls, this.choices, this.overlay); canvas.append(this.root);
  }
  button(label: string, action, sprite = 'button') {
    const b = element('button', 'twinkle-ui-button', label) as HTMLButtonElement;
    b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.addEventListener('click', action); this.paint(b, sprite, true); return b;
  }
  paint(node: HTMLElement, key: string, slice = false) {
    node.dataset.sprite = key; node.dataset.slice = String(slice);
    const s = this.theme?.sprites?.[key]; if (!s) return;
    const url = `url("${this.options.asset(s.file)}")`;
    node.style.backgroundImage = ''; node.style.borderImageSource = ''; node.style.borderWidth = '';
    if (slice && s.border?.some(n => n > 0)) {
      node.style.borderStyle = 'solid'; node.style.borderColor = 'transparent';
      node.style.borderWidth = '0px';
      node.style.borderImageSource = url; node.style.borderImageSlice = s.border.join(' ') + ' fill'; node.style.borderImageWidth = s.border.map(n => n + 'px').join(' ');
    } else node.style.backgroundImage = url;
    node.classList.add('has-sprite');
  }
  async load() {
    const file = this.options.library?.storyUi?.file; if (!file) return;
    const response = await fetch(this.options.asset(file), { signal: this.abort.signal });
    if (!response.ok) throw new Error('原版剧情界面读取失败，请重新下载剧情资源。');
    const theme = await response.json(); if (this.abort.signal.aborted) return;
    if (!theme.sprites?.message || !theme.sprites?.modal) throw new Error('原版剧情界面不完整，请重新下载剧情资源。');
    this.theme = theme;
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-sprite]')) this.paint(node, node.dataset.sprite, node.dataset.slice === 'true');
    if (theme.sprites.slider) this.root.style.setProperty('--twinkle-slider', `url("${this.options.asset(theme.sprites.slider.file)}")`);
  }
  pressed(key: string, value: boolean) { this.buttons[key]?.setAttribute('aria-pressed', String(value)); if (this.buttons[key]) this.paint(this.buttons[key], value ? key + 'On' : key); }
  opacity(value: number) { this.backdrop.style.opacity = String(value / 100); }
  panel(title: string, className = '') {
    this.close(); this.previousFocus = document.activeElement as HTMLElement; this.actions.modal?.(true);
    this.overlay.hidden = false; this.overlay.replaceChildren();
    const panel = element('section', 'twinkle-modal ' + className); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title); this.paint(panel, 'modal', true);
    const heading = element('h2', 'twinkle-modal-title', title), close = this.button('关闭', () => this.close(), 'close'); close.classList.add('twinkle-modal-close'); close.dataset.icon = 'true';
    panel.append(heading, close); this.overlay.append(panel); close.focus(); return panel;
  }
  close() {
    if (this.overlay.hidden) return;
    clearTimeout(this.previewTimer); const cancel = this.closeAction; this.closeAction = null; cancel?.();
    this.overlay.hidden = true; this.overlay.replaceChildren(); this.previousFocus?.focus(); this.actions.modal?.(false);
  }
  confirm(text: string, label: string, action) {
    const panel = this.panel('确认', 'twinkle-confirm'); panel.append(element('p', '', text));
    const footer = element('div', 'twinkle-modal-footer'); footer.append(this.button('取消', () => this.close()), this.button(label, () => { this.close(); action(); }, 'confirm')); panel.append(footer);
  }
  showLog(lines: any[]) {
    const panel = this.panel('对白记录', 'twinkle-log'); this.paint(panel, 'window', true); const content = element('div', 'twinkle-log-scroll');
    for (const row of lines) {
      const item = element('article', 'twinkle-log-row'); this.paint(item, 'logRow', true);
      item.append(element('strong', '', row.speaker || ''), element('p', '', row.text));
      if (row.voice) { const play = this.button('重播语音', () => this.actions.voice(row.voice), 'voice'); play.classList.add('twinkle-log-voice'); play.dataset.icon = 'true'; item.append(play); }
      const jump = this.button('回到此句', () => { this.close(); this.actions.restore(row.length); }); jump.classList.add('twinkle-log-jump'); item.append(jump); content.append(item);
    }
    if (!lines.length) content.append(element('p', '', '暂无对白记录。'));
    panel.append(content); content.scrollTop = content.scrollHeight;
  }
  showSettings() {
    const panel = this.panel('设置', 'twinkle-settings'); let draft = { ...this.settings }; const updates: (() => void)[] = [];
    const tabs = element('div', 'twinkle-settings-tabs'), content = element('div', 'twinkle-settings-scroll'); this.paint(content, 'panel', true);
    const sound = element('div'), text = element('div'); text.hidden = true;
    const tab = (label, left, view) => this.button(label, () => {
      sound.hidden = view !== sound; text.hidden = view !== text; content.scrollTop = 0;
      this.paint(soundTab, view === sound ? 'tabLeftOn' : 'tabLeft', true); this.paint(textTab, view === text ? 'tabRightOn' : 'tabRight', true);
      soundTab.setAttribute('aria-selected', String(view === sound)); textTab.setAttribute('aria-selected', String(view === text));
    }, left ? 'tabLeftOn' : 'tabRight');
    const soundTab = tab('声音', true, sound), textTab = tab('文字', false, text); tabs.setAttribute('role', 'tablist');
    for (const b of [soundTab, textTab]) b.setAttribute('role', 'tab'); soundTab.setAttribute('aria-selected', 'true'); textTab.setAttribute('aria-selected', 'false'); tabs.append(soundTab, textTab);
    const refresh = () => { this.actions.settings(draft); this.opacity(draft.opacity); };
    const row = (parent, label, help = '') => {
      const block = element('section', 'twinkle-setting-row'), heading = element('h3', '', label);
      if (help) { const button = this.button('说明：' + label, () => { hint.hidden = !hint.hidden; }, 'help'); button.dataset.icon = 'true'; heading.append(button); }
      const hint = element('p', 'twinkle-setting-help', help); hint.hidden = true; block.append(heading, hint); parent.append(block); return block;
    };
    const range = (parent, key, label, volume = false, low = '小', high = '大') => {
      const block = row(parent, label), line = element('div', 'twinkle-setting-range'), input = document.createElement('input'), value = element('output');
      const waitLabel = key === 'autoSpeed' ? element('span', 'twinkle-auto-delay') : null;
      if (waitLabel) block.querySelector('h3').append(waitLabel);
      const showWait = () => { if (waitLabel) waitLabel.textContent = '等待时间 ' + (Math.max(100, 4000 * (1 - draft.autoSpeed / 100)) / 1000).toFixed(2) + ' 秒'; }; showWait();
      input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1'; input.value = String(draft[key]); input.setAttribute('aria-label', label);
      const displayValue = () => { value.textContent = input.value; value.style.left = input.value + '%'; input.style.setProperty('--fill', input.value + '%'); };
      const update = () => { draft[key] = Number(input.value); displayValue(); showWait(); refresh(); if (key === 'textSpeed' || key === 'opacity') preview(); };
      input.addEventListener('input', update); displayValue();
      updates.push(() => { input.value = String(draft[key]); displayValue(); showWait(); });
      if (volume) {
        let beforeMute = draft[key] || DEFAULT_SETTINGS[key]; const mute = this.button(label + '静音', () => {
          if (Number(input.value)) { beforeMute = Number(input.value); input.value = '0'; } else input.value = String(beforeMute);
          this.paint(mute, Number(input.value) ? 'sound' : 'soundOff'); update();
        }, Number(input.value) ? 'sound' : 'soundOff'); mute.dataset.icon = 'true'; line.append(mute);
      }
      const change = (delta, sprite, caption) => {
        const wrap = element('span', 'twinkle-range-end'), b = this.button((delta < 0 ? '减小' : '增大') + label, () => { input.value = String(Math.max(0, Math.min(100, Number(input.value) + delta))); update(); }, sprite);
        b.dataset.icon = 'true'; wrap.append(b, element('span', '', caption)); return wrap;
      };
      const slider = element('span', 'twinkle-range-track'); slider.append(input, value); line.append(change(-5, 'minus', low), slider, change(5, 'plus', high)); block.append(line);
    };
    const toggle = (parent, key, label, yes = '开启', no = '关闭', help = '') => {
      const block = row(parent, label, help), choices = element('div', 'twinkle-setting-options');
      for (const [value, caption] of [[true, yes], [false, no]]) {
        const b = this.button(String(caption), () => { draft[key] = value; for (const button of choices.querySelectorAll<HTMLElement>('button')) { const on = button === b; button.setAttribute('aria-pressed', String(on)); this.paint(button, on ? 'selected' : 'button', true); } refresh(); }, draft[key] === value ? 'selected' : 'button'); b.setAttribute('aria-pressed', String(draft[key] === value)); choices.append(b);
        updates.push(() => { const on = draft[key] === value; b.setAttribute('aria-pressed', String(on)); this.paint(b, on ? 'selected' : 'button', true); });
      }
      block.append(choices);
    };
    range(sound, 'bgm', '背景音乐', true); range(sound, 'se', '音效', true); range(sound, 'voice', '角色语音', true); range(sound, 'bgVoice', '背景语音', true);
    toggle(sound, 'bgVoiceDuck', '背景语音自动静音', '开启', '关闭', '播放角色对白语音时静音背景语音；对白语音结束或当前没有语音时恢复。');
    range(sound, 'special', '特殊场景音效', true);
    toggle(sound, 'stopVoice', '切换对白时的语音', '停止', '继续', '手动切换到下一句时，是否停止上一句的语音。');
    toggle(sound, 'stopHiddenAuto', '隐藏对白窗口时的自动播放', '暂停', '继续', '隐藏界面时暂停自动推进，再次显示界面后继续。');
    toggle(text, 'voiceFirst', '自动播放模式', '语音优先', '文字优先', '语音优先会等待本句语音播放完成，再按自动播放速度推进。');
    range(text, 'autoSpeed', '自动播放速度', false, '慢', '快'); range(text, 'textSpeed', '文字显示速度', false, '慢', '快'); range(text, 'opacity', '对白窗口不透明度', false, '0%', '100%');
    const sample = element('div', 'twinkle-text-sample'), sampleBackground = element('span', 'twinkle-sample-bg'), sampleText = element('p');
    this.paint(sampleBackground, 'message'); sample.append(sampleBackground, sampleText); text.append(sample);
    const preview = () => {
      clearTimeout(this.previewTimer); const message = '这里是文字显示速度的示例。\n闪耀☆星骑士'; let i = 0;
      const tick = () => { sampleText.textContent = message.slice(0, ++i); sampleBackground.style.opacity = String(draft.opacity / 100); if (i < message.length) this.previewTimer = setTimeout(tick, Math.max(0, 60 - draft.textSpeed * .6)); }; tick();
    }; preview();
    const defaults = this.button('恢复默认设置', () => { draft = { ...DEFAULT_SETTINGS }; for (const update of updates) update(); refresh(); preview(); });
    const textDefaults = this.button('恢复默认设置', () => defaults.click());
    for (const button of [defaults, textDefaults]) button.classList.add('twinkle-defaults');
    sound.append(defaults); text.append(textDefaults);
    const original = { ...this.settings }; this.closeAction = () => { this.settings = original; this.actions.settings(original); this.opacity(original.opacity); };
    const footer = element('div', 'twinkle-modal-footer'); footer.append(this.button('取消', () => this.close()), this.button('确定', () => {
      this.settings = { ...draft }; try { localStorage.setItem('twinkle-story-settings', JSON.stringify({ version: 2, ...this.settings })); } catch {}
      this.closeAction = null; this.close(); this.actions.settings(this.settings);
    }, 'confirm'));
    content.append(sound, text); panel.append(tabs, content, footer);
  }
  destroy() { this.abort.abort(); clearTimeout(this.previewTimer); this.closeAction = null; this.root.remove(); }
}
