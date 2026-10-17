import { renameFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { ensureCharacterMetadata } = require('./character-metadata.ts');
const { buildCatalog } = require('./catalog.ts');
const { BASE, md5, decode, sniffImage } = require('./format.ts');
const { downloadUrls } = require('../../../app/download.ts');
const { loadPack, routeKey } = require('../../../app/pack.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { migrateCharacterForms } = require('./character-forms.ts');
const { isMaterialId } = require('./character-types.ts');
const { ensureDynamicCgMetadata } = require('./dynamic-cg.ts');
const iconSpec = id => ({ character: id, url: BASE + 'assets/ultra/images/character/dmm/i/' + md5('icon_l_' + id) + '.bin' });
async function refreshCatalog(root, { refresh = false, ids = [], fetchResource = fetchPublicResource, onProgress, allowCachedMetadata = false }: any = {}) {
  const warnings = [];
  try { await ensureCharacterMetadata(root, { refresh, fetchResource }); }
  catch (error) { if (!allowCachedMetadata) throw error; warnings.push('角色资料更新失败，已按现有目录和指定编号继续检查：' + error.message); }
  try { await ensureDynamicCgMetadata(root, { refresh, fetchResource }); }
  catch (error) { warnings.push('动态 CG 标记更新失败，已保留现有标记：' + error.message); }
  const catalog = buildCatalog(root);
  const candidates = ids.length ? [...new Set<string>(ids.map(id => catalog.aliases?.[id] || id))].filter(id => !isMaterialId(id)) : catalog.characters.filter(character => !character.iconBody).map(character => character.id);
  const targets = candidates.filter(id => !catalog.characters.find(character => character.id === id)?.iconBody).map(iconSpec);
  const absent = new Set<string>();
  const result = targets.length ? await downloadUrls(root, targets, { maxBytes: 4 * 1024 * 1024, onProgress: state => onProgress?.({ phase: 'icons', checked: state.done, targets: state.total }),
    fetchResource: async (url, options) => { const response = await fetchResource(url, options); if ([403, 404].includes(response.status)) absent.add(url); return response; },
    validate: bytes => { if (!sniffImage(decode(bytes))) throw new Error('角色头像不是有效的图片。'); }
  }) : { saved: 0, skipped: 0, errors: [] };
  const pack = loadPack(path.join(root, 'cache')), additionalImages = [], directory = path.join(root, 'library/images');
  fs.mkdirSync(directory, { recursive: true });
  for (const spec of targets) {
    const record = pack.manifest.routes[routeKey('GET', spec.url)]?.findLast(item => item.status === 200); if (!record || absent.has(spec.url)) continue;
    const bytes = decode(fs.readFileSync(path.join(pack.root, 'bodies', record.body))), extension = sniffImage(bytes);
    if (!extension) continue;
    const file = 'images/' + record.body + '.' + extension, target = path.join(root, 'library', file);
    if (!fs.existsSync(target)) { fs.writeFileSync(target + '.tmp', bytes); renameFileSync(target + '.tmp', target); }
    additionalImages.push({ id: record.body, name: new URL(spec.url).pathname.split('/').at(-1), file, category: 'icon', bytes: bytes.length });
  }
  const updated = targets.length ? buildCatalog(root) : catalog;
  const file = path.join(root, 'library/index.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ characters: [], images: [], audio: [], stories: [], skeletons: [], issues: [], stats: {} }));
  const stats = migrateCharacterForms(root, { catalog: updated, additionalImages });
  const errors = result.errors.filter(item => !absent.has(item.url));
  return { state: errors.length ? 'partial' : 'ready', ...stats, warnings, downloadedIcons: result.saved, unavailableIcons: absent.size,
    missingIcons: updated.characters.filter(character => !character.iconBody).length, failed: errors.length, errors };
}
if (require.main === module) {
  const root = require('./paths.ts').root;
  require('../../../app/projects.ts').withPackLock(root, () => refreshCatalog(root, { refresh: process.argv.includes('--refresh'),
    onProgress: state => { if (state.done % 20 === 0 || state.done === state.total) console.log(JSON.stringify({ icons: state.done, total: state.total })); } }))
    .then(result => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
export { iconSpec, refreshCatalog };
