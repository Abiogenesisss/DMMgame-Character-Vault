import { renameFileSync } from '../../../app/atomic-file.ts';
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { BASE, md5, validId, baseId, voiceUrl } = require('./format.ts');
const { loadPack, sha256 } = require('../../../app/pack.ts');
const { readSelection, readScopes } = require('./selection.ts');

const MAPPING_VERSION = 1;
const BAD_VOICE = /hscene|scenario|(?:^|[_/-])story(?:[_/-]|$)/i;
const FILE_NAME = /^fkg_[a-zA-Z0-9_]+\.mp3$/;
const BODY_ID = /^[a-f0-9]{64}$/;
const TYPE_LABELS = {
  INTRODUCE: '自我介绍', FIRST_APPEARANCE: '初次登场',
  BATTLE_START: '战斗开始', NOMAL_ATTACK: '普通攻击', SKILL_ATTACK: '技能攻击',
  DAMAGE: '受伤', MORTAL_WOUND: '重伤', DEAD: '战斗不能',
  BATTLE_VICTORYL: '战斗胜利', BATTLE_NARROW_VICTORY: '险胜', BATTLE_EASY_VICTORY: '轻松获胜',
  SKILL_NOT_DEFEAT: '攻击未击倒', SKILL_KILLED: '击倒敌人', TREASURE_DISCOVERY: '发现宝箱',
  HIDDEN_DOOR_DISCOVERY: '发现隐藏通道', DAMAGE_TRAP: '陷阱伤害', DAMAGE_PANEL: '陷阱伤害',
  PARTY_MEMBER_ELECTED: '编入队伍', EQUIP_CHANGE: '更换装备', LEVEL_UP: '升级',
  EVOLUTION: '进化', FLOWERING: '开花', MYPAGE_FAVORABILITY: '好感度台词',
  MYPAGE_COMMON: '主页台词', LEAVE: '待机台词', PRESENT_GIFT: '赠送礼物',
  PRESENT_FAVORITE_GIFT: '赠送喜好礼物', PRESENT_GIFT_SAKU: '赠送礼物·好感度咲',
  PRESENT_FAVORITE_GIFT_SAKU: '赠送喜好礼物·好感度咲',
  LOGIN_BONUS: '登录奖励', ANGRY: '生气', JOY: '喜悦', SAD: '伤心', FUN: '开心',
  PLAYABLE_FREE_GACHA: '免费招募提醒', STAMINA_MAX: '体力恢复', LOGIN: '登录问候',
  MOVE_START: '出发', TITLE: '标题语音', BLESSING_GARDEN: '庭园问候', FOREVER: '誓约问候',
  NEW_YEAR: '新年', TANABATA: '七夕', SUMMER: '夏日', TSUKIMI: '赏月', AUTUMN: '秋日',
  HALLOWEEN: '万圣节', WINTER: '冬日', HOLYCHRISMAS: '圣诞节',
  VALENTINE: '情人节', WHITEDAY: '白色情人节', SPRING: '春日'
};
const SEASON_TYPES = new Set(['NEW_YEAR', 'TANABATA', 'SUMMER', 'TSUKIMI', 'AUTUMN', 'HALLOWEEN', 'WINTER', 'HOLYCHRISMAS', 'VALENTINE', 'WHITEDAY', 'SPRING']);

function voiceLabel(type, file) {
  const family = type.replace(/\d+$/, ''), number = file.match(/(\d{3})\.mp3$/)?.[1];
  const label = TYPE_LABELS[family] || '角色语音';
  return /\d+$/.test(type) && number ? label + ' ' + Number(number) : label;
}
function voiceGroup(type) {
  const family = type.replace(/\d+$/, '');
  if (SEASON_TYPES.has(family)) return '季节';
  if (/^(?:BATTLE|NOMAL_ATTACK|SKILL|DAMAGE|MORTAL_WOUND|DEAD|TREASURE|HIDDEN_DOOR|MOVE_START)/.test(type)) return '战斗';
  if (/^(?:LEVEL_UP|EVOLUTION|FLOWERING|EQUIP_CHANGE|PARTY_MEMBER|PRESENT)/.test(type)) return '养成';
  return '日常';
}
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function assignedFunction(source, owner, name) {
  const pattern = new RegExp(escaped(owner) + "\\[['\"]" + name + "['\"]\\]\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{", 'g');
  const found = pattern.exec(source); if (!found) return null;
  const start = found.index + found[0].length; let depth = 1, quote = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) { if (char === '\\') i++; else if (char === quote) quote = null; }
    else if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i);
  }
  return null;
}

