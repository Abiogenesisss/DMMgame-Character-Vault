'use strict';
const fs = require('node:fs'), path = require('node:path');
function parseStory(rows, metadata, catalog) {
  if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row) || row[1] !== Number(metadata.sceneId) || typeof row[4] !== 'string')) throw new Error('剧情编号或结构无效。');
  const commands = [], frames = [], assets = new Set<string>(), characters = new Set(metadata.character ? [metadata.character] : []);
  let image = null, model = null, music = null, animation = null, actors = new Map();
  const find = (prefix, id) => { const base=prefix+'/'+id,address=catalog.assets[base]?base:prefix.startsWith('AS')&&catalog.assets[base+'.ogg']?base+'.ogg':null;if(!address)return null;assets.add(address);return address; };
  for (const row of rows) {
    const data = JSON.parse(row[4]);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('剧情指令格式无效。');
    frames.push({ row: row[0], scene: metadata.sceneId, data });
    const background = data.Background;
    if (background?.AssetId) {
      if (background.Type === 2) {
        const nextImage = find('TSTX', background.AssetId), nextModel = find('SBSX', background.AssetId);
        if (image && image !== nextImage) commands.push({ command: 'image_delete', args: [image] });
        image = nextImage;
        if (image) commands.push({ command: 'image', args: [image] });
        if (nextModel !== model) { model = nextModel; commands.push({ command: 'spine', args: [model] }); animation = null; }
        const nextAnimation = 'Animation_' + Math.max(1, Number(background.AdultStillAnimationType) || 1) + '_Loop';
        if (model && animation !== nextAnimation) { animation = nextAnimation; commands.push({ command: 'spine_play', args: [animation, 'true'] }); }
      } else {
        const next = find('TAB', background.AssetId);
        if (image && image !== next) commands.push({ command: 'image_delete', args: [image] });
        image = next; if (image) commands.push({ command: 'image', args: [image] });
        if (model) { model = null; commands.push({ command: 'spine', args: [null] }); }
      }
    }
    if (background?.BgmAssetId) {
      const next = find('ASBM', background.BgmAssetId);
      if (next !== music) { music = next; commands.push({ command: 'music', args: [music] }); }
    }
    if (background?.SoundEffect) { const sound = find('ASASE', background.SoundEffect); if (sound) commands.push({ command: 'sound', args: [sound] }); }
    if (background?.VoiceAssetId) find('ASA', background.VoiceAssetId + '.ogg');
    for (const key of ['Character1', 'Character2', 'Character3', 'Character4', 'HiddenCharacter']) {
      const character = data[key]; if (!character) continue;
      if (character.Deactivate) {
        if (character.AssetId) { for (const [slot, actor] of actors) if (actor.resourceId === character.AssetId) actors.delete(slot); }
        else actors.delete(key);
        continue;
      }
      if (!character.AssetId) continue;
      const reference = find('SCS', character.AssetId) || find('ICS', character.AssetId); if (!reference) continue;
      const matched = catalog.characters.find(role => role.resourceId === character.AssetId && role.id === character.AssetId) || catalog.characters.find(role => role.resourceId === character.AssetId);
      if (matched) characters.add(matched.id);
      const x = character.MovePathXs?.at(-1) ?? character.X ?? 0;
      actors.set(key, { reference, resourceId: character.AssetId, position: x < -1000 ? 2 : x > 1000 ? 4 : 3, talking: false });
    }
    const phrase = data.Phrase;
    commands.push({ command: 'actors', args: [[...actors.values()].map((actor, index) => ({ ...actor, talking: phrase?.Speakers?.includes(index + 1) || false }))] });
    if (typeof phrase?.Text === 'string' && phrase.Text) {
      const voice = (phrase.VoiceAssetIds || []).map(id => find('ASA', id + '.ogg')).find(Boolean) || null;
      commands.push({ command: 'mess', args: [phrase.SpeakerName || '', phrase.Text, voice] });
    }
  }
  return { ...metadata, id: 'muvluv-' + metadata.sceneId, format: 'muvluv', characters: [...characters], commands,
    frames, assets: [...assets], resources: {}, voices: {} };
}
function cachedStories(root, catalog, roles) {
  if (!root) return [];
  const stories = [];
  for (const metadata of catalog.scenes || []) {
    if(roles&&!roles.includes(metadata.character))continue;
    const file = path.join(root, 'metadata/scene-' + metadata.sceneId + '.json'); if (!fs.existsSync(file)) continue;
    const story = parseStory(JSON.parse(fs.readFileSync(file, 'utf8')), metadata, catalog);
    stories.push(story);
  }
  const episodes = new Map();
  for (const story of stories) {
    if (!story.character || !story.episodeId) continue;
    const expected = catalog.scenes.filter(scene => scene.episodeId === story.episodeId);
    if (!expected.some(scene => scene.adult)) continue;
    if (!episodes.has(story.episodeId)) episodes.set(story.episodeId, { expected, parts: [] });
    episodes.get(story.episodeId).parts.push(story);
  }
  return [...episodes.values()].map(({ expected, parts }) => {
    expected.sort((a,b)=>a.order-b.order); parts.sort((a,b)=>a.order-b.order);
    const anchor=expected.find(scene=>scene.adult),frames=parts.flatMap(part=>part.frames),program={version:2,commands:[],dialogue:0};
    for(const frame of frames){program.commands.push({op:'frame',args:[],...frame,source:program.commands.length});if(frame.data.Phrase?.Text)program.commands.push({op:'dialogue',args:[],...frame,source:program.commands.length,dialogue:program.dialogue++,text:frame.data.Phrase.Text,speaker:frame.data.Phrase.SpeakerName||''});}
    return {...parts[0],...anchor,id:'muvluv-'+anchor.sceneId,format:'muvluv',programVersion:2,hasCg:true,adult:true,
      segments:parts.map(p=>p.sceneId),expectedSegments:expected.map(p=>p.sceneId),frames,program,
      commands:parts.flatMap(p=>p.commands),characters:[...new Set<string>(parts.flatMap(p=>p.characters))],assets:[...new Set<string>(parts.flatMap(p=>p.assets))],resources:{},voices:{}};
  });
}
export { parseStory, cachedStories };
