import { renameFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadPack, routeKey } = require('../../../app/pack.ts');
const { buildCatalog } = require('./catalog.ts');
const { baseId, portraitSpecs } = require('./format.ts');
const { characterAliases } = require('./character-identity.ts');
const { readSelection, selectRoles } = require('./selection.ts');
const { mergeCharacterName } = require('./character-metadata.ts');
const { prepareLibrary } = require('../viewer/character-content.ts');

// Repairs metadata only. Media files and scenario bodies are never opened.
function mergeCharacterForms(index, catalog, manifest, selected, savedImages = []) {
  const images = new Map([...(index.images || []), ...savedImages].filter(item => item.category !== 'flower').map(item => [item.id, item]));
  const oldCharacters = index.characters || [];
  const oldPortraits = new Map();
  for (const character of oldCharacters) for (const portrait of character.portraits || []) {
    if (portrait.file && /^[145]\d{5}$/.test(portrait.character)) oldPortraits.set(portrait.character, portrait.file);
  }
  const resolve = id => baseId(id, catalog);
  const fileFor = spec => {
    const record = manifest.routes[routeKey('GET', spec.url)]?.findLast(row => row.status === 200);
    return images.get(record?.body)?.file || oldPortraits.get(spec.character) || null;
  };
  const groups = new Map();
  for (const character of oldCharacters) {
    const id = resolve(character.id);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(character);
  }
  const source = [...catalog.characters];
  for (const [id, previous] of groups) if (!source.some(character => character.id === id)) {
    source.push({ ...previous[0], id, forms: { before: id } });
  }
  index.characters = source.map(character => {
    const previous = groups.get(character.id) || [];
    const primary = previous.find(item => item.id === character.id) || previous[0] || {};
    const collected = selected.has(character.id) || previous.some(item => item.collected);
    const portraits = collected ? portraitSpecs(character).map(spec => ({ phase: spec.phase, label: spec.label,
      character: spec.character, file: fileFor(spec) })) : [];
    const merged = { ...primary, ...character,
      name: mergeCharacterName(primary.name, character),
      variants: [...new Set([...(character.variants || []), ...previous.flatMap(item => item.variants || [item.id])])],
      icon: images.get(character.iconBody)?.file || primary.icon || null,
      collected, hasDynamicCg: !!character.hasDynamicCg || previous.some(item => item.hasDynamicCg),
      portraits,
      stories: [] };
    for (const key of ['flower', 'flowerId', 'flowerCandidates', 'flowerUnavailable']) delete merged[key];
    return merged;
  }).sort((a, b) => Number(a.id) - Number(b.id));
  index.aliases = { ...catalog.aliases, ...characterAliases(index.characters) };
  for (const list of [index.stories, index.images, index.audio, index.skeletons]) for (const item of list || []) {
    if (item.parent || item.character) item.parent = baseId(item.parent || item.character, index);
    if (item.characters) item.characters = [...new Set<string>(item.characters.map(id => baseId(id, index)).filter(Boolean))];
  }
  for (const story of index.stories || []) {
    const character = index.characters.find(item => item.id === story.parent);
    if (character) character.stories.push(story.id);
    if (/^角色 \d+ · 剧情 \d+$/.test(story.title || '')) story.title = '角色 ' + story.parent + ' · 剧情 ' + story.chapter;
  }
  const excludedIcons = new Set<string>(catalog.excludedIconBodies || []), referenced = new Set<string>(index.characters.flatMap(character => [character.icon, ...character.portraits.map(item => item.file)]).filter(Boolean));
  index.images = [...images.values()].filter(image => !excludedIcons.has(image.id) || referenced.has(image.file));
  for (const character of index.characters) character.voiceSaved = (index.audio || [])
    .filter(item => item.context === 'character' && (item.parent === character.id || item.characters?.includes(character.id))).length;
  prepareLibrary(index, catalog);
  index.version = 3;
  index.stats = { ...index.stats, characters: index.characters.length, icons: index.images.filter(item => item.category === 'icon').length };
  index.generated = new Date().toISOString();
  return index;
}

function migrateCharacterForms(root, { catalog, additionalImages = [] }: any = {}) {
  const indexFile = path.join(root, 'library/index.json');
  if (!fs.existsSync(indexFile)) throw new Error('请先生成角色资源库。');
  catalog ||= buildCatalog(root);
  const pack = loadPack(path.join(root, 'cache'));
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const selected = readSelection(root, catalog);
  // List existing exported files by hash. No media bytes are read.
  const savedImages = [...additionalImages];
  const records = Object.values<any>(pack.manifest.routes).flat();
  const portraitUrls = new Set<string>(catalog.characters.flatMap(portraitSpecs).map(spec => spec.url));
  const imageDirectory = path.join(root, 'library/images');
  if (fs.existsSync(imageDirectory)) for (const file of fs.readdirSync(imageDirectory)) {
    const match = file.match(/^([a-f0-9]{64})\.(png|jpg|webp)$/);
    if (!match || index.images.some(image => image.id === match[1])) continue;
    const record = records.find(row => row.body === match[1] && row.status === 200 && portraitUrls.has(row.url.split('?')[0]));
    if (!record) continue;
    savedImages.push({ id: match[1], name: new URL(record.url).pathname.split('/').at(-1), file: 'images/' + file,
      category: 'portrait', bytes: fs.statSync(path.join(imageDirectory, file)).size });
  }
  mergeCharacterForms(index, catalog, pack.manifest, selected, savedImages);
  // Normalize aliases without widening category selections to all resources.
  // Only legacy collected roles absent from the selection need that fallback.
  selectRoles(root, index.characters.filter(character => character.collected && !selected.has(character.id)).map(character => character.id), index);
  fs.writeFileSync(indexFile + '.tmp', JSON.stringify(index));
  renameFileSync(indexFile + '.tmp', indexFile);
  return { characters: index.characters.length, collected: index.characters.filter(character => character.collected).length,
    portraits: index.characters.reduce((total, character) => total + character.portraits.filter(item => item.file).length, 0),
    stories: index.stories.length };
}

if (require.main === module) {
  require('../../../app/projects.ts').withPackLock(require('./paths.ts').root, () => migrateCharacterForms(require('./paths.ts').root))
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
export { mergeCharacterForms, migrateCharacterForms };
