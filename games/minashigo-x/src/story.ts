const { logicalPath } = require('./format.ts');
function csvRows(text) {
  if (typeof text !== 'string' || text.length > 4 * 1024 * 1024) throw new Error('剧情脚本超过大小限制。');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n' || i === text.length)) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (row.length > 64) throw new Error('剧情指令字段过多。');
      if (c !== ',') { if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > 100000) throw new Error('剧情指令过多。'); }
    } else field += c;
  }
  if (quoted) throw new Error('剧情 CSV 引号不完整。'); return rows;
}
const number = (value, fallback = 0, limit = 10000) => value !== '' && Number.isFinite(Number(value)) ? Math.max(-limit, Math.min(limit, Number(value))) : fallback;
function storyDependencies(text) {
  const resources = new Map<string, string>();
  const add = value => { const logical = logicalPath(value); if (logical?.startsWith('adv/')) resources.set(logical, value); };
  for (const [command, ...args] of csvRows(text)) {
    // Normalize the dictionary key while keeping source directives untouched.
    for (const value of args) if (/\.(txt|png|jpg|jpeg|plist|mp3|mp4|json|atlas|skel|bin)$/.test(value)) add(value);
    if (command === 'spriteatlas' && logicalPath(args[0])?.startsWith('adv/')) { add(args[0] + '.plist'); add(args[0] + '.png'); }
  }
  if (resources.size > 1000) throw new Error('剧情引用的素材过多。');
  return [...resources.values()];
}
function storyProgram(text) {
  const rows = csvRows(text), lines = [], poses = new Map();
  const state: any = { background: null, color: '#000000', actors: Object.create(null), music: null, sound: null, voice: null, speaker: '' };
  const reference = value => logicalPath(value);
  for (const [command, ...args] of rows) {
    if (command === 'name') state.speaker = args[0] || '';
    if (command === 'bg') {
      if (args[0]?.startsWith('color_')) { state.color = 'rgb(' + args[0].split('_').slice(1, 4).map(value => Math.max(0, Math.min(255, number(value)))).join(',') + ')'; state.background = null; }
      else state.background = reference(args[0]);
    }
    if (command === 'bgoff') state.background = null;
    if (command === 'playbgm') state.music = reference(args[0]);
    if (command === 'stopbgm') state.music = null;
    if (command === 'playvoice') state.voice = reference(args[1]);
    if (command === 'playse') state.sound = reference(args[0]);
    if (command === 'sprite' || command === 'spriteatlas') {
      const atlas = command === 'spriteatlas', base = reference(args[0]), tag = args[atlas ? 2 : 1]; if (!base || !/^[A-Za-z0-9_-]{1,100}$/.test(tag || '') || ['__proto__','constructor','prototype'].includes(tag)) continue;
      const pose = atlas ? args[1] : null; if (atlas && !/^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*$/.test(pose || '')) throw new Error('剧情表情编号无效。');
      const key = atlas ? base + '#' + pose : base; if (atlas) poses.set(key, { atlas: base, pose });
      const start = atlas ? 3 : 2;
      state.actors[tag] = { resource: key, x: number(args[start]), y: number(args[start + 1]), scaleX: number(args[start + 2], 1, 10), scaleY: number(args[start + 2], 1, 10), rotation: 0, opacity: 1 };
    }
    if (command === 'spriteoff') { if (args[0]) delete state.actors[args[0]]; else state.actors = Object.create(null); }
    if (command === 'imgconf') {
      const actor = state.actors[args[0]]; if (!actor) continue;
      if (args[1] && args[1] !== args[0] && /^[A-Za-z0-9_-]{1,100}$/.test(args[1]) && !['__proto__','constructor','prototype'].includes(args[1])) { delete state.actors[args[0]]; state.actors[args[1]] = actor; }
      actor.x = number(args[2], actor.x); actor.y = number(args[3], actor.y);
      actor.rotation = number(args[6], actor.rotation, 360); actor.scaleX = number(args[7], actor.scaleX, 10); actor.scaleY = number(args[8], actor.scaleY, 10);
    }
    if (command === 'msg') {
      // The official CSV places the message mode before the text, followed by
      // optional control columns. Those columns must never become dialogue.
      const mode = /^[01]$/.test(args[0] || '') && args.length > 1 ? Number(args[0]) : null;
      const text = mode == null ? args[0] : args[1];
      if (text) { lines.push({ ...structuredClone(state), text, messageType: mode }); state.voice = null; state.sound = null; }
    }
  }
  if (!lines.length) throw new Error('剧情中没有可播放的对白。');
  return { lines, poses: [...poses].map(([key, pose]) => ({ key, ...pose })), directives: rows };
}
function atlasFrames(xml) {
  if (typeof xml !== 'string' || xml.length > 4 * 1024 * 1024 || /<!ENTITY/i.test(xml)) throw new Error('立绘图集格式无效。');
  const start = /<key>frames<\/key>\s*<dict>/.exec(xml); if (!start) throw new Error('立绘图集缺少帧。');
  const block = xml.slice(start.index + start[0].length).split(/<key>metadata<\/key>/)[0], frames = {};
  for (const match of block.matchAll(/<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g)) {
    const name = match[1], body = match[2], value = key => new RegExp('<key>' + key + '</key>\\s*<string>([^<]*)</string>').exec(body)?.[1];
    const numbers = key => (value(key)?.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    let rect = numbers('textureRect'); const size = numbers('spriteSourceSize'), rotated = /<key>textureRotated<\/key>\s*<true\s*\/>/.test(body);
    let vertices = numbers('vertices'), uv = numbers('verticesUV'), triangles = numbers('triangles');
    // TexturePacker also emits ordinary trimmed rectangles without mesh fields.
    // Their offsets are relative to the center of the original source canvas.
    if (!vertices.length && !uv.length && !triangles.length && rect.length === 4 && size.length === 2) {
      const sprite = numbers('spriteSize'), offset = numbers('spriteOffset');
      if (sprite.length !== 2 || offset.length !== 2) throw new Error('立绘图集裁切数据无效。');
      const left = (size[0] - sprite[0]) / 2 + offset[0], top = (size[1] - sprite[1]) / 2 - offset[1];
      vertices = [left, top, left + sprite[0], top, left + sprite[0], top + sprite[1], left, top + sprite[1]];
      if (rotated) rect = [rect[0], rect[1], rect[3], rect[2]];
      uv = [rect[0], rect[1], rect[0] + rect[2], rect[1], rect[0] + rect[2], rect[1] + rect[3], rect[0], rect[1] + rect[3]];
      triangles = [0, 1, 2, 0, 2, 3];
    }
    if (!/^[A-Za-z0-9_-]+\.png$/.test(name) || rect.length !== 4 || size.length !== 2 || vertices.length < 6 || vertices.length !== uv.length || vertices.length % 2 || triangles.length % 3 || triangles.length > 30000
      || [...rect, ...size, ...vertices, ...uv, ...triangles].some(value => !Number.isFinite(value))
      || size.some(value => value < 1 || value > 4096) || rect.some(value => value < 0 || !Number.isInteger(value)) || !rect[2] || !rect[3]
      || triangles.some(index => !Number.isSafeInteger(index) || index < 0 || index >= vertices.length / 2)) throw new Error('立绘图集几何数据无效。');
    frames[name] = { rect, size, vertices, uv, triangles, rotated };
  }
  if (!Object.keys(frames).length) throw new Error('立绘图集没有有效帧。'); return frames;
}
export { csvRows, storyProgram, storyDependencies, atlasFrames };
