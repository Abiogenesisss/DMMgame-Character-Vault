type StoryAction = () => unknown;

// Games supply navigation; the shell supplies the common playback toolbar.
export class StoryControls {
  element = document.createElement('footer');
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  restart: HTMLButtonElement;
  fullscreen: HTMLButtonElement;
  close: HTMLButtonElement;
  events = new AbortController();
  wasFullscreen = false;
  guardTimer: ReturnType<typeof setTimeout>;
  guardCancel = false;

  constructor(public host: HTMLElement, actions: { previous: StoryAction; next: StoryAction; restart: StoryAction },
    { className = '', position, onError = () => {} }: { className?: string; position?: HTMLElement; onError?: (error: Error) => void } = {}) {
    this.element.className = 'story-controls ' + className;
    const button = (label: string, action: StoryAction) => {
      const item = document.createElement('button');
      item.type = 'button'; item.className = 'secondary-button'; item.textContent = label; item.setAttribute('aria-label', label);
      item.addEventListener('click', async event => {
        event.stopPropagation();
        try { await action(); } catch (error) { onError(error instanceof Error ? error : new Error(error?.message || String(error))); }
      }, { signal: this.events.signal });
      return item;
    };
    this.previous = button('上一句', actions.previous);
    this.next = button('下一句', actions.next);
    this.restart = button('从头播放', actions.restart);
    this.previous.disabled = this.next.disabled = this.restart.disabled = true;
    const navigation = document.createElement('div'); navigation.className = 'story-controls-navigation';
    navigation.append(this.previous, this.next, this.restart); this.element.append(navigation);
    if (position) { position.classList.add('story-controls-position'); position.setAttribute('aria-live', 'polite'); this.element.append(position); }
    const windowControls = document.createElement('div'); windowControls.className = 'story-controls-window';
    this.fullscreen = button('全屏', () => this.toggleFullscreen());
    this.fullscreen.disabled = typeof host.requestFullscreen !== 'function';
    this.fullscreen.title = '全屏（Esc 退出）';
    this.close = button('关闭', async () => { if (document.fullscreenElement === host) await document.exitFullscreen(); host.closest('dialog')?.close(); });
    windowControls.append(this.fullscreen, this.close); this.element.append(windowControls);
    document.addEventListener('fullscreenchange', () => {
      const active = document.fullscreenElement === host;
      // Some browsers send dialog cancel immediately after leaving fullscreen.
      if (this.wasFullscreen && !active) {
        this.guardCancel = true; clearTimeout(this.guardTimer);
        this.guardTimer = setTimeout(() => { this.guardCancel = false; }, 200);
      }
      this.wasFullscreen = active;
      this.fullscreen.textContent = active ? '退出全屏' : '全屏';
      this.fullscreen.setAttribute('aria-label', this.fullscreen.textContent);
      this.fullscreen.setAttribute('aria-pressed', String(active));
    }, { signal: this.events.signal });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || document.fullscreenElement !== host) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this.toggleFullscreen().catch(onError);
    }, { capture: true, signal: this.events.signal });
    host.closest('dialog')?.addEventListener('cancel', event => {
      if (document.fullscreenElement !== host && !this.guardCancel) return;
      event.preventDefault();
      if (document.fullscreenElement === host) this.toggleFullscreen().catch(onError);
    }, { signal: this.events.signal });
  }
  async toggleFullscreen() {
    if (document.fullscreenElement === this.host) await document.exitFullscreen();
    else await this.host.requestFullscreen();
  }
  destroy() { this.events.abort(); clearTimeout(this.guardTimer); }
}
