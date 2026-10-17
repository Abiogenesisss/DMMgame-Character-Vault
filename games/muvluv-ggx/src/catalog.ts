import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { ORIGIN, validId, resourceKind, decodeData } = require('./format.ts');
const { parseAddressables } = require('./addressables.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const RARITIES = [{ id: 5, label: 'SSR' }, { id: 3, label: 'SR' }, { id: 1, label: 'R' }];
function voiceCategory(prefix, code) {
  if (prefix === 'ASCB' || /^(?:Quest|Maze)/.test(code)) return ['battle', '战斗'];
  if (prefix === 'ASS' || /^(?:Enhance|LimitBreak|FavoritePresent|Present)/.test(code)) return ['growth', '养成'];
  if (/^(?:NewYear|Valentine|WhiteDay|AprilFool|JuneBride|Tanabata|Halloween|Christmas|CharacterBirthday|UserBirthday)/.test(code)) return ['season', '季节'];
  return ['daily', '日常'];
}
const readJson = (file, fallback?: any) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
function writeJson(file, value) { writeAtomicFileSync(file, JSON.stringify(value)); }
function bundleUrl(internalId, source) {
  let url;
  if (/^rlp\/[a-f0-9]{32}\.bundle$/.test(internalId)) url = source.remoteBase + internalId.slice(4);
  else if (/^\{UnityEngine\.AddressableAssets\.Addressables\.RuntimePath\}\/WebGL\/[a-f0-9]{32}\.bundle$/.test(internalId)) url = internalId.replace('{UnityEngine.AddressableAssets.Addressables.RuntimePath}/', source.streamingBase);
  else url = internalId;
  if (resourceKind(url) !== 'bundle') throw new Error('资源目录中的素材包地址无效。');
  return url;
}
function assetsFromCatalogs(catalogs, source) {
  const assets = {}, conflicts = new Set<string>();
  const remoteAddresses = new Set<string>(catalogs.slice(1).flatMap(catalog => catalog.locations.map(item => item.address)));
  for (const [catalogIndex, catalog] of catalogs.entries()) {
    const byId = new Map<any, any>(catalog.locations.map(item => [item.id, item]));
    function dependencies(item, visited = new Set<string>()) {
      if (visited.has(item.id)) return []; visited.add(item.id);
      if (item.type === 'UnityEngine.ResourceManagement.ResourceProviders.IAssetBundleResource') return [bundleUrl(item.internalId, source)];
      return item.dependencies.flatMap(id => { const child = byId.get(id); if (!child) throw new Error('资源目录缺少依赖。'); return dependencies(child, visited); });
    }
    for (const item of catalog.locations) {
      if (!['UnityEngine.GameObject', 'UnityEngine.Sprite', 'UnityEngine.AudioClip'].includes(item.type) || !item.address) continue;
      if (item.address.startsWith('Assets/') || item.address.startsWith('Packages/')) continue;
      // Remote catalogs provide the game's updated versions of built-in assets.
      if (catalogIndex === 0 && remoteAddresses.has(item.address)) continue;
      if (conflicts.has(item.address)) continue;
      const value = { address: item.address, internalId: item.internalId, type: item.type, bundles: [...new Set<string>(dependencies(item))] };
      if (assets[item.address] && JSON.stringify(assets[item.address]) !== JSON.stringify(value)) { delete assets[item.address]; conflicts.add(item.address); continue; }
      assets[item.address] = value;
    }
  }
  return { assets, conflicts: [...conflicts] };
}
function applyMasterMappings(catalog, master) {
  const table = kind => master[0].filter(row => Array.isArray(row) && row[0] === kind).map(row => row[1]);
  const characters = new Map<string, any>(catalog.characters.map(character => [character.id, character]));
  const people = new Map(table(41).map(row => [row[0], row]));
  const members = table(330);
  for (const character of catalog.characters) {
    const person = people.get(character.personId), parent = Number(person?.[10]);
    // A duo uses one member's portal background. Require the explicit member
    // relation as well, so sharing a background alone never merges people.
    if (parent !== character.personId && people.has(parent)
      && catalog.characters.some(role => role.personId === parent)
      && members.some(row => String(row[1]) === character.id && row[2] === parent && row[3] === 2)) character.parentPersonId = parent;
  }
  const owners = new Map<any, string>(catalog.scenes.filter(scene => scene.character).map(scene => [scene.episodeId, scene.character]));
  // The chapter's still table is authoritative when its resource ID differs
  // from the card ID (for example, duo 500301 uses CG c500302).
  for (const row of table(183)) {
    const character = characters.get(owners.get(row[2]));
    if (!character || typeof row[4] !== 'string') continue;
    for (const [kind, prefix] of [['cg', 'TSTX/'], ['motions', 'SBSX/']]) {
      const address = prefix + row[4];
      if (catalog.assets[address] && !character[kind].includes(address)) character[kind].push(address);
    }
  }
  return catalog;
}
function buildCatalog(master, catalogs, source) {
  if (!Array.isArray(master) || !Array.isArray(master[0])) throw new Error('角色主数据格式无效。');
  const rows = master[0], table = kind => rows.filter(row => Array.isArray(row) && row[0] === kind).map(row => row[1]);
  // These union IDs/column positions are verified against this client's master
  // data and captured scenes. Fail closed if a future schema changes them.
  const cards = table(53), people = new Map(table(41).map(row => [row[0], row]));
  const teams = new Map(table(58).map(row => [row[0], row]));
  if (!cards.length || cards.some(row => !Array.isArray(row) || row.length !== 42 || !validId(String(row[0])) || !people.has(row[1]) || typeof row[8] !== 'string')) throw new Error('不支持的角色主数据版本。');
  const { assets, conflicts } = assetsFromCatalogs(catalogs, source), voiceLabels = new Map(table(59).map(row => [row[4], row[3]]));
  const characters = cards.map(row => {
    const person = people.get(row[1]), team = teams.get(person[4]);
    const id = String(row[0]), resourceId = row[8], name = person[1] + (row[3] ? '「' + row[3] + '」' : '');
    const voiceCategories = { ASCB: ['battle', '战斗'], ASCM: ['daily', '日常'], ASCS: ['season', '季节'], ASS: ['growth', '养成'] };
    const voices = Object.values<any>(assets).filter(asset => asset.type === 'UnityEngine.AudioClip' && Object.hasOwn(voiceCategories, asset.address.split('/')[0]) && asset.address.split('/')[1] === resourceId)
      .map(asset => { const [prefix, , filename] = asset.address.split('/'), code = filename.replace(/\.ogg$/, '');
        const [group, groupLabel] = voiceCategory(prefix, code);
        return { address: asset.address, code, label: voiceLabels.get(code) || code, group, groupLabel }; });
    const choose = addresses => addresses.filter(address => assets[address]);
    return { id, personId: row[1], name, shortName: person[1], subtitle: row[3], resourceId, styleOrder: row[4],
      profile: { reading: person[2], order: person[3], teamId: person[4], team: team?.[1] },
      portal: { background: choose(['TCNP/' + (person[10] || row[1])])[0] || null,
        teamLogo: choose(['TTL/' + team?.[3]])[0] || null },
      rarityId: RARITIES.some(value => value.id === row[5]) ? row[5] : null,
      rarityLabel: RARITIES.find(value => value.id === row[5])?.label || '未标注',
      icon: choose(['ICCS/' + resourceId, 'ICV/' + resourceId])[0] || null,
      // ICS is a 300x240 card preview. Column 9 is the explicit story costume
      // override; cards without one use their own resource ID for the full stand.
      portraitResourceId: row[9] || resourceId,
      portraits: choose(['SCS/' + (row[9] || resourceId)]), cardPortraits: choose(['SBC/' + resourceId]), cg: choose(['TSTX/c' + resourceId]),
      motions: choose(['SBSX/c' + resourceId]), voices, episodes: [] };
  });
  const ids = new Set(characters.map(character => character.id));
  const episodeOwners = new Map(table(8).filter(row => ids.has(String(row[5]))).map(row => [row[0], String(row[5])]));
  for (const row of table(104)) if (ids.has(String(row[1]))) episodeOwners.set(row[2], String(row[1]));
  const sceneMeta = table(13).map(row => ({ sceneId: String(row[0]), episodeId: row[1], title: row[5], order: row[2], adult: row[4] === true, character: episodeOwners.get(row[1]) || null }));
  for (const scene of sceneMeta) if (scene.character) characters.find(character => character.id === scene.character).episodes.push(scene);
  return applyMasterMappings({ version: 1, game: 'muvluv-ggx', characters, assets, conflicts, scenes: sceneMeta, source }, master);
}
async function prepareCatalog(root, { fetchResource = fetchPublicResource }: any = {}) {
  const analysis = path.join(root, 'metadata'), source = readJson(path.join(analysis, 'source.json'), {});
  const masterFile = path.join(analysis, 'master-data.json');
  if (!fs.existsSync(masterFile)) {
    const binary = source.masterFile && path.join(analysis, source.masterFile);
    if (!binary || !fs.existsSync(binary)) throw new Error('抓包缺少角色主数据正文，请补充包含正文的主数据响应。');
    writeJson(masterFile, decodeData(fs.readFileSync(binary)));
  }
  const catalogs = [];
  for (const name of ['catalog', 'ui_catalog', 'spine_catalog', 'sound_catalog']) {
    const binary = path.join(analysis, name + '.bin');
    if (!fs.existsSync(binary)) {
      const url = source.catalogUrls?.[name]; if (resourceKind(url) !== 'catalog') throw new Error('抓包缺少游戏资源目录。');
      const response = await fetchResource(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error('资源目录 HTTP ' + response.status); }
      const bytes = Buffer.from(await response.arrayBuffer()); parseAddressables(bytes); fs.writeFileSync(binary, bytes);
    }
    const parsed = parseAddressables(fs.readFileSync(binary)); catalogs.push(parsed);
  }
  const catalog = buildCatalog(readJson(masterFile), catalogs, source);
  writeJson(path.join(analysis, 'catalog.json'), catalog); return catalog;
}
function readCatalog(root) {
  const catalog = readJson(path.join(root, 'metadata/catalog.json'), { characters: [], assets: {}, scenes: [] });
  const master = readJson(path.join(root, 'metadata/master-data.json'), null);
  return master ? applyMasterMappings(catalog, master) : catalog;
}
export { RARITIES, readJson, writeJson, bundleUrl, assetsFromCatalogs, buildCatalog, prepareCatalog, readCatalog, voiceCategory };
