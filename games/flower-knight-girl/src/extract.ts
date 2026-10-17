import { renameFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadPack, routeKey } = require('../../../app/pack.ts');
const { baseId, md5, decode, sniffImage, isMp3, parseStory, spineSpecs, voiceUrl, portraitSpecs, roleImageSpecs } = require('./format.ts');
const { ensureCatalog } = require('./catalog.ts');
const { readSelection, readScopes } = require('./selection.ts');
const { spinePlacement } = require('../viewer/reader-scene.ts');
const { ensureVoiceMapping, roleVoiceSpecs, syncCachedVoices } = require('./character-voices.ts');
const { wantsDependency } = require('./collection-scope.ts');
const { mergeCharacterName } = require('./character-metadata.ts');
const { readStoryUi } = require('./story-ui.ts');
const { prepareLibrary } = require('../viewer/character-content.ts');
// A download may rebuild files while another tab is already reading them.
function saveFile(file, bytes) { fs.writeFileSync(file + '.tmp', bytes); renameFileSync(file + '.tmp', file); }
const upsert = (items, item) => {
  const previous = items.find(entry => entry.id === item.id);
  if (previous) { Object.assign(previous, item); return previous; }
  items.push(item); return item;
};
function extract(root, progress: (...args: any[]) => any = () => {}, { scope = 'all', roles }: any = {}) {
  const pack = loadPack(path.join(root, 'cache'));
  const catalog = ensureCatalog(root);
  const storyUi = readStoryUi(root);
  const owner = id => baseId(id, catalog);
  const scoped = scope !== 'all';
  const selected = scoped ? new Set<string>((roles || []).map(owner)) : readSelection(root, catalog);
  const selections = readScopes(root, catalog);
  const allows = (id, category) => selected.has(id) && (scoped
    ? scope === category || scope === 'stories' && ['cg', 'motions'].includes(category)
    : selections.get(id)?.has('all') || selections.get(id)?.has(category) || ['cg', 'motions'].includes(category) && selections.get(id)?.has('stories'));
  const voiceMapping = scope === 'all' ? ensureVoiceMapping(root, { manifest: pack.manifest }) : null;
  const out = path.join(root, 'library');
  for (const folder of ['images', 'audio', 'stories', 'spine']) fs.mkdirSync(path.join(out, folder), { recursive: true });
  const indexFile = path.join(out, 'index.json');
  const previous = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : null;
  const index = scoped ? previous : { version: 3, aliases: catalog.aliases, source: 'Flower Knight CDN resources', characters: catalog.characters.map(item => ({ ...item, hasDynamicCg: !!item.hasDynamicCg, collected: selected.has(item.id), stories: [] })),
    images: [], audio: [], stories: [], skeletons: [], issues: [], unidentifiedIcons: catalog.unknownIcons };
  index.aliases = catalog.aliases;
  const excludedIcons = new Set<string>(catalog.excludedIconBodies || []);
  index.characters = index.characters.filter(character => owner(character.id));
  if (scoped) for (const character of catalog.characters) {
    const previous = index.characters.find(item => item.id === character.id);
    if (previous) {
      previous.name = mergeCharacterName(previous.name, character);
      if (character.nameAliases) previous.nameAliases = character.nameAliases;
      for (const key of ['rarityId', 'rarityLabel']) if (character[key] != null) previous[key] = character[key];
    } else index.characters.push({ ...character, collected: false, stories: [], portraits: [] });
  }
  // Drop legacy plant associations from metadata while preserving cached files.
  for (const character of index.characters) {
    for (const key of ['flower', 'flowerId', 'flowerCandidates', 'flowerUnavailable']) delete character[key];
    if (character.portraits) character.portraits = character.portraits.filter(item => item.phase !== 'flower' && !/^2\d{5}$/.test(item.character || ''));
  }
  index.images = (index.images || []).filter(image => image.category !== 'flower' && !excludedIcons.has(image.id));
  if (scoped) {
    for (const character of index.characters) if (selected.has(character.id)) {
      character.collected = true;
      character.forms = catalog.characters.find(item => item.id === character.id)?.forms || character.forms;
    }
    for (const key of ['images', 'audio', 'stories', 'skeletons', 'issues']) index[key] ||= [];
  }
  const assets = new Map(), images = new Map<any, any>(index.images.map(item => [item.id, item]));
  const good = url => pack.manifest.routes[routeKey('GET', url)]?.findLast(record => record.status === 200
    && fs.existsSync(path.join(pack.root, 'bodies', record.body)));
  const bytes = record => decode(fs.readFileSync(path.join(pack.root, 'bodies', record.body)));
  const wanted = new Set<string>(catalog.characters.filter(character => allows(character.id, 'portraits')).flatMap(roleImageSpecs).map(spec => spec.url));
  if (voiceMapping) roleVoiceSpecs(catalog, [...selected].filter(id => allows(id, 'voices')), voiceMapping).forEach(spec => wanted.add(spec.url));
  const scenarios = [];
  const characters = new Map<any, any>(index.characters.map(character => [character.id, character]));
  // Recognize badges from already cached scripts; this never fetches an unselected role.
  for (const spec of catalog.stories) {
    const role = owner(spec.character);
    if (scoped && !selected.has(role) || selected.has(role) && !['stories', 'cg', 'motions'].some(category => allows(role, category))) continue;
    const record = good(spec.url); if (!record) continue;
    try {
      const story = parseStory(bytes(record), spec);
      if (story.commands.some(row => row.command === 'spine')) { const character = characters.get(owner(spec.character)); if (character) character.hasDynamicCg = true; }
      if (!selected.has(owner(spec.character))) continue;
      story.dependencies.filter(item => allows(role, 'stories') || allows(role, 'cg') && wantsDependency('cg', item) || allows(role, 'motions') && wantsDependency('motions', item)).forEach(item => wanted.add(item.url));
      scenarios.push({ spec, record, story });
    } catch (error) { if (selected.has(owner(spec.character))) index.issues.push({ story: spec.id, error: error.message }); }
  }
  progress({ state: 'extracting', message: '正在整理花骑士图片和剧情…' });
  for (const variants of Object.values<any>(pack.manifest.routes)) {
    const record = variants.at(-1); if (record.method !== 'GET' || record.status !== 200 || !record.url.includes('/assets/')) continue;
    if (excludedIcons.has(record.body)) continue;
    try {
      const pathname = new URL(record.url).pathname;
      if (!wanted.has(record.url.split('?')[0]) && (scoped || !/\/character\/dmm\/i\//.test(pathname))) continue;
      if (!/\.(bin|png|jpe?g|webp|mp3)$/.test(pathname)) continue;
      const data = bytes(record), extension = sniffImage(data);
      let asset;
      if (extension) {
        const file = `images/${record.body}.${extension}`;
        if (!fs.existsSync(path.join(out, file))) fs.writeFileSync(path.join(out, file), data);
        const category = /\/character\//.test(pathname) ? /\/i\//.test(pathname) ? 'icon' : 'portrait'
          : /\/hscene_r18_spine\//.test(pathname) ? 'texture' : /\/hscene/.test(pathname) ? 'cg' : /\/background\//.test(pathname) ? 'background' : 'ui';
        asset = upsert(index.images, { id: record.body, name: pathname.split('/').at(-1), file, category, bytes: data.length });
        images.set(record.body, asset);
      } else if (pathname.endsWith('.mp3')) {
        if (!isMp3(data)) throw new Error('语音不是有效的 MP3 资源。');
        const file = `audio/${record.body}.mp3`;
        if (!fs.existsSync(path.join(out, file))) fs.writeFileSync(path.join(out, file), data);
        asset = upsert(index.audio, { id: record.body, name: pathname.split('/').at(-1), file, category: pathname.includes('/bgm/') ? 'music' : pathname.includes('/voice/') ? 'voice' : 'effect', bytes: data.length });
      }
      if (asset) assets.set(record.url.split('?')[0], asset);
    } catch (error) { index.issues.push({ file: new URL(record.url).pathname, error: error.message }); }
  }
  for (const character of index.characters) {
    if (!scoped || !character.icon) character.icon = images.get(character.iconBody)?.file || null;
    if (!allows(character.id, 'portraits')) {
      if (!scoped) character.portraits = [];
      continue;
    }
    character.portraits = character.collected ? portraitSpecs(character).map(spec => ({ phase: spec.phase, label: spec.label,
      character: spec.character, file: assets.get(spec.url)?.file || null })) : [];
  }
  const models = new Map();
  function saveSpine(reference, specs, character, placement) {
    if (models.has(reference)) { const model = models.get(reference); if (!model.characters.includes(character)) model.characters.push(character); return model; }
    const records = specs.map(item => good(item.url));
    if (records.some(item => !item)) return null;
    const skeleton = JSON.parse(bytes(records[0]).toString('utf8'));
    if (!skeleton.skeleton || !skeleton.animations) throw new Error('Invalid Spine skeleton');
    const folderName = 'cg-' + specs[0].name;
    const folder = path.join(out, 'spine', folderName); fs.mkdirSync(folder, { recursive: true });
    saveFile(path.join(folder, 'skeleton.json'), JSON.stringify(skeleton));
    let atlas = bytes(records[1]).toString('utf8').replace(/\r\n/g, '\n');
    const pageNames = [...atlas.matchAll(/^([^\n]+\.(?:png|webp))\n(?=size:)/gm)].map(match => match[1]);
    if (pageNames.length !== records.length - 2) throw new Error('Spine atlas texture count mismatch');
    for (let i = 0; i < pageNames.length; i++) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(pageNames[i])) throw new Error('Unsafe Spine page name');
      const data = bytes(records[i + 2]), extension = sniffImage(data);
      if (!extension) throw new Error('Spine texture is not an image');
      const filename = pageNames[i].replace(/\.(png|webp)$/, '.' + extension);
      atlas = atlas.replace(pageNames[i], filename); saveFile(path.join(folder, filename), data);
    }
    saveFile(path.join(folder, 'skeleton.atlas'), atlas);
    const previous = index.skeletons.find(item => item.id === md5(reference));
    const model = { id: md5(reference), name: specs[0].name, character, characters: [...new Set([...(previous?.characters || []), ...(previous?.character ? [previous.character] : []), character])], kind: 'cg', placement,
      file: `spine/${folderName}/skeleton.json`, animations: Object.keys(skeleton.animations), version: skeleton.skeleton.spine };
    models.set(reference, model); upsert(index.skeletons, model); return model;
  }
  for (const { spec, record, story } of scenarios) {
    try {
      const refs = new Set<string>();
      for (const dependency of story.dependencies) {
        if (dependency.type === 'image') {
          const image = assets.get(dependency.url); if (image) {
            image.name = dependency.reference;
            image.characters = [...new Set([...(image.characters || []), ...(image.character ? [image.character] : []), owner(spec.character)])];
            image.character = owner(spec.character); refs.add(image.id);
          }
        }
      }
      for (const command of story.commands.filter(row => row.command === 'spine' && allows(owner(spec.character), 'motions'))) {
        try { saveSpine(command.args[0], spineSpecs(command.args[0], Number(command.args[1])), owner(spec.character), spinePlacement(command.args)); }
        catch (error) { story.issues.push({ reference: command.args[0], error: error.message }); }
      }
      if (!allows(owner(spec.character), 'stories')) continue;
      story.resources = Object.fromEntries(story.dependencies.map(item => [item.reference, ['image', 'voice'].includes(item.type) ? assets.get(item.url)?.file || null : models.get(item.reference)?.file || null]));
      story.voices = Object.fromEntries(story.commands.filter(row => row.command === 'mess' && row.args[2])
        .map(row => [row.args[2], assets.get(voiceUrl(row.args[2]))?.file || null]));
      const missing = story.dependencies.filter(item => !good(item.url)).map(item => item.url);
      const voices = story.dependencies.filter(item => item.type === 'voice');
      const voiceAssets = voices.map(item => assets.get(item.url)).filter(Boolean);
      for (const audio of voiceAssets) {
        audio.context = 'story';
        audio.characters = [...new Set([...(audio.characters || []), owner(spec.character)])];
      }
      const motions = [...new Set<string>(story.commands.filter(row => row.command === 'spine').map(row => models.get(row.args[0])?.id).filter(Boolean))];
      const metadata = { id: spec.id, character: spec.character, parent: owner(spec.character), chapter: spec.chapter,
        title: `角色 ${owner(spec.character)} · 剧情 ${spec.chapter}`, dialogue: story.dialogue,
        file: `stories/${spec.id}.json`, script: `stories/${spec.id}.csv`, images: [...refs], motions,
        voiceTotal: voices.length, voiceSaved: voiceAssets.length, voiceFiles: [...new Set<string>(voiceAssets.map(item => item.file))],
        complete: missing.length === 0 && story.issues.length === 0,
        missing: missing.length, issues: story.issues.length };
      story.audio = Object.fromEntries([...assets].filter(([, item]) => item.category === 'voice' || item.category === 'music').map(([url, item]) => [url, item.file]));
      story.ui = storyUi?.file || null;
      saveFile(path.join(out, metadata.file), JSON.stringify(story));
      saveFile(path.join(out, metadata.script), bytes(record));
      upsert(index.stories, metadata);
      const character = characters.get(metadata.parent);
      if (character) { character.stories ||= []; if (!character.stories.includes(metadata.id)) character.stories.push(metadata.id); }
    } catch (error) { index.issues.push({ story: spec.id, error: error.message }); }
  }
  index.stats = { ...(scoped ? index.stats : {}), characters: index.characters.length, stories: index.stories.length,
    completeStories: index.stories.filter(item => item.complete).length, cg: index.images.filter(item => item.category === 'cg').length,
    dynamicCg: index.skeletons.filter(item => item.kind === 'cg').length, audio: index.audio.length,
    characterVoices: index.audio.filter(item => item.context === 'character').length,
    icons: index.images.filter(item => item.category === 'icon').length, issues: index.issues.length };
  prepareLibrary(index, catalog, previous);
  index.storyUi = storyUi;
  index.generated = new Date().toISOString();
  if (voiceMapping) syncCachedVoices(root, { mapping: voiceMapping, index, persist: false });
  const file = path.join(out, 'index.json'); fs.writeFileSync(file + '.tmp', JSON.stringify(index)); renameFileSync(file + '.tmp', file);
  progress({ state: 'ready', message: '花骑士内容索引已更新。', stats: index.stats });
  return { state: 'ready', message: '花骑士内容索引已更新。', stats: index.stats };
}
if (require.main === module) (async () => {
  const root = require('./paths.ts').root;
  const work = async () => {
    // An empty project has no game capture to extend. Keep extraction a local
    // no-op there instead of downloading a whole game without imported data.
    const hasGameData = Object.values<any>(loadPack(path.join(root, 'cache')).manifest.routes).some(records => records.some(record => record.url.startsWith(require('./format.ts').BASE)));
    if (hasGameData) try { await require('./refresh-catalog.ts').refreshCatalog(root); }
    catch (error) { console.warn('完整角色目录暂未更新：' + error.message); }
    console.log(JSON.stringify(extract(root)));
  };
  const file = path.join(root, 'state/pack.lock');
  // The server owns the lock while its extraction child runs. A standalone
  // CLI invocation must acquire its own lock before refreshing or exporting.
  const parentOwnsLock = fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.ppid;
  if (parentOwnsLock) await work(); else await require('../../../app/projects.ts').withPackLock(root, work);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
export { extract };
