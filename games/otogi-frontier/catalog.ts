'use strict';
const fs = require('node:fs'), path = require('node:path');
const { loadPack, routeKey } = require('../../app/pack.ts');
const { BASE, MASTER, RARITIES, validId, resourceKind, readMaster } = require('./format.ts');
const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
function buildCharacters(rows, scenes: any = {}, records = []) {
  const groups = new Map();
  for (const row of rows) {
    if (!validId(row.id) || !validId(row.rmid) || typeof row.n !== 'string' || !row.n.trim() || !Number.isInteger(row.ce) || row.ce < 1 || row.ce > 10) continue;
    const id = String(row.rmid); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(row);
  }
  const aliases = {}, characters = [];
  for (const [id, variants] of groups) {
    variants.sort((a, b) => a.ce - b.ce || a.id - b.id);
    const base = variants.find(row => String(row.id) === id);
    // A missing base does not allow an evolution stage to invent a rarity.
    const rarity = RARITIES.find(item => item.id === base?.r);
    const character: { id: any; name: any; rarityId: any; rarityLabel: any; variants: any; portraits: any; cg: any[]; voices: any[]; extraStory?: any; } = { id, name: base?.n || variants[0].n, rarityId: rarity?.id ?? null, rarityLabel: rarity?.label || '未标注', variants: variants.map(row => String(row.id)),
      portraits: variants.map(row => ({ name: 'chara/homestand/' + row.id, url: BASE + 'chara/homestand/' + row.id, phase: String(row.ce), label: row.ce === 1 ? '初始' : '进化 ' + (row.ce - 1), variant: String(row.id) })), cg: [], voices: [] };
    // Confirmed against captured and unowned roles: CG IDs are a leading 2,
    // the root's family digits, then scene 1/2. Probe only the scene slots the
    // master explicitly lists, and only when the user downloads that role.
    if (id.endsWith('1')) for (const chapter of [1, 2]) if ([1, 2, 3, 4].includes(base?.['sc' + chapter])) {
      const scene = '2' + id.slice(0, -1) + chapter;
      character.cg.push({ name: 'chara/still/' + scene, url: BASE + 'chara/still/' + scene, scene, label: 'CG ' + chapter, source: 'id-template' });
    }
    for (const variant of character.variants) aliases[variant] = id;
    character.extraStory = base?.sc3 === 5; characters.push(character);
  }
  for (const scene of Object.values<any>(scenes)) {
    const character = characters.find(item => item.id === aliases[scene.character]);
    if (!character || !validId(scene.id)) continue;
    const confirmed = character.cg.find(spec => spec.scene === scene.id);
    if (confirmed) confirmed.source = 'captured-scene';
    else character.cg.push({ name: 'chara/still/' + scene.id, url: BASE + 'chara/still/' + scene.id, scene: scene.id, label: 'CG ' + (character.cg.length + 1), source: 'captured-scene' });
    for (const record of records.filter(record => resourceKind(record.url) === 'voices' && record.url.endsWith('_' + scene.id))) {
      if (!character.voices.some(spec => spec.url === record.url)) character.voices.push({ name: new URL(record.url).pathname.split('/').at(-1), url: record.url, scene: scene.id,
        group: record.url.includes('/still/') ? 'CG 配音' : '剧情配音' });
    }
  }
  for (const character of characters) {
    // CG voice bundles use the same scene ID on the public asset server.
    // Old roles use different clip names inside the bundle, so only infer the
    // bundle path; never manufacture individual voice filenames.
    for (const [index, spec] of character.cg.entries()) {
      const name = 'voice_still_' + spec.scene, url = BASE + 'sound/voice/still/' + name;
      const captured = character.voices.find(voice => voice.url === url);
      if (captured) { captured.source = 'captured-voice'; captured.group = 'CG ' + (index + 1) + ' 配音'; }
      else character.voices.push({ name, url, scene: spec.scene, group: 'CG ' + (index + 1) + ' 配音', source: 'id-template' });
    }
    character.stories = character.cg.map((spec, index) => ({ id: 'otogi-' + spec.scene, character: character.id, scene: spec.scene, chapter: index + 1, adult: true, title: 'CG ' + (index + 1) + ' · 剧情与演出', sources: [
      { kind: 'scene', url: 'https://otogi-rest.otogi-frontier.com/api/MScenes/' + spec.scene }, { kind: 'adult', url: 'https://otogi-rest.otogi-frontier.com/api/MAdults/MonsterMAdults/' + spec.scene }
    ] }));
    if (character.extraStory && character.id.endsWith('1')) { const scene = '2' + character.id.slice(0, -1) + '3'; character.stories.push({ id: 'otogi-' + scene, character: character.id, scene, chapter: 3, adult: false, title: '角色剧情 3', sources: [{ kind: 'scene', url: 'https://otogi-rest.otogi-frontier.com/api/MScenes/' + scene }] }); }
    delete character.extraStory;
  }
  characters.sort((a, b) => Number(a.id) - Number(b.id));
  return { version: 3, game: 'otogi-frontier', aliases, characters, icons: [{ url: BASE + 'chara_icon', name: 'chara_icon' }] };
}
function buildCatalog(root) {
  const pack = loadPack(path.join(root, 'cache')), record = pack.manifest.routes[routeKey('GET', MASTER)]?.findLast(item => item.status === 200);
  if (!record) throw new Error('抓包中没有童话边境角色表 MMonsters.gz。');
  const rows = readMaster(fs.readFileSync(path.join(pack.root, 'bodies', record.body))), records = Object.values<any>(pack.manifest.routes).flat();
  const catalog = buildCharacters(rows, readJson(path.join(root, 'metadata/scenes.json'), {}), records);
  if (!catalog.characters.length) throw new Error('童话边境角色表中没有有效角色。');
  fs.mkdirSync(path.join(root, 'metadata'), { recursive: true });
  fs.writeFileSync(path.join(root, 'metadata/catalog.json'), JSON.stringify(catalog)); return catalog;
}
const readCatalog = root => { const catalog = readJson(path.join(root, 'metadata/catalog.json'), null); return catalog?.version >= 3 ? catalog : buildCatalog(root); };
export { buildCharacters, buildCatalog, readCatalog, readJson };
