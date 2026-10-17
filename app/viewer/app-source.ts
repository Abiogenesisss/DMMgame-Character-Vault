import { GAMES, registerGame, SORT_ORDERS, sortCharacters, gameFromPath, gameSession } from './games.ts';
import { characterArtists, artistOptions } from './artists.ts';

import type { PageElements } from './elements.ts';
function $<K extends keyof PageElements>(id: K): PageElements[K];
function $(id: string): HTMLElement;
function $(id: string) { return document.getElementById(id); }
const dialogReturnViews = new WeakMap<HTMLDialogElement, {scroll: number; focus: HTMLElement; game: string}>();
const asset = file => currentSession.path + 'library/' + file.split('/').map(encodeURIComponent).join('/');
const CATALOG_PAGES = ['characters', 'favorites'], CHARACTER_SECTIONS = ['presentation', 'stories', 'voices'];
const roleContent = (data, character) => currentSession.profile.roleContent(data, character);
const portraitStatus = character => currentSession.profile.portraitStatus(character);
const readRoute = (hash, data) => currentSession.profile.readRoute(hash, data);
const routeHash = (...args) => currentSession.profile.routeHash(...args);
const combinedCg = () => currentSession.profile.features.motions && !currentSession.profile.features.dynamicCg;
const motionLabel = () => currentSession?.profile.features.dynamicCg ? '动态 CG' : 'CG';
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: unknown) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
const clean = text => String(text || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?(?:color|size|b|i|ruby|rt|font)(?:=[^>]*)?>/gi, '').replace(/\\n/g, '\n');
const sessions = new Map();
const moduleLoads = new Map(), moduleRevisions = new Map();
globalThis.CharacterVault = { register: registerGame };
async function loadGameModule(project) {
  const id = project.adapter, revision = project.revision || 'local';
  if (GAMES[id] && (!project.revision || moduleRevisions.get(id) === revision)) return;
  const key = id + ':' + revision;
  if (!moduleLoads.has(key)) moduleLoads.set(key, new Promise<void>((resolve, reject) => {
    const previousProfile = GAMES[id], script = document.createElement('script');
    script.src = project.moduleUrl || '/modules/' + id + '/module.js'; script.async = true;
    script.onload = () => { script.remove(); if (!GAMES[id] || GAMES[id] === previousProfile) { moduleLoads.delete(key); reject(new Error('游戏模块未注册。')); return; } moduleRevisions.set(id, revision); resolve(); };
    script.onerror = () => { script.remove(); moduleLoads.delete(key); reject(new Error('游戏模块加载失败，请检查该游戏是否安装完整。')); };
    document.head.append(script);
  }));
  await moduleLoads.get(key);
  if (project.stylesheet) {
    let style = document.querySelector<HTMLLinkElement>('link[data-game-style="' + id + '"]');
    if (!style) { style = document.createElement('link'); style.rel = 'stylesheet'; style.dataset.gameStyle = id; document.head.append(style); }
    style.href = project.stylesheet;
  } else document.querySelector<HTMLLinkElement>('link[data-game-style="' + id + '"]')?.remove();
}
let projects = [], currentSession, gameGeneration = 0, favorites = new Set<string>();
const audition = $('role-voice-player');
let catalogState;
let library, tab = 'characters', limit = 72, selectedRole = null, roleSection = 'presentation', selectedVoiceFile = null;
let searchTimer, toastTimer, polling, statusGeneration = 0, collectionRunning = false, collectionJob = null;
let preview, previewGeneration = 0, storyReader, storyGeneration = 0;
let inlineModel = null, inlinePlayer, motionGeneration = 0, inlineFailed = false;
let portraitModel = null, portraitPlayer, portraitGeneration = 0, portraitFailed = false;
let appliedHash = null;
let gameView = null;

