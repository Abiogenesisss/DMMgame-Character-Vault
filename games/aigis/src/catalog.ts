import { renameFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { loadPack, routeKey, sha256 } = require('../../../app/pack.ts');
const { downloadUrls } = require('../../../app/download.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { BASE, table } = require('./format.ts');
const { canonicalId } = require('./character-identity.ts');
const { attachRarities } = require('./rarity.ts');
const { isGamePortrait } = require('./portraits.ts');
const { attachArtists, cachedArtistMetadata, readArtistMetadata } = require('./artists.ts');
const { parseFileList } = require('./file-list.ts');
const RARITY_SOURCE = 'https://raw.githubusercontent.com/Altterisk/Aigis-Enemy/main/public/data/units.json';
const PHASES = ['基础立绘', '觉醒立绘', '第二觉醒 A', '第二觉醒 B'];
function cachedRecord(root, url) {
  return loadPack(path.join(root, 'cache')).manifest.routes[routeKey('GET', url)]?.findLast(record => record.status === 200 && fs.existsSync(path.join(root, 'cache/bodies', record.body))) || null;
}
function buildCatalog(entries, names = [], units = []) {
  const characters = new Map();
  const get = (id, fallback) => {
    if (!characters.has(id)) characters.set(id, { id, name: fallback, portraits: [], cg: [] });
    return characters.get(id);
  };
  for (const entry of entries) {
    let match;
    if ((match = /^(Card|SkinCard)(\d{4,6})(_sp)?_(\d)\.aar$/.exec(entry.name))) {
      const id = match[1] === 'SkinCard' ? 'skin-' + match[2] : match[2], phase = Number(match[4]);
      const name = names[Number(id) - 1]?.Message;
      const character = get(id, match[1] === 'SkinCard' ? '外观 ' + match[2] : name && name !== '-' ? name : '角色 ' + id);
      const previous = character.portraits.find(item => item.phase === String(phase));
      if (!previous || previous.mobile && !match[3]) {
        if (previous) character.portraits.splice(character.portraits.indexOf(previous), 1);
        character.portraits.push({ ...entry, phase: String(phase), label: PHASES[phase] || '立绘 ' + phase, mobile: !!match[3] });
      }
    } else if ((match = /^HarlemCG(\d{4,6})\.aar$/.exec(entry.name))) {
      const id = match[1], name = names[Number(id) - 1]?.Message;
      get(id, name && name !== '-' ? name : '角色 ' + id).cg.push(entry);
    } else if ((match = /^EvtCard(\d{4,6})\.aar$/.exec(entry.name))) {
      get('event-' + match[1], '事件立绘 ' + match[1]).portraits.push({ ...entry, phase: 'event', label: '事件立绘' });
    }
  }
  for (const character of characters.values()) character.portraits.sort((a, b) => a.phase.localeCompare(b.phase));
  return attachRarities({ version: 1, game: 'aigis', characters: [...characters.values()].sort((a, b) => a.id.localeCompare(b.id)),
    icons: entries.filter(entry => /^ico_\d{2}_\d{2}\.aar$/.test(entry.name) || entry.name === 'skin_ico_00.aar') }, units);
}
async function readRarityMetadata(root, fetchResource) {
  const file = path.join(root, 'metadata/unit-metadata.json');
  const valid = units => {
    if (!Array.isArray(units) || !units.length || units.some(unit => !Number.isInteger(unit.id) || typeof unit.name !== 'string' || !Number.isInteger(unit.rarity_id))) throw new Error('稀有度资料格式无效。');
    return units;
  };
  if (fs.existsSync(file)) return valid(JSON.parse(fs.readFileSync(file, 'utf8')));
  const response = await fetchResource(RARITY_SOURCE, { signal: AbortSignal.timeout(30000) });
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('稀有度资料 HTTP ' + response.status); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new Error('稀有度资料超出大小限制。'); chunks.push(chunk); }
  const units = valid(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
  fs.writeFileSync(file + '.tmp', JSON.stringify(units)); renameFileSync(file + '.tmp', file); return units;
}
async function prepareCatalog(root, { fetchResource = fetchPublicResource }: any = {}) {
  const sourceFile = path.join(root, 'metadata/source.json'), listFile = path.join(root, 'metadata/filelist.txt');
  const source = fs.existsSync(sourceFile) ? JSON.parse(fs.readFileSync(sourceFile, 'utf8')) : {};
  if (!fs.existsSync(listFile) || source.fileListUrl && source.fileListUrl !== source.loadedFileListUrl) {
    if (!source.fileListUrl?.startsWith(BASE) || !/^\/[a-f0-9]{40}\/1fp32igvpoxnb521p9dqypak5cal0xv0$/.test(new URL(source.fileListUrl).pathname)) throw new Error('HAR 中缺少千年战争资源清单地址，请补充抓包。');
    const result = await downloadUrls(root, [{ url: source.fileListUrl }], { fetchResource, maxBytes: 8 * 1024 * 1024, validate: parseFileList });
    if (result.failed) throw new Error(result.errors[0]?.error || '资源清单下载失败。');
    const record = cachedRecord(root, source.fileListUrl);
    const parsed = parseFileList(fs.readFileSync(path.join(root, 'cache/bodies', record.body)));
    fs.writeFileSync(listFile, parsed.text); source.loadedFileListUrl = source.fileListUrl;
    fs.writeFileSync(sourceFile, JSON.stringify(source));
  }
  const { entries } = parseFileList(fs.readFileSync(listFile, 'utf8'));
  const nameSpec = entries.find(entry => entry.name === 'NameText.atb');
  if (!nameSpec) throw new Error('资源清单缺少角色名称表。');
  const result = await downloadUrls(root, [nameSpec], { fetchResource, maxBytes: 8 * 1024 * 1024, validate: table });
  if (result.failed) throw new Error(result.errors[0]?.error || '角色名称表下载失败。');
  const nameRecord = cachedRecord(root, nameSpec.url);
  const names = table(fs.readFileSync(path.join(root, 'cache/bodies', nameRecord.body))).rows;
  let units = [], rarityIssue;
  try { units = await readRarityMetadata(root, fetchResource); } catch (error) { rarityIssue = error.message; }
  const catalog = buildCatalog(entries, names, units);
  if (rarityIssue) catalog.rarityIssue = rarityIssue;
  try { attachArtists(catalog, await readArtistMetadata(root, fetchResource)); } catch (error) { catalog.artistIssue = error.message; }
  // Avatars share small atlases. Only the base/skin icon families are needed
  // for the catalogue; no battle animation or sound resources are requested.
  const icons = catalog.icons.filter(spec => /^ico_00_\d{2}\.aar$/.test(spec.name) || spec.name === 'skin_ico_00.aar');
  if (icons.length) {
    const iconResult = await downloadUrls(root, icons, { fetchResource, maxBytes: 16 * 1024 * 1024, validate: require('./format.ts').archive });
    if (iconResult.failed) catalog.iconIssues = iconResult.errors;
  }
  catalog.resourceSignature = sha256(Buffer.from(fs.readFileSync(listFile, 'utf8') + nameRecord.body));
  fs.writeFileSync(path.join(root, 'metadata/catalog.json'), JSON.stringify(catalog));
  return catalog;
}
function readCatalog(root) {
  const file = path.join(root, 'metadata/catalog.json');
  if (!fs.existsSync(file)) throw new Error('请先导入千年战争 HAR 并生成角色目录。');
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const character of catalog.characters) character.portraits = character.portraits.filter(isGamePortrait);
  catalog.characters = catalog.characters.filter(character => character.portraits.length || character.cg.length);
  try { attachArtists(catalog, cachedArtistMetadata(root)); } catch (error) { catalog.artistIssue = error.message; }
  return catalog;
}
export { parseFileList, canonicalId, buildCatalog, prepareCatalog, readCatalog, cachedRecord };
