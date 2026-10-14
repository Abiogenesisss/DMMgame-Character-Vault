'use strict';
const fs = require('node:fs'), path = require('node:path');
const { fetchPublicResource } = require('../../../app/public-fetch.ts');
const { readJson } = require('./catalog.ts');
const { API, sourceFile, validateSource, cachedStories } = require('./stories.ts');
const { runPython } = require('./python.ts');
async function storySession(root) {
  const source = readJson(path.join(root, 'metadata/source.json'), {});
  if (!fs.existsSync(path.join(__dirname, '../dev/capture_story.py'))) return {};
  if (!source.captureFile || !fs.existsSync(source.captureFile)) return {};
  // The token is used only in memory for these same-origin, read-only requests.
  const session = await runPython('../dev/capture_story.py', [source.captureFile, root, 'session']);
  return session.headers || {};
}
async function downloadStories(root, catalog, roles, { fetchResource = fetchPublicResource, headers, refresh = false, onProgress = () => {} }: any = {}) {
  const sources = catalog.characters.filter(character => roles.includes(character.id)).flatMap(character => (character.stories || []).flatMap(spec => spec.sources.map(source => ({ ...source, scene: spec.scene, character: character.id }))));
  const state = { saved: 0, skipped: 0, checked: 0, targets: sources.length, errors: [] };
  let session = headers;
  for (const source of sources) {
    const file = sourceFile(root, source.scene, source.kind);
    try {
      if (!refresh && fs.existsSync(file)) { validateSource(readJson(file, null), source.scene, source.kind); state.skipped++; }
      else {
        const url = new URL(source.url);
        if (url.origin !== API || !/^\/api\/(MScenes|MAdults\/MonsterMAdults)\/\d{4,8}$/.test(url.pathname) || url.search) throw new Error('剧情接口地址无效。');
        session ||= await storySession(root);
        const response = await fetchResource(url.href, { headers: session, signal: AbortSignal.timeout(20000) });
        if (response.status !== 200) { await response.body?.cancel(); throw new Error(response.status === 401 ? '此剧情需要有效的账号授权，当前会话不可用。' : '该剧情当前无法读取（HTTP ' + response.status + '），已保存的 CG 可继续鉴赏。'); }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('剧情脚本超出大小限制。'); chunks.push(chunk); }
        const data = validateSource(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), source.scene, source.kind);
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); state.saved++;
      }
    } catch (error) { state.errors.push({ character: source.character, scene: source.scene, error: error.message }); }
    state.checked++; onProgress(state);
  }
  return { ...state, stories: cachedStories(root, catalog, roles) };
}
export { storySession, downloadStories };