function rememberGame() {
  if (!currentSession) return;
  if (library) saveCatalog();
  currentSession.favorites = favorites; currentSession.hash = appliedHash || '#characters';
}
function renderGameLinks() {
  const links = projects.map(project => {
    const link = element('a', 'secondary-button', project.label || GAMES[project.adapter]?.label || project.name); link.href = '/games/' + project.id + '/'; link.dataset.gameId = project.id;
    if (project.id === currentSession?.id) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
      event.preventDefault(); if (project.id === currentSession?.id && gameFromPath(location.pathname) === project.id) return;
      rememberGame(); const hash = sessions.get(project.id)?.hash || '#characters';
      history.pushState({}, '', '/games/' + project.id + '/' + hash);
      activateGame(project, { focus: true }).catch(error => notify(error.message));
    }); return link;
  });
  $('game-links').replaceChildren(...links); $('game-links').hidden = !links.length;
}
function configureGame() {
  const profile = currentSession.profile; document.title = profile.label + ' · DMMgame Character Vault'; document.body.dataset.game = currentSession.id;
  $('header-game').textContent = profile.label; $('page-game-title').textContent = profile.title; $('role-game-title').textContent = profile.title;
  $('role-description').textContent = profile.roleDescription; $('game-note').textContent = profile.note; $('footer-game').textContent = profile.label + ' · 角色资源收藏与鉴赏';
  $('portrait-flower').textContent = profile.glyph;
  $('discovery-game').textContent = profile.label; $('discovery-hint').textContent = profile.discoveryHint || '';
  $('discovery-ids').value = currentSession.discoveryIds || '';
  const harImport = !!profile.catalogHarImport;
  $('discover-characters').textContent = $('discovery-title').textContent = profile.discoveryLabel || (harImport ? '导入角色清单' : '拉取新角色');
  $('discovery-ids-field').hidden = harImport || profile.discoveryIds === false; $('discovery-har-field').hidden = !harImport;
  $('discovery-har').value = ''; $('discovery-har').required = harImport; renderHarFile();
  document.querySelector<HTMLElement>('.voice-introduction').textContent = profile.voiceDescription || '日常、战斗、养成与季节语音。剧情配音在剧情中播放。';
  $('search').placeholder = profile.features.artists ? '名字、编号或画师' : '角色名字或编号';
  const combined = combinedCg(), label = motionLabel();
  $('role-gallery-section').hidden = combined;
  const gallery = $(combined ? 'role-motion-section' : 'role-gallery-section');
  gallery.insertBefore($('role-media'), gallery.children[1] || null);
  gallery.insertBefore($('role-cg-empty'), $('role-media').nextSibling);
  $('get-character-motions').dataset.downloadScope = combined ? 'cg' : 'motions';
  $('role-motion-label').textContent = combined ? 'CG 鉴赏' : label;
  $('role-motions').setAttribute('aria-label', label);
  $('inline-animation-select').setAttribute('aria-label', '选择' + label + '动作');
  $('inline-motion-stage').setAttribute('aria-label', label + '预览');
  $('role-motions-empty').textContent = '暂无已保存的' + label + '。';
  $('motion-dialog').querySelector<HTMLElement>('small').textContent = combined ? 'CG 鉴赏' : '动态鉴赏';
  $('motion-dialog').querySelector<HTMLElement>('[data-close]').setAttribute('aria-label', '关闭' + label);
  document.querySelectorAll<HTMLElement>('[data-feature]').forEach(node => { node.hidden = !profile.features[node.dataset.feature]; });
  $('dynamic-filter').closest('fieldset').hidden = !profile.features.dynamicCg || profile.features.dynamicFilter === false;
  document.querySelectorAll<HTMLButtonElement>('[data-download-scope]').forEach(button => { button.hidden = !profile.scopes[button.dataset.downloadScope]; });
  $('sort-order').replaceChildren(...SORT_ORDERS.filter(order => !order.feature || profile.features[order.feature]).map(order => {
    const option = element('option', '', order.label); option.value = order.id; return option;
  }));
  renderGameLinks();
}
async function activateGame(project, { focus = false }: any = {}) {
  rememberGame(); const generation = ++gameGeneration;
  await loadGameModule(project); if (generation !== gameGeneration) return;
  gameView?.destroy(); gameView = null;
  clearTimeout(searchTimer); clearTimeout(polling); clearTimeout(toastTimer); $('toast').hidden = true;
  pauseAudition(true); stopInlineMotion(); inlineModel = null; inlineFailed = false;
  stopPortraitMotion(); portraitModel = null;
  previewGeneration++; preview?.destroy(); preview = null; storyGeneration++; storyReader?.destroy(); storyReader = null;
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  if (!sessions.has(project.id)) {
    const session = gameSession(project); try { session.favorites = session.profile.readFavorites(localStorage.getItem(session.profile.favoriteKey)); } catch {}
    sessions.set(project.id, session);
  }
  currentSession = sessions.get(project.id); favorites = currentSession.favorites; catalogState = currentSession.views;
  currentSession.profile = GAMES[project.adapter]; currentSession.revision = project.revision;
  library = null; selectedRole = null; appliedHash = null; collectionJob = null; collectionRunning = false;
  $('collection-status').hidden = true; $('character-page').hidden = true; $('catalog-page').hidden = false;
  $('catalog').replaceChildren(); $('empty').hidden = true; $('more').hidden = true; $('page-description').textContent = '正在读取角色…';
  $('main-content').setAttribute('aria-busy', 'true'); configureGame(); updateGetButtons();
  gameView = currentSession.profile.createView?.({ asset, openRole, toggleFavorite, getCharacter, characterCard, isBusy: () => collectionRunning, syncMedia: syncInlineMotion,
    rerender: () => { renderCatalog(); if (selectedRole) renderRole(selectedRole); } }) || null;
  try { localStorage.setItem('vault-active-game-v1', project.id); } catch {}
  try { await loadLibrary(currentSession); }
  catch (error) { if (generation !== gameGeneration) return; $('main-content').setAttribute('aria-busy', 'false'); $('page-description').textContent = error.message; throw error; }
  if (generation !== gameGeneration) return;
  $('main-content').setAttribute('aria-busy', 'false'); applyRoute({ focus }); await pollStatus(currentSession);
}
async function loadProjects() {
  const response = await fetch('/api/games', { cache: 'no-store' }); if (!response.ok) throw new Error('游戏列表读取失败。');
  projects = (await response.json()).filter(project => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(project.id) && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(project.adapter));
  const present = new Set(projects.map(project => project.id)), adapters = new Set(projects.map(project => project.adapter));
  for (const id of sessions.keys()) if (!present.has(id)) sessions.delete(id);
  for (const id of Object.keys(GAMES)) if (!adapters.has(id)) {
    delete GAMES[id]; moduleRevisions.delete(id);
    for (const key of moduleLoads.keys()) if (key.startsWith(id + ':')) moduleLoads.delete(key);
    document.querySelector<HTMLLinkElement>('link[data-game-style="' + id + '"]')?.remove();
  }
  const active = projects.find(project => project.id === currentSession?.id);
  if (active && active.revision === currentSession.revision) { renderGameLinks(); return false; }
  if (currentSession && !active) {
    gameView?.destroy(); gameView = null;
    ++gameGeneration; clearTimeout(polling); pauseAudition(true); stopInlineMotion(); stopPortraitMotion(); preview?.destroy(); preview = null; storyReader?.destroy(); storyReader = null;
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close()); currentSession = null; library = null; selectedRole = null; collectionRunning = false;
  }
  if (!projects.length) {
    history.replaceState({}, '', '/'); renderGameLinks(); $('character-page').hidden = true; $('catalog-page').hidden = false;
    $('collection-status').hidden = true; $('catalog').replaceChildren(); $('more').hidden = true; $('empty').hidden = false;
    $('page-description').textContent = '当前没有可用的游戏。'; $('empty').textContent = '请使用包含游戏内容的完整版本。';
    $('result-count').textContent = '0 位角色'; $('characters-count').textContent = '0'; $('favorites-count').textContent = '0';
    document.title = 'DMMgame Character Vault'; delete document.body.dataset.game;
    $('page-game-title').textContent = 'DMMgame Character Vault'; $('footer-game').textContent = '角色资源库'; $('game-note').textContent = '';
    $('header-game').textContent = '角色资源库'; updateGetButtons(); return true;
  }
  let saved; try { saved = localStorage.getItem('vault-active-game-v1'); } catch {}
  const id = gameFromPath(location.pathname) || saved;
  const project = active || projects.find(project => project.id === id) || projects[0];
  if (!gameFromPath(location.pathname) || project.id !== id) history.replaceState({}, '', '/games/' + project.id + '/' + (location.hash || '#characters'));
  await activateGame(project); return true;
}
function syncRoute() {
  const id = gameFromPath(location.pathname), project = projects.find(project => project.id === id);
  if (project && currentSession?.id !== id) activateGame(project, { focus: true }).catch(error => notify(error.message));
  else if (library && location.hash !== appliedHash) applyRoute({ focus: true });
}

function notify(text) {
  clearTimeout(toastTimer); $('toast').textContent = text;
  (document.querySelector<HTMLDialogElement>('dialog[open]') || document.body).append($('toast')); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}
