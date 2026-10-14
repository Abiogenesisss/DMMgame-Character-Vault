'use strict';
const {characterArtists}=require('./artists.ts');
const SORT_ORDERS = [
  { id: 'id-asc', label: '编号：从小到大' }, { id: 'id-desc', label: '编号：从大到小' },
  { id: 'name-asc', label: '名称：正序' }, { id: 'name-desc', label: '名称：倒序' },
  { id: 'rarity-desc', label: '稀有度：从高到低', feature: 'rarity' }, { id: 'rarity-asc', label: '稀有度：从低到高', feature: 'rarity' },
  { id: 'artist-asc', label: '画师：正序', feature: 'artists' }
];
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
function compareIds(a, b, direction = 1) {
  const left = String(a.id), right = String(b.id);
  // Independently numbered event/skin entries follow regular characters in
  // either direction, so descending IDs still start with the newest units.
  return Number(!/^\d+$/.test(left)) - Number(!/^\d+$/.test(right)) || direction * collator.compare(left, right);
}
function sortCharacters(characters, order = 'id-asc', rarities = []) {
  const rarityRanks = new Map(rarities.map((rarity, index) => [rarity.id, index]));
  return [...characters].sort((a, b) => {
    if (order === 'id-desc') return compareIds(a, b, -1);
    if (order === 'name-asc' || order === 'name-desc') return (order === 'name-asc' ? 1 : -1) * collator.compare(a.name || '', b.name || '') || compareIds(a, b);
    if (order === 'artist-asc') {
      const left = characterArtists(a).join(' / '), right = characterArtists(b).join(' / ');
      return Number(!left) - Number(!right) || collator.compare(left, right) || compareIds(a, b);
    }
    if (order === 'rarity-asc' || order === 'rarity-desc') {
      const left = rarityRanks.get(a.rarityId), right = rarityRanks.get(b.rarityId);
      // Raw rarity IDs are not tier ranks (sapphire is 7). Unknown tiers stay last.
      if (left == null || right == null) return Number(left == null) - Number(right == null) || compareIds(a, b);
      return (order === 'rarity-desc' ? 1 : -1) * (left - right) || compareIds(a, b);
    }
    return compareIds(a, b);
  });
}
const GAMES=Object.create(null);
function registerGame(id,profile){if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)||!profile||typeof profile.catalogCharacters!=='function')throw new Error('游戏模块无效。');GAMES[id]=profile;}
function gameFromPath(pathname) { return /^\/games\/([a-z0-9][a-z0-9_-]{0,63})(?:\/|$)/.exec(pathname)?.[1] || null; }
function gameSession(project) {
  const profile = GAMES[project.adapter]; if (!profile) throw new Error('这款游戏没有配置鉴赏页面。');
  return { id: project.id, path: '/games/' + project.id + '/', profile, hash: '#characters', library: null, favorites: new Set<string>(),
    views: Object.fromEntries(['characters', 'favorites'].map(page => [page, { query: '', availability: 'all', rarity: 'all', artist: 'all', sort: 'id-asc', dynamicOnly: false, limit: 72, scroll: 0, focusId: null }])),
    collection: collectionTracker() };
}
function collectionTracker() {
  let observed = false;
  return {
    latest: null,
    begin() { observed = true; }, cancel() { observed = false; },
    observe(state) {
      const running = state?.state === 'running', completed = !!state && !running && observed;
      observed = running; this.latest = state;
      // Historical terminal states are ignored on first load. Completion is a
      // short toast after a job observed/started in this session, never a banner.
      return { running, visible: running, completed };
    }
  };
}
export { GAMES, registerGame, SORT_ORDERS, sortCharacters, gameFromPath, gameSession, collectionTracker };
