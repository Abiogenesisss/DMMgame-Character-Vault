import { renameFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const SOURCE = 'https://nbjogger.net/aigis-search/';
const RARITY_IDS = { 'アイアン': 0, 'ブロンズ': 1, 'シルバー': 2, 'ゴールド': 3, 'プラチナ': 4, 'ブラック': 5, 'サファイア': 7 };
const nameKey = name => name.normalize('NFKC').trim();
const UNNAMED = new Set(['未表記', '非公開', '未公開', '非公表', '未記載', '不明', '不詳', '未確認', '未标注', '未標註', 'unknown', '-', '?']);
const namedArtist = name => typeof name === 'string' && name.trim() && !UNNAMED.has(nameKey(name).toLowerCase());
function parseArtistMetadata(bundle) {
  // Read JSON string literals as data. Never evaluate the downloaded bundle or
  // import its embedded pictures, game scripts, stats or event descriptions.
  const arrays = [...bundle.matchAll(/JSON\.parse\('((?:\\.|[^'\\])*)'\)/g)]
    .filter(match => match[1].startsWith('[')).map(match => JSON.parse(match[1].replace(/\\([\\'])/g, '$1')));
  const categories = arrays.find(rows => rows[0]?.category), units = arrays.find(rows => typeof rows[0]?.name === 'string');
  const names = categories?.find(category => category.category === 'イラストレーター')?.tags;
  if (!Array.isArray(names) || !names.length || !units?.length) throw new Error('画师资料缺少角色或画师名录。');
  const artists = new Set(names.filter(namedArtist));
  const characters = units.filter(unit => typeof unit.name === 'string' && Array.isArray(unit.tags)).map(unit => {
    const tiers = unit.tags.filter(tag => Object.hasOwn(RARITY_IDS, tag));
    return { name: unit.name, rarityId: tiers.length === 1 ? RARITY_IDS[tiers[0]] : null,
      artists: [...new Set<string>(unit.tags.filter(tag => artists.has(tag)))].sort() };
  }).filter(unit => unit.artists.length);
  if (!characters.length) throw new Error('画师资料没有有效对应关系。');
  return { version: 1, source: SOURCE, characters };
}
function validateMetadata(metadata) {
  if (metadata?.version !== 1 || metadata.source !== SOURCE || !Array.isArray(metadata.characters) || !metadata.characters.length
    || metadata.characters.some(unit => typeof unit.name !== 'string' || !unit.name.trim()
      || !Array.isArray(unit.artists) || !unit.artists.length || unit.artists.some(name => typeof name !== 'string' || !name.trim()))) throw new Error('画师资料格式无效。');
  const characters = metadata.characters.map(unit => ({ ...unit, artists: [...new Set<string>(unit.artists.filter(namedArtist).map(name => name.trim()))] })).filter(unit => unit.artists.length);
  if (!characters.length) throw new Error('画师资料没有公开署名。');
  return { ...metadata, characters };
}
function cachedArtistMetadata(root) {
  const file = path.join(root, 'metadata/artist-metadata.json');
  return fs.existsSync(file) ? validateMetadata(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
}
function attachArtists(catalog, metadata) {
  if (!metadata) return catalog;
  const byName = new Map();
  for (const unit of metadata.characters) {
    const key = nameKey(unit.name); if (!byName.has(key)) byName.set(key, []); byName.get(key).push(unit);
  }
  for (const character of catalog.characters) {
    // Regular unit names and rarity must agree. Skins/events have independent
    // identifiers; never inherit credits merely from their numeric suffix.
    const matches = /^\d+$/.test(character.id) ? (byName.get(nameKey(character.name)) || [])
      .filter(unit => character.rarityId == null || unit.rarityId == null || unit.rarityId === character.rarityId) : [];
    const groups = new Map<any, any>(matches.map(unit => { const artists = [...new Set<string>(unit.artists.filter(namedArtist).map(name => name.trim()))].sort(); return [JSON.stringify(artists), artists]; }));
    character.artists = groups.size === 1 ? [...groups.values()][0] : [];
    character.artistSource = character.artists.length ? metadata.source : null;
  }
  return catalog;
}
async function readArtistMetadata(root, fetchResource = fetchPublicResource, { refresh = false }: any = {}) {
  const cached = cachedArtistMetadata(root); if (cached && !refresh) return cached;
  const read = async (url, maxBytes) => {
    const response = await fetchResource(url, { signal: AbortSignal.timeout(30000) });
    if (response.status !== 200) { await response.body?.cancel(); throw new Error('画师资料 HTTP ' + response.status); }
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw new Error('画师资料超出大小限制。'); chunks.push(chunk); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  };
  const html = await read(SOURCE, 1024 * 1024);
  const script = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(match => new URL(match[1], SOURCE)).find(url => url.origin === new URL(SOURCE).origin && /^\/aigis-search\/static\/js\/main\.[a-f0-9]+\.js$/.test(url.pathname));
  if (!script) throw new Error('画师资料入口未找到。');
  const metadata = validateMetadata({ ...parseArtistMetadata(await read(script.href, 16 * 1024 * 1024)), bundleUrl: script.href, fetched: new Date().toISOString() });
  const file = path.join(root, 'metadata/artist-metadata.json'); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(metadata)); renameFileSync(file + '.tmp', file); return metadata;
}
if (require.main === module) (async () => {
  const root = require('./paths.ts').root;
  const metadata = await readArtistMetadata(root, fetchPublicResource, { refresh: process.argv.includes('--refresh') });
  await require('../../../app/projects.ts').withPackLock(root, async () => {
    const catalog = attachArtists(require('./catalog.ts').readCatalog(root), metadata), file = path.join(root, 'metadata/catalog.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(catalog)); renameFileSync(file + '.tmp', file);
    const index = require('./extract.ts').extract(root, undefined, { roles: [] });
    console.log(JSON.stringify({ characters: index.characters.filter(character => character.artists?.length).length,
      artists: new Set<string>(index.characters.flatMap(character => character.artists || [])).size, unknown: index.characters.filter(character => !character.artists?.length).length }));
  });
})().catch(error => { console.error(error.message); process.exitCode = 1; });
export { SOURCE, parseArtistMetadata, attachArtists, cachedArtistMetadata, readArtistMetadata };