function openDialog(dialog) {
  if (dialog.open) return;
  dialogReturnViews.set(dialog, { scroll: window.scrollY, focus: document.activeElement as HTMLElement, game: currentSession.id });
  dialog.showModal(); syncInlineMotion();
}
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button => button.addEventListener('click', () => button.closest<HTMLDialogElement>('dialog').close()));
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener('close', () => {
  if ($('toast').parentElement === dialog) { $('toast').hidden = true; document.body.append($('toast')); }
  if (!document.querySelector<HTMLDialogElement>('dialog[open]') && dialogReturnViews.get(dialog)?.game === currentSession?.id) {
    const focus = dialogReturnViews.get(dialog)?.focus;
    (focus?.isConnected ? focus : selectedRole ? $('role-tab-' + roleSection) : document.querySelector<HTMLElement>('.nav-item.active'))?.focus({ preventScroll: true });
    window.scrollTo({ top: dialogReturnViews.get(dialog)?.scroll || 0 });
    syncInlineMotion();
  }
}));
function pauseAudition(clear = false) {
  audition.pause();
  if (clear) {
    selectedVoiceFile = null; audition.removeAttribute('src'); audition.load(); audition.hidden = true;
    $('role-voice-title').hidden = true;
  }
}
function characterName(id) { return library.characters.find(character => character.id === id)?.name || '角色 ' + id; }
function saveCatalog() {
  if (library && !selectedRole) Object.assign(catalogState[tab], { query: $('search').value, limit, scroll: window.scrollY });
}
function restoreCatalog() {
  const state = catalogState[tab];
  const target = state.focusId && [...document.querySelectorAll<HTMLElement>('.character-open')].find(button => button.dataset.characterId === state.focusId);
  (target || $('page-title')).focus({ preventScroll: true });
  window.scrollTo({ top: state.scroll });
}
function applyRoute({ focus = false }: any = {}) {
  clearTimeout(searchTimer);
  const legacyTarget = { cg: 'role-gallery-section', motions: 'role-motion-section' }[location.hash.split('/')[2]];
  const route = readRoute(location.hash, library), oldRole = selectedRole?.id, oldTab = tab;
  tab = route.tab;
  const nextRole = route.id ? library.characters.find(character => character.id === route.id) : null;
  if (oldRole !== nextRole?.id || oldTab !== tab) {
    pauseAudition(true); stopInlineMotion(); stopPortraitMotion(); portraitModel = null;
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  }
  selectedRole = nextRole || null; roleSection = route.section;
  if (route.id && !selectedRole) {
    history.replaceState({}, '', routeHash(tab)); notify('这位角色暂未收录。');
  } else if (location.hash !== routeHash(tab, selectedRole?.id, roleSection)) {
    history.replaceState(history.state, '', routeHash(tab, selectedRole?.id, roleSection));
  }
  limit = catalogState[tab].limit; $('search').value = catalogState[tab].query;
  $('dynamic-filter').checked = catalogState[tab].dynamicOnly;
  $('rarity-filter').value = catalogState[tab].rarity;
  $('catalog-page').hidden = !!selectedRole; $('character-page').hidden = !selectedRole;
  $('catalog-search').hidden = !!selectedRole;
  document.querySelectorAll<HTMLElement>('.nav-item').forEach(button => {
    const active = button.dataset.tab === tab; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  renderCatalog();
  if (selectedRole) {
    renderRole(selectedRole);
    if (focus) { $('role-title').focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
    if (legacyTarget) $(legacyTarget).scrollIntoView();
  } else if (focus || oldRole || oldTab !== tab) restoreCatalog();
  appliedHash = location.hash;
  currentSession.hash = appliedHash;
}
function setTab(page) {
  if (!library || !CATALOG_PAGES.includes(page)) return;
  saveCatalog();
  history.pushState({}, '', routeHash(page)); applyRoute({ focus: true });
}
function characterCard(character) {
  const card = element('div', 'character-card'), open = element('button', 'character-open');
  const thumbnail = element('span', 'character-thumbnail');
  open.dataset.characterId = character.id; open.setAttribute('aria-label', '鉴赏角色 ' + character.name + (character.releaseUnconfirmed ? '（实装待确认）' : ''));
  if (character.icon) {
    const img = element('img'); img.src = asset(character.icon); img.alt = character.name; img.loading = 'lazy'; thumbnail.append(img);
  } else thumbnail.append(element('span', 'thumbnail-placeholder', currentSession.profile.glyph));
  if (currentSession.profile.features.dynamicCg && character.hasDynamicCg) thumbnail.append(element('span', 'dynamic-badge', '▷ 动态 CG'));
  if (character.releaseUnconfirmed) thumbnail.append(element('span', 'release-badge', '实装待确认'));
  const caption = element('span', 'character-caption');
  const rarityLabel = character.rarityId == null ? '' : character.rarityLabel + ' · ';
  caption.append(element('strong', '', character.name), element('small', character.collected ? 'available' : '', rarityLabel + (character.collected ? '已保存资源' : '尚未获取')));
  open.append(thumbnail, caption);
  open.addEventListener('click', () => openRole(character));
  const star = element('button', 'favorite-star', favorites.has(character.id) ? '★' : '☆');
  star.dataset.favoriteId = character.id; star.setAttribute('aria-label', '收藏角色 ' + character.name);
  star.setAttribute('aria-pressed', String(favorites.has(character.id)));
  star.addEventListener('click', () => toggleFavorite(character.id));
  card.append(open, star); return card;
}
function renderCatalog() {
  if (!library) return;
  $('page-title').textContent = tab === 'favorites' ? '我的收藏' : '角色图鉴';
  $('page-description').textContent = tab === 'favorites' ? '收藏的角色，随时打开鉴赏。' : currentSession.profile.description;
  $('characters-count').textContent = currentSession.profile.groupedCharacters ? currentSession.profile.catalogCharacters(library).length : library.characters.length;
  $('favorites-count').textContent = library.characters.filter(character => favorites.has(character.id)).length;
  const { availability, dynamicOnly, rarity, artist, sort } = catalogState[tab];
  $('sort-order').value = sort;
  const filter = { tab, favorites, query: $('search').value, availability, dynamicOnly: currentSession.profile.features.dynamicCg && currentSession.profile.features.dynamicFilter !== false && dynamicOnly, rarity, artist };
  const items = sortCharacters(currentSession.profile.catalogCharacters(library, filter), sort, currentSession.profile.rarities);
  if (currentSession.profile.features.rarity) {
    const rows = currentSession.profile.catalogCharacters(library, { ...filter, rarity: 'all' }), counts = new Map();
    for (const character of rows) for (const rarityId of currentSession.profile.rarityValues?.(character) || [character.rarityId]) {
      const key = rarityId == null ? 'unknown' : String(rarityId); counts.set(key, (counts.get(key) || 0) + 1);
    }
    $('rarity-filter').replaceChildren(...[{ id: 'all', label: '全部稀有度' }, ...currentSession.profile.rarities, { id: 'unknown', label: '未标注' }].map(rarity => {
      const option = element('option', '', rarity.label + '（' + (rarity.id === 'all' ? rows.length : counts.get(String(rarity.id)) || 0) + '）'); option.value = String(rarity.id); return option;
    })); $('rarity-filter').value = rarity;
  }
  if (currentSession.profile.features.artists) {
    const rows = currentSession.profile.catalogCharacters(library, { ...filter, artist: 'all' });
    const counts = new Map(artistOptions(rows).map(option => [option.value, option.count]));
    $('artist-filter').replaceChildren(...artistOptions(library.characters).map(artist => {
      const option = element('option', '', artist.label + '（' + (counts.get(artist.value) || 0) + '）'); option.value = artist.value; return option;
    })); $('artist-filter').value = artist;
  }
  $('saved-count').textContent = library.characters.filter(character => character.collected).length;
  $('dynamic-count').textContent = library.characters.filter(character => character.hasDynamicCg).length;
  $('portrait-count').textContent = library.stats?.portraits ?? library.characters.reduce((total, character) => total + (character.portraits || []).filter(item => item.file).length, 0);
  $('cg-count').textContent = library.stats?.cg ?? 0;
  document.querySelectorAll<HTMLElement>('[data-availability]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.availability === availability)));
  $('catalog').replaceChildren();
  if (gameView?.renderCatalog) gameView.renderCatalog($('catalog'), items, { library, favorites, tab, query: filter.query, selectedRole });
  else for (const character of items.slice(0, limit)) $('catalog').append(characterCard(character));
  $('result-count').textContent = items.length.toLocaleString('zh-CN') + (tab === 'favorites' ? ' 位收藏角色' : ' 位角色');
  $('empty').hidden = items.length > 0;
  $('empty').textContent = !library.characters.length && currentSession.profile.emptyCatalogMessage ? currentSession.profile.emptyCatalogMessage
    : tab === 'favorites' && !favorites.size ? '在角色图鉴点 ☆，收藏喜欢的角色。' : '暂无匹配角色。';
  $('more').hidden = !!gameView?.renderCatalog || items.length <= limit;
  $('more').textContent = '加载更多 · 还有 ' + Math.max(0, items.length - limit) + ' 位角色';
}
function updateFavorite() {
  if (!selectedRole) return;
  $('role-favorite').textContent = favorites.has(selectedRole.id) ? '★ 已收藏' : '☆ 收藏角色';
  $('role-favorite').setAttribute('aria-pressed', String(favorites.has(selectedRole.id)));
}
function toggleFavorite(id) {
  const next = new Set<string>(favorites);
  if (next.has(id)) next.delete(id); else next.add(id);
  try { localStorage.setItem(currentSession.profile.favoriteKey, JSON.stringify([...next])); }
  catch { notify('浏览器未能保存收藏，请检查存储设置。'); return; }
  favorites = next; currentSession.favorites = favorites; renderCatalog(); updateFavorite();
  if (!selectedRole) {
    const button = [...document.querySelectorAll<HTMLElement>('.favorite-star')].find(item => item.dataset.favoriteId === id);
    (button || $('page-title')).focus({ preventScroll: true });
  }
}
function openRole(character) {
  saveCatalog(); catalogState[tab].focusId = character.id;
  history.pushState({ fromCatalog: true }, '', routeHash(tab, character.id));
  applyRoute({ focus: true });
}
function backToCatalog() {
  if (history.state?.fromCatalog) history.back();
  else { history.replaceState({}, '', routeHash(tab)); applyRoute({ focus: true }); }
}
function setRoleSection(section) {
  if (!selectedRole || !CHARACTER_SECTIONS.includes(section) || !currentSession.profile.features[section]) return;
  roleSection = section; history.replaceState(history.state, '', routeHash(tab, selectedRole.id, section));
  appliedHash = location.hash; currentSession.hash = appliedHash;
  renderRoleSection();
}
function renderRoleSection() {
  for (const section of CHARACTER_SECTIONS) {
    const active = section === roleSection && currentSession.profile.features[section], button = $('role-tab-' + section);
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    $('role-panel-' + section).hidden = !active;
  }
  if (roleSection !== 'voices') pauseAudition();
  syncInlineMotion();
}
function openImage(image) {
  pauseAudition(); $('image-title').textContent = selectedRole.name + ' · CG';
  $('cg-image').src = asset(image.file);
  openDialog($('image-dialog'));
}
$('image-dialog').addEventListener('close', () => { $('cg-image').removeAttribute('src'); });
function voiceLabel(item, index) {
  return item.label || (item.name && !/^[a-f0-9]{32,64}(\.mp3)?$/i.test(item.name) ? item.name : '角色语音 ' + (index + 1));
}
function renderVoices(items) {
  if (selectedVoiceFile && !items.some(item => item.file === selectedVoiceFile)) pauseAudition(true);
  $('role-voices').replaceChildren(); $('role-voices-empty').hidden = !!items.length;
  const groups = new Map();
  for (const [index, item] of items.entries()) {
    const groupName = item.group || '角色语音';
    if (!groups.has(groupName)) {
      const group = element('section', 'voice-category'), list = element('div', 'voice-category-list');
      group.append(element('h3', '', groupName), list); $('role-voices').append(group); groups.set(groupName, list);
    }
    const label = voiceLabel(item, index), button = element('button', 'voice-choice');
    const marker = element('span', 'voice-symbol', '▷'); marker.setAttribute('aria-hidden', 'true');
    button.append(marker, element('span', 'voice-label', label));
    button.dataset.voiceFile = item.file; button.setAttribute('aria-label', '播放角色语音：' + label);
    button.setAttribute('aria-pressed', String(item.file === selectedVoiceFile));
    button.addEventListener('click', () => {
      selectedVoiceFile = item.file;
      audition.src = asset(item.file); audition.hidden = false;
      $('role-voice-title').textContent = label; $('role-voice-title').hidden = false;
      document.querySelectorAll<HTMLElement>('.voice-choice').forEach(choice => choice.setAttribute('aria-pressed', String(choice.dataset.voiceFile === item.file)));
      audition.play().catch(error => {
        if (error.name === 'AbortError' || selectedVoiceFile !== item.file) return;
        notify('这段角色语音暂时无法播放。');
      });
    });
    groups.get(groupName).append(button);
  }
}
function renderRole(character) {
  gameView?.renderRole(character, library);
  const resources = roleContent(library, character);
  const skins = currentSession.profile.groupedCharacters ? character.skins || [] : [];
  const sameRole = $('portrait-forms').dataset.characterId === character.id;
  const previousPhase = sameRole ? $('portrait-forms').dataset.phase : null;
  const previousModel = sameRole ? inlineModel?.file : null;
  stopInlineMotion();
  $('role-title').textContent = character.name + (character.rarityId == null || currentSession.profile.hideRoleRarity ? '' : ' · ' + character.rarityLabel);
  $('role-description').textContent = character.releaseUnconfirmed ? '实装待确认 · 已收录角色素材，可按需获取。' : currentSession.profile.roleDescription;
  $('role-artists').textContent = '画师：' + (characterArtists(character).join(' / ') || '未标注');
  $('back-to-catalog').textContent = tab === 'favorites' ? '← 返回我的收藏' : '← 返回角色图鉴';
  updateFavorite();
  $('role-skins').replaceChildren(); $('role-skins').hidden = !skins.length;
  if (skins.length) {
    $('role-skins').append(element('span', 'role-skins-label', '角色皮肤'));
    for (const skin of skins) {
      const button = element('button', 'secondary-button', skin.label + (skin.collected ? ' · 更新资源' : ' · 下载资源'));
      button.type = 'button'; button.dataset.skinId = skin.id; button.addEventListener('click', () => getCharacter(skin.id, 'all'));
      $('role-skins').append(button);
    }
  }
  renderPortrait(character, resources.portraits.some(item => item.phase === previousPhase) ? previousPhase : resources.portraits[0]?.phase || 'avatar');
  renderVoices(resources.voices);
  const savedStories = resources.stories.filter(story => story.downloaded !== false).length;
  $('role-story-count').textContent = savedStories === resources.stories.length ? String(savedStories) : savedStories + '/' + resources.stories.length;
  $('role-voice-count').textContent = resources.voices.length;
  $('role-cg-count').textContent = resources.cg.length;
  $('role-motion-count').textContent = resources.motions.length + (combinedCg() ? resources.cg.length : 0);
  $('role-stories').replaceChildren(); $('role-stories-empty').hidden = !!resources.stories.length;
  $('role-stories-empty').textContent = character.storyAvailable === false && currentSession.profile.missingStoryMessage
    ? currentSession.profile.missingStoryMessage : '暂无已保存的角色剧情。';
  for (const metadata of resources.stories) {
    const button = element('button', 'role-story-button', metadata.title || '角色剧情');
    const missing = metadata.downloaded === false;
    const incomplete = currentSession.profile.requiresCompleteStories && metadata.complete === false && metadata.playable !== true;
    if (missing || incomplete) { button.disabled = true; button.textContent += missing ? ' · 未下载' : ' · 尚未完整'; }
    button.addEventListener('click', () => openStory(metadata));
    const row = element('div', 'role-story-row'); row.append(button);
    if (incomplete && !missing) row.append(element('span', 'note', (metadata.expectedSegments ? '脚本 ' + (metadata.segments || 0) + '/' + metadata.expectedSegments + ' 段 · ' : '') + '缺少 ' + (metadata.missingAssets ?? '?') + ' 项播放资源，可更新剧情补齐。'));
    if (metadata.complete === false && metadata.playable === true && !missing) row.append(element('span', 'note', '缺少 ' + metadata.missingAssets + ' 项音频，仍可播放；更新剧情可重试。'));
    if (metadata.kind === 'audio') row.append(element('span', 'note', '语音短篇'));
    if (metadata.script) {
      const link = element('a', 'script-link', '下载演出脚本');
      link.href = asset(metadata.script); link.download = metadata.id + '.' + (metadata.scriptFormat || 'csv'); row.append(link);
    }
    $('role-stories').append(row);
  }
  renderGallery(resources.cg);
  $('role-motions').replaceChildren(); $('role-motions-empty').hidden = !!resources.motions.length || combinedCg() && !!resources.cg.length;
  for (const [index, model] of resources.motions.entries()) {
    const button = element('button', '', (skins.some(skin => skin.id === model.character) ? model.label : motionLabel()) + ' ' + (index + 1 + (combinedCg() ? resources.cg.length : 0)));
    button.id = 'motion-tab-' + index; button.dataset.motionFile = model.file;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'inline-motion-preview');
    button.addEventListener('click', () => selectInlineMotion(model)); $('role-motions').append(button);
  }
  selectInlineMotion(resources.motions.find(model => model.file === previousModel) || resources.motions[0] || null);
  renderRoleSection(); updateGetButtons();
}
function renderGallery(items) {
  $('role-media').replaceChildren(); $('role-cg-empty').hidden = combinedCg() || !!items.length;
  $('role-cg-empty').textContent = selectedRole.cgAvailable === false && currentSession.profile.missingCgMessage ? currentSession.profile.missingCgMessage
    : selectedRole.placeholders?.some(item => item.category === 'cg') ? '该编号的 CG 资源为占位图，暂无可用 CG。' : selectedRole.hasDynamicCg ? '动态资源可在下方「动态 CG」中鉴赏。' : '暂无已保存的角色 CG。';
  for (const [index, image] of items.entries()) {
    const label = 'CG ' + (index + 1);
    const button = element('button', 'role-image'); button.setAttribute('aria-label', '查看' + label);
    const img = element('img'); img.src = asset(image.file); img.alt = selectedRole.name + ' · ' + label; img.loading = 'lazy'; button.append(img);
    button.append(element('span', 'gallery-caption', label));
    button.addEventListener('click', () => openImage(image));
    $('role-media').append(button);
  }
}
function renderPortrait(character, phase) {
  const { portraits: slots } = roleContent(library, character), forms = $('portrait-forms');
  const slot = slots.find(item => item.phase === phase) || slots[0], image = slot?.model ? null : slot?.file;
  stopPortraitMotion(); portraitFailed = false;
  portraitModel = slot?.model ? library.skeletons?.find(model => model.id === slot.model && model.kind === 'portrait') : null;
  $('role-portrait-motion').hidden = !portraitModel; $('portrait-motion-state').hidden = !portraitModel;
  $('portrait-motion-state').textContent = '正在读取立绘…';
  forms.replaceChildren(); forms.dataset.characterId = character.id; forms.dataset.phase = slot?.phase || 'avatar'; forms.hidden = !slots.length;
  for (const item of slots) {
    const button = element('button', '', item.label || '角色立绘'), active = item === slot;
    button.id = 'portrait-form-' + item.phase; button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'role-portrait-stage'); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    button.addEventListener('click', () => { renderPortrait(character, item.phase); $('portrait-form-' + item.phase)?.focus({ preventScroll: true }); });
    forms.append(button);
  }
  if (slot) $('role-portrait-stage').setAttribute('aria-labelledby', 'portrait-form-' + slot.phase);
  else $('role-portrait-stage').setAttribute('aria-labelledby', 'role-portrait-heading');
  $('role-art').hidden = !image; $('role-icon').hidden = !!image || !!portraitModel || !character.icon; $('portrait-flower').hidden = !!image || !!portraitModel;
  if (image) { $('role-art').src = asset(image); $('role-art').alt = character.name + ' · ' + (slot.label || '立绘'); }
  else $('role-art').removeAttribute('src');
  if (character.icon) $('role-icon').src = asset(character.icon); else $('role-icon').removeAttribute('src');
  $('portrait-label').textContent = slot?.label || '';
  $('portrait-status').textContent = portraitStatus(character);
  syncPortraitMotion();
}
function stopPortraitMotion() {
  portraitGeneration++; portraitPlayer?.destroy(); portraitPlayer = null;
  $('role-portrait-motion').setAttribute('aria-busy', 'false');
}
async function syncPortraitMotion() {
  const stage = $('role-portrait-motion'), rect = stage.getBoundingClientRect();
  const visible = selectedRole && portraitModel && roleSection === 'presentation' && !document.hidden && rect.width && rect.bottom > 0 && rect.top < innerHeight + 120 && !document.querySelector<HTMLDialogElement>('dialog[open]');
  if (!visible) { if (portraitPlayer) stopPortraitMotion(); return; }
  if (portraitPlayer || portraitFailed) return;
  const generation = ++portraitGeneration, player = new currentSession.profile.Player(stage); portraitPlayer = player;
  stage.setAttribute('aria-busy', 'true'); $('portrait-motion-state').hidden = false;
  try {
    await player.load(portraitModel, { animation: portraitModel.defaultAnimation || 'Normal', assetRoot: currentSession.path + 'library/' });
    if (generation !== portraitGeneration) return;
    stage.setAttribute('aria-busy', 'false'); $('portrait-motion-state').hidden = true;
  } catch {
    if (generation !== portraitGeneration) return;
    stopPortraitMotion(); portraitFailed = true; $('portrait-motion-state').textContent = '立绘加载失败，请更新立绘后重试。';
  }
}
function stopInlineMotion() {
  motionGeneration++; inlinePlayer?.destroy(); inlinePlayer = null;
  $('inline-motion-stage').setAttribute('aria-busy', 'false');
  $('inline-motion-state').hidden = false;
  if (!inlineFailed) $('inline-motion-message').textContent = motionLabel() + ' 预览';
}
function selectInlineMotion(model) {
  stopInlineMotion(); inlineModel = model; inlineFailed = false;
  const animations = model?.animations || [];
  $('inline-motion-preview').hidden = !model; $('inline-motion-controls').hidden = !model; $('expand-motion').hidden = !model;
  $('inline-motion-retry').hidden = true;
  $('inline-animation-select').replaceChildren(); $('inline-animation-select').disabled = !animations.length;
  for (const name of animations) { const option = element('option', '', name); option.value = name; $('inline-animation-select').append(option); }
  $('inline-animation-select').value = animations.includes('wait1') ? 'wait1' : animations.includes('Wait') ? 'Wait' : animations[0] || '';
  $('inline-motion-note').textContent = animations.length + ' 个动作';
  document.querySelectorAll<HTMLElement>('[data-motion-file]').forEach(button => {
    const active = button.dataset.motionFile === model?.file;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    if (active) $('inline-motion-preview').setAttribute('aria-labelledby', button.id);
  });
  syncInlineMotion();
}
function syncInlineMotion() {
  syncPortraitMotion();
  const rect = $('inline-motion-stage').getBoundingClientRect();
  // One visible viewer at a time; off-screen stages do not retain a WebGL canvas.
  const visible = selectedRole && roleSection === 'presentation' && inlineModel && rect.width && rect.bottom > 0 && rect.top < innerHeight + 120
    && !document.querySelector<HTMLDialogElement>('dialog[open]');
  if (!visible) { if (inlinePlayer) stopInlineMotion(); return; }
  if (inlinePlayer || inlineFailed) return;
  loadInlineMotion();
}
async function loadInlineMotion() {
  if (!inlineModel) return;
  stopInlineMotion(); inlineFailed = false;
  const generation = ++motionGeneration, player = new currentSession.profile.Player($('inline-motion-stage'));
  inlinePlayer = player; $('inline-motion-stage').setAttribute('aria-busy', 'true');
  $('inline-motion-message').textContent = '正在加载' + motionLabel() + '…'; $('inline-motion-retry').hidden = true;
  try {
    await player.load(inlineModel, { animation: $('inline-animation-select').value, assetRoot: currentSession.path + 'library/' });
    if (generation !== motionGeneration) return;
    $('inline-motion-stage').setAttribute('aria-busy', 'false'); $('inline-motion-state').hidden = true;
  } catch {
    if (generation !== motionGeneration) return;
    stopInlineMotion(); inlineFailed = true;
    $('inline-motion-message').textContent = motionLabel() + ' 加载失败。'; $('inline-motion-retry').hidden = false;
  }
}
function updateGetButtons() {
  gameView?.setBusy(collectionRunning);
  $('discover-characters').disabled = collectionRunning || !library;
  $('discovery-submit').disabled = collectionRunning || !library;
  const verb = currentSession?.profile.catalogHarImport ? '导入' : '拉取';
  $('discovery-submit').textContent = collectionRunning && collectionJob?.type === 'catalog' ? '正在' + verb + '…' : '开始' + verb;
  $('discovery-ids').disabled = collectionRunning;
  $('discovery-har').disabled = collectionRunning;
  const resources = selectedRole ? roleContent(library, selectedRole) : null;
  const downloadRole = selectedRole && (currentSession.profile.downloadCharacter?.(selectedRole) || selectedRole);
  const jobScope = collectionJob?.scope || (collectionJob?.voicesOnly ? 'voices' : 'all');
  document.querySelectorAll<HTMLButtonElement>('[data-download-scope]').forEach(button => {
    const scope = button.dataset.downloadScope, label = currentSession?.profile.scopes[scope]?.label;
    if (!label) { button.hidden = true; return; }
    button.hidden = false;
    const savedFrom = currentSession.profile.scopes[scope].savedFrom || [scope];
    const saved = scope === 'all' ? downloadRole?.collected : savedFrom.some(kind => resources?.[kind]?.some(item => item.downloaded !== false)) || scope === 'cg' && combinedCg() && resources?.motions.length;
    button.disabled = collectionRunning || !downloadRole || scope === 'cg' && (currentSession.profile.features.rarity || currentSession.profile.requireCgAvailability) && !downloadRole.cgAvailable
      || scope === 'motions' && downloadRole.cgAvailable === false || scope === 'voices' && downloadRole.voiceAvailable === false;
    if (scope === 'stories' && downloadRole?.storyAvailable === false) button.disabled = true;
    button.textContent = collectionRunning && collectionJob?.roles?.some(id => id === selectedRole?.id || selectedRole?.memberIds?.includes(id)) && jobScope === scope
      ? '正在下载' + label + '…' : currentSession.profile.scopes[scope]?.cachedLabel&&library?.storyUi
        ? currentSession.profile.scopes[scope].cachedLabel : (saved ? '更新' : '下载') + label;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-skin-id]').forEach(button => { button.disabled = collectionRunning; });
}
async function getCharacter(id, scope = 'all') {
  if (collectionRunning || !currentSession.profile.scopes[scope]) return;
  clearTimeout(polling); statusGeneration++;
  const session = currentSession, generation = gameGeneration; session.collection.begin();
  collectionRunning = true; collectionJob = { roles: [id], scope }; updateGetButtons();
  try {
    const response = await fetch(session.path + 'api/collect', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, scope, retryMissing: library.characters.flatMap(character => [character, ...(character.skins || []), ...(character.styles || [])]).find(character => character.id === id)?.collected === true }) });
    const job = await response.json(); if (!response.ok) throw new Error(job.error);
    session.collection.observe(job); if (generation !== gameGeneration) return;
    collectionJob = job;
    await pollStatus(session);
  } catch (error) { session.collection.cancel(); if (generation !== gameGeneration) return; collectionRunning = false; updateGetButtons(); notify(error.message); await pollStatus(session); }
}

