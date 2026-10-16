import fs from 'node:fs';
import path from 'node:path';
import { parseAddressables } from './addressables.ts';
import { Resources, readJson, writeJson, validBundle, validId } from './resources.ts';
import { runUnity } from './unity.ts';
import { cardPortraits } from './portraits.ts';

export function readCatalog(root: string) {
  const catalog = readJson(path.join(root, 'metadata/catalog.json'), { characters: [], assets: {}, settings: {} });
  catalog.characters = catalog.characters.map(role => ({ ...role, portraitAssets: cardPortraits(role.portraitAssets) }));
  return catalog;
}
export function bundleNames(locations: any[], entry: any) {
  const result = new Set<string>(), visiting = new Set<number>();
  function visit(id: number, depth = 0) {
    const item = locations[id]; if (!item || depth > 64 || visiting.has(id)) throw new Error('资源目录依赖无效。');
    const name = item.internalId.replace('{UnityEngine.AddressableAssets.Addressables.RuntimePath}/', '');
    if (validBundle(name)) { result.add(name); return; }
    visiting.add(id); item.dependencies.forEach(n => visit(n, depth + 1)); visiting.delete(id);
  }
  entry.dependencies.forEach(id => visit(id)); return [...result];
}
export function aliasKey(file: string) {
  return file.replace(/^Assets\/AssetBundles\//, '').replace(/\/(?:HighQuality|LowQuality)\/(?:general|adult)\//, '/').replace(/\/(?:HighQuality|LowQuality)\//, '/');
}
export function catalogFromLocations(groups: any[][], settings: any) {
  const assets: Record<string, any> = {}, aliases: Record<string, string> = {};
  const types = new Set(['UnityEngine.Sprite', 'UnityEngine.Texture2D', 'UnityEngine.AudioClip', 'UnityEngine.GameObject', 'Spine.Unity.SkeletonDataAsset', 'Utage.AdvChapterData']);
  for (const locations of groups) {
    const spriteIds = new Set(locations.filter(a => a.type === 'UnityEngine.Sprite').map(a => a.internalId));
    for (const item of locations) {
    if (!types.has(item.type) || /\/LowQuality\//.test(item.internalId)) continue;
    if (!/^Assets\/(?:AssetBundles\/(?:Characters|Stills|Sprites\/Chara\/Thumb_005\/L|Sound|Adventure)|Adventure\/ImportChara)\//.test(item.internalId) && item.internalId !== 'Assets/Sprites/Common/Button/btn_common.png') continue;
    if (item.type === 'UnityEngine.GameObject' && !/^Assets\/AssetBundles\/Adventure\//.test(item.internalId)) continue;
    if (/\/Sound\/Voice\//.test(item.internalId) && !/\/Sound\/Voice\/(?:\d{7}|ImportChara\/\d{7})\//.test(item.internalId)) continue;
    if (/\/AssetBundles\/(?:Characters|Stills)\//.test(item.internalId) && item.type !== 'Spine.Unity.SkeletonDataAsset') continue;
    if (item.type === 'UnityEngine.Texture2D' && spriteIds.has(item.internalId)) continue;
    const kind = item.type.endsWith('SkeletonDataAsset') ? 'spine' : item.type.endsWith('AudioClip') ? 'audio' : item.type.endsWith('AdvChapterData') ? 'story' : item.type.endsWith('GameObject') ? 'effect' : 'image';
    assets[item.internalId] = { id: item.internalId, internalId: item.internalId, type: item.type, kind, bundles: bundleNames(locations, item) };
    const key = aliasKey(item.internalId);
    if (!aliases[key] || /\/adult\//.test(item.internalId)) aliases[key] = item.internalId;
    }
  }
  const configs = (settings.Character || []).filter(row => row.FileName && !row.CharacterName.endsWith('L'));
  const characters = [];
  for (const asset of Object.values<any>(assets)) {
    const match = /^Assets\/Adventure\/ImportChara\/(\d{7})\.chapter\.asset$/.exec(asset.id); if (!match || !validId(match[1])) continue;
    const id = match[1], rows = configs.filter(row => row.FileName.includes('/ch_' + id + '/'));
    const icon = Object.keys(assets).find(key => key.endsWith(`/Thumb_005/L/chara_${id}_2_1.png`));
    if (!icon || !rows.length) continue;
    const portraitMap = new Map<string, any>();
    for (const row of rows) { const key = aliases[row.FileName]; if (key) portraitMap.set(key, { asset: key, label: row.CharacterName, name: row.NameText }); }
    const portraits = cardPortraits([...portraitMap.values()]);
    const name = rows[0].NameText || rows[0].CharacterName;
    const variant = rows.find(row => /_m1_SkeletonData/.test(row.FileName))?.CharacterName;
    const label = variant && !/(?:戦闘服|制服)$/.test(variant) ? variant : name;
    const motions = Object.keys(assets).filter(key => new RegExp('/Stills/st_' + id + '(?:_\\d+)?/st_' + id + '(?:_\\d+)?_SkeletonData\\.asset$').test(key));
    const voices = Object.keys(assets).filter(key => new RegExp('/Sound/Voice/' + id + '/vo_c' + id + '_\\d+\\.ogg$').test(key));
    characters.push({ id, name: label, nameAliases: [...new Set([name, ...rows.map(r => r.CharacterName)])], iconAsset: icon,
      portraitAssets: portraits, motionAssets: motions, voiceAssets: voices, storyAsset: asset.id,
      hasDynamicCg: !!motions.length, cgAvailable: !!motions.length, voiceAvailable: !!voices.length, storyAvailable: true });
  }
  characters.sort((a, b) => a.id.localeCompare(b.id));
  if (!characters.length) throw new Error('资源目录中没有可识别的角色卡。');
  return { version: 3, game: 'twinkle-star-knights', characters, assets, aliases, settings };
}

export async function prepareCatalog(root: string, { resources = new Resources(root), refresh = false } = {}) {
  const metadata = path.join(root, 'metadata'), groups = [];
  for (const name of ['catalog', 'catalog_sound']) {
    const file = await resources.get(name + '.bundle', refresh), output = path.join(metadata, name + '-raw.json');
    if (refresh || !fs.existsSync(output)) await runUnity({ command: 'catalog', file, output });
    groups.push(parseAddressables(readJson(output)));
  }
  const master = groups[0].find(a => a.internalId === 'Assets/Adventure/Master.chapter.asset' && a.type === 'Utage.AdvChapterData');
  if (!master) throw new Error('缺少角色与场景配置。');
  const files = []; for (const name of bundleNames(groups[0], master)) files.push(await resources.get(name));
  const settingsPath = path.join(metadata, 'scene-settings.json');
  await runUnity({ command: 'settings', files, output: settingsPath });
  const catalog = catalogFromLocations(groups, readJson(settingsPath));
  writeJson(path.join(metadata, 'catalog.json'), catalog); resources.save(); return catalog;
}
