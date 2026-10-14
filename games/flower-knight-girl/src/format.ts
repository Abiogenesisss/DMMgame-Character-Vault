'use strict';
const { createHash } = require('node:crypto');
const zlib = require('node:zlib');
const { baseId } = require('./character-identity.ts');
const { isMaterialId } = require('./character-types.ts');
const BASE = 'https://dugrqaqinbtcq.cloudfront.net/product/ynnFQcGDLfaUcGhp/';
const md5 = value => createHash('md5').update(value).digest('hex');
const validId = id => /^1\d{5}(?:\d{3})?$/.test(String(id)) && !isMaterialId(id);
function assetUrl(relative) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.includes('..') || relative.startsWith('/')) throw new Error('Invalid Flower Knight asset path');
  return BASE + 'assets/' + relative;
}
function storySpec(id, chapter) {
  if (!validId(id) || ![1, 2].includes(chapter)) throw new Error('Invalid character or chapter');
  const name = `hscene_r18_${id}${chapter === 2 ? '_2' : ''}`;
  return { id: md5(name), character: String(id), chapter, name, url: assetUrl('event/hscene_r18/' + md5(name) + '.bin') };
}
function imageSpec(reference) {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(reference)) throw new Error('Unsupported image reference');
  const [family, name] = reference.split('/');
  return { reference, name, type: 'image', url: assetUrl(`ultra/images/${family}/${md5(name)}.bin`) };
}
function spineSpecs(reference, count) {
  if (!/^hscene_r18_spine\/r18_spine_[0-9_]+$/.test(reference) || !Number.isInteger(count) || count < 1 || count > 16) throw new Error('Unsupported Spine reference');
  const name = reference.split('/').at(-1);
  const make = (prefix, textureName, type) => ({ reference, name, type, textureName,
    url: assetUrl(`hscene_r18_spine/${md5(prefix + textureName)}.bin`) });
  return [make('spine', name, 'skeleton'), make('atlas', name, 'atlas'),
    ...Array.from({ length: count }, (_, index) => make('webp', name + (index ? '_' + (index + 1) : ''), 'texture'))];
}
function voiceUrl(reference) {
  if (!/^\d{6,9}\/[a-zA-Z0-9_-]+$/.test(reference)) return null;
  const [id, name] = reference.split('/');
  return assetUrl(`voice/c/${id}/${md5(name)}.mp3`);
}
function voiceSpec(reference) {
  const url = voiceUrl(reference);
  if (!url) throw new Error('Unsupported voice reference');
  return { reference, name: reference.split('/').at(-1), type: 'voice', url };
}
function isMp3(bytes) {
  return bytes.length >= 4 && (bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
}
function standUrl(id) {
  // 2-prefixed assets are botanical flowers, excluded from role collection.
  if (!/^[145]\d{5}$/.test(String(id)) || isMaterialId(id)) throw new Error('Invalid portrait character');
  return assetUrl('ultra/images/character/dmm/stand/' + md5('stand_' + id) + '.bin');
}
function bloomSpecs(character) {
  const id = String(typeof character === 'object' ? character.id : character);
  if (!/^1\d{5}$/.test(id)) throw new Error('Invalid portrait character');
  return [300000, 400000].map(offset => {
    const bloom = String(Number(id) + offset);
    return { phase: 'bloom', label: '开花后', character: bloom, url: standUrl(bloom) };
  });
}
function portraitSpecs(character) {
  const id = String(typeof character === 'object' ? character.id : character);
  if (!/^1\d{5}$/.test(id)) throw new Error('Invalid portrait character');
  const forms = typeof character === 'object' && character.forms || {
    before: id, ...(Number(id) % 2 === 1 ? { after: String(Number(id) + 1) } : {})
  };
  return [['before', '进化前'], ['after', '进化后'], ['bloom', '开花后']]
    .filter(([phase]) => forms[phase])
    .map(([phase, label]) => ({ phase, label, character: String(forms[phase]), url: standUrl(forms[phase]) }));
}
function portraitDownloadSpecs(character) {
  const portraits = portraitSpecs(character);
  // Probe both asset families only until bloom art is confirmed. Candidates
  // belong to the download queue, never to the displayed form list.
  return portraits.some(spec => spec.phase === 'bloom') ? portraits
    : [...portraits, ...bloomSpecs(character).map(spec => ({ ...spec, candidate: true }))];
}
const roleImageSpecs = portraitSpecs;
function decode(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x78 && ((bytes[0] << 8) + bytes[1]) % 31 === 0) return zlib.inflateSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
  return bytes;
}
function csvRows(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else if (quoted || field === '') quoted = !quoted;
      else field += char;
    } else if (!quoted && char === ',') { row.push(field); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Unterminated scenario CSV field');
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
function parseStory(bytes, spec) {
  const rows = csvRows(new TextDecoder('utf-8', { fatal: true }).decode(decode(bytes)).replace(/^\uFEFF/, ''));
  if (!rows.some(row => row[0] === 'mess')) throw new Error('Not a Flower Knight scenario');
  const dependencies = new Map(); const issues = []; let dialogue = 0;
  const commands = rows.map(row => {
    const [command, ...args] = row;
    if (command === 'mess') dialogue++;
    try {
      const files = command === 'image' || command === 'spine_image' ? [imageSpec(args[0])]
        : command === 'spine' ? spineSpecs(args[0], Number(args[1])) : command === 'mess' && args[2] ? [voiceSpec(args[2])] : [];
      files.forEach(file => dependencies.set(file.url, file));
    } catch (error) { issues.push({ command, reference: args[0], error: error.message }); }
    return { command, args };
  });
  return { ...spec, dialogue, commands, dependencies: [...dependencies.values()], issues };
}
function sniffImage(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
export { BASE, md5, validId, baseId, assetUrl, storySpec, imageSpec, spineSpecs, voiceUrl, voiceSpec, isMp3, standUrl, bloomSpecs, portraitSpecs, portraitDownloadSpecs, roleImageSpecs, decode, csvRows, parseStory, sniffImage };
