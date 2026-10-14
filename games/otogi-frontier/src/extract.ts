import { renameFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { loadPack, routeKey, sha256 } = require('../../../app/pack.ts');
const { readCatalog, readJson } = require('./catalog.ts');
const { decodeBundle } = require('./format.ts');
const { runPython } = require('./python.ts');
const { cachedStories, writeStories } = require('./stories.ts');
async function extract(root, progress: (...args: any[]) => any = () => {}, { roles, scope = 'all', exportResources = request => runPython('export_unity.py', [], request) }: any = {}) {
  const catalog = readCatalog(root), pack = loadPack(path.join(root, 'cache')), output = path.join(root, 'library');
  const previous = readJson(path.join(output, 'index.json'), {}), old = new Map<any, any>((previous.characters || []).map(character => [character.id, character]));
  const index: { version: number; game: string; aliases: any; characters: any[]; images: any; audio: any; skeletons: any; stories: any; issues: any; iconBody?: string; stats?: Record<string, number>; generated?: string; } = { version: 1, game: 'otogi-frontier', aliases: catalog.aliases, characters: [], images: previous.images || [], audio: previous.audio || [], skeletons: previous.skeletons || [], stories: previous.stories || [], issues: roles ? (previous.issues || []).filter(issue => !roles.includes(issue.character)) : scope === 'catalog' ? previous.issues || [] : [] };
  const codec = readJson(path.join(root, 'metadata/asset-codec.json'), null), bundles = [], specs = new Map();
  const good = spec => pack.manifest.routes[routeKey('GET', spec.url)]?.findLast(record => record.status === 200 && fs.existsSync(path.join(pack.root, 'bodies', record.body)));
  const referenced = file => file && fs.existsSync(path.join(output, file));
  function queue(spec, kind, character, extra: any = {}) {
    if (specs.has(spec.url)) return;
    const record = good(spec); if (!record) return;
    // A sheet can preload unreleased sprites. An unchanged sheet still needs
    // re-indexing when the refreshed master adds a role without a linked icon.
    const done = kind === 'icons' ? previous.iconBody === record.body && catalog.characters.every(item => referenced(old.get(item.id)?.icon))
      : kind === 'voices' ? index.audio.some(item => item.archiveBody === record.body && referenced(item.file))
        : kind === 'cg' ? index.skeletons.some(item => item.exportVersion >= 2 && item.archiveBody === record.body && referenced(item.file) && (item.layers || []).every(layer => referenced(layer.file))) || index.images.some(item => item.category === 'cg' && item.archiveBody === record.body && referenced(item.file))
          : ['music', 'sound'].includes(kind) ? index.audio.some(item => item.archiveBody === record.body && referenced(item.file)) : index.images.some(item => item.archiveBody === record.body && referenced(item.file));
    specs.set(spec.url, { ...spec, kind, character, archiveBody: record.body });
    if (done) return;
    try {
      const raw = fs.readFileSync(path.join(pack.root, 'bodies', record.body)); if (sha256(raw) !== record.body) throw new Error('资源正文校验失败。');
      const bytes = decodeBundle(raw, codec);
      const directory = path.join(root, 'cache/decoded'); fs.mkdirSync(directory, { recursive: true });
      const input = path.join(directory, record.body + '.bundle'); if (!fs.existsSync(input)) fs.writeFileSync(input, bytes);
      if (!bundles.some(item => item.url === spec.url)) bundles.push({ input, kind: kind === 'actors' ? 'portraits' : kind, url: spec.url, body: record.body, scene: spec.scene, ...extra });
    } catch (error) { index.issues.push({ character, resource: spec.name, error: error.message }); }
  }
  if (!roles) {
    const sprites = {};
    for (const character of catalog.characters) for (const variant of character.variants.slice().reverse()) sprites[variant] = character.id;
    // Prefer the initial icon. Other available icons are a fallback per root.
    for (const character of catalog.characters) sprites[character.id] = character.id;
    for (const spec of catalog.icons) queue(spec, 'icons', undefined, { sprites });
  }
  for (const character of catalog.characters.filter(item => !roles || roles.includes(item.id))) {
    if (['all', 'portraits'].includes(scope)) for (const spec of character.portraits) queue(spec, 'portraits', character.id);
    if (['all', 'cg', 'motions', 'stories'].includes(scope)) for (const spec of character.cg) queue(spec, 'cg', character.id);
    if (['all', 'voices'].includes(scope)) for (const spec of character.voices) queue(spec, 'voices', character.id);
  }
  if (['all', 'stories'].includes(scope)) for (const { spec, story } of cachedStories(root, catalog, roles)) for (const dependency of story.dependencies) queue(dependency, dependency.kind, spec.character);
  if (bundles.length) {
    progress({ state: 'extracting', message: '正在整理童话边境立绘、CG 和语音…' });
    const result = await exportResources({ output, bundles });
    const put = (items, item) => { const position = items.findIndex(previous => previous.id === item.id); if (position < 0) items.push(item); else items[position] = item; };
    for (const resource of result.resources) {
      const spec = specs.get(resource.url);
      for (const image of resource.images || []) put(index.images, { ...image, id: sha256(Buffer.from(resource.url + ':' + (image.character || spec.character) + ':' + (image.sprite || image.id))), character: image.character || spec.character, assetCharacter: spec.assetCharacter, resource: spec.name, archiveBody: resource.body, phase: spec.phase, label: spec.label });
      for (const [number, motion] of (resource.motions || []).entries()) put(index.skeletons, { ...motion, id: sha256(Buffer.from(resource.url + ':' + number)), character: spec.character, kind: 'cg', label: spec.label, scene: spec.scene, resource: spec.name, archiveBody: resource.body });
      for (const [number, voice] of (resource.audio || []).entries()) put(index.audio, { ...voice, id: sha256(Buffer.from(resource.url + ':' + voice.id)), character: spec.character, scene: spec.scene, context: ['music', 'sound'].includes(spec.kind) ? spec.kind : 'character', group: spec.group || 'CG 配音', label: (spec.group || 'CG 配音') + ' ' + (number + 1), resource: spec.name, archiveBody: resource.body });
    }
    for (const issue of result.issues) { const spec = specs.get(issue.resource); index.issues.push({ ...issue, character: spec?.character }); }
  }
  for (const item of index.audio) if (!item.scene) item.scene = /^voice_(?:adventure|still)_(\d+)$/.exec(item.resource || '')?.[1];
  for (const character of catalog.characters) {
    const before = old.get(character.id) || {}, icons = index.images.filter(image => image.category === 'icon' && image.character === character.id && referenced(image.file));
    const icon = icons.find(image => image.sprite === character.id) || icons[0];
    const portraits = character.portraits.flatMap(spec => index.images.filter(image => image.category === 'portrait' && image.character === character.id && image.resource === spec.name && referenced(image.file))
      .map(image => ({ phase: spec.phase, label: spec.label, variant: spec.variant, file: image.file, archiveBody: image.archiveBody })));
    const cg = index.images.filter(image => image.category === 'cg' && image.character === character.id && referenced(image.file));
    const motions = index.skeletons.filter(item => item.character === character.id && referenced(item.file));
    index.characters.push({ id: character.id, name: character.name, variants: character.variants, rarityId: character.rarityId, rarityLabel: character.rarityLabel,
      icon: icon?.file || before.icon || null, portraits, cg, motions: motions.map(item => item.id), hasDynamicCg: motions.length > 0,
      cgAvailable: character.cg.length > 0, voiceAvailable: character.voices.length > 0, portraitTotal: character.portraits.length,
      storyAvailable: character.stories.length > 0, collected: !!(portraits.length || cg.length || motions.length || index.audio.some(item => item.character === character.id)), stories: [] });
  }
  writeStories(root, index, catalog);
  index.iconBody = good(catalog.icons[0])?.body || previous.iconBody;
  index.stats = { characters: index.characters.length, icons: index.characters.filter(character => character.icon).length, collected: index.characters.filter(character => character.collected).length,
    portraits: index.characters.reduce((sum, character) => sum + character.portraits.length, 0), cg: index.characters.reduce((sum, character) => sum + character.cg.length, 0) + index.skeletons.length, dynamicCg: index.skeletons.length, audio: index.audio.length, stories: index.stories.length, issues: index.issues.length };
  index.generated = new Date().toISOString(); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'index.json.tmp'), JSON.stringify(index)); renameFileSync(path.join(output, 'index.json.tmp'), path.join(output, 'index.json'));
  progress({ state: 'ready', message: '童话边境资源库已更新。', stats: index.stats }); return index;
}
if (require.main === module) {
  const root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../../parsed-data/otogi-frontier');
  require('../../../app/projects.ts').withPackLock(root, () => extract(root)).then(index => console.log(JSON.stringify(index.stats))).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
export { extract };
