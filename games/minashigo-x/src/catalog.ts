import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
const fs = require('node:fs'), path = require('node:path');
const { logicalPath, resourceSpec, validId } = require('./format.ts');
const readJson = (file, fallback?: any) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const writeJson = (file, value) => writeAtomicFileSync(file, JSON.stringify(value));
const readCatalog = root => readJson(path.join(root, 'metadata/catalog.json'), { characters: [], assets: {} });
const RARITIES = [{ id: 4, label: 'SSR' }, { id: 3, label: 'SR' }, { id: 2, label: 'R' }];
const VOICE_GROUPS = { 1: '日常', 2: '战斗', 7: '入手与演出', 8: '养成', 9: '编成' };
const STORY_SOURCE_VERSION = 2;
function storySources(rows, id) {
  const orders = new Map<string, number>();
  return rows.filter(row => row.unitId === Number(id)).sort((a, b) => a.category - b.category || a.storyId - b.storyId).flatMap(row => {
    const resource = row.resourcePathR18 || row.resourcePath;
    if (!/^\d{5,10}$/.test(String(row.storyId))) return [];
    // Diaries are complete MP3 episodes; side stories also use ex*/ev* names.
    // Chapter identity comes from storyId, never the repeated category title.
    const audio = /^adv\/sound\/voice\/[A-Za-z0-9_-]+\.mp3$/.test(resource || '');
    if (!audio && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(resource || '')) return [];
    const group = row.category + ':' + (row.title || '角色剧情'), order = (orders.get(group) || 0) + 1; orders.set(group, order);
    const title = row.category === 4 ? '外传 · ' + (row.name || '角色外传') + ' · 第 ' + (row.title || order) + ' 话' : (row.title || '角色剧情') + ' · ' + order;
    return [{ id: String(row.storyId), title, ...(audio ? { audio: resource } : { script: 'adv/textfiles/story/' + resource + '.txt' }), type: row.contentType }];
  });
}
function applyStoryResources(catalog, scenes) {
  for (const saved of scenes) {
    const role = catalog.characters.find(role => role.storySources?.some(source => source.id === String(saved.storyId))); if (!role) continue;
    const source = role.storySources.find(source => source.id === String(saved.storyId)), resources = [];
    for (const record of saved.resources || []) {
      const name = logicalPath(record.path); if (!name?.startsWith('adv/')) throw new Error('剧情资源路径无效。');
      const spec = resourceSpec(record, saved.version || catalog.resourceVersion);
      catalog.assets[name] = spec; resources.push(name);
      if (new RegExp('^adv/image/(?:character|summon)/' + role.id + '/image/[^/]+\\.(jpg|jpeg|png)$').test(name) && !role.cg.includes(name)) role.cg.push(name);
    }
    if (!resources.includes(source.audio || source.script)) throw new Error('剧情资源清单缺少对应主文件。');
    // A CG-only lookup publishes image addresses, never a half-mapped chapter.
    // Keep any previously downloaded/full chapter intact until a story refresh.
    if (saved.completeMap === false) continue;
    const missingResources = [...new Set<string>((saved.missingResources || []).map(logicalPath))];
    if (missingResources.some(name => !name?.startsWith('adv/'))) throw new Error('缺失的剧情资源路径无效。');
    const value = { id: source.id, character: role.id, title: source.title, adult: source.type === 2, ...(source.audio ? { kind: 'audio', audio: source.audio } : { script: source.script }),
      version: saved.version || catalog.resourceVersion, resources: [...new Set(resources)], ...(missingResources.length ? { missingResources } : {}) };
    const index = role.stories.findIndex(story => story.id === value.id); if (index < 0) role.stories.push(value); else role.stories[index] = value;
  }
  return catalog;
}
function buildCatalog(tables, manifest, captured = [], previous = { characters: [], assets: {} }) {
  const assets = { ...previous.assets }, characters = [], keys = Object.keys(manifest.assets);
  const publicAsset = name => {
    const options = manifest.assets[name], value = options?.[3] || options?.[0]; if (!value) return null;
    assets[name] = resourceSpec({ path: name, md5: value.md5 }, manifest.version); return name;
  };
  const voicePaths = new Map();
  for (const key of keys) {
    const match = /^sound\/voice\/(character|summon)\/(?:\d+\/)?([^/]+)\.mp3$/.exec(key);
    if (match) { const id = match[1] + ':' + match[2], list = voicePaths.get(id) || []; list.push(key); voicePaths.set(id, list); }
  }
  const old = new Map<string, any>(previous.characters.map(role => [role.id, role]));
  for (const [kind, mainName, textName] of [['character', 'CharacterMain', 'CharacterText'], ['summon', 'SummonMain', 'SummonText']]) {
    for (const row of tables[mainName] || []) {
      const id = String(row.id); if (!validId(id) || row.unitType !== 1 || typeof row.name !== 'string' || !row.name.trim()) continue;
      if (characters.some(role => role.id === id)) throw new Error('角色主数据包含重复编号。');
      const prefix = 'image/' + kind + '/', portraits = ['03', '01', '02', '05', '06', '07'].map(phase => publicAsset(prefix + 'stand/' + id + phase + '.png')).filter(Boolean);
      const icon = publicAsset(prefix + 'icon/' + id + '.png');
      const voices = [];
      for (const text of tables[textName] || []) if (text.id === row.id && text.voiceFile) {
        for (const file of voicePaths.get(kind + ':' + text.voiceFile) || []) if (publicAsset(file) && !voices.some(voice => voice.path === file)) voices.push({ path: file, label: text.title || text.voiceFile, group: String(text.sceneType), groupLabel: VOICE_GROUPS[text.sceneType] || '其他语音' });
      }
      const before = old.get(id), sources = storySources(tables.StoryMain || [], id);
      const stories = (before?.stories || []).map(story => ({ ...story, title: sources.find(source => source.id === story.id)?.title || story.title })), cg = [...(before?.cg || [])];
      if (!portraits.length && !voices.length && !icon && !before) continue;
      characters.push({ id, name: row.name, shortName: row.shortName || row.name, kind, groupId: row.groupId, rarityId: row.rarity,
        rarityLabel: RARITIES.find(rarity => rarity.id === row.rarity)?.label || '未标注', icon: icon || before?.icon || null,
        portraits: [...new Set([...portraits, ...(before?.portraits || [])])], voices: [...new Map([...(before?.voices || []), ...voices].map(voice => [voice.path, voice])).values()], cg, stories,
        storySources: sources });
      old.delete(id);
    }
  }
  characters.push(...old.values()); characters.sort((a, b) => Number(a.id) - Number(b.id));
  if (!characters.length || !Object.keys(assets).length) throw new Error('新目录没有有效角色，已保留原清单。');
  return applyStoryResources({ version: 1, game: 'minashigo-x', storySourceVersion: STORY_SOURCE_VERSION, resourceVersion: manifest.version, characters, assets }, captured);
}
export { readJson, writeJson, readCatalog, buildCatalog, applyStoryResources, storySources, STORY_SOURCE_VERSION, RARITIES };
