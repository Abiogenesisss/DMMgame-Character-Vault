const el = (tag, cls = '', text = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };
const safeFile = file => typeof file === 'string' && /^story-ui\/minashigo\/(?:theme\.json|[a-f0-9]{64}\.(png|ttf))$/.test(file);
const clean = value => String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/\\n/g, '\n');
export class MinashigoStoryUi {
  host = el('div', 'minashigo-native-ui'); popup; popupName; priorFocus; draft; stateImages = []; cursorImages = []; buttons: Record<string, HTMLButtonElement> = {}; font;
  constructor(public player: any, public data: any) {
    if (data?.version !== 1 || data.width !== 1280 || data.height !== 720 || !data.views?.normal || !data.views?.adult) throw new Error('播放器界面文件无效。');
    const view = data.views[player.story.adult && !player.audioOnly ? 'adult' : 'normal'];
    player.stage.append(this.host); this.draw(view, this.host);
    const body = view.fields.body, name = view.fields.name;
    player.dialogue.className = 'minashigo-native-dialogue'; player.dialogue.replaceChildren(player.speaker, player.text); this.host.append(player.dialogue);
    this.place(player.text, body); this.place(player.speaker, name);
    for (const [key, label, action] of [
      ['auto', '自动播放', () => player.toggleAuto()], ['fastForward', '快进', () => player.toggleFast()],
      ['log', '剧情日志', () => this.open('log')], ['hideUi', '隐藏界面', () => player.toggleUi()],
      ['config', '设置', () => this.open('settings')], ['skip', '跳过剧情', () => this.open('skip')], ['next', '下一句', () => player.advance()]
    ] as any[]) this.buttons[key] = this.button(this.host, view.controls[key], label, action);
    if (safeFile(data.font?.file) && typeof FontFace !== 'undefined' && document.fonts) {
      this.font = new FontFace('MinashigoStory', 'url("' + player.options.asset(data.font.file) + '")');
      this.font.load().then(font => { if (!player.destroyed) document.fonts.add(font); }).catch(() => {});
    }
    this.host.addEventListener('click', event => event.stopPropagation());
    this.host.addEventListener('keydown', event => { if ([' ', 'ArrowLeft', 'ArrowRight'].includes(event.key) && event.target instanceof HTMLButtonElement) event.stopPropagation(); });
    this.update();
  }
  place(node, rect, offsetX = 0, offsetY = 0) {
    if (!rect || [rect.x, rect.y, rect.w, rect.h].some(value => !Number.isFinite(value))) throw new Error('播放器控件位置无效。');
    Object.assign(node.style, { left: (rect.x + offsetX) / 12.8 + '%', top: (rect.y + offsetY) / 7.2 + '%', width: rect.w / 12.8 + '%', height: rect.h / 7.2 + '%' });
    if (rect.fontSize) { node.style.fontSize = rect.fontSize / 12.8 + 'cqw'; node.style.lineHeight = String((rect.lineHeight || rect.fontSize * 1.3) / rect.fontSize); node.style.color = rect.color || ''; node.style.textAlign = rect.align || 'left'; }
  }
  draw(view, host, offsetX = 0, offsetY = 0) {
    const drawn = [];
    for (const row of view.rows || []) {
      if (row.button || !row.sprite && !row.text || /RICHTEXT_CHILD/.test(row.id)) continue;
      const node = el('span', 'minashigo-native-part', clean(row.text)); node.dataset.nativePart = row.id;
      this.place(node, row, offsetX, offsetY);
      if (row.sprite) {
        const file = row.sprite.file; if (!safeFile(file)) throw new Error('播放器图片路径无效。');
        const url = 'url("' + this.player.options.asset(file) + '")';
        const [left, top, right, bottom] = row.sprite.insets || [0, 0, 0, 0];
        if (row.sliced && left + top + right + bottom) {
          node.style.borderStyle = 'solid'; node.style.borderImageSource = url; node.style.borderImageSlice = [top, right, bottom, left].join(' ') + ' fill';
          node.style.borderWidth = [top, right, bottom, left].map(n => n / 12.8 + 'cqw').join(' ');
        } else { node.style.backgroundImage = url; node.style.backgroundSize = '100% 100%'; }
      }
      if (/\/AutoPlayButton\/(Off|On)$/.test(row.id)) this.stateImages.push({ node, type: 'auto', on: row.id.endsWith('/On') });
      if (/\/FastForward\/(Off|On)$/.test(row.id)) this.stateImages.push({ node, type: 'fast', on: row.id.endsWith('/On') });
      if (/adv_cursor_under$/.test(row.id)) { this.cursorImages.push(node); node.classList.add('minashigo-next-cursor'); }
      host.append(node); drawn.push({ node, row });
    }
    return drawn;
  }
  button(host, rect, label, action, offsetX = 0, offsetY = 0) {
    if (!rect) return null;
    const button = el('button', 'minashigo-native-button'); button.type = 'button'; button.setAttribute('aria-label', label); button.title = label;
    this.place(button, rect, offsetX, offsetY); button.addEventListener('click', event => { event.stopPropagation(); action(); }); host.append(button); return button;
  }
  update() {
    const p = this.player; this.host.hidden = p.uiHidden;
    for (const { node, type, on } of this.stateImages) node.hidden = (type === 'auto' ? p.audioOnly ? !p.voice.paused : p.auto : p.fast) !== on;
    for (const node of this.cursorImages) node.hidden = p.audioOnly || p.typing || p.cursor >= (p.story.lines?.length || 0) - 1;
    this.buttons.auto?.setAttribute('aria-pressed', String(p.audioOnly ? !p.voice.paused : p.auto)); this.buttons.fastForward?.setAttribute('aria-pressed', String(p.fast));
    if (this.buttons.next) this.buttons.next.disabled = p.audioOnly || !p.typing && p.cursor >= p.story.lines.length - 1;
  }
  open(name) {
    if (this.popup || !this.data.views[name]) return;
    const p = this.player, view = this.data.views[name], x = (1280 - view.width) / 2, y = (720 - view.height) / 2;
    this.priorFocus = document.activeElement; this.popupName = name; p.finishText(); p.pauseFlow();
    const host = this.popup = el('div', 'minashigo-native-popup'); host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true'); host.setAttribute('aria-label', { log: '剧情日志', settings: '设置', skip: '跳过剧情' }[name]);
    const drawn = this.draw(view, host, x, y); p.stage.append(host);
    host.addEventListener('click', event => event.stopPropagation());
    host.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.key === 'Tab') { const focusable = [...host.querySelectorAll('button:not(:disabled),input')] as HTMLElement[]; const i = focusable.indexOf(document.activeElement as HTMLElement); if (focusable.length) { event.preventDefault(); focusable[(i + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus(); } }
    });
    const close = this.button(host, view.controls.CloseButton, '关闭', () => this.close(), x, y);
    if (name === 'log') {
      const rows = el('div', 'minashigo-log-lines'); rows.tabIndex = 0; rows.setAttribute('aria-label', '已读对白');
      // The original log viewport is centered inside its ornamental paper frame.
      const bounds = view.rows.find(row => /Base_InnerShadowTrasparent$/.test(row.id)) || { x: 86, y: 25, w: view.width - 172, h: view.height - 50 };
      this.place(rows, bounds, x, y);
      for (const [index, line] of p.history().entries()) {
        const row = el('div', 'minashigo-log-line'), content = el(p.audioOnly ? 'div' : 'button', 'minashigo-log-content'), voice = line.voice && p.file(line.voice);
        if (!p.audioOnly) {
          content.type = 'button'; content.classList.add('minashigo-log-jump'); content.title = '回到第 ' + (index + 1) + ' 句对白';
          content.addEventListener('click', event => {
            // Dragging to copy log text must not activate the jump button.
            const selection = window.getSelection();
            if (event.detail > 0 && selection?.rangeCount && !selection.isCollapsed && selection.getRangeAt(0).intersectsNode(content)) return;
            this.close(); p.seek(index);
          });
        }
        if (voice) {
          const button = el('button', 'minashigo-log-replay'); button.type = 'button'; button.title = '重听第 ' + (index + 1) + ' 段语音'; button.setAttribute('aria-label', button.title);
          button.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="currentColor" d="M24 1 47 24 24 47 1 24Z"/><path fill="none" stroke="#f7ead5" stroke-width="1" d="M24 5 43 24 24 43 5 24Z"/><path fill="#fff6e8" d="M13 20h6l8-7v22l-8-7h-6Z"/><path fill="none" stroke="#fff6e8" stroke-width="2" stroke-linecap="round" d="M31 19a7 7 0 0 1 0 10m3-14a12 12 0 0 1 0 18"/></svg>';
          button.addEventListener('click', () => p.playVoice(line.voice)); row.append(button);
        }
        if (line.speaker) content.append(el('strong', '', clean(line.speaker))); content.append(el('span', 'minashigo-log-text', clean(line.text))); row.append(content); rows.append(row);
      }
      host.append(rows); rows.scrollTop = rows.scrollHeight;
    }
    if (name === 'settings') {
      this.draft = { ...p.levels };
      for (const [key, label] of [['bgm', 'BGM 音量'], ['voice', '语音音量'], ['se', '音效音量']]) {
        const rect = view.fields[key], input = el('input', 'minashigo-volume-slider'); input.type = 'range'; input.min = '0'; input.max = '100'; input.value = String(Math.round(this.draft[key] * 100)); input.setAttribute('aria-label', label);
        const fieldRoot = rect.path.split('/Volume/')[0];
        const knob = drawn.find(({ row }) => row.id.startsWith(fieldRoot) && /\/Btn_SquareGrade5$/.test(row.id));
        if (knob?.row.sprite) { input.style.setProperty('--slider-thumb', 'url("' + p.options.asset(knob.row.sprite.file) + '")'); knob.node.hidden = true; }
        this.place(input, { ...rect, y: rect.y - 12.5, h: 35 }, x, y);
        const refresh = () => {
          this.draft[key] = Number(input.value) / 100; p.applyLevels(this.draft);
          const bar = drawn.find(({ row }) => row.id === rect.path.replace(/\/[^/]+$/, ''));
          if (bar) bar.node.style.width = rect.w * this.draft[key] / 12.8 + '%';
        };
        input.addEventListener('input', refresh); host.append(input); refresh();
      }
      this.button(host, view.controls.DecisionButton, '保存设置', () => this.close(true), x, y);
      this.button(host, view.controls.CancelButton, '取消设置', () => this.close(), x, y);
    }
    if (name === 'skip') {
      for (const { node, row } of drawn) if (/StoryNameLabel$/.test(row.id)) node.textContent = clean(p.story.title);
      this.button(host, view.controls.DecisionButton, '确认跳过', () => { this.close(); p.skip(); }, x, y);
      this.button(host, view.controls.CancelButton, '取消跳过', () => this.close(), x, y);
    }
    close?.focus();
  }
  close(save = false) {
    if (!this.popup) return;
    if (this.popupName === 'settings') { if (save) this.player.saveLevels(this.draft); else this.player.applyLevels(this.player.levels); }
    this.popup.remove(); this.popup = null; this.popupName = null; this.draft = null;
    if (this.priorFocus?.isConnected) this.priorFocus.focus(); this.priorFocus = null; this.player.schedule();
  }
  destroy() { this.popup?.remove(); this.host.remove(); if (this.font && document.fonts) document.fonts.delete(this.font); }
}
