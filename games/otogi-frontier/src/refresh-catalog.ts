'use strict';
const fs = require('node:fs'), path = require('node:path');
const { downloadUrls } = require('../../../app/download.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { MASTER, readMaster, decodeBundle } = require('./format.ts');
const { readCatalog, buildCatalog, buildCharacters, readJson } = require('./catalog.ts');
const { extract } = require('./extract.ts');
async function refreshCatalog(root, { ids = [], fetchResource = fetchPublicResource, onProgress = () => {}, extractResources = extract }: any = {}) {
  const previous = readCatalog(root), library = readJson(path.join(root, 'library/index.json'), { characters: [] });
  onProgress({ phase: 'catalog', checked: 0, targets: 1 });
  const result = await downloadUrls(root, [{ url: MASTER }], { refresh: true, fetchResource, maxBytes: 32 * 1024 * 1024,
    validate: bytes => { if (!buildCharacters(readMaster(bytes)).characters.length) throw new Error('公开角色表没有有效角色，已保留现有资料。'); } });
  if (result.failed) throw new Error(result.errors[0]?.error || '童话边境角色表更新失败。');
  const catalog = buildCatalog(root), old = new Map<any, any>(previous.characters.map(character => [character.id, character]));
  // Retired/collaboration roles and their known resource paths remain usable.
  for (const character of catalog.characters) {
    const before = old.get(character.id); if (!before) continue;
    for (const category of ['portraits', 'cg', 'voices']) {
      const present = new Set<string>(character[category].map(spec => spec.url));
      character[category].push(...before[category].filter(spec => !present.has(spec.url)));
    }
    character.variants = [...new Set([...character.variants, ...before.variants])];
    old.delete(character.id);
  }
  catalog.characters.push(...old.values()); catalog.characters.sort((a, b) => Number(a.id) - Number(b.id));
  catalog.aliases = { ...previous.aliases, ...catalog.aliases };
  fs.writeFileSync(path.join(root, 'metadata/catalog.json.tmp'), JSON.stringify(catalog));
  fs.renameSync(path.join(root, 'metadata/catalog.json.tmp'), path.join(root, 'metadata/catalog.json'));
  const saved = new Map<any, any>(library.characters.map(character => [character.id, character]));
  const needsIcons = catalog.characters.some(character => !saved.get(character.id)?.icon);
  let icons = { saved: 0, errors: [], failed: 0 };
  if (needsIcons) icons = await downloadUrls(root, catalog.icons, { refresh: true, fetchResource, maxBytes: 80 * 1024 * 1024, validate: bytes => decodeBundle(bytes),
    onProgress: state => onProgress({ phase: 'icons', checked: state.done, targets: state.total }) });
  onProgress({ phase: 'indexing', checked: 0, targets: 1 });
  const index = await extractResources(root, undefined, { scope: 'catalog' });
  return { failed: icons.failed + index.issues.filter(issue => !library.issues?.some(oldIssue => JSON.stringify(oldIssue) === JSON.stringify(issue))).length,
    errors: icons.errors, downloadedIcons: icons.saved, warnings: ids.length && ids.every(id => !catalog.aliases[id]) ? ['指定编号尚未出现在公开角色表中，未添加猜测的角色。'] : [] };
}
export { refreshCatalog };
