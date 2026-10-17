'use strict';
const fs = require('node:fs'), path = require('node:path');
const { loadPack, routeKey, sha256 } = require('../../../app/pack.ts');
const { readCatalog, readJson, writeJson } = require('./catalog.ts');
const { cachedStories } = require('./story.ts');
const { runUnity } = require('./unity.ts');
async function extract(root, progress: (...args: any[]) => any = () => {}, { roles, scope = 'all', exportResources = runUnity }: any = {}) {
  const catalog = readCatalog(root), pack = loadPack(path.join(root, 'cache')), output = path.join(root, 'library');
  const cache = readJson(path.join(root, 'metadata/exports.json'), {});
  const issues = [], requests = [], wanted = new Map(), fingerprints = new Map(), inputsByAddress = new Map(), validated = new Map();
  const exists = file => typeof file === 'string' && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && fs.existsSync(path.join(output, file));
  const intact = item => item && (item.image ? exists(item.image.file) : item.audio ? exists(item.audio.file) : item.model ? item.model.files?.length && item.model.files.every(exists) : false);
  function source(address) {
    if (inputsByAddress.has(address)) return inputsByAddress.get(address);
    const spec = catalog.assets[address]; if (!spec?.bundles?.length) return null;
    const records = [];
    for (const url of spec.bundles) {
      const record = pack.manifest.routes[routeKey('GET', url)]?.at(-1);
      if (!record || record.status !== 200 || !/^[a-f0-9]{64}$/.test(record.body)) return null;
      const input = path.join(pack.root, 'bodies', record.body);
      if (!validated.has(record.body)) validated.set(record.body, fs.existsSync(input) && fs.statSync(input).size === record.size && sha256(fs.readFileSync(input)) === record.body);
      if (!validated.get(record.body)) return null;
      records.push({ input, body: record.body });
    }
    const fingerprint = sha256(Buffer.from(spec.internalId + ':' + records.map(record => record.body).join(':'))); fingerprints.set(address, fingerprint);
    const value = { fingerprint, inputs: records.map(record => record.input) }; inputsByAddress.set(address, value); return value;
  }
  function queue(address, kind) {
    if (wanted.has(address) || !catalog.assets[address]) return;
    wanted.set(address, kind); const spec = catalog.assets[address], input = source(address); if (!input) return;
    const { fingerprint } = input;
    const current = cache[address];
    const modelCurrent = !current?.model || current.model.exportVersion >= (address.startsWith('SCS/') ? 3 : 2);
    if (current?.fingerprint === fingerprint && intact(current) && modelCurrent) return;
    requests.push({ address, kind, internalId: spec.internalId, type: spec.type, ...input });
  }
  for (const character of catalog.characters.filter(item => !roles || roles.includes(item.id))) {
    if (['all', 'catalog', 'portraits'].includes(scope)) {
      Object.values<string>(character.portal || {}).filter(Boolean).forEach(address => queue(address, 'portal'));
      character.portraits.forEach(address => queue(address, 'portraits'));
    }
    if (['all', 'portraits'].includes(scope)) (character.cardPortraits || []).forEach(address => queue(address, 'portraits'));
    if (['all', 'cg', 'motions'].includes(scope)) { if (scope !== 'motions') character.cg.forEach(address => queue(address, 'cg')); character.motions.forEach(address => queue(address, 'motions')); }
    if (['all', 'voices'].includes(scope)) character.voices.forEach(voice => queue(voice.address, 'voices'));
  }
  const scenarios = cachedStories(root, catalog, roles);
  if (['all', 'stories'].includes(scope)) for (const story of scenarios) for (const address of story.assets) queue(address,
    address.startsWith('SBSX/') ? 'motions' : address.startsWith('ASA/') ? 'story-voices' : address.startsWith('ASBM/') ? 'music' : address.startsWith('ASASE/') ? 'sound' : /^(ICS|SCS)\//.test(address) ? 'portraits' : 'background');
  if (requests.length) {
    progress({ state: 'extracting', message: '正在整理 Muv-Luv 角色素材…', targets: requests.length });
    // A bounded batch prevents a large HAR's audio catalog from keeping all
    // Unity files and decoded textures alive in one Python process.
    for (let start = 0; start < requests.length; start += 100) {
      const result = await exportResources({ output, assets: requests.slice(start, start + 100) });
      for (const resource of result.resources || []) cache[resource.address] = resource;
      for (const issue of result.issues || []) issues.push({ resource: issue.address, error: issue.error });
      writeJson(path.join(root, 'metadata/exports.json'), cache);
      progress({ state: 'extracting', message: '正在整理 Muv-Luv 角色素材…', checked: Math.min(start + 100, requests.length), targets: requests.length });
    }
  }
  const index: { version: number; game: string; characters: any[]; images: any[]; audio: any[]; stories: any[]; skeletons: any[]; issues: any[]; storyUi?: any; stats?: Record<string, number>; generated?: string; } = { version: 1, game: 'muvluv-ggx', characters: [], images: [], audio: [], stories: [], skeletons: [], issues: [] };
  function saved(address) {
    const value = cache[address]; if (!intact(value)) return null;
    const expected = source(address)?.fingerprint;
    // Clearing raw downloads does not remove already exported, intact media.
    // Replace it only when a newly available source proves that it changed.
    if (expected && value.fingerprint !== expected) return null;
    return value;
  }
  const knownImage = (address, character, category) => {
    const value = saved(address); if (!value?.image) return null;
    const image = { ...value.image, id: sha256(Buffer.from(character + ':' + category + ':' + address)), character, category, resource: address };
    if (!index.images.some(item => item.id === image.id)) index.images.push(image); return image;
  };
  for (const character of catalog.characters) {
    const icon = knownImage(character.icon, character.id, 'icon');
    const portraits = [...character.portraits, ...(character.cardPortraits || [])].flatMap(address => {
      const card = address.startsWith('SBC/'), label = card ? '动态卡面' : '衣装立绘', phase = card ? 'card' : 'stand';
      const model = saved(address)?.model;
      if (model) {
        const item = { ...model, id: sha256(Buffer.from(character.id + ':' + address)), character: character.id, kind: 'portrait', resource: address, label, still: !card };
        index.skeletons.push(item);
        return [{ phase, label, model: item.id, file: model.file, resource: address }];
      }
      const image = knownImage(address, character.id, 'portrait'); return image ? [{ phase, label, file: image.file, resource: address }] : [];
    });
    const cg = character.cg.flatMap(address => { const image = knownImage(address, character.id, 'cg'); return image ? [image] : []; });
    const motions = character.motions.flatMap(address => { const model = saved(address)?.model; if (!model) return []; const item = { ...model, id: sha256(Buffer.from(character.id + ':' + address)), character: character.id, kind: 'cg', resource: address, label: '动态 CG' }; index.skeletons.push(item); return [item]; });
    for (const voice of character.voices) {
      const audio = saved(voice.address)?.audio; if (audio) index.audio.push({ ...audio, ...voice, resource: voice.address, id: sha256(Buffer.from(character.id + ':' + voice.address)), character: character.id, context: 'character', category: 'character-voice' });
    }
    const portal = Object.fromEntries(Object.entries<string>(character.portal || {}).map(([key, address]) => [key, knownImage(address, character.id, 'portal')?.file || null]));
    index.characters.push({ id: character.id, name: character.name, personId: character.personId, parentPersonId: character.parentPersonId, shortName: character.shortName, subtitle: character.subtitle,
      styleOrder: character.styleOrder, profile: character.profile, portal, portraitResourceId: character.portraitResourceId,
      rarityId: character.rarityId, rarityLabel: character.rarityLabel, icon: icon?.file || null,
      portraits, cg, motions: motions.map(model => model.id), hasDynamicCg: character.motions.length > 0, portraitTotal: character.portraits.length + (character.cardPortraits || []).length,
      cgAvailable: character.cg.length + character.motions.length > 0, voiceAvailable: character.voices.length > 0,
      storyAvailable: catalog.scenes.some(scene => scene.character === character.id), collected: !!(portraits.length || cg.length || motions.length || index.audio.some(audio => audio.character === character.id)), stories: [] });
  }
  const storyUi=require('./story-ui.ts').readStoryUi(root);index.storyUi=storyUi;
  for (const scenario of cachedStories(root, catalog)) {
    for (const address of scenario.assets) {
      const value = saved(address); const file = value?.image?.file || value?.audio?.file || value?.model?.file;
      if (!file) continue; scenario.resources[address] = file;
      if (address.startsWith('ASA/') && value.audio) { scenario.voices[address] = file; index.audio.push({ ...value.audio, id: sha256(Buffer.from(scenario.id + ':' + address)), resource: address, context: 'story', category: 'story-voice', scene: scenario.id, characters: scenario.characters }); }
      if (value?.model && !index.skeletons.some(model => model.file === value.model.file)) index.skeletons.push({ ...value.model, id: sha256(Buffer.from(address)), resource: address, kind: 'story' });
    }
    scenario.models=Object.fromEntries(scenario.assets.flatMap(address=>saved(address)?.model?[[address,saved(address).model]]:[]));
    scenario.icons=Object.fromEntries(catalog.characters.flatMap(role=>{const icon=saved(role.icon)?.image?.file;return icon?[[role.portraitResourceId||role.resourceId,icon]]:[];}));
    scenario.ui=storyUi?.file||null;scenario.missingAssets=scenario.assets.filter(address=>!saved(address));
    if(!storyUi)scenario.missingAssets.push('GameUi/Scenario');
    scenario.complete=scenario.segments.length===scenario.expectedSegments.length&&!scenario.missingAssets.length;
    const file = 'stories/' + scenario.id + '.json', script = 'stories/' + scenario.id + '.source.json';
    writeJson(path.join(output, file), scenario);
    writeJson(path.join(output,script),scenario.segments.flatMap(id=>readJson(path.join(root,'metadata/scene-'+id+'.json'),[])));
    const metadata = { id: scenario.id, title: scenario.title || '已保存剧情', character: scenario.character, characters: [scenario.character], file, script, scriptFormat: 'json', format: 'muvluv', adult: scenario.adult,hasCg:true,programVersion:2,complete:scenario.complete,segments:scenario.segments.length,
      expectedSegments: scenario.expectedSegments.length, missingAssets: scenario.missingAssets.length,
      dialogue: scenario.commands.filter(command => command.command === 'mess').length, voiceFiles: Object.values<any>(scenario.voices) };
    index.stories.push(metadata);
    for (const character of index.characters) if (scenario.character===character.id) { character.stories.push(scenario.id); character.storyAvailable = true; character.collected = true; }
  }
  for (const issue of issues) {
    const character = catalog.characters.find(role => [role.icon, ...role.portraits, ...role.cg, ...role.motions, ...role.voices.map(voice => voice.address)].includes(issue.resource))?.id;
    index.issues.push({ ...issue, character });
  }
  index.stats = { characters: index.characters.length, icons: index.characters.filter(character => character.icon).length, collected: index.characters.filter(character => character.collected).length,
    portraits: index.characters.reduce((sum, character) => sum + character.portraits.length, 0), cg: index.characters.reduce((sum, character) => sum + character.cg.length, 0), dynamicCg: index.skeletons.filter(model => model.kind === 'cg').length,
    audio: index.audio.length, characterVoices: index.audio.filter(audio => audio.context === 'character').length, stories: index.stories.length, issues: index.issues.length };
  index.generated = new Date().toISOString(); writeJson(path.join(output, 'index.json'), index);
  progress({ state: 'ready', message: 'Muv-Luv 资源库已更新。', stats: index.stats }); return index;
}
if (require.main === module) {
  const root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../../parsed-data/muvluv-ggx');
  require('../../../app/projects.ts').withPackLock(root, () => extract(root)).then(index => console.log(JSON.stringify(index.stats))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
export { extract };