async function openMotion(model) {
  const generation = ++previewGeneration;
  pauseAudition(); preview?.destroy(); $('motion-title').textContent = selectedRole.name + ' · ' + motionLabel(); $('motion-note').textContent = '正在加载本地' + motionLabel() + '…';
  const animations = model.animations || [];
  $('animation-select').replaceChildren(); animations.forEach(name => { const option = element('option', '', name); option.value = name; $('animation-select').append(option); });
  $('animation-select').disabled = !animations.length;
  openDialog($('motion-dialog')); preview = new currentSession.profile.Player($('motion-stage'));
  try { await preview.load(model, { assetRoot: currentSession.path + 'library/' }); if (generation === previewGeneration && $('motion-dialog').open) { $('motion-note').textContent = `${animations.length} 个动作`; $('animation-select').value = animations.includes('wait1') ? 'wait1' : animations.includes('Wait') ? 'Wait' : animations[0] || ''; } }
  catch (error) { if (generation === previewGeneration && $('motion-dialog').open) $('motion-note').textContent = '预览失败：' + error.message; }
}
$('animation-select').addEventListener('change', () => preview?.setAnimation($('animation-select').value));
$('motion-dialog').addEventListener('close', () => { previewGeneration++; preview?.destroy(); preview = null; });
$('inline-animation-select').addEventListener('change', () => inlinePlayer?.setAnimation($('inline-animation-select').value));
$('expand-motion').addEventListener('click', () => { if (inlineModel) openMotion(inlineModel); });
$('inline-motion-retry').addEventListener('click', loadInlineMotion);
new IntersectionObserver(syncInlineMotion, { rootMargin: '120px 0px' }).observe($('inline-motion-stage'));
new IntersectionObserver(syncPortraitMotion, { rootMargin: '120px 0px' }).observe($('role-portrait-motion'));
document.addEventListener('visibilitychange', syncPortraitMotion);

