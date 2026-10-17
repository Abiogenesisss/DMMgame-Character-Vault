'use strict';
const COLLECTION_SCOPES = {
  all: { label: '角色全部资源', phase: 'scripts' },
  portraits: { label: '立绘', phase: 'portraits' },
  cg: { label: 'CG', phase: 'indexing' },
  motions: { label: '动态 CG', phase: 'indexing' },
  stories: { label: '剧情', phase: 'scripts' },
  voices: { label: '角色语音', phase: 'voices' },
  ui: { label: '播放器 UI', cachedLabel: '检查播放器 UI', phase: 'ui' }
};
function collectionScope({ scope, voicesOnly }: any = {}) {
  if (voicesOnly !== undefined && typeof voicesOnly !== 'boolean') throw new Error('语音获取选项有误。');
  const value = scope ?? (voicesOnly ? 'voices' : 'all');
  if (typeof value !== 'string' || !Object.hasOwn(COLLECTION_SCOPES, value)) throw new Error('资源下载范围有误。');
  if (voicesOnly && value !== 'voices') throw new Error('资源下载范围与语音选项冲突。');
  return value;
}
function wantsDependency(scope, item) {
  if (scope === 'cg') return item.type === 'image' && item.reference.startsWith('hscene');
  if (scope === 'motions') return ['skeleton', 'atlas', 'texture'].includes(item.type);
  return scope === 'all' || scope === 'stories';
}
export { COLLECTION_SCOPES, collectionScope, wantsDependency };
