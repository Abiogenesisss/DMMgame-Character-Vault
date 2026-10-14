'use strict';
const fs = require('node:fs'), path = require('node:path');
const { ORIGIN, resourceKind, validId } = require('./format.ts');
const { parseAddressables } = require('./addressables.ts');
const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(value)); fs.renameSync(file + '.tmp', file); }
function buildAssets(locations, source) {
  const byId = new Map<any, any>(locations.map(item => [item.id, item])), assets = {}, conflicts = new Set<string>();
  function bundles(item, seen = new Set<string>()) {
    if (seen.has(item.id)) return []; seen.add(item.id);
    if (item.type === 'UnityEngine.ResourceManagement.ResourceProviders.IAssetBundleResource') {
      if (item.internalId.startsWith('{Absf.Asset.AddressableAssets.AddressablesProfileDefine.LocalLoadPath}/')) return null;
      const relative = item.internalId.replace(/^\{Absf\.Asset\.AddressableAssets\.AddressablesProfileDefine\.RemoteLoadPath\}\//, '');
      const url = /^https:/.test(item.internalId) ? item.internalId : source.bundleBase + relative;
      if (resourceKind(url) !== 'bundle') throw new Error('资源目录包含无效素材地址。');
      return [url];
    }
    const values=item.dependencies.map(id => { const child = byId.get(id); if (!child) throw new Error('资源目录缺少依赖。'); return bundles(child, seen); });
    return values.some(value=>value===null)?null:values.flat();
  }
  const supported = new Set(['UnityEngine.GameObject', 'UnityEngine.Sprite', 'UnityEngine.Texture2D', 'UnityEngine.TextAsset', 'Project.Ingame.UnitResourceAsset', 'Project.Novel.NovelScriptFileAsset', 'CriWare.Assets.CriAtomAcbAsset', 'UnityEngine.ResourceManagement.ResourceProviders.SceneInstance']);
  for (const item of locations) {
    if (!supported.has(item.type) || !item.address?.startsWith('Assets/Project/LazyAssets/') || conflicts.has(item.address)) continue;
    if(item.type.endsWith('.SceneInstance')&&item.address!=='Assets/Project/LazyAssets/Scenes/Novel.unity')continue;
    const dependencies=bundles(item);if(dependencies===null)continue;
    const value = { address: item.address, internalId: item.internalId, type: item.type, bundles: [...new Set<string>(dependencies)] };
    const previous = assets[item.address];
    // Unity exposes one imported bitmap through both Sprite and Texture2D.
    // Prefer the cropped sprite when both entries identify the same import.
    if (previous && previous.internalId === value.internalId && JSON.stringify(previous.bundles) === JSON.stringify(value.bundles)
      && [previous.type, value.type].every(type => ['UnityEngine.Sprite', 'UnityEngine.Texture2D'].includes(type))) {
      if (value.type === 'UnityEngine.Sprite') assets[item.address] = value;
      continue;
    }
    if (assets[item.address] && JSON.stringify(assets[item.address]) !== JSON.stringify(value)) { delete assets[item.address]; conflicts.add(item.address); continue; }
    assets[item.address] = value;
  }
  return { assets, conflicts: [...conflicts] };
}
function buildCatalog(locations, source, metadata: any = {}) {
  const { assets, conflicts } = buildAssets(locations, source), values = Object.values<any>(assets);
  const roles = [...new Set(values.filter(item => item.type === 'Project.Ingame.UnitResourceAsset').map(item => /\/(1\d{8})[GX]\.asset$/.exec(item.address)?.[1]).filter(validId))].sort();
  const characters = roles.map(id => {
    const select = (type, pattern) => values.filter(item => item.type === type && pattern.test(item.address)).map(item => item.address);
    const icons = select('UnityEngine.Sprite', new RegExp('/CharaIcon/M/G/[^/]*' + id + 'G\\.png$'));
    const portraits = select('UnityEngine.GameObject', new RegExp('/CharaStand/Novel/Prefabs/[GX]/CharaStand' + id + '[GX]\\.prefab$'));
    const stories = select('UnityEngine.TextAsset', new RegExp('/(?:hmr|hmn|men)_' + id + '\\d{2}/[^/]+\\.txt$'));
    const motions = select('UnityEngine.GameObject', new RegExp('/hmr_' + id + '\\d{2}/l2d_[^/]+/l2d_[^/]+\\.prefab$'));
    const cg = select('UnityEngine.Sprite', new RegExp('/(?:hmr|men)_' + id + '\\d{2}/[^/]+\\.png$'));
    const voices = select('CriWare.Assets.CriAtomAcbAsset', new RegExp('/workunit_outgame_voice/charavoice/outv_' + id + '\\.acb$')).map(address => ({ address, code: path.posix.basename(address, '.acb'), group: 'daily', groupLabel: '角色语音' }));
    return { id, name: metadata[id]?.name || '角色 ' + id, nameVerified: !!metadata[id]?.name, rarityId: metadata[id]?.rarityId ?? null,
      rarityLabel: metadata[id]?.rarityLabel || '未标注', icon: icons[0] || null, portraits, cg, motions, voices, stories };
  }).filter(character => character.icon || character.portraits.length || character.motions.length || character.stories.length);
  return { version: 1, game: 'dotabyss', source, characters, assets, conflicts };
}
function mergeCatalog(previous, current) {
  const roles = new Map<any, any>((previous.characters || []).map(role => [role.id, role]));
  for (const role of current.characters) {
    const old = roles.get(role.id), merged = { ...old, ...role, icon: role.icon || old?.icon || null };
    for (const field of ['portraits', 'cg', 'motions', 'stories']) merged[field] = [...new Set([...role[field], ...(old?.[field] || [])])];
    merged.voices = [...new Map([...(old?.voices || []), ...role.voices].map(voice => [voice.address, voice])).values()];
    roles.set(role.id, merged);
  }
  // Removed upstream resources remain usable in an existing offline collection.
  return { ...current, assets: { ...previous.assets, ...current.assets }, characters: [...roles.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
async function prepareCatalog(root, { fetchResource = require('../../app/public-fetch.ts').fetchPublicResource }: any = {}) {
  const analysis = path.join(root, 'metadata'), source = readJson(path.join(analysis, 'source.json'), {}), binary = path.join(analysis, 'catalog.bin');
  if (!fs.existsSync(binary)) {
    if (resourceKind(source.catalogUrl) !== 'catalog') throw new Error('抓包缺少 DOTABYSS 资源目录地址。');
    const response = await fetchResource(source.catalogUrl, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('资源目录 HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer()); parseAddressables(bytes); fs.mkdirSync(analysis, { recursive: true }); fs.writeFileSync(binary, bytes);
  }
  const parsed = parseAddressables(fs.readFileSync(binary));
  const catalog = mergeCatalog(readCatalog(root), buildCatalog(parsed.locations, source, readJson(path.join(analysis, 'characters.json'), {})));
  writeJson(path.join(analysis, 'catalog.json'), catalog); return catalog;
}
const readCatalog = root => readJson(path.join(root, 'metadata/catalog.json'), { characters: [], assets: {} });
export { ORIGIN, buildAssets, buildCatalog, mergeCatalog, prepareCatalog, readCatalog, readJson, writeJson };