async function openStory(metadata) {
  const generation=++storyGeneration,session=currentSession,profile=session.profile;
  pauseAudition();storyReader?.destroy();storyReader=null;
  $('story-dialog').dataset.storyEngine=profile.storyEngine?.(metadata)||'legacy';
  $('story-title').textContent=metadata.title;
  const host=element('div');host.id=profile.storyHostId||'game-story-reader';
  $('story-reader').replaceChildren(host);openDialog($('story-dialog'));
  const options={asset:file=>session.path+'library/'+file.split('/').map(encodeURIComponent).join('/'),assetRoot:session.path+'library/',positionKey:(profile.storyPositionPrefix||session.id+'-position-')+metadata.id,library,characterName,onError:error=>notify(error.message)};
  try {
    storyReader=profile.createStoryPlayer(host,options,metadata);
    const response=await fetch(options.asset(metadata.file));if(!response.ok)throw new Error('剧情文件读取失败。');
    const data=await response.json();if(generation!==storyGeneration||!$('story-dialog').open)return;
    await storyReader.load(data);
  } catch(error){if(generation!==storyGeneration)return;if(storyReader?.fail)storyReader.fail(error);else{const message=element('p','note',error.message);message.setAttribute('role','alert');host.replaceChildren(message);}}
}
$('story-dialog').addEventListener('close',()=>{storyGeneration++;storyReader?.destroy();storyReader=null;$('story-reader').replaceChildren();});

