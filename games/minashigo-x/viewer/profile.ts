import * as content from './character-content.ts';
export default { ...content, label: 'ミナシゴノシゴト', title: 'MINASHIGO NO SHIGOTO X', favoriteKey: 'minashigo-favorites-v1', storyPositionPrefix: 'minashigo-story-position-',
  description: '选择角色或战神，鉴赏立绘、CG、语音与剧情。', roleDescription: '立绘、CG、语音与剧情鉴赏', glyph: '♜',
  emptyCatalogMessage: '首次使用请点击“拉取新角色”，在线获取角色目录与头像。',
  note: '角色与战神按原编号收录，可搜索“战神”筛选。CG 与剧情支持按需下载，无需逐个抓 HAR。',
  discoveryLabel: '拉取新角色', discoveryIds: false, discoveryHint: '自动检查公开主数据，补充角色与战神清单，并下载缺失头像，已有头像直接复用。立绘、CG、语音和剧情可在角色页按需下载，无需登录 DMM。',
  requiresCompleteStories: true,
  features: { presentation: true, sections: true, voices: true, stories: true, motions: false, dynamicCg: false, dynamicFilter: false, rarity: true, artists: false, discovery: true },
  rarities: [{ id: 4, label: 'SSR' }, { id: 3, label: 'SR' }, { id: 2, label: 'R' }],
  scopes: { catalog: { label: '图鉴头像' }, all: { label: '当前角色全部资源' }, portraits: { label: '立绘' }, cg: { label: 'CG' }, voices: { label: '角色语音' }, stories: { label: '剧情' }, ui: { label: '播放器 UI', cachedLabel: '播放器 UI 已就绪' } }
};
