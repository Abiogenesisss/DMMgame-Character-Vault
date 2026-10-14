'use strict';
const fs = require('node:fs'), path = require('node:path');
const { loadPack, routeKey, sha256 } = require('../../../app/pack.ts');
const { readCatalog, prepareCatalog } = require('./catalog.ts');
const { archive, texture, png } = require('./format.ts');
const { isGamePortrait } = require('./portraits.ts');
function extract(root, progress: (...args: any[]) => any = () => {}, { roles, scope = 'all' }: any = {}) {
  const catalog = readCatalog(root), pack = loadPack(path.join(root, 'cache')), out = path.join(root, 'library');
  fs.mkdirSync(path.join(out, 'images'), { recursive: true });
  const indexFile = path.join(out, 'index.json'), previous = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : null;
  const saved = new Map<any, any>((previous?.characters || []).map(character => [character.id, character]));
  const excludedFiles = new Set<string>((previous?.characters || []).flatMap(character => (character.portraits || []).filter(image => !isGamePortrait(image)).map(image => image.file)));
  const index: { version: number; game: string; characters: any[]; images: any[]; issues: any; stats?: Record<string, number>; generated?: string; } = { version: 1, game: 'aigis', characters: [], images: [...(previous?.images || [])], issues: roles ? (previous?.issues || []).filter(issue => isGamePortrait(issue) && !roles.includes(issue.character)) : [] };
  const imageIds = new Set(index.images.map(image => image.id));
  const good = spec => pack.manifest.routes[routeKey('GET', spec.url)]?.findLast(record => record.status === 200 && fs.existsSync(path.join(pack.root, 'bodies', record.body)));
  function exportImage(raw, frame, metadata) {
    const bytes = png(raw, frame), id = sha256(bytes), file = 'images/' + id + '.png', target = path.join(out, file);
    if (!fs.existsSync(target)) { fs.writeFileSync(target + '.tmp', bytes); fs.renameSync(target + '.tmp', target); }
    if (!imageIds.has(id)) { imageIds.add(id); index.images.push({ id, file, width: frame.width, height: frame.height, bytes: bytes.length, ...metadata }); }
    return file;
  }
  const icons = new Map();
  for (const spec of [...catalog.icons].sort((a, b) => a.name.localeCompare(b.name))) {
    const record = good(spec); if (!record) continue;
    // Previously exported atlases are linked from the index without decoding again.
    const existing = (previous?.images || []).filter(image => image.category === 'icon' && image.archiveBody === record.body);
    if (existing.length) { for (const image of existing) if (!icons.has(image.character)) icons.set(image.character, image.file); continue; }
    try {
      for (const member of archive(fs.readFileSync(path.join(pack.root, 'bodies', record.body))).filter(member => member.name.endsWith('.atx'))) {
        const raw = texture(member.bytes);
        if (raw.placeholder) continue;
        for (const frame of raw.frames) {
          const id = (spec.name.startsWith('skin_') ? 'skin-' : '') + String(frame.id).padStart(4, '0');
          if (roles && !roles.includes(id) || !catalog.characters.some(character => character.id === id) || icons.has(id)) continue;
          icons.set(id, exportImage(raw, frame, { category: 'icon', character: id, archiveBody: record.body }));
        }
      }
    } catch (error) { index.issues.push({ resource: spec.name, error: error.message }); }
  }
  for (const character of catalog.characters) {
    const old = saved.get(character.id), entry: { id: any; name: any; rarityId: any; rarityLabel: any; rarityCode: any; artists: any; artistSource: any; icon: any; portraits: any; cg: any[]; placeholders: any; portraitTotal: any; cgAvailable: boolean; collected?: boolean; } = { id: character.id, name: character.name,
      rarityId: character.rarityId ?? null, rarityLabel: character.rarityLabel || '未标注', rarityCode: character.rarityCode ?? null,
      artists: character.artists || [], artistSource: character.artistSource || null,
      icon: icons.get(character.id) || old?.icon || null,
      portraits: (old?.portraits || []).filter(isGamePortrait), cg: [...(old?.cg || [])],
      placeholders: (old?.placeholders || []).filter(item => [...character.portraits, ...character.cg].some(spec => spec.name === item.resource)),
      portraitTotal: character.portraits.length, cgAvailable: character.cg.length > 0 };
    if (!roles || roles.includes(character.id)) for (const [category, specs] of [['portraits', character.portraits], ['cg', character.cg]].filter(([category]) => scope === 'all' || scope === category)) for (const spec of specs) {
      const record = good(spec); if (!record) continue;
      const portraitMember = new RegExp('_card_' + (/^\d$/.test(spec.phase || '') ? spec.phase : '0') + '\\.atx$', 'i');
      if (entry.placeholders.some(item => item.resource === spec.name && item.archiveBody === record.body)) continue;
      if (entry[category].some(image => image.archiveBody === record.body && (category !== 'portraits' || portraitMember.test(image.member)) && fs.existsSync(path.join(out, image.file)))) continue;
      try {
        const members = archive(fs.readFileSync(path.join(pack.root, 'bodies', record.body))).filter(member => member.name.endsWith('.atx'));
        // Awakened archives may include base art too. Match the requested form
        // to the member suffix, rather than exporting the first texture again.
        const pictures = category === 'portraits' ? members.filter(member => portraitMember.test(member.name)) : members;
        if (!pictures.length) throw new Error('归档中没有对应的静态图片。');
        entry[category] = entry[category].filter(image => image.resource !== spec.name);
        entry.placeholders = entry.placeholders.filter(item => item.resource !== spec.name);
        let placeholder = false, exported = 0;
        for (const member of pictures) {
          const raw = texture(member.bytes);
          if (raw.placeholder) { placeholder = true; continue; }
          // Some CGs omit sprite rectangles and use the full static canvas.
          // Empty avatar slots remain excluded by the icon extraction path.
          const frames = category === 'cg' && !raw.frames.length ? [{ id: 0, x: 0, y: 0, width: raw.width, height: raw.height }] : raw.frames;
          for (const frame of frames) {
            const label = category === 'portraits' ? spec.label : 'CG ' + (entry.cg.length + 1);
            const file = exportImage(raw, frame, { category: category === 'portraits' ? 'portrait' : 'cg', character: character.id, archiveBody: record.body });
            entry[category].push({ file, label, phase: spec.phase, resource: spec.name, member: member.name, frame: frame.id, archiveBody: record.body });
            exported++;
          }
        }
        if (placeholder && !exported) entry.placeholders.push({ resource: spec.name, category, phase: spec.phase, archiveBody: record.body });
      } catch (error) { index.issues.push({ character: character.id, resource: spec.name, error: error.message }); }
    }
    entry.portraits.sort((a, b) => character.portraits.findIndex(spec => spec.name === a.resource) - character.portraits.findIndex(spec => spec.name === b.resource));
    entry.collected = !!(entry.portraits.length || entry.cg.length); index.characters.push(entry);
  }
  const referencedFiles = new Set(index.characters.flatMap(character => [character.icon, ...character.portraits.map(image => image.file), ...character.cg.map(image => image.file)]).filter(Boolean));
  index.images = index.images.filter(image => referencedFiles.has(image.file));
  index.stats = { characters: index.characters.length, icons: index.characters.filter(character => character.icon).length,
    collected: index.characters.filter(character => character.collected).length,
    portraits: index.characters.reduce((total, character) => total + character.portraits.length, 0),
    cg: index.characters.reduce((total, character) => total + character.cg.length, 0), issues: index.issues.length };
  index.generated = new Date().toISOString(); fs.writeFileSync(indexFile + '.tmp', JSON.stringify(index)); fs.renameSync(indexFile + '.tmp', indexFile);
  // Delete only excluded exports with canonical filenames, and retain any file
  // still shared by a valid portrait, icon or CG. Raw archives stay untouched.
  for (const file of excludedFiles) if (/^images\/[a-f0-9]{64}\.png$/.test(file) && !referencedFiles.has(file)) fs.rmSync(path.join(out, file), { force: true });
  progress({ state: 'ready', message: '千年战争立绘与 CG 索引已更新。', stats: index.stats });
  return index;
}
if (require.main === module) {
  const root = require('./paths.ts').root;
  require('../../../app/projects.ts').withPackLock(root, async () => { await prepareCatalog(root); return extract(root); })
    .then(index => console.log(JSON.stringify(index.stats))).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
export { extract };
