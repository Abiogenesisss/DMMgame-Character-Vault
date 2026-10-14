import { renameFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { downloadUrls } = require('../../../app/download.ts');
const { loadPack, routeKey } = require('../../../app/pack.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { ensureCatalog } = require('./catalog.ts');
const { baseId, portraitDownloadSpecs, decode, sniffImage } = require('./format.ts');
const { selectRoles } = require('./selection.ts');
const { migrateCharacterForms } = require('./character-forms.ts');

// Fill missing human portraits and discover bloom art.
// CG, scenario scripts, Spine files and voices are not re-read or re-extracted.
async function collectPortraits(root, { roles, retryMissing = false, fetchResource = fetchPublicResource, onProgress }: any = {}) {
  if (!Array.isArray(roles) || !roles.length || roles.some(id => typeof id !== 'string' || !/^1\d{5}$/.test(id))) throw new Error('请指定角色：npm run collect:flower:portraits -- --roles 100001');
  const catalog = ensureCatalog(root);
  roles = [...new Set(roles.map(id => baseId(id, catalog)))];
  if (roles.some(id => !catalog.characters.some(character => character.id === id))) throw new Error('角色未被索引。');
  const file = path.join(root, 'library/index.json');
  if (!fs.existsSync(file)) throw new Error('请先生成角色资源库。');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cached = loadPack(path.join(root, 'cache'));
  const images = new Map<any, any>((index.images || []).map(image => [image.id, image.file]));
  let relink = false;
  const absenceFile = path.join(root, 'state/flower-unavailable.json');
  const unavailable = fs.existsSync(absenceFile) ? JSON.parse(fs.readFileSync(absenceFile, 'utf8')) : {};
  const missing = [...new Map<any, any>(catalog.characters.filter(character => roles.includes(character.id)).flatMap(character => {
    const previous = index.characters.find(item => item.id === character.id);
    const saved = previous?.portraits || [];
    const specs = portraitDownloadSpecs(character);
    return specs.filter(spec => {
      if (saved.some(item => item.character === spec.character && item.file && fs.existsSync(path.join(root, 'library', item.file)))) return false;
      const record = cached.manifest.routes[routeKey('GET', spec.url)]?.findLast(item => item.status === 200);
      const exported = images.get(record?.body);
      if (exported && fs.existsSync(path.join(root, 'library', exported))) { relink = true; return false; }
      return true;
    });
  }).map(spec => [spec.url, spec])).values()];
  const targets = missing.filter(spec => !spec.candidate || retryMissing || !unavailable[spec.url]);
  const byUrl = new Map<any, any>(targets.map(spec => [spec.url, spec])), absent = new Set<string>();
  const state = targets.length ? await downloadUrls(root, targets, {
    fetchResource: async (url, options) => {
      const response = await fetchResource(url, options);
      if (byUrl.get(url).candidate && [403, 404].includes(response.status)) {
        absent.add(url); unavailable[url] = { status: response.status, checked: new Date().toISOString() };
      }
      return response;
    },
    maxBytes: 32 * 1024 * 1024,
    onProgress,
    validate: bytes => { if (!sniffImage(decode(bytes))) throw new Error('立绘不是有效的图片。'); }
  })
    : { state: 'ready', saved: 0, skipped: 0, failed: 0, errors: [] };
  // Missing optional bloom families are expected; retain actual errors.
  const errors = state.errors.filter(item => !absent.has(item.url));
  const failed = new Set<string>(errors.map(item => item.url));
  let exported = 0;
  const pack = loadPack(path.join(root, 'cache'));
  const updatedCatalog = ensureCatalog(root);
  for (const spec of targets) {
    if (absent.has(spec.url) || failed.has(spec.url)) continue;
    const record = pack.manifest.routes[routeKey('GET', spec.url)]?.findLast(item => item.status === 200);
    if (!record) throw new Error('立绘未成功保存。');
    // Losslessly unpack this portrait and check its format header; no image
    // preview, pixel analysis or story-body parsing is performed.
    const bytes = decode(fs.readFileSync(path.join(pack.root, 'bodies', record.body)));
    const extension = sniffImage(bytes);
    if (!extension) throw new Error('立绘不是有效的图片。');
    const target = path.join(root, 'library/images', record.body + '.' + extension);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) { fs.writeFileSync(target + '.tmp', bytes); renameFileSync(target + '.tmp', target); }
    delete unavailable[spec.url]; exported++;
  }
  if (targets.length) {
    fs.mkdirSync(path.dirname(absenceFile), { recursive: true });
    fs.writeFileSync(absenceFile + '.tmp', JSON.stringify(unavailable)); renameFileSync(absenceFile + '.tmp', absenceFile);
  }
  if (exported || relink) {
    selectRoles(root, roles, catalog, 'portraits');
    migrateCharacterForms(root, { catalog: updatedCatalog });
  }
  if (errors.length) throw new Error(errors.map(item => item.error).join('；'));
  return { state: 'ready', roles, targets: targets.length, saved: state.saved, reused: state.skipped,
    unavailable: missing.length - targets.length + absent.size, failed: 0 };
}

if (require.main === module) {
  const option = process.argv.indexOf('--roles');
  const roles = option < 0 ? undefined : process.argv[option + 1]?.split(',');
  const root = require('./paths.ts').root;
  require('../../../app/projects.ts').withPackLock(root, () => collectPortraits(root, { roles, retryMissing: process.argv.includes('--retry-missing') }))
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
export { collectPortraits };
