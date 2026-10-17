const fs = require('node:fs'), path = require('node:path');
const { writeAtomicFileSync } = require('../../../app/atomic-file.ts');
const { downloadUrls } = require('../../../app/download.ts');
const { loadPack, routeKey } = require('../../../app/pack.ts');
const { readCatalog, readJson, writeJson, applyStoryResources, STORY_SOURCE_VERSION } = require('./catalog.ts');
const { ORIGIN, hash, logicalPath, resourceKind } = require('./format.ts');
const { storyDependencies, storyProgram } = require('./story.ts');
const { storySession } = require('./guest-session.ts');
async function discoverStories(root, { roles, scope, fetchResource, onProgress = () => {}, createSession = storySession }: any) {
  let catalog = readCatalog(root);
  const sceneFile = path.join(root, 'metadata/story-resources.json'), cachedScenes = readJson(sceneFile, []);
  const selected = () => catalog.characters.filter(role => !roles || roles.includes(role.id));
  if (catalog.storySourceVersion !== STORY_SOURCE_VERSION || selected().some(role => !Array.isArray(role.storySources))) {
    await require('./refresh-catalog.ts').refreshCatalog(root, { fetchResource }); catalog = readCatalog(root);
  }
  const pending = () => selected().flatMap(role => role.storySources.filter(source => scope !== 'cg' || source.type === 2)
    .filter(source => !role.stories.some(story => story.id === source.id && story.script === source.script && story.audio === source.audio && story.version === catalog.resourceVersion && !story.missingResources?.length))
    .filter(source => scope !== 'cg' || !cachedScenes.some(scene => String(scene.storyId) === source.id && scene.version === catalog.resourceVersion && !scene.missingResources?.length && scene.resources.some(row => logicalPath(row.path) === source.script)))
    .map(source => ({ character: role.id, source })));
  if (!pending().length) return { catalog, errors: [] };
  onProgress({ phase: 'guest-session', targets: pending().length, checked: 0 });
  const session = await createSession(root, fetchResource);
  if (session.version !== catalog.resourceVersion) {
    await require('./refresh-catalog.ts').refreshCatalog(root, { fetchResource }); catalog = readCatalog(root);
    if (session.version !== catalog.resourceVersion) throw new Error('剧情资源与角色清单版本不一致，请稍后重试。');
  }
  const requested = pending(), errors = [], scenes = [], memo = new Map<string, Promise<any>>(); let checked = 0;
  const lookup = name => {
    const key = logicalPath(name), known = catalog.assets[key];
    if (!memo.has(key)) memo.set(key, known?.logical === key && resourceKind(known.url) === 'asset' && known.url.startsWith(ORIGIN + '/' + session.version + '/')
      ? Promise.resolve(known) : session.getResource(name).catch(error => { throw new Error(key + '：' + error.message); }));
    return memo.get(key);
  };
  for (const { character, source } of requested) {
    try {
      onProgress({ phase: 'story-mapping', checked: 0, targets: 1, story: source.id });
      if (source.audio) {
        const audio = await lookup(source.audio);
        scenes.push({ storyId: Number(source.id), version: session.version, completeMap: true, resources: [{ path: audio.path, md5: audio.md5 }] });
        continue;
      }
      const script = await lookup(source.script);
      const result = await downloadUrls(root, [{ url: script.url }], { fetchResource, timeoutMs: 60000, maxBytes: 4 * 1024 * 1024,
        validate: bytes => { if (hash(bytes, 'md5') !== script.md5) throw new Error('剧情脚本校验值不符。'); } });
      if (result.failed) throw new Error('剧情脚本下载失败，请重试。');
      const pack = loadPack(path.join(root, 'cache')), record = pack.manifest.routes[routeKey('GET', script.url)]?.at(-1);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(path.join(pack.root, 'bodies', record.body)));
      storyProgram(text); // Do not publish a map for an unreadable/incomplete CSV.
      const dependencies = storyDependencies(text).filter(name => logicalPath(name) !== source.script)
        .filter(name => scope !== 'cg' || new RegExp('^adv/image/(?:character|summon)/' + character + '/image/[^/]+\\.(png|jpe?g)$').test(logicalPath(name))), resources = [script];
      onProgress({ phase: 'story-mapping', checked: 1, targets: dependencies.length + 1, story: source.id });
      // The official RESTClient serializes calls for one identity. Overlapping
      // resource lookups can return 500; only anonymous CDN downloads run in parallel.
      const missingResources = []; let mapped = 1;
      for (const dependency of dependencies) {
        try { resources.push(await lookup(dependency)); }
        catch (error) {
          missingResources.push(logicalPath(dependency)); errors.push({ character, story: source.id, error: error.message });
        }
        onProgress({ phase: 'story-mapping', checked: ++mapped, targets: dependencies.length + 1, story: source.id });
      }
      // Keep the script and successful mappings if a dependency is unavailable.
      // The extractor records what is missing; a later refresh retries only that
      // mapping while all successfully resolved assets stay in the shared cache.
      scenes.push({ storyId: Number(source.id), version: session.version, completeMap: scope !== 'cg',
        ...(missingResources.length ? { missingResources } : {}), resources: resources.map(spec => ({ path: spec.path, md5: spec.md5 })) });
    } catch (error) { errors.push({ character, story: source.id, error: error.message }); }
    finally { checked++; onProgress({ phase: 'story-mapping', checked, targets: requested.length }); }
  }
  if (scenes.length) {
    const catalogFile = path.join(root, 'metadata/catalog.json');
    const originals = [sceneFile, catalogFile].map(file => fs.existsSync(file) ? fs.readFileSync(file) : null);
    const merged = [...new Map([...readJson(sceneFile, []), ...scenes].map(scene => [scene.storyId, scene])).values()];
    applyStoryResources(catalog, scenes);
    try { writeJson(sceneFile, merged); writeJson(catalogFile, catalog); }
    catch (error) { [sceneFile, catalogFile].forEach((file, i) => { if (originals[i]) writeAtomicFileSync(file, originals[i]); else if (fs.existsSync(file)) fs.unlinkSync(file); }); throw error; }
  }
  return { catalog, errors };
}
export { discoverStories };
