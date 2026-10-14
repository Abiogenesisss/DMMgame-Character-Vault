'use strict';
const fs = require('node:fs'), path = require('node:path');
const { sha256 } = require('../../app/pack.ts');
const { RARITIES, isMaterialId } = require('./character-types.ts');
const { fetchPublicResource } = require('../../app/public-fetch.ts');
const SOURCE = 'https://flowerknight.fandom.com/api.php?action=query&format=json&titles=Module%3AMasterCharacterData&prop=revisions&rvprop=content&rvslots=main';
function parseCharacterMetadata(source) {
  const characters = new Map();
  // Read only ID, name, original rarity and library membership from Lua data.
  // Never execute the module, captured game scripts or story content.
  const entries = /\[("(?:\\.|[^"\\])*")\]\s*=\s*\{\s*id\s*=\s*(\d+),([\s\S]*?)(?=\r?\n\["|\r?\n\}\s*$)/g;
  for (const match of source.matchAll(entries)) {
    const variant = match[2], id = variant.slice(0, 6), body = match[3];
    if (!/^1\d{5}(?:\d{3})?$/.test(variant) || isMaterialId(variant)) continue;
    const rarity = Number(/\brarity\s*=\s*(\d+)/.exec(body)?.[1]), libraryId = Number(/\blibID\s*=\s*(\d+)/.exec(body)?.[1]);
    if (!RARITIES.some(item => item.id === rarity) || !(libraryId > 0)) continue;
    const name = JSON.parse(/\bname\s*=\s*("(?:\\.|[^"\\])*")/.exec(body)?.[1] || match[1]);
    if (typeof name !== 'string' || !name.trim()) continue;
    const character = characters.get(id) || { id, name: '角色 ' + id, variants: [], nameAliases: [] };
    if (!character.variants.includes(variant)) character.variants.push(variant);
    if (!character.nameAliases.includes(name)) character.nameAliases.push(name);
    // Only the six-digit base record defines the unit's name and star rating.
    // Nine-digit costumes/4-panel entries can have a different rarity. Without
    // a base record, leave the rating unknown instead of borrowing a costume's.
    if (variant.length === 6) Object.assign(character, { name, rarityId: rarity, rarityLabel: RARITIES.find(item => item.id === rarity).label });
    characters.set(id, character);
  }
  return [...characters.values()].map(character => ({ ...character,
    variants: character.variants.sort((a, b) => Number(a) - Number(b)), nameAliases: character.nameAliases.sort() }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}
// Repair names previously taken from costume records, retaining custom names.
function mergeCharacterName(previousName, character) {
  return previousName && !/^角色 \d+$/.test(previousName) && !character.nameAliases?.includes(previousName) ? previousName : character.name;
}
function readCharacterMetadata(root) {
  const file = path.join(root, 'metadata/flower-wiki-master.lua'); if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file); if (bytes.length > 16 * 1024 * 1024) throw new Error('花骑士角色表超出大小限制。');
  const characters = parseCharacterMetadata(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!characters.length) throw new Error('花骑士角色表没有有效的可玩角色。');
  return { source: SOURCE, signature: sha256(bytes), characters };
}
async function ensureCharacterMetadata(root, { refresh = false, fetchResource = fetchPublicResource }: any = {}) {
  const cached = readCharacterMetadata(root); if (cached && !refresh) return cached;
  const response = await fetchResource(SOURCE, { signal: AbortSignal.timeout(30000) });
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('花骑士完整角色表 HTTP ' + response.status); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new Error('花骑士角色表超出大小限制。'); chunks.push(chunk); }
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  const revision = Object.values<any>(result.query?.pages || {})[0]?.revisions?.[0];
  const source = revision?.slots?.main?.['*'] || revision?.slots?.main?.content || revision?.['*'];
  if (typeof source !== 'string' || !parseCharacterMetadata(source).length) throw new Error('花骑士角色表没有有效的可玩角色。');
  const file = path.join(root, 'metadata/flower-wiki-master.lua'); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', source); fs.renameSync(file + '.tmp', file); return readCharacterMetadata(root);
}
export { SOURCE, parseCharacterMetadata, readCharacterMetadata, ensureCharacterMetadata, mergeCharacterName };
