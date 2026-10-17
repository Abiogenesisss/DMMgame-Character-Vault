const validId = value => typeof value === 'string' && /^\d{6}$/.test(value);
function catalogCharacters(library, { tab = 'characters', favorites = new Set<string>(), query = '', availability = 'all', rarity = 'all' }: any = {}) {
  const search = query.trim().toLowerCase();
  return (library.characters || []).filter(role => (tab !== 'favorites' || favorites.has(role.id)) && (availability !== 'saved' || role.collected) && (availability !== 'missing' || !role.collected)
    && (rarity === 'all' || (rarity === 'unknown' ? role.rarityId == null : String(role.rarityId) === rarity))
    && (!search || [role.id, role.name, role.shortName, role.kind === 'summon' ? '战神 戦神' : '角色 ミナシゴ'].join(' ').toLowerCase().includes(search)));
}
function readFavorites(value) { try { const list = JSON.parse(value || '[]'); return new Set<string>(Array.isArray(list) ? list.filter(validId) : []); } catch { return new Set<string>(); } }
function readRoute(hash) {
  const [page, id, section] = String(hash || '').replace(/^#/, '').split('/');
  return { tab: ['characters', 'favorites'].includes(page) ? page : 'characters', id: validId(id) ? id : null, section: ['stories', 'voices'].includes(section) ? section : 'presentation' };
}
const routeHash = (tab, id, section = 'presentation') => '#' + tab + (id ? '/' + id + '/' + section : '');
const portraitStatus = role => role.portraits?.length ? '已保存 ' + role.portraits.length + ' 张立绘' : '暂无已保存的立绘。';
function roleContent(library, role) {
  const saved = (library.stories || []).filter(story => story.character === role.id);
  const chapters = (role.storyChapters || []).map(chapter => ({ ...chapter, character: role.id, downloaded: false }));
  const stories = [...new Map([...chapters, ...saved].map(story => [story.id, story])).values()];
  return { portraits: role.portraits || [], cg: role.cg || [], motions: [], stories, voices: (library.audio || []).filter(voice => voice.character === role.id && voice.context === 'character') };
}
export { catalogCharacters, readFavorites, readRoute, routeHash, portraitStatus, roleContent };
