'use strict';
const { canonicalId } = require('../src/identity.ts');
function catalogCharacters(library, { tab = 'characters', favorites = new Set<string>(), query = '', availability = 'all', rarity = 'all', dynamicOnly = false }: any = {}) {
  const search = query.trim().toLowerCase();
  return (library.characters || []).filter(character => (tab !== 'favorites' || favorites.has(character.id)) && (!dynamicOnly || character.hasDynamicCg)
    && (availability !== 'saved' || character.collected) && (availability !== 'missing' || !character.collected)
    && (rarity === 'all' || (rarity === 'unknown' ? character.rarityId == null : String(character.rarityId) === String(rarity)))
    && (!search || [character.name, character.id, ...(character.variants || [])].join(' ').toLowerCase().includes(search)));
}
function readFavorites(value, library) {
  try { const items = JSON.parse(value || '[]'); return new Set(Array.isArray(items) ? items.filter(id => typeof id === 'string').map(id => canonicalId(id, library)).filter(Boolean) : []); } catch { return new Set<string>(); }
}
function readRoute(hash, library) {
  const [page, id, section] = String(hash || '').replace(/^#/, '').split('/');
  return { tab: ['characters', 'favorites'].includes(page) ? page : 'characters', id: ['characters', 'favorites'].includes(page) ? canonicalId(id, library) : null, section: section === 'voices' ? section : 'presentation' };
}
const routeHash = (tab, id, section = 'presentation') => '#' + tab + (id ? '/' + id + '/' + section : '');
const portraitStatus = character => character.portraits?.length ? '已保存 ' + character.portraits.length + ' 张立绘' : '暂无已保存的立绘。';
function roleContent(library, character) { return { portraits: character.portraits || [], cg: character.cg || [], stories: [],
  voices: (library.audio || []).filter(item => item.character === character.id && !['music', 'sound'].includes(item.context)), motions: (library.skeletons || []).filter(item => item.character === character.id) }; }
export { catalogCharacters, readFavorites, readRoute, routeHash, portraitStatus, roleContent };
