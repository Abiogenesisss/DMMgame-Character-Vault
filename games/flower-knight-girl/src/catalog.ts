'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadPack } = require('../../../app/pack.ts');
const { md5, baseId, validId, storySpec, bloomSpecs } = require('./format.ts');
const { characterAliases } = require('./character-identity.ts');
const { isMaterialId } = require('./character-types.ts');
const { readCharacterMetadata } = require('./character-metadata.ts');
const { readDynamicCgMetadata } = require('./dynamic-cg.ts');
const { prepareLibrary } = require('../viewer/character-content.ts');
const CATALOG_VERSION = 4;
const resourceSignature = records => md5([...new Set<string>(records.filter(record => /\/character\/dmm\/(i|stand)\//.test(record.url))
  .map(record => [record.url.split('?')[0], record.status, record.body].join(':')))].sort().join('\n'));
const capturedImages = records => new Set<string>(records.filter(record => record.status === 200 && record.size > 0
  && !/^text\/|json|javascript/i.test(record.mimeType || '')).map(record => record.url.split('?')[0]));
function confirmBloom(character, captured) {
  if (character.forms?.bloom) return false;
  const bloom = bloomSpecs(character).find(spec => captured.has(spec.url));
  if (!bloom) return false;
  character.forms ||= { before: character.id, ...(Number(character.id) % 2 === 1 ? { after: String(Number(character.id) + 1) } : {}) };
  character.forms.bloom = bloom.character;
  return true;
}
function buildCatalog(root) {
  const metadata = readCharacterMetadata(root);
  const records = Object.values<any>(loadPack(path.join(root, 'cache')).manifest.routes).flat();
  const icons = new Map<any, any>(records.filter(record => record.status === 200 && /\/character\/dmm\/i\/[a-f0-9]{32}\.bin/.test(record.url))
    .map(record => [new URL(record.url).pathname.split('/').at(-1).slice(0, 32), record]));
  const knownFile = path.join(root, 'metadata/icon-identities.json');
  const identities = fs.existsSync(knownFile) ? JSON.parse(fs.readFileSync(knownFile, 'utf8')) : {};
  const candidates = new Set(Object.keys(identities));
  for (const character of metadata?.characters || []) for (const id of character.variants) candidates.add(id);
  for (const record of records) if (/\/setting\/|\/json\/bustup\//.test(record.url)) {
    const body = fs.readFileSync(path.join(root, 'cache/bodies', record.body)).toString('utf8');
    for (const match of body.matchAll(/\b\d{6,9}\b/g)) candidates.add(match[0]);
  }
  // Local dictionary matching never issues requests for guessed numeric IDs.
  for (let id = 100000; id < 600000; id++) {
    const digest = md5('icon_l_' + id); if (icons.has(digest)) candidates.add(String(id));
  }
  for (const id of [...candidates].filter(id => id.length === 6)) for (let variant = 0; variant < 1000; variant++) {
    const skin = id + String(variant).padStart(3, '0');
    if (icons.has(md5('icon_l_' + skin))) candidates.add(skin);
  }
  const variants = [...candidates].filter(id => /^[145]\d{5}(?:\d{3})?$/.test(id) && !isMaterialId(id) && icons.has(md5('icon_l_' + id))).sort((a, b) => Number(a) - Number(b));
  const known = new Set([...(metadata?.characters || []).map(character => character.id), ...variants.map(id => baseId(id))]);
  const canonicalId = id => {
    const stem = baseId(id), previous = String(Number(stem) - 1);
    return Number(stem) % 2 === 0 && known.has(previous) ? previous : stem;
  };
  const characters = new Map<any, any>((metadata?.characters || []).map(character => [character.id, { ...character, iconBody: icons.get(md5('icon_l_' + character.id))?.body || null }]));
  for (const id of variants) {
    const canonical = canonicalId(id), record = icons.get(md5('icon_l_' + id));
    const character = characters.get(canonical) || { id: canonical, name: '角色 ' + canonical, variants: [], iconBody: record.body };
    if (!character.variants.includes(id)) character.variants.push(id);
    character.iconBody ||= record.body;
    characters.set(canonical, character);
    identities[id] = record.body;
  }
  const captured = capturedImages(records);
  for (const character of characters.values()) {
    character.forms = { before: character.id };
    if (Number(character.id) % 2 === 1) character.forms.after = String(Number(character.id) + 1);
    // An icon or a performance-only flowering state does not prove that art
    // exists. Only a successfully captured stand URL adds a bloom form.
    confirmBloom(character, captured);
  }
  const aliases = characterAliases([...characters.values()]);
  const targets = new Set([...characters.values()].flatMap(character => [character.id, ...character.variants.filter(id => id.length === 9)]).filter(validId));
  const stories = [...targets].sort().flatMap(id => [storySpec(id, 1), storySpec(id, 2)]);
  // Retain confirmed legacy story URLs during a metadata migration, without
  // opening a scenario body or requesting guessed evolution scripts.
  const catalogFile = path.join(root, 'metadata/catalog.json');
  const previous = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : null;
  if (fs.existsSync(catalogFile)) {
    for (const spec of previous.stories || []) if (validId(spec.character) && captured.has(spec.url) && !stories.some(item => item.id === spec.id)) stories.push(spec);
  }
  const output = { version: CATALOG_VERSION, aliases, resourceSignature: resourceSignature(records), generated: new Date().toISOString(), capturedIcons: icons.size,
    identifiedIcons: variants.length, unknownIcons: icons.size - variants.length,
    characterMetadataSource: metadata?.source || null, characterMetadataSignature: metadata?.signature || null,
    excludedIconBodies: [...new Set([...candidates].filter(isMaterialId).map(id => icons.get(md5('icon_l_' + id))?.body).filter(Boolean))],
    characters: [...characters.values()].sort((a, b) => Number(a.id) - Number(b.id)), stories };
  const libraryFile = path.join(root, 'library/index.json');
  const library = fs.existsSync(libraryFile) ? JSON.parse(fs.readFileSync(libraryFile, 'utf8')) : null;
  prepareLibrary(output, previous, library, readDynamicCgMetadata(root));
  fs.mkdirSync(path.join(root, 'metadata'), { recursive: true });
  fs.writeFileSync(knownFile, JSON.stringify(identities));
  fs.writeFileSync(path.join(root, 'metadata/catalog.json'), JSON.stringify(output));
  return output;
}
function ensureCatalog(root) {
  const file = path.join(root, 'metadata/catalog.json');
  const catalog = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  // Custom catalogs can opt in with explicit forms and aliases. Generated
  // catalogs refresh when new portrait/icon metadata arrives in another HAR.
  if ([2, 3, CATALOG_VERSION].includes(catalog?.version) && catalog.aliases) {
    const dynamicCount = catalog.characters.filter(character => character.hasDynamicCg === true).length;
    prepareLibrary(catalog, readDynamicCgMetadata(root));
    let changed = dynamicCount !== catalog.characters.filter(character => character.hasDynamicCg === true).length;
    const records = Object.values<any>(loadPack(path.join(root, 'cache')).manifest.routes).flat();
    // Clearing download originals must never discard the saved character list.
    if (!records.length) {
      delete catalog.resourceSignature;
      fs.writeFileSync(file, JSON.stringify(catalog));
      return catalog;
    }
    const playable = catalog.characters.filter(character => !isMaterialId(character.id));
    if (playable.length !== catalog.characters.length) { catalog.characters = playable; catalog.aliases = characterAliases(playable); catalog.stories = (catalog.stories || []).filter(story => validId(story.character)); changed = true; }
    for (const character of catalog.characters) for (const key of ['flower', 'flowerId', 'flowerCandidates', 'flowerUnavailable']) {
      if (Object.hasOwn(character, key)) { delete character[key]; changed = true; }
    }
    if (!catalog.resourceSignature) {
      // Preserve explicit/custom catalogs while attaching newly downloaded art.
      const captured = capturedImages(records);
      for (const character of catalog.characters) if (confirmBloom(character, captured)) changed = true;
      if (changed) {
        catalog.aliases = { ...catalog.aliases, ...characterAliases(catalog.characters) };
        fs.writeFileSync(file, JSON.stringify(catalog));
      }
      return catalog;
    }
    if (catalog.version === CATALOG_VERSION && catalog.resourceSignature === resourceSignature(records) && catalog.characterMetadataSignature === (readCharacterMetadata(root)?.signature || null)) {
      if (changed) fs.writeFileSync(file, JSON.stringify(catalog));
      return catalog;
    }
  }
  return buildCatalog(root);
}
export { CATALOG_VERSION, buildCatalog, ensureCatalog };