async function loadLibrary(session = currentSession) {
  if (!session) return;
  const generation = gameGeneration, request = session.libraryRequest = (session.libraryRequest || 0) + 1;
  const response = await fetch(session.path + 'library/index.json', { cache: 'no-store' });
  let nextLibrary;
  if (response.status === 404) {
    nextLibrary = { characters: [], images: [], audio: [], stories: [], skeletons: [] };
  } else {
    if (!response.ok) throw new Error(session.profile.label + '内容库还未生成。');
    nextLibrary = await response.json();
  }
  if (request !== session.libraryRequest) return false;
  session.library = nextLibrary;
  if (session.profile.prepareLibrary) session.library = session.profile.prepareLibrary(session.library);
  const previous = JSON.stringify([...session.favorites]);
  session.favorites = session.profile.readFavorites(previous, session.library);
  if (JSON.stringify([...session.favorites]) !== previous) {
    try { localStorage.setItem(session.profile.favoriteKey, JSON.stringify([...session.favorites])); } catch {}
  }
  if (generation !== gameGeneration || session !== currentSession) return false;
  library = session.library; favorites = session.favorites; applyRoute(); return true;
}
function discoverySummary(state) {
  if (currentSession.profile.discoveryIds === false) return '角色列表已更新，新增 ' + (state.added || 0) + ' 项角色或样式。';
  if (currentSession.profile.catalogHarImport) return '导入完成，新增 ' + (state.added || 0) + ' 位角色。';
  if (currentSession.profile.groupedCharacters) return '目录已更新' + (state.assetVersion ? '至 ' + state.assetVersion : '') + '，新增 ' + (state.added || 0) + ' 项角色或皮肤资源。';
  return '拉取完成，新增 ' + (state.added || 0) + ' 位角色。';
}
function renderHarFile(file?: File) {
  $('discovery-har-picker').classList.toggle('has-file', !!file);
  $('discovery-har-name').textContent = file?.name || '选择 HAR 文件';
  $('discovery-har-name').title = file?.name || '';
  $('discovery-har').title = file?.name || '选择本地 HAR 文件';
  $('discovery-har-meta').textContent = file
    ? (file.size < 1024 ** 2 ? Math.max(1, Math.ceil(file.size / 1024)) + ' KB' : (file.size / 1024 ** 2).toFixed(1) + ' MB') + ' · 本地文件'
    : '支持 .har / .json · 点击浏览本地文件';
  $('discovery-har-action').textContent = file ? '重新选择 ↗' : '选择文件 ↗';
}
$('discovery-har').addEventListener('change', () => renderHarFile($('discovery-har').files?.[0]));
function renderDiscoveryResult(state = collectionJob) {
  if (!$('discovery-dialog').open) return;
  const valid = state?.type === 'catalog'; $('discovery-result').hidden = !valid;
  $('discovery-roles').replaceChildren(); $('discovery-warning').hidden = true;
  if (!valid) return;
  if (state.state === 'running') {
    const phase = { client: '首次检查正在准备公开客户端配置', version: '正在检查游戏资源版本', catalog: '正在更新角色清单', icons: '正在补齐角色头像', indexing: '正在整理角色资料' }[state.phase] || '正在拉取新角色';
    $('discovery-message').textContent = phase + (state.targets ? ' · ' + (state.checked || 0) + ' / ' + state.targets : '') + '…'; return;
  }
  $('discovery-message').textContent = state.error || discoverySummary(state) + (state.missingIds?.length ? '有 ' + state.missingIds.length + ' 个编号未能确认。' : '');
  const warnings = [...(state.warnings || []), ...(state.errors || []).slice(0, 3).map(item => item.error)].filter(Boolean);
  $('discovery-warning').hidden = !warnings.length; $('discovery-warning').textContent = warnings.join('\n');
  for (const id of state.addedIds || []) {
    const character = library?.characters.find(character => character.id === (library.aliases?.[id] || id)); if (!character) continue;
    const style = character.styles?.find(style => style.id === id);
    const button = element('button', 'secondary-button', style ? style.name + ' · ' + id : character.name + (character.id !== id ? ' · 皮肤 ' : ' · ') + id);
    button.addEventListener('click', () => { if (style) character.activeStyleId = id; $('discovery-dialog').close(); openRole(character); }); $('discovery-roles').append(button);
  }
}
$('discover-characters').addEventListener('click', () => {
  if (!currentSession?.profile.features.discovery || collectionRunning) return;
  openDialog($('discovery-dialog')); renderDiscoveryResult();
  (currentSession.profile.catalogHarImport ? $('discovery-har') : currentSession.profile.discoveryIds === false ? $('discovery-submit') : $('discovery-ids')).focus();
});
$('discovery-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentSession?.profile.features.discovery || collectionRunning) return;
  const session = currentSession, generation = gameGeneration;
  const file = session.profile.catalogHarImport ? $('discovery-har').files?.[0] : null;
  clearTimeout(polling); statusGeneration++;
  session.discoveryIds = session.profile.discoveryIds === false ? '' : $('discovery-ids').value;
  session.collection.begin(); collectionRunning = true; collectionJob = { type: 'catalog', state: 'running', scope: 'catalog', phase: 'catalog', roles: [] };
  updateGetButtons(); renderDiscoveryResult();
  try {
    let payload: any = { ids: session.discoveryIds };
    if (session.profile.catalogHarImport) {
      if (!file) throw new Error('请先选择千年战争的 HAR 文件。');
      if (file.size > 512 * 1024 ** 2) throw new Error('HAR 文件超过 512 MiB，请只记录进入游戏时的请求后重新导出。');
      let har;
      try { har = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
      catch { throw new Error('HAR 文件不是有效的 JSON。'); }
      payload = { har: session.profile.selectCatalogHar(har) };
    }
    const response = await fetch(session.path + 'api/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error === '这款游戏暂不支持拉取新角色。'
      ? '后台尚未加载拉取功能，请重启项目服务后再试。' : job.error || '角色清单更新失败。');
    session.collection.observe(job); if (generation !== gameGeneration) return;
    collectionJob = job; await pollStatus(session);
  } catch (error) {
    session.collection.cancel(); if (generation !== gameGeneration) return;
    collectionRunning = false; updateGetButtons(); renderDiscoveryResult({ type: 'catalog', state: 'failed', error: error.message }); notify(error.message);
  }
});
async function pollStatus(session = currentSession) {
  if (!session || session !== currentSession) return;
  const generation = gameGeneration, request = ++statusGeneration;
  let delay = 5000;
  clearTimeout(polling);
  try {
    const response = await fetch(session.path + 'api/status', { cache: 'no-store' }); if (!response.ok) throw new Error('下载状态读取失败。');
    const state = await response.json();
    if (generation !== gameGeneration || session !== currentSession || request !== statusGeneration) return;
    const view = session.collection.observe(state);
    collectionJob = state; collectionRunning = view.running;
    $('collection-status').hidden = !view.visible; updateGetButtons(); renderDiscoveryResult();
    if (state) {
      const phase = { ui: '播放器 UI', client: '公开客户端配置', version: '游戏资源版本', catalog: '角色清单', icons: '角色头像', scripts: '剧情', indexing: '素材引用', cg: session.profile.features.stories ? 'CG 与剧情素材' : 'CG', motions: motionLabel(), portraits: '立绘', voices: '角色语音', extracting: '角色内容' }[state.phase] || session.profile.scopes[state.scope || 'all']?.label || '资源';
      $('collection-title').textContent = collectionRunning
        ? state.type === 'catalog' ? '正在' + (session.profile.catalogHarImport ? '导入' : '拉取') + session.profile.label + '的角色清单 · ' + phase : '正在获取角色 ' + (state.roles || []).join('、') + ' 的' + phase
        : { ready: '资源已更新', partial: '部分资源未完成', failed: '下载失败', interrupted: '下载已中断' }[state.state] || '任务已结束';
      const total = (state.phase === 'voices' ? state.voiceTargets : ['cg', 'motions'].includes(state.phase) ? state.mediaTargets : state.phase === 'portraits' ? state.portraitTargets : state.targets) ?? state.targets;
      const done = (state.phase === 'voices' ? state.voiceChecked : ['cg', 'motions'].includes(state.phase) ? state.mediaChecked : state.phase === 'portraits' ? state.portraitChecked : state.checked) ?? state.checked;
      $('collection-detail').textContent = collectionRunning && state.phase === 'extracting' ? '正在解包并更新内容…' : total > 0 ? (done || 0) + ' / ' + total : collectionRunning ? '正在准备资源…' : '处理已结束';
      $('collection-progress').max = total || 1;
      if (total > 0 && !(collectionRunning && state.phase === 'extracting')) $('collection-progress').value = done || 0;
      else $('collection-progress').removeAttribute('value');
      if (collectionRunning) delay = 1000;
      else if (view.completed) {
        const refreshed = await loadLibrary(session); if (!refreshed || generation !== gameGeneration || request !== statusGeneration) return;
        session.collection.acknowledge();
        if (state.error) notify(state.error);
        else if (state.failed) notify('部分资源未能下载：' + (state.errors?.[0]?.error || state.failed + ' 项失败。'));
        else if (state.state === 'interrupted') notify('下载已中断，可重新下载继续。');
        else if (state.placeholders) notify('资源已更新，已跳过 ' + state.placeholders + ' 项空白占位资源。');
        else if (state.type === 'catalog') notify(discoverySummary(state));
        else notify('下载完成，角色资源已更新。');
        renderDiscoveryResult(state);
        updateGetButtons();
      }
    }
  } catch { /* Keep completion pending until the local index can be refreshed. */ }
  finally {
    if (generation === gameGeneration && session === currentSession && request === statusGeneration)
      polling = setTimeout(() => pollStatus(session), delay);
  }
}

