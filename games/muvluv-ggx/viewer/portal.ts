import { Player } from './spine-player.ts';
import { activeStyle } from './character-content.ts';

const node = (tag, className = '', text = ''): any => {
  const result = document.createElement(tag); result.className = className; if (text) result.textContent = text; return result;
};
const rarity = style => ({ 1: 'R', 3: 'SR', 5: 'SSR' }[style.rarityId] || '—');
const styleName = style => style.parentPersonId != null ? style.name : style.subtitle || style.name;

// Freeze ordinary stands through one temporary renderer, never one context per card.
export class PortalView {
  api: any;
  team = '';
  selections = new Map();
  snapshots = new Map();
  observer: IntersectionObserver;
  queue: any[] = [];
  generation = 0;
  rendering = false;
  destroyed = false;
  player: Player | null = null;
  previewStage: HTMLElement;
  controls: HTMLElement;
  dialog: HTMLDialogElement;
  download: HTMLButtonElement | null = null;

  constructor(api) {
    this.api = api;
    this.previewStage = node('div', 'muv-snapshot-stage'); this.previewStage.setAttribute('aria-hidden', 'true');
    this.controls = node('div', 'muv-style-controls');
    this.dialog = node('dialog', 'muv-wardrobe'); this.dialog.setAttribute('aria-labelledby', 'muv-wardrobe-title');
    document.body.append(this.previewStage, this.dialog);
    document.getElementById('portrait-forms').before(this.controls);
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const host: any = entry.target; this.observer.unobserve(host); this.queue.push({ host, ...host.preview });
      }
      void this.drain();
    }, { rootMargin: '180px' });
    this.dialog.addEventListener('close', () => {
      if (this.destroyed) return;
      this.dialog.replaceChildren(); this.resetPreviews(); this.controls.querySelector<HTMLButtonElement>('[data-wardrobe]')?.focus();
      this.api.syncMedia?.();
    });
  }
  resetPreviews() { this.generation++; this.queue = []; this.observer.disconnect(); this.player?.destroy(); this.player = null; }
  preview(character, library) {
    const host = node('span', 'muv-portal-art'), background = character.portal?.background;
    if (background) { const img = node('img', 'muv-portal-background'); img.src = this.api.asset(background); img.alt = ''; img.loading = 'lazy'; host.append(img); }
    const stand = character.portraits?.find(item => item.resource?.startsWith('SCS/')) || character.portraits?.find(item => item.phase !== 'card');
    const model = stand?.model && library.skeletons?.find(item => item.id === stand.model && item.kind === 'portrait');
    if (model) {
      const key = model.file, saved = this.snapshots.get(key);
      if (saved) { const img = node('img', 'muv-portal-stand'); img.src = saved; img.alt = ''; host.append(img); }
      else { host.append(node('span', 'muv-preview-state', '正在准备立绘')); host.preview = { model, key }; this.observer.observe(host); }
    } else if (stand?.file && !stand.model) {
      const img = node('img', 'muv-portal-stand'); img.src = this.api.asset(stand.file); img.alt = ''; img.loading = 'lazy'; host.append(img);
    } else host.append(node('span', 'muv-preview-state', '立绘尚未保存'));
    return host;
  }
  async drain() {
    if (this.rendering) return; this.rendering = true;
    try {
      while (this.queue.length) {
        const { host, model, key } = this.queue.shift(); if (!host.isConnected) continue;
        const generation = this.generation; let player;
        try {
          let image = this.snapshots.get(key);
          if (!image) {
            player = this.player = new Player(this.previewStage);
            await player.load({ ...model, fit: 'portal' }, { still: true, animation: model.defaultAnimation || 'Normal', assetRoot: this.api.asset('') });
            if (generation !== this.generation) continue;
            image = player.snapshot(); if (!image) throw new Error('Stand unavailable'); this.snapshots.set(key, image);
          }
          if (generation !== this.generation || !host.isConnected) continue;
          host.querySelector('.muv-preview-state')?.remove(); const img = node('img', 'muv-portal-stand'); img.src = image; img.alt = ''; host.append(img);
        } catch { if (generation === this.generation) { const label = host.querySelector('.muv-preview-state'); if (label) label.textContent = '立绘读取失败，可更新资源'; } }
        finally { player?.destroy(); if (this.player === player) this.player = null; }
      }
    } finally { this.rendering = false; }
  }
  renderCatalog(host, items, { library, favorites, selectedRole, query = '' }: any) {
    this.resetPreviews(); host.replaceChildren(); if (selectedRole) return;
    const teams = new Map();
    for (const character of library.characters) {
      const key = String(character.profile?.teamId || 'unknown');
      if (!teams.has(key)) teams.set(key, { name: character.profile?.team || '其他角色', logo: character.portal?.teamLogo });
    }
    if (!teams.has(this.team)) this.team = teams.keys().next().value || '';
    if (query && items.length && !items.some(c => String(c.profile?.teamId || 'unknown') === this.team)) this.team = String(items[0].profile?.teamId || 'unknown');
    const wrap = node('div', 'muv-portal'), nav = node('nav', 'muv-team-nav'); nav.setAttribute('aria-label', '所属队伍');
    for (const [key, team] of teams) {
      const button = node('button', 'muv-team-button'); button.type = 'button'; button.setAttribute('aria-pressed', String(this.team === key));
      const count = items.filter(c => String(c.profile?.teamId || 'unknown') === key).length;
      if (team.logo) { const img = node('img'); img.src = this.api.asset(team.logo); img.alt = ''; button.append(img); }
      button.append(node('span', '', team.name), node('small', '', String(count)));
      button.addEventListener('click', () => { this.team = key; this.renderCatalog(host, items, { library, favorites }); host.querySelector(`[data-team="${key}"]`)?.focus(); });
      button.dataset.team = key; nav.append(button);
    }
    const main = node('div', 'muv-portal-main'), heading = node('div', 'muv-portal-heading'), title = node('div');
    title.append(node('span', 'muv-kicker', 'CHARACTER PORTAL'), node('h2', '', teams.get(this.team)?.name || '角色图鉴'));
    this.download = node('button', 'secondary-button', '更新图鉴立绘'); this.download.type = 'button'; this.download.dataset.portalDownload = '';
    this.download.addEventListener('click', () => { if (library.characters[0]) this.api.getCharacter(library.characters[0].id, 'catalog'); });
    this.download.disabled = this.api.isBusy(); heading.append(title, this.download); main.append(heading);
    const shown = items.filter(c => String(c.profile?.teamId || 'unknown') === this.team), grid = node('div', 'muv-portal-grid');
    for (const character of shown) {
      const card = node('article', 'muv-portal-card'), open = node('button', 'character-open muv-portal-open');
      open.type = 'button'; open.dataset.characterId = character.id; open.setAttribute('aria-label', '鉴赏角色 ' + character.name); open.append(this.preview(character, library));
      const caption = node('span', 'muv-portal-caption'); caption.append(node('strong', '', character.name), node('small', '', (character.styles?.length || 1) + ' 种样式 · ' + (character.collected ? '已保存资源' : '尚未获取'))); open.append(caption);
      open.addEventListener('click', () => this.api.openRole(character));
      const favorite = node('button', 'favorite-star', favorites.has(character.id) ? '★' : '☆'); favorite.type = 'button'; favorite.dataset.favoriteId = character.id;
      favorite.setAttribute('aria-label', '收藏角色 ' + character.name); favorite.setAttribute('aria-pressed', String(favorites.has(character.id)));
      favorite.addEventListener('click', () => this.api.toggleFavorite(character.id)); card.append(open, favorite); grid.append(card);
    }
    if (!shown.length) grid.append(node('p', 'muv-portal-empty', '当前队伍暂无匹配角色，试试其他队伍或调整筛选。'));
    main.append(grid); wrap.append(nav, main); host.append(wrap);
  }
  selectStyle(character, id) { this.selections.set(character.id, id); character.activeStyleId = id; this.api.rerender(); this.controls.querySelector('select')?.focus({ preventScroll: true }); }
  renderRole(character, library) {
    character.activeStyleId ||= this.selections.get(character.id);
    const style = activeStyle(character); this.controls.replaceChildren();
    const label = node('label', 'muv-style-select', '角色样式'), select = node('select'); select.setAttribute('aria-label', '选择角色样式');
    for (const item of character.styles || [character]) { const option = node('option', '', rarity(item) + ' · ' + styleName(item)); option.value = item.id; select.append(option); }
    select.value = style.id; select.addEventListener('change', () => this.selectStyle(character, select.value)); label.append(select);
    const wardrobe = node('button', 'secondary-button', '衣装一览'); wardrobe.type = 'button'; wardrobe.dataset.wardrobe = ''; wardrobe.addEventListener('click', () => this.openWardrobe(character, library)); this.controls.append(label, wardrobe);
  }
  openWardrobe(character, library) {
    this.resetPreviews(); this.dialog.replaceChildren();
    const header = node('header', 'muv-wardrobe-header'), title = node('h2', '', '衣装一览'); title.id = 'muv-wardrobe-title';
    const close = node('button', 'secondary-button', '关闭'); close.type = 'button'; close.addEventListener('click', () => this.dialog.close()); header.append(title, close);
    const grid = node('div', 'muv-wardrobe-grid'), outfits = new Map();
    for (const style of character.styles || [character]) { const key = style.portraitResourceId || style.id; if (!outfits.has(key)) outfits.set(key, style); }
    let choice = activeStyle(character).id; const selectedResource = activeStyle(character).portraitResourceId;
    for (const style of outfits.values()) {
      const button = node('button', 'muv-outfit'); button.type = 'button'; button.dataset.styleId = style.id;
      button.setAttribute('aria-pressed', String(style.id === choice || !!selectedResource && style.portraitResourceId === selectedResource));
      button.append(this.preview({ ...style, portal: character.portal }, library), node('strong', '', styleName(style)));
      button.addEventListener('click', () => { choice = style.id; grid.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); }); grid.append(button);
    }
    const footer = node('footer'), cancel = node('button', 'secondary-button', '取消'), confirm = node('button', 'primary-button', '使用此衣装');
    cancel.type = confirm.type = 'button'; cancel.addEventListener('click', () => this.dialog.close());
    confirm.addEventListener('click', () => { this.dialog.close(); this.selectStyle(character, choice); }); footer.append(cancel, confirm);
    this.dialog.append(header, grid, footer); this.dialog.showModal(); this.api.syncMedia?.(); close.focus();
  }
  setBusy(value) { if (this.download) this.download.disabled = value; }
  destroy() { this.destroyed = true; this.resetPreviews(); this.dialog.close(); this.dialog.remove(); this.controls.remove(); this.previewStage.remove(); this.snapshots.clear(); }
}
