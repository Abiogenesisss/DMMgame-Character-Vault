'use strict';
const fs = require('node:fs'), path = require('node:path');
const { BASE, validId } = require('./format.ts');
const { readJson } = require('./catalog.ts');
const API = 'https://otogi-rest.otogi-frontier.com';
function storySources(scene, adult = true) {
  if (!validId(scene)) throw new Error('剧情编号无效。');
  return [{ kind: 'scene', url: API + '/api/MScenes/' + scene }, ...(adult ? [{ kind: 'adult', url: API + '/api/MAdults/MonsterMAdults/' + scene }] : [])];
}
function sourceFile(root, scene, kind) { if (!validId(scene) || !['scene', 'adult'].includes(kind)) throw new Error('剧情缓存路径无效。'); return path.join(root, 'metadata/story-source', kind + '-' + scene + '.json'); }
function validateSource(data, scene, kind) {
  if (kind === 'adult') {
    if (String(data?.Id) !== scene || !Array.isArray(data.MAdultDetails)) throw new Error('CG 剧情编号或格式不匹配。');
  } else if (!Array.isArray(data) || !data.length || data.some(item => String(item.MSceneId) !== scene || !Array.isArray(item.MRichSceneDetails) || !Array.isArray(item.MSceneDetails))) throw new Error('剧情编号或格式不匹配。');
  return data;
}
const resourceName = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null;
function normalizeStory(spec, sceneData, adultData, aliases: any = {}) {
  const commands = [], dependencies = new Map();
  const emit = (command, ...args) => commands.push({ command, args });
  const dependency = (name, kind, url, extra: any = {}) => { dependencies.set(kind + ':' + name, { name, kind, url, ...extra }); return kind + ':' + name; };
  const voice = (scene, group) => dependency('voice_' + group + '_' + scene, 'voices', BASE + 'sound/voice/' + group + '/voice_' + group + '_' + scene, { group: group === 'still' ? 'CG 配音' : '剧情配音', scene });
  let voiceCounter = 0;
  if (sceneData) for (const scene of [...sceneData].sort((a, b) => a.Order - b.Order)) {
    const rows = scene.UseRichScene ? scene.MRichSceneDetails : scene.MSceneDetails;
    if (rows.length) voice(spec.scene, 'adventure');
    for (const row of [...rows].sort((a, b) => a.Order - b.Order)) {
      if (resourceName(row.BackgroundImage)) emit('spine_image', dependency(row.BackgroundImage, 'backgrounds', BASE + 'bg/adventure/' + row.BackgroundImage));
      if (resourceName(row.Bgm)) emit('music', dependency(row.Bgm, 'music', BASE + 'sound/bgm/' + row.Bgm));
      const actors = (row.Characters || []).filter(actor => validId(actor.MMonsterId)).map(actor => ({ id: String(actor.MMonsterId), position: actor.Position,
        facial: actor.Facial, talking: !!actor.IsTalking, fadeIn: !!actor.FadeIn,
        reference: dependency('chara/homestand/' + actor.MMonsterId, 'actors', BASE + 'chara/homestand/' + actor.MMonsterId, { assetCharacter: String(actor.MMonsterId) }) }));
      emit('actors', actors); if (row.SceneChangeEffectType) emit('transition', 'fade');
      let reference = resourceName(row.Voice || row.VoiceName) ? 'intro:' + (row.Voice || row.VoiceName) : '';
      if (!reference && actors.some(actor => actor.talking && (aliases[actor.id] || actor.id) === spec.character)) reference = 'adventure:' + (++voiceCounter);
      if (typeof row.Serif === 'string' && row.Serif) emit('mess', String(row.Name || ''), row.Serif, reference);
    }
  }
  if (adultData) {
    emit('actors', []); emit('music', ''); emit('spine', 'cg:' + spec.scene); voice(spec.scene, 'still');
    for (const row of [...adultData.MAdultDetails].sort((a, b) => a.Order - b.Order)) {
      if (resourceName(row.BGM)) emit('music', dependency(row.BGM, 'music', BASE + 'sound/bgm/' + row.BGM));
      if (resourceName(row.SE)) emit('sound', dependency(row.SE, 'sound', BASE + 'sound/se/' + row.SE));
      const action = Number(row.CharaAnimation) || Number(row.Motion);
      if (action > 0 && action <= 4) emit('spine_play', 'animation' + action, 'true');
      if (row.Effect) emit('transition', 'fade');
      if (typeof row.Serif === 'string' && row.Serif) emit('mess', String(row.Name || ''), row.Serif, resourceName(row.Voice) || '');
    }
  }
  return { id: spec.id, character: spec.character, scene: spec.scene, commands, dependencies: [...dependencies.values()], dialogue: commands.filter(row => row.command === 'mess').length,
    resources: {}, voices: {}, format: 'otogi', sourceComplete: !!sceneData && (!spec.adult || !!adultData) };
}
function cachedStories(root, catalog, roles?: any) {
  const stories = [];
  for (const character of catalog.characters.filter(character => !roles || roles.includes(character.id))) for (const spec of character.stories || []) {
    const scene = readJson(sourceFile(root, spec.scene, 'scene'), null), adult = spec.adult ? readJson(sourceFile(root, spec.scene, 'adult'), null) : null;
    if (!scene && !adult) continue;
    if (scene) validateSource(scene, spec.scene, 'scene'); if (adult) validateSource(adult, spec.scene, 'adult');
    const story = normalizeStory(spec, scene, adult, catalog.aliases); if (story.dialogue) stories.push({ spec, story, source: { scene, adult } });
  }
  return stories;
}
function bindStory(story, index, catalog) {
  const resolve = ref => { const dependency = story.dependencies.find(item => item.kind + ':' + item.name === ref); if (!dependency) return null;
    const list = ['voices', 'music', 'sound'].includes(dependency.kind) ? index.audio : index.images;
    return list.find(item => item.resource === dependency.name && (dependency.kind === 'actors' || item.character === story.character))?.file || null; };
  story.resources = Object.fromEntries(story.dependencies.map(item => { const ref = item.kind + ':' + item.name; return [ref, resolve(ref)]; }));
  const model = index.skeletons.find(item => item.character === story.character && item.scene === story.scene); story.resources['cg:' + story.scene] = model?.file || null;
  const clips = index.audio.filter(item => item.character === story.character && item.scene === story.scene), prefix = 'c_' + story.character.slice(0, -1) + '_' + story.scene.at(-1) + '_';
  story.voices = {};
  for (const row of story.commands.filter(row => row.command === 'mess' && row.args[2])) {
    const ref = row.args[2];
    const clip = ref.startsWith('adventure:') ? clips.find(item => item.resource === 'voice_adventure_' + story.scene && item.name.startsWith(prefix + ref.split(':')[1].padStart(3, '0') + '_'))
      : ref.startsWith('intro:') ? clips.find(item => item.name === ref.slice(6) && item.resource === 'voice_adventure_' + story.scene) : clips.find(item => item.name === ref && item.resource === 'voice_still_' + story.scene);
    story.voices[ref] = clip?.file || null;
  }
  return story;
}
function writeStories(root, index, catalog) {
  const current = cachedStories(root, catalog);
  index.stories ||= [];
  for (const { spec, story, source } of current) {
    bindStory(story, index, catalog); const folder = path.join(root, 'library/stories'); fs.mkdirSync(folder, { recursive: true });
    for (const [name, data] of [[spec.id + '.json', story], [spec.id + '.source.json', source]]) {
      const file = path.join(folder, name); fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file);
    }
    const metadata = { id: spec.id, character: spec.character, parent: spec.character, chapter: spec.chapter, scene: spec.scene, title: spec.title,
      file: 'stories/' + spec.id + '.json', script: 'stories/' + spec.id + '.source.json', scriptFormat: 'json', dialogue: story.dialogue,
      voiceSaved: Object.values<any>(story.voices).filter(Boolean).length, voiceTotal: Object.keys(story.voices).length, complete: story.sourceComplete, motions: index.skeletons.filter(item => item.character === spec.character && item.scene === spec.scene).map(item => item.id) };
    const before = index.stories.findIndex(item => item.id === spec.id); if (before < 0) index.stories.push(metadata); else index.stories[before] = metadata;
  }
  for (const character of index.characters) {
    character.stories = index.stories.filter(story => story.character === character.id).map(story => story.id);
    if (character.stories.length) character.collected = true;
  }
}
export { API, storySources, sourceFile, validateSource, normalizeStory, cachedStories, bindStory, writeStories };
