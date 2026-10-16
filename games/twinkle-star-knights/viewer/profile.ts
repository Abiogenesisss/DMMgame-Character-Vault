import { cardPortraits } from '../src/portraits.ts';
// Browser validation uses the public card ID grammar without Node imports.
const canonical = (id: unknown) => typeof id === 'string' && /^[12]\d{6}$/.test(id) ? id : null;
export function catalogCharacters(library, { tab = 'characters', favorites = new Set(), query = '', availability = 'all' }: any = {}) {
  const search = query.trim().toLowerCase();
  return (library.characters || []).filter(c => (tab !== 'favorites' || favorites.has(c.id))
    && (availability !== 'saved' || c.collected) && (availability !== 'missing' || !c.collected)
    && (!search || [c.id, c.name, ...(c.nameAliases || [])].join(' ').toLowerCase().includes(search)));
}
export function readFavorites(value) { try { const ids = JSON.parse(value || '[]'); return new Set<string>(Array.isArray(ids) ? ids.map(canonical).filter(Boolean) : []); } catch { return new Set<string>(); } }
export function readRoute(hash) { const [page, id, section] = String(hash || '').replace(/^#/, '').split('/'); return { tab: ['characters', 'favorites'].includes(page) ? page : 'characters', id: ['characters', 'favorites'].includes(page) ? canonical(id) : null, section: ['stories', 'voices'].includes(section) ? section : 'presentation' }; }
export const routeHash = (tab, id, section = 'presentation') => '#' + tab + (id ? '/' + id + '/' + section : '');
export const roleContent = (library, character) => ({ portraits: cardPortraits(character.portraits), cg: [], stories: (library.stories || []).filter(s => s.character === character.id),
  voices: (library.audio || []).filter(a => a.character === character.id && a.context === 'character'), motions: (library.skeletons || []).filter(s => s.character === character.id && s.kind === 'cg') });
export default {
  label: '闪耀星骑士', title: 'TWINKLE STAR KNIGHTS X', favoriteKey: 'twinkle-favorites-v1', glyph: '✧',
  description: '选择角色，鉴赏立绘、动态 CG、剧情和语音。', roleDescription: '立绘、动态 CG、剧情与语音鉴赏',
  note: '每张角色卡独立收藏和下载，立绘优先展示对应变体，共用制服排在后面。',
  discoveryHint: '留空更新完整资源目录，并补齐角色头像。', voiceDescription: '角色日常语音。剧情配音只在对应章节中播放。',
  requiresCompleteStories: true,
  features: { presentation: true, sections: true, voices: true, stories: true, motions: true, dynamicCg: false, discovery: true, rarity: false, artists: false },
  scopes: { all: { label: '角色资源' }, portraits: { label: '立绘' }, cg: { label: 'CG', savedFrom: ['motions'] }, motions: { label: 'CG' }, stories: { label: '剧情' }, voices: { label: '角色语音' }, ui: { label: '播放器 UI', cachedLabel: '检查播放器 UI' } },
  catalogCharacters, readFavorites, readRoute, routeHash, roleContent,
  portraitStatus: c => cardPortraits(c.portraits).length ? '已保存 ' + cardPortraits(c.portraits).length + ' 套立绘' : '暂无已保存的立绘。'
};
