'use strict';
// The captured client uses a 960×640 scene and a default Spine scale of 0.36.
const FRAME = { width: 960, height: 640 };
function spinePlacement(args = []) {
  const number = (value, fallback) => value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const scale = number(args[4], 0.36);
  return { x: number(args[2], 0), y: number(args[3], 0), scale: scale > 0 ? scale : 0.36 };
}
function fitScene(width, height, placement = spinePlacement()) {
  const scale = Math.max(0, Math.min(1, width / FRAME.width, height / FRAME.height));
  return { scale: scale * placement.scale,
    x: (width - FRAME.width * scale) / 2 + (FRAME.width / 2 + placement.x) * scale,
    y: (height - FRAME.height * scale) / 2 + (FRAME.height / 2 + placement.y) * scale };
}
function readScene(story, commandIndex, models, images = []) {
  let image = null, reference = null, placement = spinePlacement(), animation = 'Wait', loop = true, token = null, actors = [], music = null, sound = null, transition = null;
  for (let index = 0; index <= commandIndex; index++) {
    const row = story.commands[index]; if (!row) break;
    if (row.command === 'image') image = row.args[0];
    if (row.command === 'spine') {
      reference = row.args[0]; placement = spinePlacement(row.args); animation = 'Wait'; loop = true; token = index;
    }
    if (row.command === 'spine_play') { animation = row.args[0]; loop = row.args[1] !== 'false'; token = index; }
    if (row.command === 'actors') actors = Array.isArray(row.args[0]) ? row.args[0] : [];
    if (row.command === 'music') music = row.args[0] || null;
    if (row.command === 'sound') sound = { reference: row.args[0], token: index };
    if (row.command === 'transition') transition = { kind: row.args[0], token: index };
    if (row.command === 'spine_image') { image = row.args[0]; reference = null; }
    if (['image_delete', 'spine_image_delete'].includes(row.command) && image === row.args[0]) image = null;
  }
  // Category downloads can fill resources after the scenario was indexed.
  const file = image ? story.resources?.[image] || images.find(item => item.name === image)?.file || null : null;
  const modelFile = story.resources?.[reference];
  const model = reference ? models.find(item => modelFile && (item.file === modelFile || item.engine==='video'&&item.tracks?.some(t=>t.file===modelFile)) || item.name === reference.split('/').at(-1)) || null : null;
  const scene: { image: any; fallbackImage: any; model: any; placement: any; animation: string; loop: boolean; token: any; actors?: any[]; music?: string; sound?: { file: string; token: number }; transition?: { kind: string; token: number } } = { image: model ? null : file, fallbackImage: file, model, placement, animation, loop, token };
  if (story.format === 'otogi') Object.assign(scene, { actors: model ? [] : actors.map(actor => ({ ...actor, file: story.resources?.[actor.reference] || null })),
    music: music ? story.resources?.[music] || null : null, sound: sound ? { ...sound, file: story.resources?.[sound.reference] || null } : null, transition });
  return scene;
}
export { FRAME, spinePlacement, fitScene, readScene };
