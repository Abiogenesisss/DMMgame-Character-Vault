'use strict';

const CATALOG_PAGES = ['characters', 'favorites'];
const CHARACTER_SECTIONS = ['presentation', 'stories', 'voices'];
const { baseId } = require('../src/character-identity.ts');
const humanPortraits = character => (character.portraits || []).filter(item => item.phase !== 'flower' && !/^2\d{5}$/.test(item.character || ''));
const ownedBy = (item, character, library) => [item.parent, item.character, ...(item.characters || [])]
  .some(id => baseId(id, library) === character.id);
const uniqueFiles = items => {
  const files = new Map();
  for (const item of items) if (item.file && !files.has(item.file)) files.set(item.file, item);
  return [...files.values()];
};

// Capability belongs to a character even when its media has not been saved.
// Repair older indexes from metadata and indexed model/story associations only.
function prepareLibrary(library, ...evidence) {
  const animated = new Set<string>();
  const add = (id, source) => { const canonical = baseId(baseId(id, source), library); if (canonical) animated.add(canonical); };
  for (const source of [library, ...evidence].filter(Boolean)) {
    const stories = new Set((source.stories || []).filter(story => story.motions?.length).map(story => story.id));
    for (const character of source.characters || []) {
      if (typeof character === 'string') add(character, source);
      else if (character.hasDynamicCg === true || character.stories?.some(id => stories.has(id))) add(character.id, source);
    }
    for (const model of source.skeletons || []) if (model.kind === 'cg') {
      for (const id of [model.parent, model.character, ...(model.characters || [])]) add(id, source);
    }
    for (const story of source.stories || []) if (story.motions?.length) {
      for (const id of [story.parent, story.character, ...(story.characters || [])]) add(id, source);
    }
  }
  for (const character of library.characters || []) if (animated.has(character.id)) character.hasDynamicCg = true;
  return library;
}

function catalogCharacters(library, { tab = 'characters', favorites = new Set<string>(), query = '', availability = 'all', dynamicOnly = false, rarity = 'all' }: any = {}) {
  const search = query.trim().toLowerCase();
  const canonicalFavorites = new Set([...favorites].map(id => baseId(id, library)));
  return (library.characters || []).filter(character => baseId(character.id, library) && (tab !== 'favorites' || canonicalFavorites.has(character.id))
    && (availability !== 'saved' || character.collected === true)
    && (availability !== 'missing' || character.collected !== true)
    && (!dynamicOnly || character.hasDynamicCg === true)
    && (rarity === 'all' || (rarity === 'unknown' ? character.rarityId == null : String(character.rarityId) === String(rarity)))
    && (!search || [character.id, character.name, ...(character.variants || []), ...Object.values<any>(character.forms || {})].join(' ').toLowerCase().includes(search)));
}

function roleContent(library, character) {
  const storyIds = new Set<string>(character.stories || []);
  const stories = (library.stories || []).filter(item => storyIds.has(item.id) || ownedBy(item, character, library));
  const imageIds = new Set<string>(stories.flatMap(item => item.images || []));
  const motionIds = new Set<string>(stories.flatMap(item => item.motions || []));
  // Legacy audio entries are unclassified. Never turn them into character voices.
  // An explicit character classification is required, and story usage takes priority.
  const storyVoiceFiles = new Set<string>((library.stories || []).flatMap(item => item.voiceFiles || []));
  const voices = uniqueFiles((library.audio || []).filter(item => ownedBy(item, character, library)
    && (item.category === 'character-voice' || item.category === 'voice' && item.context === 'character')
    && item.context !== 'story' && !item.story && !item.storyIds?.length
    && !/hscene|scenario|(?:^|[\s/_-])story(?:[\s/_-]|$)/i.test([item.reference, item.name].join(' '))
    && !storyVoiceFiles.has(item.file))).sort((a, b) => {
      const groups = { '日常': 0, '战斗': 1, '养成': 2, '季节': 3 };
      return (groups[a.group] ?? 4) - (groups[b.group] ?? 4) || (a.order ?? 1000) - (b.order ?? 1000);
    });
  return {
    portraits: humanPortraits(character).filter(item => item.file),
    voices,
    stories,
    cg: uniqueFiles((library.images || []).filter(item => item.category === 'cg'
      && (imageIds.has(item.id) || ownedBy(item, character, library)))),
    motions: uniqueFiles((library.skeletons || []).filter(item => item.kind === 'cg'
      && (motionIds.has(item.id) || ownedBy(item, character, library))))
  };
}

function readFavorites(value, library) {
  try {
    const ids = JSON.parse(value || '[]');
    return new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && /^1\d{5}$/.test(id)).map(id => baseId(id, library)) : []);
  } catch { return new Set<string>(); }
}

function portraitStatus(character) {
  const slots = humanPortraits(character), saved = slots.filter(item => item.file);
  if (!saved.length) return '暂无已保存的立绘。';
  const missing = slots.filter(item => !item.file).map(item => item.label).filter(Boolean);
  return '已保存 ' + saved.length + ' 张立绘' + (missing.length ? '，' + missing.join('、') + '立绘尚未保存。' : '');
}

function readRoute(hash, library) {
  const [tab, id, section] = String(hash || '').replace(/^#/, '').split('/');
  if (!CATALOG_PAGES.includes(tab)) return { tab: 'characters', id: null, section: 'presentation' };
  return { tab, id: /^[145]\d{5}$/.test(id || '') ? baseId(id, library) : null,
    section: CHARACTER_SECTIONS.includes(section) ? section : 'presentation' };
}

function routeHash(tab, id = null, section = 'presentation') {
  const page = CATALOG_PAGES.includes(tab) ? tab : 'characters';
  return id ? '#' + page + '/' + id + '/' + (CHARACTER_SECTIONS.includes(section) ? section : 'presentation') : '#' + page;
}

export { CATALOG_PAGES, CHARACTER_SECTIONS, prepareLibrary, catalogCharacters, roleContent, portraitStatus, readFavorites, readRoute, routeHash };
