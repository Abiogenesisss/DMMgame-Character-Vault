import { renameFileSync, writeAtomicFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadPack, saveManifest, routeKey, sha256 } = require('../../../app/pack.ts');
const { withPackLock } = require('../../../app/projects.ts');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { BASE, baseId, parseStory, decode, sniffImage, isMp3, portraitDownloadSpecs } = require('./format.ts');
const { ensureCatalog } = require('./catalog.ts');
const { extract } = require('./extract.ts');
const { selectRoles } = require('./selection.ts');
const { ensureVoiceMapping, roleVoiceSpecs, syncCachedVoices } = require('./character-voices.ts');
const { COLLECTION_SCOPES, collectionScope, wantsDependency } = require('./collection-scope.ts');
const { ensureStoryUi, publishStoryUi } = require('./story-ui.ts');

async function collect(root, { roles, concurrency = 4, retryMissing = false, scope, voicesOnly, fetchResource = fetchPublicResource, prepareUi = ensureStoryUi }: any = {}) {
  scope = collectionScope({ scope, voicesOnly }); voicesOnly = scope === 'voices';
  if (!Array.isArray(roles) || !roles.length || roles.some(id => typeof id !== 'string' || !/^1\d{5}$/.test(id))) {
    throw new Error('请指定要获取的角色：npm run collect:flower -- --roles 162403');
  }
  const catalog = ensureCatalog(root);
  roles = roles.map(id => baseId(id, catalog));
  if (roles.some(id => !catalog.characters.some(character => character.id === id))) throw new Error('角色未被索引。');
  if (['all', 'stories', 'ui'].includes(scope)) {
    const file = path.join(root, 'state/flower-status.json');
    const state = { state: 'running', roles, scope, voicesOnly: false, phase: 'ui', pid: process.pid, started: new Date().toISOString(), targets: 0, checked: 0, failed: 0 };
    const save = () => writeAtomicFileSync(file, JSON.stringify(state));
    try {
      save(); const ui = await prepareUi(root, { fetchResource, onProgress: progress => { Object.assign(state, progress); save(); } });
      publishStoryUi(root, ui);
      if (scope === 'ui') { Object.assign(state, { state: 'ready', phase: 'finished', finished: new Date().toISOString() }); save(); return state; }
    } catch (error) { Object.assign(state, { state: 'failed', error: error.message, finished: new Date().toISOString() }); save(); throw error; }
  }
  const pack = loadPack(path.join(root, 'cache'));
  roles = [...new Set<string>(roles)];
  const voiceMapping = ['all', 'voices'].includes(scope) ? ensureVoiceMapping(root, { manifest: pack.manifest }) : null;
  const voiceTargets = voiceMapping ? roleVoiceSpecs(catalog, roles, voiceMapping) : [];
  if (voicesOnly && !voiceTargets.length) throw new Error('角色语音映射尚未生成，请先导入包含游戏脚本的 HAR。');
  if (voicesOnly && !fs.existsSync(path.join(root, 'library/index.json'))) throw new Error('请先生成角色资源库，再获取角色语音。');
  if (scope !== 'all' && !fs.existsSync(path.join(root, 'library/index.json'))) throw new Error('请先生成角色资源库。');
  const targets = ['all', 'stories', 'cg', 'motions'].includes(scope) ? catalog.stories.filter(item => roles.includes(baseId(item.character, catalog))) : [];
  const portraits = ['all', 'portraits'].includes(scope) ? [...new Map<any, any>(catalog.characters.filter(character => roles.includes(character.id))
    .flatMap(portraitDownloadSpecs).map(spec => [spec.url, spec])).values()] : [];
  const directory = path.join(root, 'state'); fs.mkdirSync(directory, { recursive: true });
  const journal = path.join(directory, 'flower-downloads.jsonl');
  const absenceFile = path.join(directory, 'flower-unavailable.json');
  const unavailable = fs.existsSync(absenceFile) ? JSON.parse(fs.readFileSync(absenceFile, 'utf8')) : {};
  if (fs.existsSync(journal)) for (const line of fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean)) {
    const record = JSON.parse(line);
    if (record.url.startsWith(BASE) && /^[a-f0-9]{64}$/.test(record.body) && fs.existsSync(path.join(pack.root, 'bodies', record.body))) pack.manifest.routes[routeKey('GET', record.url)] = [record];
  }
  const stateFile = path.join(directory, 'flower-status.json');
  const state: { state: string; phase: any; scope: any; voicesOnly: any; pid: number; started: string; roles: any; characters: any; targets: any; checked: number; stories: number; unavailable: number; saved: number; skipped: number; bytes: number; mediaTargets: number; mediaChecked: number; portraitTargets: number; portraitChecked: number; voiceTargets: any; voiceChecked: number; failed: number; errors: any[]; stats?: Record<string, number>; finished?: string; error?: string; } = { state: 'running', phase: COLLECTION_SCOPES[scope].phase, scope, voicesOnly, pid: process.pid, started: new Date().toISOString(),
    roles, characters: roles.length, targets: targets.length, checked: 0, stories: 0,
    unavailable: 0, saved: 0, skipped: 0, bytes: 0, mediaTargets: 0, mediaChecked: 0,
    portraitTargets: portraits.length, portraitChecked: 0, voiceTargets: voiceTargets.length, voiceChecked: 0, failed: 0, errors: [] };
  let stopping = false, sinceFlush = 0;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const checkpoint = () => {
    writeAtomicFileSync(stateFile, JSON.stringify(state));
    writeAtomicFileSync(absenceFile, JSON.stringify(unavailable));
  };
  const flush = () => { saveManifest(pack.root, pack.manifest); sinceFlush = 0; checkpoint(); };
  const interval = setInterval(() => { checkpoint(); console.log(JSON.stringify({ phase: state.phase, checked: state.checked, targets: state.targets, stories: state.stories,
    mediaChecked: state.mediaChecked, mediaTargets: state.mediaTargets, saved: state.saved, MiB: Math.round(state.bytes / 1048576), failed: state.failed })); }, 10000);
  async function obtain(item, validate) {
    const key = routeKey('GET', item.url);
    const previous = pack.manifest.routes[key]?.at(-1);
    if (previous?.status === 200 && /^[a-f0-9]{64}$/.test(previous.body)) {
      const file = path.join(pack.root, 'bodies', previous.body);
      if (fs.existsSync(file)) {
        const body = fs.readFileSync(file);
        if (body.length === previous.size && sha256(body) === previous.body) {
          let usable = true; try { validate(body); } catch { usable = false; }
          if (usable) { state.skipped++; return body; }
        }
      }
    }
    if (!retryMissing && unavailable[item.url]) { state.unavailable++; return null; }
    if (!item.url.startsWith(BASE + 'assets/')) throw new Error('Unexpected Flower Knight download host');
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetchResource(item.url, { signal: AbortSignal.timeout(30000) });
        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
        await response.body?.cancel();
      } catch (error) { if (attempt === 2) throw error; }
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if ([403, 404].includes(response.status)) {
      await response.body?.cancel(); unavailable[item.url] = { status: response.status, checked: new Date().toISOString() }; state.unavailable++; return null;
    }
    if (response.status !== 200) { await response.body?.cancel(); throw new Error('HTTP ' + response.status); }
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length; if (length > 32 * 1024 * 1024) throw new Error('Unexpected resource size'); chunks.push(chunk);
    }
    const body = Buffer.concat(chunks); validate(body);
    const digest = sha256(body), target = path.join(pack.root, 'bodies', digest);
    if (!fs.existsSync(target)) { fs.writeFileSync(target + '.tmp', body); renameFileSync(target + '.tmp', target); }
    const mimeType = response.headers.get('content-type') || 'application/octet-stream';
    const record = { url: item.url, method: 'GET', status: 200, body: digest, size: body.length,
      headers: [['content-type', mimeType]], mimeType, resourceType: 'fetch', range: '',
      requestBodyHash: sha256(Buffer.alloc(0)), source: 'flower-collection' };
    pack.manifest.routes[key] = [record]; fs.appendFileSync(journal, JSON.stringify(record) + '\n');
    delete unavailable[item.url]; state.saved++; state.bytes += body.length;
    if (++sinceFlush >= 40) flush();
    return body;
  }
  async function runQueue(queue, task) {
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (!stopping && cursor < queue.length) {
        const item = queue[cursor++];
        try { await task(item); }
        catch (error) { state.failed++; if (state.errors.length < 60) state.errors.push({ url: item.url, error: error.message || error.code || 'Download failed' }); }
      }
    }));
  }
  try {
    checkpoint(); const media = new Map();
    if (targets.length) {
      await runQueue(targets, async spec => {
        try {
          // Missing scenarios may be cached to discover addresses. Scoped
          // extraction keeps these indexing-only scenarios out of the reader.
          const body = await obtain(spec, value => parseStory(value, spec));
          if (body) { const story = parseStory(body, spec); state.stories++;
            story.dependencies.filter(item => wantsDependency(scope, item)).forEach(item => media.set(item.url, item));
            if (story.issues.length) { state.failed += story.issues.length; state.errors.push(...story.issues.slice(0, 10)); }
          }
        } finally { state.checked++; }
      });
      if (['cg', 'motions'].includes(scope) && !state.stories && state.failed) throw new Error(state.errors[0].error);
      flush(); state.phase = scope === 'motions' ? 'motions' : 'cg'; state.mediaTargets = media.size; checkpoint();
      await runQueue([...media.values()], async item => {
        try { await obtain(item, body => {
          const content = decode(body);
          if (['image', 'texture'].includes(item.type) && !sniffImage(content)) throw new Error('Resource is not an image');
          if (item.type === 'skeleton' && !JSON.parse(content.toString('utf8')).skeleton) throw new Error('Resource is not a Spine skeleton');
          if (item.type === 'atlas' && !content.toString('utf8').includes('size:')) throw new Error('Resource is not a Spine atlas');
          if (item.type === 'voice' && !isMp3(content)) throw new Error('Resource is not an MP3 voice');
        }); } finally { state.mediaChecked++; }
      });
    }
    if (portraits.length) {
      flush(); state.phase = 'portraits'; checkpoint();
      if (!stopping) await runQueue(portraits, async spec => {
        try { await obtain(spec, body => { if (!sniffImage(decode(body))) throw new Error('Resource is not a portrait'); }); }
        finally { state.portraitChecked++; }
      });
    }
    if (voiceTargets.length) {
      flush(); state.phase = 'voices'; checkpoint();
      if (!stopping) await runQueue(voiceTargets, async spec => {
        try { await obtain(spec, body => { if (!isMp3(body)) throw new Error('角色语音不是有效的 MP3 资源。'); }); }
        finally { state.voiceChecked++; }
      });
    }
    flush(); state.phase = 'extracting'; checkpoint();
    selectRoles(root, roles, catalog, scope);
    const result = voicesOnly ? syncCachedVoices(root, { mapping: ensureVoiceMapping(root, { manifest: pack.manifest }) }) : extract(root, undefined, { scope, roles });
    state.stats = result.stats;
    state.state = stopping ? 'interrupted' : state.failed ? 'partial' : 'ready'; state.phase = 'finished'; state.finished = new Date().toISOString();
    checkpoint(); console.log(JSON.stringify(state));
    return state;
  } catch (error) { state.state = 'failed'; state.error = error.message; checkpoint(); throw error; }
  finally { clearInterval(interval); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (require.main === module) {
  const index = process.argv.indexOf('--roles');
  const roles = index >= 0 ? process.argv[index + 1]?.split(',') : undefined;
  const scopeIndex = process.argv.indexOf('--scope');
  const scope = scopeIndex < 0 ? undefined : process.argv[scopeIndex + 1] || '';
  const root = require('./paths.ts').root;
  withPackLock(root, () => collect(root, { roles, scope, retryMissing: process.argv.includes('--retry-missing'), voicesOnly: process.argv.includes('--voices-only') }))
    .then(result => { if (result.failed) process.exitCode = 1; })
    .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
export { collect };
