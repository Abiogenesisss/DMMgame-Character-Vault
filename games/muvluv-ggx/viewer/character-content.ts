'use strict';
const validId = id => typeof id === 'string' && /^\d{5,8}$/.test(id);
function catalogCharacters(library, { tab = 'characters', favorites = new Set<string>(), query = '', availability = 'all', rarity = 'all', dynamicOnly = false }: any = {}) {
  const search = query.trim().toLowerCase();
  return (library.characters || []).filter(character => (tab !== 'favorites' || favorites.has(character.id)) && (!dynamicOnly || character.hasDynamicCg)
    && (availability !== 'saved' || character.collected) && (availability !== 'missing' || !character.collected)
    && (rarity === 'all' || (rarity === 'unknown' ? character.rarityId == null : String(character.rarityId) === String(rarity)))
    && (!search || [character.name, character.id].join(' ').toLowerCase().includes(search)));
}
function readFavorites(value) { try { const items = JSON.parse(value || '[]'); return new Set(Array.isArray(items) ? items.filter(validId) : []); } catch { return new Set<string>(); } }
function readRoute(hash) {
  const [tab, id, section] = String(hash || '').replace(/^#/, '').split('/');
  return { tab: ['characters', 'favorites'].includes(tab) ? tab : 'characters', id: ['characters', 'favorites'].includes(tab) && validId(id) ? id : null,
    section: ['stories', 'voices'].includes(section) ? section : 'presentation' };
}
const routeHash = (tab, id, section = 'presentation') => '#' + tab + (id ? '/' + id + '/' + section : '');
const portraitStatus = character => character.portraits?.length ? '已保存 ' + character.portraits.length + ' 张立绘' : '暂无已保存的立绘。';
function roleContent(library, character) { return { portraits: (character.portraits || []).filter(item => item.file), cg: (character.cg || []).filter(item => item.file),
  voices: (library.audio || []).filter(item => item.character === character.id && item.context === 'character' && item.file),
  stories: (library.stories || []).filter(item => item.file && character.stories?.includes(item.id)), motions: (library.skeletons || []).filter(item => item.character === character.id && item.kind === 'cg' && item.file) }; }
function prepareLibrary(library) {
  // Older indexes omitted the saved flag when only a chapter was downloaded.
  // Derive it from indexed content; an avatar alone is not a collected role.
  return { ...library, characters: (library.characters || []).map(character => ({ ...character,
    collected: Object.values(roleContent(library, character)).some(items => items.length > 0) })) };
}
export { catalogCharacters, readFavorites, readRoute, routeHash, portraitStatus, roleContent, prepareLibrary };
