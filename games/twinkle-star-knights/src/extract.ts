import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../../app/pack.ts';
import { Resources, readJson, writeJson } from './resources.ts';
import { readCatalog } from './catalog.ts';
import { runUnity } from './unity.ts';
import { spineMetadata } from './spine.ts';
import { storyProgram } from './story.ts';
import { readStoryUi } from './story-ui.ts';
import { cardPortraits } from './portraits.ts';

export const hasFile = (root: string, file: string) => typeof file === 'string' && !file.includes('..') && fs.existsSync(path.join(root, 'library', file));
export function readExports(root: string) { return readJson(path.join(root, 'metadata/exports.json'), {}); }
export function selectScopes(root: string, roles: string[], scope: string) {
  const file = path.join(root, 'state/selection.json'), data = readJson(file, {});
  for (const id of roles) data[id] = [...new Set([...(data[id] || []), scope])]; writeJson(file, data);
}
export async function exportAssets(root: string, ids: string[], resources: Resources, catalog = readCatalog(root)) {
  const saved = readExports(root), requests = [], issues = []; let metadataChanged = false;
  for (const id of new Set(ids)) {
    const asset = catalog.assets[id]; if (!asset) continue;
    const files = asset.bundles.map(b => resources.file(b)); if (!files.length || files.some(f => !f)) continue;
    const fingerprint = sha256(Buffer.from((asset.kind === 'image' ? 'sprite-canvas-v2\n' : asset.kind === 'spine' ? 'spine-atlas-v2\n' : '') + id + '\n' + files.join('\n'))).slice(0, 24);
    const previous = saved[id], products = previous?.model?.files || previous?.effect?.files || [previous?.image?.file || previous?.audio?.file || previous?.script];
    if (previous?.fingerprint === fingerprint && products.every(f => hasFile(root, f))) {
      if (previous.model && !previous.model.animationDurations) { Object.assign(previous.model, spineMetadata(fs.readFileSync(path.join(root, 'library', previous.model.file)))); metadataChanged = true; }
      continue;
    }
    requests.push({ ...asset, files, fingerprint });
  }
  // Batch by bundle set so a shared story book or model bundle is decoded once.
  requests.sort((a, b) => a.files.join().localeCompare(b.files.join()));
  if (requests.length) {
    const results = await runUnity({ command: 'export', requests, output: path.join(root, 'library') });
    for (const result of results) {
      if (result.error) { issues.push({ asset: result.id, error: result.error }); continue; }
      try {
        if (result.model) Object.assign(result.model, spineMetadata(fs.readFileSync(path.join(root, 'library', result.model.file))));
        saved[result.id] = { ...result, fingerprint: requests.find(r => r.id === result.id).fingerprint };
      } catch (error) { issues.push({ asset: result.id, error: error.message }); }
    }
    metadataChanged = true;
  }
  if (metadataChanged) writeJson(path.join(root, 'metadata/exports.json'), saved);
  return { saved, issues };
}
export function roleAssetIds(role: any, scope: string) {
  const ids = [role.iconAsset];
  if (['all', 'portraits'].includes(scope)) ids.push(...cardPortraits<any>(role.portraitAssets).map(p => p.asset));
  if (['all', 'cg', 'motions'].includes(scope)) ids.push(...role.motionAssets);
  if (['all', 'voices'].includes(scope)) ids.push(...role.voiceAssets);
  if (['all', 'stories'].includes(scope)) ids.push(role.storyAsset);
  return ids.filter(Boolean);
}
export async function extract(root: string, progress = (_state: any) => {}, { resources = new Resources(root) } = {}) {
  const catalog = readCatalog(root), selection = readJson(path.join(root, 'state/selection.json'), {});
  const ids = catalog.characters.map(c => c.iconAsset);
  for (const role of catalog.characters) for (const scope of selection[role.id] || []) ids.push(...roleAssetIds(role, scope));
  let { saved, issues } = await exportAssets(root, ids, resources, catalog);
  const programs = [];
  for (const role of catalog.characters) {
    const scopes = selection[role.id] || []; if (!scopes.some(s => ['all', 'stories'].includes(s))) continue;
    const book = saved[role.storyAsset]?.script; if (!hasFile(root, book)) continue;
    for (const [id, rows] of Object.entries<any[]>(readJson(path.join(root, 'library', book)))) {
      programs.push({ id, role: role.id, rows, program: storyProgram(rows, catalog) });
    }
  }
  const extras = await exportAssets(root, programs.flatMap(p => p.program.resources), resources, catalog); saved = extras.saved; issues.push(...extras.issues);
  const skeletons = [], audio = [], stories = [];
  const exported = (id: string) => saved[id]?.model || saved[id]?.image || saved[id]?.audio || saved[id]?.effect;
  for (const { id, role, rows, program } of programs) {
    const media = {}, missing = [...program.unresolved];
    for (const asset of program.resources) {
      const item = exported(asset);
      if (item && (item.files || [item.file]).every(file => hasFile(root, file))) media[asset] = item;
      else missing.push(asset);
    }
    const file = `stories/${id}.json`, script = `stories/${id}.source.json`;
    writeJson(path.join(root, 'library', file), { ...program, media }); writeJson(path.join(root, 'library', script), rows);
    stories.push({ id, character: role, title: /8$/.test(id) ? '特别剧情 · ' + id : '角色剧情 · ' + id, file, script, scriptFormat: 'json', segments: 1, expectedSegments: 1, complete: !missing.length, missingAssets: missing.length, unsupported: program.unsupported });
  }
  const characters = catalog.characters.map(role => {
    const scopes = selection[role.id] || [], wanted = scope => scopes.includes('all') || scopes.includes(scope);
    const portraits = [];
    if (wanted('portraits')) for (const p of role.portraitAssets) {
      const model = saved[p.asset]?.model; if (!model || !hasFile(root, model.file)) continue;
      const id = role.id + '-' + portraits.length;
      skeletons.push({ ...model, id, character: role.id, kind: 'portrait', label: p.label });
      portraits.push({ phase: id, label: p.label, model: id });
    }
    if (wanted('cg') || wanted('motions')) for (const a of role.motionAssets) {
      const model = saved[a]?.model; if (model && hasFile(root, model.file)) skeletons.push({ ...model, id: a, character: role.id, kind: 'cg', label: '动态 CG' });
    }
    if (wanted('voices')) for (const a of role.voiceAssets) {
      const item = saved[a]?.audio; if (item && hasFile(root, item.file)) audio.push({ ...item, character: role.id, context: 'character', category: 'character-voice', group: '角色语音', label: path.posix.basename(a, '.ogg') });
    }
    const voiceSaved = audio.filter(a => a.character === role.id).length, chapters = stories.filter(s => s.character === role.id);
    const icon = saved[role.iconAsset]?.image?.file;
    return { id: role.id, name: role.name, nameAliases: role.nameAliases, hasDynamicCg: role.hasDynamicCg, cgAvailable: role.cgAvailable, voiceAvailable: role.voiceAvailable, storyAvailable: role.storyAvailable,
      icon: hasFile(root, icon) ? icon : null, portraits, cg: [], stories: chapters, voiceSaved,
      collected: !!(portraits.length || voiceSaved || chapters.length || skeletons.some(s => s.character === role.id && s.kind === 'cg')) };
  });
  const index = { version: 1, game: 'twinkle-star-knights', characters, skeletons, audio, stories, images: [], issues, storyUi: readStoryUi(root),
    stats: { characters: characters.length, icons: characters.filter(c => c.icon).length, portraits: characters.reduce((n, c) => n + c.portraits.length, 0),
      cg: 0, dynamicCg: skeletons.filter(s => s.kind === 'cg').length, audio: audio.length, characterVoices: audio.length, stories: stories.length, collected: characters.filter(c => c.collected).length, issues: issues.length } };
  writeJson(path.join(root, 'library/index.json'), index); progress({ state: 'ready', stats: index.stats }); return index;
}
if (require.main === module) extract(process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../../parsed-data/twinkle-star-knights')).then(index => console.log(JSON.stringify(index.stats))).catch(error => { console.error(error.message); process.exitCode = 1; });
