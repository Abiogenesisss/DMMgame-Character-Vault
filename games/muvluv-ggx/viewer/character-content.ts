'use strict';
const validId = id => typeof id === 'string' && /^\d{5,8}$/.test(id);
function catalogCharacters(library, { tab = 'characters', favorites = new Set<string>(), query = '', availability = 'all', rarity = 'all', dynamicOnly = false }: any = {}) {
  const search = query.trim().toLowerCase();
  return (library.characters || []).filter(character => (tab !== 'favorites' || favorites.has(character.id)) && (!dynamicOnly || character.hasDynamicCg)
    && (availability !== 'saved' || character.collected) && (availability !== 'missing' || !character.collected)
    && (rarity === 'all' || (character.styles || [character]).some(style => rarity === 'unknown' ? style.rarityId == null : String(style.rarityId) === String(rarity)))
    && (!search || [character.name, character.id, character.profile?.reading, character.profile?.team,
      ...(character.styles || []).flatMap(style => [style.id, style.name, style.subtitle])].join(' ').toLowerCase().includes(search)));
}
function readFavorites(value, library) { try { const items = JSON.parse(value || '[]'); return new Set(Array.isArray(items) ? items.filter(validId).map(id => library?.aliases?.[id] || id) : []); } catch { return new Set<string>(); } }
function readRoute(hash, library) {
  const [tab, id, section] = String(hash || '').replace(/^#/, '').split('/');
  const canonical = library?.aliases?.[id] || id;
  if (canonical !== id) { const character = library.characters.find(c => c.id === canonical); if (character) character.activeStyleId = id; }
  return { tab: ['characters', 'favorites'].includes(tab) ? tab : 'characters', id: ['characters', 'favorites'].includes(tab) && validId(id) ? canonical : null,
    section: ['stories', 'voices'].includes(section) ? section : 'presentation' };
}
const routeHash = (tab, id, section = 'presentation') => '#' + tab + (id ? '/' + id + '/' + section : '');
const portraitStatus = character => { const style = activeStyle(character); return style.portraits?.length ? '当前样式已保存 ' + style.portraits.length + ' 项立绘资源' : '当前样式尚未保存立绘。'; };
const rarityValues = character => [...new Set((character.styles || [character]).map(style => style.rarityId))];
function activeStyle(character) { return character.styles?.find(style => style.id === character.activeStyleId) || character.styles?.[0] || character; }
function roleContent(library, character) { character = activeStyle(character); return { portraits: (character.portraits || []).filter(item => item.file), cg: (character.cg || []).filter(item => item.file),
  voices: (library.audio || []).filter(item => item.character === character.id && item.context === 'character' && item.file),
  stories: (library.stories || []).filter(item => item.file && character.stories?.includes(item.id)), motions: (library.skeletons || []).filter(item => item.character === character.id && item.kind === 'cg' && item.file) }; }
function prepareLibrary(library) {
  if (library.muvPortalVersion === 1) return library;
  const groups = new Map(), aliases = {};
  for (const original of library.characters || []) {
    const character = { ...original, collected: Object.values(roleContent(library, original)).some(items => items.length > 0) };
    const key = character.parentPersonId ?? character.personId ?? character.id;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(character);
  }
  const characters = [...groups.values()].map(members => {
    const styles = members.sort((a, b) => Number(a.parentPersonId != null) - Number(b.parentPersonId != null)
      || (a.styleOrder ?? Number(a.id)) - (b.styleOrder ?? Number(b.id)));
    const base = styles[0];
    for (const style of styles) aliases[style.id] = base.id;
    return { ...base, name: base.shortName || base.name, icon: null, styles, memberIds: styles.map(style => style.id),
      rarityId: Math.max(...styles.map(style => style.rarityId || 0)) || null, collected: styles.some(style => style.collected),
      portraits: styles.flatMap(style => style.portraits || []), hasDynamicCg: styles.some(style => style.hasDynamicCg),
      stories: [...new Set(styles.flatMap(style => style.stories || []))] };
  });
  return { ...library, muvPortalVersion: 1, characters, aliases };
}
export { catalogCharacters, readFavorites, readRoute, routeHash, portraitStatus, roleContent, prepareLibrary, activeStyle, rarityValues };
