'use strict';
const { canonicalId } = require('../src/character-identity.ts');
const { isGamePortrait } = require('../src/portraits.ts');
const { characterArtists, matchesArtist } = require('../../../app/viewer/artists.ts');
function portraitStatus(character) {
  const saved = (character.portraits || []).filter(item => item.file && isGamePortrait(item));
  const placeholders = (character.placeholders || []).filter(item => item.category === 'portraits').length;
  if (saved.length) return '已保存 ' + saved.length + ' 张立绘' + (placeholders ? '，已跳过空白占位图。' : '');
  if (placeholders) return placeholders >= character.portraitTotal ? '该编号的立绘资源为占位图，暂无可用立绘。' : '部分立绘资源为占位图，其他形态尚未保存。';
  return '暂无已保存的立绘。';
}
function catalogCharacters(library, { tab = 'characters', favorites = new Set<string>(), query = '', availability = 'all', rarity = 'all', artist = 'all' }: any = {}) {
  const search = query.trim().toLowerCase();
  return (library.characters || []).filter(character => (tab !== 'favorites' || favorites.has(character.id))
    && (availability !== 'saved' || character.collected) && (availability !== 'missing' || !character.collected)
    && (rarity === 'all' || (rarity === 'unknown' ? character.rarityId == null : String(character.rarityId) === String(rarity)))
    && matchesArtist(character, artist)
    && (!search || [character.name, character.id, ...characterArtists(character)].join(' ').toLowerCase().includes(search)));
}
function readFavorites(value) {
  try { const items = JSON.parse(value || '[]'); return new Set<string>(Array.isArray(items) ? items.filter(id => typeof id === 'string').map(id => canonicalId(id) as string).filter(Boolean) : []); }
  catch { return new Set<string>(); }
}
function readRoute(hash) {
  const [page, id] = String(hash || '').replace(/^#/, '').split('/');
  return { tab: ['characters', 'favorites'].includes(page) ? page : 'characters', id: ['characters', 'favorites'].includes(page) ? canonicalId(id) : null };
}
export { catalogCharacters, portraitStatus, readFavorites, readRoute };
