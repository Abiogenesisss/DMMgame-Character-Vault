const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const { loadPack, routeKey } = require('../../../app/pack.ts');
const { writeAtomicFileSync } = require('../../../app/atomic-file.ts');
const { readCatalog, readJson, writeJson } = require('./catalog.ts');
const { hash } = require('./format.ts');
const { storyProgram, storyDependencies, atlasFrames } = require('./story.ts');
const { logicalPath } = require('./format.ts');
async function extract(root, onProgress = () => {}, { metadataOnly = false }: any = {}) {
  const catalog = readCatalog(root), output = path.join(root, 'library'), pack = loadPack(path.join(root, 'cache'));
  const exportsFile = path.join(root, 'metadata/exports.json'), saved = readJson(exportsFile, {}), issues = [];
  const intact = item => item && typeof item.file === 'string' && !path.isAbsolute(item.file) && !item.file.split(/[\\/]/).includes('..') && fs.existsSync(path.join(output, item.file));
  if (!metadataOnly) for (const [logical, spec] of Object.entries<any>(catalog.assets)) {
    const record = pack.manifest.routes[routeKey('GET', spec.url)]?.findLast(record => record.status === 200);
    if (!record || intact(saved[logical]) && saved[logical].body === record.body) continue;
    const input = path.join(pack.root, 'bodies', record.body); if (!/^[a-f0-9]{64}$/.test(record.body) || !fs.existsSync(input)) continue;
    try {
      const bytes = fs.readFileSync(input); if (hash(bytes) !== record.body || hash(bytes, 'md5') !== spec.md5) throw new Error('素材校验失败。');
      const extension = path.posix.extname(logical), type = /\.(png|jpe?g)$/.test(logical) ? 'image' : extension === '.mp3' ? 'audio' : extension === '.txt' ? 'script' : extension === '.plist' ? 'atlas' : null;
      if (!type) continue;
      const info: any = { file: (type === 'image' ? 'images/' : type === 'audio' ? 'audio/' : 'sources/') + record.body + extension, body: record.body, resource: logical, type };
      if (type === 'image') { const meta = await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 }).metadata(); if (!meta.width || !meta.height) throw new Error('图片尺寸无效。'); info.width = meta.width; info.height = meta.height; }
      if (type === 'audio' && !(bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224)) throw new Error('语音文件格式无效。');
      if (!fs.existsSync(path.join(output, info.file))) writeAtomicFileSync(path.join(output, info.file), bytes); saved[logical] = info;
    } catch (error) { issues.push({ resource: logical, error: error.message }); }
  }
  async function poseFile(key, atlas, pose) {
    const image = saved[atlas + '.png'], plist = saved[atlas + '.plist']; if (!intact(image) || !intact(plist)) return null;
    const digest = hash('geometry-v2:' + image.body + ':' + plist.body + ':' + pose), file = 'poses/' + digest + '.png';
    if (!fs.existsSync(path.join(output, file))) {
      if (metadataOnly) return null;
      const frames = atlasFrames(fs.readFileSync(path.join(output, plist.file), 'utf8')), layers = []; let width, height;
      const input = fs.readFileSync(path.join(output, image.file));
      if (!frames[pose.split(':')[0] + '.png']) throw new Error('立绘图集缺少基础图层。');
      for (const part of pose.split(':')) {
        // The official addImageSpriteAtlas requires the first/base frame and
        // skips absent overlays. Some NPC atlases contain only body.png even
        // though the script requests body:000.
        const frame = frames[part + '.png']; if (!frame) continue;
        const [x, y, w, h] = frame.rect; if (x + w > image.width || y + h > image.height) throw new Error('立绘裁切区域越界。');
        [width, height] = frame.size;
        const polygons = [];
        for (let i = 0; i < frame.triangles.length; i += 3) polygons.push('M' + frame.triangles.slice(i, i + 3).map(index => [frame.uv[index * 2] - x, frame.uv[index * 2 + 1] - y].join(',')).join('L') + 'Z');
        // One combined path prevents antialiasing each shared triangle edge
        // independently, which would introduce translucent seams in the body.
        const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><path fill="white" fill-rule="nonzero" d="' + polygons.join(' ') + '"/></svg>');
        let cropped = sharp(input).extract({ left: x, top: y, width: w, height: h }).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]);
        if (frame.rotated) cropped = sharp(await cropped.png().toBuffer()).rotate(270);
        const xs = frame.vertices.filter((_, i) => i % 2 === 0), ys = frame.vertices.filter((_, i) => i % 2 === 1), left = Math.min(...xs), top = Math.min(...ys);
        const targetWidth = Math.max(...xs) - left, targetHeight = Math.max(...ys) - top;
        if (![left, top, targetWidth, targetHeight].every(Number.isInteger) || left < 0 || top < 0 || left + targetWidth > width || top + targetHeight > height || targetWidth < 1 || targetHeight < 1) throw new Error('立绘还原区域无效。');
        layers.push({ input: await cropped.resize(targetWidth, targetHeight, { fit: 'fill' }).png().toBuffer(), left, top });
      }
      writeAtomicFileSync(path.join(output, file), await sharp({ create: { width, height, channels: 4, background: '#00000000' } }).composite(layers).png().toBuffer());
    }
    const metadata = await sharp(path.join(output, file), { limitInputPixels: 16 * 1024 * 1024 }).metadata();
    return { file, resource: key, type: 'image', width: metadata.width, height: metadata.height };
  }
  const index: any = { version: 1, game: 'minashigo-x', characters: [], images: [], audio: [], skeletons: [], stories: [], issues, storyUi: require('./story-ui.ts').readStoryUi(root) };
  const imageIds = new Set(), audioIds = new Set();
  const media = logical => intact(saved[logical]) ? saved[logical] : null;
  function image(logical, character, category) {
    const item = media(logical); if (item?.type !== 'image') return null;
    const value = { ...item, id: hash(character + ':' + category + ':' + logical), character, category };
    if (!imageIds.has(value.id)) { imageIds.add(value.id); index.images.push(value); } return value;
  }
  function audio(logical, character, context, label = '', group = 'story', groupLabel = '剧情配音') {
    const item = media(logical); if (item?.type !== 'audio') return null;
    const value = { ...item, id: hash(character + ':' + context + ':' + logical), character, context, label, group, groupLabel };
    if (!audioIds.has(value.id)) { audioIds.add(value.id); index.audio.push(value); } return value;
  }
  for (const role of catalog.characters) {
    const portraits = role.portraits.map((logical, i) => { const value = image(logical, role.id, 'portrait'); return value && { ...value, phase: String(i), label: '立绘 ' + (i + 1) }; }).filter(Boolean);
    const cg = role.cg.map((logical, i) => { const value = image(logical, role.id, 'cg'); return value && { ...value, label: 'CG ' + (i + 1) }; }).filter(Boolean);
    for (const voice of role.voices) audio(voice.path, role.id, 'character', voice.label, voice.group, voice.groupLabel);
    const stories = [];
    for (const spec of role.stories) {
      if (!/^\d{5,10}$/.test(spec.id) || spec.character !== role.id) { issues.push({ character: role.id, error: '剧情编号或归属无效。' }); continue; }
      const primary = media(spec.audio || spec.script); if (!primary) continue;
      try {
        const audioStory = spec.kind === 'audio';
        if (audioStory && primary.type !== 'audio') throw new Error('日记语音格式无效。');
        const text = audioStory ? null : fs.readFileSync(path.join(output, primary.file), 'utf8');
        const program = audioStory ? null : storyProgram(text), resources = {}, missing = new Set<string>();
        const expected = new Set<string>([...spec.resources, ...(spec.missingResources || []), ...(text ? storyDependencies(text).map(logicalPath) : [])]);
        for (const logical of expected) {
          const item = media(logical); if (!item) { missing.add(logical); continue; }
          resources[logical] = item.file;
          if (item.type === 'image') image(logical, role.id, 'story');
          if (item.type === 'audio') audio(logical, role.id, /\/bgm\//.test(logical) ? 'music' : 'story');
        }
        for (const pose of program?.poses || []) {
          const item = await poseFile(pose.key, pose.atlas, pose.pose);
          if (item) { resources[pose.key] = item.file; const id = hash(role.id + ':pose:' + pose.key); if (!imageIds.has(id)) { imageIds.add(id); index.images.push({ ...item, id, character: role.id, category: 'story' }); } }
          else missing.add(pose.key);
        }
        const dialogue = program?.lines.length || 0;
        const adult = role.storySources?.find(source => source.id === spec.id)?.type === 2 || spec.adult === true;
        // Missing optional audio can be silent; missing pictures/poses must still
        // block playback. A diary's primary audio was required above.
        const playable = [...missing].every(name => /^adv\/sound\/.+\.mp3$/.test(name));
        const story = { ...spec, adult, ...(program ? { lines: program.lines, directives: program.directives } : {}), resources, missingResources: [...missing], format: 'minashigo', dialogue };
        const file = 'stories/' + spec.id + '.json'; if (!metadataOnly || !fs.existsSync(path.join(output, file))) writeJson(path.join(output, file), story);
        index.stories.push({ id: spec.id, character: role.id, title: spec.title, adult, ...(audioStory ? { kind: 'audio' } : { script: primary.file, scriptFormat: 'csv' }), file,
          complete: missing.size === 0, playable, missingAssets: missing.size, dialogue }); stories.push(spec.id);
      } catch (error) { issues.push({ character: role.id, resource: spec.audio || spec.script, error: error.message }); }
    }
    const icon = image(role.icon, role.id, 'icon');
    const voiceSaved = index.audio.filter(item => item.character === role.id && item.context === 'character').length;
    index.characters.push({ id: role.id, name: role.name, shortName: role.shortName, kind: role.kind, rarityId: role.rarityId, rarityLabel: role.rarityLabel,
      icon: icon?.file || null, portraits, cg, stories, portraitTotal: role.portraits.length,
      storyChapters: (role.storySources || []).map(source => ({ id: source.id, title: source.title, ...(source.audio ? { kind: 'audio' } : {}) })),
      cgAvailable: role.cg.length > 0 || !!role.storySources?.some(source => source.type === 2), storyAvailable: role.stories.length > 0 || !!role.storySources?.length, voiceAvailable: role.voices.length > 0,
      voiceSaved, collected: !!(portraits.length || cg.length || stories.length || voiceSaved) });
  }
  index.stats = { characters: index.characters.length, icons: index.characters.filter(role => role.icon).length, collected: index.characters.filter(role => role.collected).length,
    portraits: index.characters.reduce((n, role) => n + role.portraits.length, 0), cg: index.characters.reduce((n, role) => n + role.cg.length, 0), audio: index.audio.length,
    characterVoices: index.audio.filter(item => item.context === 'character').length, stories: index.stories.length, dynamicCg: 0, issues: issues.length };
  index.generated = new Date().toISOString(); if (!metadataOnly) writeJson(exportsFile, saved); writeJson(path.join(output, 'index.json'), index); return index;
}
export { extract };