// Parse only the client's technical voice tables. Never execute the captured script.
function parseVoiceTypes(source) {
  const soundOwner = source.match(/\[['"]SoundURL['"]\]\s*=\s*([\w$]+)\s*;/)?.[1];
  const voiceOwner = source.match(/\[['"]VoiceType['"]\]\s*=\s*([\w$]+)\s*;/)?.[1];
  if (!soundOwner || !voiceOwner) throw new Error('游戏脚本中没有可识别的角色语音配置。');
  const constants = new Map();
  const constantPattern = new RegExp(escaped(soundOwner) + "\\[['\"](VOICE_[A-Z0-9_]+)['\"]\\]\\s*=\\s*['\"](fkg_[a-zA-Z0-9_]+\\.mp3)['\"]", 'g');
  for (const match of source.matchAll(constantPattern)) constants.set(match[1], match[2]);
  const method = assignedFunction(source, voiceOwner, 'getFileName');
  if (!method) throw new Error('无法识别游戏的角色语音文件名规则。');
  const cases = /case\s+[\w$]+\[['"]resourcemanager['"]\]\[['"]VoiceType['"]\]\[['"]([A-Z0-9_]+)['"]\]\s*:\s*return\s+[\w$]+\[['"]resourcemanager['"]\]\[['"]SoundURL['"]\]\[['"](VOICE_[A-Z0-9_]+)['"]\]\s*;/g;
  const byFile = new Map();
  for (const match of method.matchAll(cases)) {
    const [type, key] = [match[1], match[2]], file = constants.get(key);
    if (!file) throw new Error('角色语音配置引用了未知文件：' + key);
    if (!FILE_NAME.test(file) || BAD_VOICE.test(type + '/' + file)) continue;
    if (byFile.has(file)) { byFile.get(file).aliases.push(type); continue; }
    byFile.set(file, { type, key, aliases: [type], file, hash: md5(file.slice(0, -4)),
      label: voiceLabel(type, file), group: voiceGroup(type), order: byFile.size });
  }
  if (!byFile.size) throw new Error('没有找到可用于角色鉴赏的非剧情语音。');
  return [...byFile.values()];
}
function validMapping(mapping) {
  return mapping?.version === MAPPING_VERSION && Array.isArray(mapping.types) && mapping.types.length
    && mapping.types.every(item => item && FILE_NAME.test(item.file) && !BAD_VOICE.test(item.type + '/' + item.file)
      && item.hash === md5(item.file.slice(0, -4)));
}
function canonicalUrl(value) { try { const url = new URL(value); url.search = ''; url.hash = ''; return url.href; } catch { return null; } }
function voiceRecordUrl(value) {
  let url; try { url = new URL(value); } catch { return null; }
  const base = new URL(BASE);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + 'assets/voice/c/')) return null;
  const tail = url.pathname.slice((base.pathname + 'assets/voice/c/').length);
  const match = /^(1\d{5}(?:\d{3})?)\/([a-f0-9]{32})\.mp3$/.exec(tail);
  return match ? { character: match[1], hash: match[2], url: canonicalUrl(value) } : null;
}
function metadataRecords(manifest) {
  return Object.values<any>(manifest.routes).map(records => records.at(-1)).filter(record =>
    record?.method === 'GET' && record.status === 200 && BODY_ID.test(record.body));
}
function cachedVoiceRows(manifest, types) {
  const byHash = new Map<any, any>(types.map(type => [type.hash, type])), rows = new Map(), ambiguous = new Set<string>();
  for (const record of metadataRecords(manifest)) {
    const parsed = voiceRecordUrl(record.url); if (!parsed) continue;
    const type = byHash.get(parsed.hash);
    if (!type) { ambiguous.add(record.body); continue; }
    if (/^(?:text\/|application\/(?:json|javascript))/i.test(record.mimeType || '')) continue;
    rows.set(parsed.url, { ...type, ...parsed, body: record.body, size: record.size, parent: baseId(parsed.character) });
  }
  return [...rows.values()].filter(row => !ambiguous.has(row.body));
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value)); renameFileSync(file + '.tmp', file);
}
function ensureVoiceMapping(root, { manifest = loadPack(path.join(root, 'cache')).manifest, write = true }: any = {}) {
  const file = path.join(root, 'metadata/voice-map.json');
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const client = metadataRecords(manifest).filter(record => canonicalUrl(record.url) === BASE + 'index.js'
    && /javascript/i.test(record.mimeType || '')).at(-1);
  let mapping;
  if (validMapping(old) && (!client || old.source?.body === client.body)) mapping = old;
  else if (client) {
    const source = path.join(root, 'cache/bodies', client.body);
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || stat.size !== client.size) throw new Error('游戏脚本大小有误。');
    const bytes = fs.readFileSync(source);
    if (sha256(bytes) !== client.body) throw new Error('游戏脚本校验失败，请重新导入 HAR。');
    mapping = { version: MAPPING_VERSION, source: { url: canonicalUrl(client.url), body: client.body },
      types: parseVoiceTypes(bytes.toString('utf8')) };
  } else mapping = { version: MAPPING_VERSION, source: null, types: [] };
  mapping = { ...mapping, cached: cachedVoiceRows(manifest, mapping.types) };
  if (write && mapping.types.length) writeJson(file, mapping);
  return mapping;
}
function characterVoiceSpecs(character, mapping, catalog) {
  if (!validId(character)) throw new Error('角色语音编号有误。');
  return mapping.types.map(type => ({ ...type, character: String(character), parent: baseId(character, catalog),
    reference: character + '/' + type.file.slice(0, -4), url: voiceUrl(character + '/' + type.file.slice(0, -4)),
    context: 'character', category: 'character-voice', type: 'voice', voiceType: type.type }));
}
function roleVoiceSpecs(catalog, roles, mapping) {
  const ids = new Set<string>();
  for (const character of catalog.characters.filter(item => roles.includes(item.id))) {
    ids.add(character.id);
    // Normal voices use the base role and optional skins, not evolution/bloom
    // portrait IDs. Merging cards must not triple the voice download queue.
    for (const variant of character.variants || []) if (String(variant).length > 6 && validId(variant) && baseId(variant, catalog) === character.id) ids.add(variant);
  }
  return [...ids].flatMap(id => characterVoiceSpecs(id, mapping, catalog));
}
function mappedVoice(url, mapping, catalog) {
  const parsed = voiceRecordUrl(url); if (!parsed) return null;
  const kind = mapping.types.find(type => type.hash === parsed.hash); if (!kind) return null;
  const label = kind.label + (parsed.character.length > 6 ? ' · 装扮 ' + Number(parsed.character.slice(6)) : '');
  return { voiceType: kind.type, label, group: kind.group, order: kind.order, name: kind.file,
    reference: parsed.character + '/' + kind.file.slice(0, -4), character: parsed.character,
    parent: baseId(parsed.character, catalog), characters: [baseId(parsed.character, catalog)], category: 'character-voice', context: 'character' };
}

// Update only metadata and copy known cached audio verbatim. No CG or story is parsed.
function syncCachedVoices(root, { mapping, persist = true, index }: any = {}) {
  mapping ||= ensureVoiceMapping(root, { write: persist });
  const indexFile = path.join(root, 'library/index.json');
  const result = { voiceTypes: mapping.types.length, matchedCached: mapping.cached.length, indexed: 0, missing: 0 };
  if (!index && !fs.existsSync(indexFile)) return { ...result, libraryReady: false };
  index ||= JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const selected = readSelection(root, index);
  const scopes = readScopes(root, index);
  const audioById = new Map<any, any>((index.audio || []).map(item => [item.id, item]));
  const blockedFiles = new Set<string>((index.stories || []).flatMap(item => item.voiceFiles || []));
  // Re-evaluate our own classifications when source rules or story usage change.
  // A previously mapped file must not remain playable after its provenance becomes ambiguous.
  for (const [id, item] of audioById) if (item.mapping === 'flower-character-voices') {
    const entry = { ...item, category: 'voice', context: item.context === 'story' || blockedFiles.has(item.file) ? 'story' : undefined };
    for (const field of ['mapping', 'voiceType', 'group', 'order']) delete entry[field];
    audioById.set(id, entry);
  }
  for (const row of mapping.cached) {
    const parent = baseId(row.character, index);
    if (!selected.has(parent) || !['all', 'voices'].some(scope => scopes.get(parent)?.has(scope)) || !index.characters.some(character => character.id === parent)) continue;
    const old = audioById.get(row.body), file = 'audio/' + row.body + '.mp3';
    if (old?.context === 'story' || old?.story || old?.storyIds?.length
      || BAD_VOICE.test([old?.reference, old?.name].join('/')) || blockedFiles.has(old?.file || file)) continue;
    const source = path.join(root, 'cache/bodies', row.body), target = path.join(root, 'library', file);
    if (!fs.existsSync(source) || fs.statSync(source).size !== row.size) { result.missing++; continue; }
    if (!persist && !fs.existsSync(target)) { result.missing++; continue; }
    if (persist) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target) || fs.statSync(target).size !== row.size) fs.copyFileSync(source, target);
    }
    const details = mappedVoice(row.url, mapping, index), previous = audioById.get(row.body);
    const entry = { ...previous, ...details, id: row.body, file, bytes: row.size,
      characters: [...new Set([...(previous?.characters || []).map(id => baseId(id, index)), parent])], mapping: 'flower-character-voices' };
    audioById.set(row.body, entry); result.indexed++;
  }
  index.audio = [...audioById.values()];
  for (const character of index.characters) {
    character.voiceSaved = index.audio.filter(item => item.context === 'character' && item.characters?.includes(character.id)).length;
    if (selected.has(character.id)) character.collected = true;
  }
  index.stats = { ...index.stats, audio: index.audio.length,
    characterVoices: index.audio.filter(item => item.context === 'character').length };
  if (persist) writeJson(indexFile, index);
  return { ...result, libraryReady: true, charactersWithVoices: index.characters.filter(character => character.voiceSaved > 0).length, stats: index.stats };
}

export { parseVoiceTypes, ensureVoiceMapping, characterVoiceSpecs, roleVoiceSpecs, mappedVoice, cachedVoiceRows, syncCachedVoices };


if (require.main === module) {
  const root = require('./paths.ts').root;
  require('../../../app/projects.ts').withPackLock(root, () => {
    const mapping = ensureVoiceMapping(root);
    if (!mapping.types.length) throw new Error('请先导入包含游戏 index.js 的 HAR，才能建立角色语音映射。');
    console.log(JSON.stringify(syncCachedVoices(root, { mapping })));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