document.querySelectorAll<HTMLElement>('.nav-item').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
$('skip-to-content').addEventListener('click', event => {
  event.preventDefault(); $('main-content').focus({ preventScroll: true }); $('main-content').scrollIntoView();
});
$('search').addEventListener('input', () => {
  if (!catalogState) return;
  clearTimeout(searchTimer); limit = 72;
  catalogState[tab].query = $('search').value; catalogState[tab].limit = limit;
  searchTimer = setTimeout(renderCatalog, 180);
});
document.querySelectorAll<HTMLElement>('[data-availability]').forEach(button => button.addEventListener('click', () => {
  if (!catalogState) return;
  clearTimeout(searchTimer); limit = 72; catalogState[tab].limit = limit;
  catalogState[tab].availability = button.dataset.availability; renderCatalog();
}));
$('dynamic-filter').addEventListener('change', () => {
  if (!catalogState) return;
  clearTimeout(searchTimer); limit = 72; catalogState[tab].limit = limit;
  catalogState[tab].dynamicOnly = $('dynamic-filter').checked; renderCatalog();
});
$('rarity-filter').addEventListener('change', () => {
  if (!catalogState) return;
  clearTimeout(searchTimer); limit = 72; catalogState[tab].limit = limit;
  catalogState[tab].rarity = $('rarity-filter').value; renderCatalog();
});
$('artist-filter').addEventListener('change', () => {
  if (!catalogState) return;
  clearTimeout(searchTimer); limit = 72; catalogState[tab].limit = limit;
  catalogState[tab].artist = $('artist-filter').value; renderCatalog();
});
$('sort-order').addEventListener('change', () => {
  if (!catalogState) return;
  clearTimeout(searchTimer); limit = 72; catalogState[tab].limit = limit;
  catalogState[tab].sort = $('sort-order').value; renderCatalog();
});
$('more').addEventListener('click', () => { limit += 72; catalogState[tab].limit = limit; renderCatalog(); });
$('refresh').addEventListener('click', async () => { try { if (library) saveCatalog(); const changed = await loadProjects(); if (!changed && currentSession) { await loadLibrary(); await pollStatus(); } } catch (error) { notify(error.message); } });
$('back-to-catalog').addEventListener('click', backToCatalog);
$('role-favorite').addEventListener('click', () => { if (selectedRole) toggleFavorite(selectedRole.id); });
document.querySelectorAll<HTMLButtonElement>('[data-download-scope]').forEach(button => button.addEventListener('click', () => {
  if (selectedRole) getCharacter((currentSession.profile.downloadCharacter?.(selectedRole) || selectedRole).id, button.dataset.downloadScope);
}));
for (const id of ['portrait-forms', 'role-motions']) {
  $(id).addEventListener('keydown', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[role=tab]'); if (!target) return;
    const buttons = [...$(id).querySelectorAll<HTMLElement>('[role=tab]')], index = buttons.indexOf(target);
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
    if (nextIndex == null) return;
    event.preventDefault(); const next = buttons[nextIndex]; next.click(); ($(next.id) || next).focus({ preventScroll: true });
  });
}
document.querySelectorAll<HTMLElement>('[data-section]').forEach(button => {
  button.addEventListener('click', () => setRoleSection(button.dataset.section));
  button.addEventListener('keydown', event => {
    const buttons = [...document.querySelectorAll<HTMLElement>('[data-section]')].filter(button => !button.hidden), index = buttons.indexOf(button);
    const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
    if (next == null) return;
    event.preventDefault(); setRoleSection(buttons[next].dataset.section); buttons[next].focus();
  });
});
window.addEventListener('popstate', syncRoute);
window.addEventListener('hashchange', syncRoute);
window.addEventListener('storage', event => {
  for (const session of sessions.values()) {
    if (event.key !== session.profile.favoriteKey && event.key !== null) continue;
    session.favorites = session.profile.readFavorites(event.newValue, session.library);
    if (session === currentSession) { favorites = session.favorites; renderCatalog(); updateFavorite(); }
  }
});
loadProjects().catch(error => { $('page-description').textContent = error.message; notify(error.message); });
let moduleScan;
function refreshMountedGames() {
  if (document.hidden || moduleScan) return;
  moduleScan = loadProjects().catch(() => {}).finally(() => { moduleScan = null; });
}
window.addEventListener('focus', refreshMountedGames);
window.setInterval(refreshMountedGames, 5000);
