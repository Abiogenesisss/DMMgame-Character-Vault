import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../../app/pack.ts';
import { writeAtomicFileSync } from '../../../app/atomic-file.ts';
import { fetchPublicResource } from '../../../app/public-fetch.ts';
import { readCharacterMetadata } from './character-metadata.ts';

export const DYNAMIC_CG_SOURCE = 'https://flowerknight.fandom.com/api.php?action=query&format=json&titles=H%20Scene&prop=revisions&rvprop=content&rvslots=main';
const FILE = 'metadata/dynamic-cg.json';

// Parse only the published character-name list. Never execute wiki Lua or
// download scenario bodies, CG textures, voices or game-account responses.
export function parseDynamicCgMetadata(source: string, characters: any[]) {
  const section = /^(==+)\s*Animated Scenes\s*\1\s*$/im.exec(source);
  if (!section) throw new Error('动态 CG 资料中没有动画角色列表。');
  const body = source.slice(section.index + section[0].length).split(/^==[^=]/m)[0];
  const names = [...new Set([...body.matchAll(/\{\{\s*WaifuList\s*\|\s*Waifus\s*=([^}|]*)/gi)]
    .flatMap(match => match[1].split(',').map(name => name.trim()).filter(Boolean)))];
  if (!names.length || names.length > 1000) throw new Error('动态 CG 角色列表无效。');
  const ids = new Set<string>(), unresolved: string[] = [];
  for (const name of names) {
    const matches = characters.filter(character => character.name === name || character.nameAliases?.includes(name));
    if (matches.length === 1 && /^1\d{5}$/.test(matches[0].id)) ids.add(matches[0].id);
    else unresolved.push(name);
  }
  // A partial name mapping must not silently replace a complete local list.
  if (unresolved.length) throw new Error('动态 CG 角色尚未匹配到目录：' + unresolved.join('、'));
  return [...ids].sort();
}
export function readDynamicCgMetadata(root: string) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, FILE), 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.characters) || data.characters.length > 1000
      || data.characters.some(id => typeof id !== 'string' || !/^1\d{5}$/.test(id))) return null;
    return data;
  } catch { return null; }
}
export async function ensureDynamicCgMetadata(root: string, { refresh = false, fetchResource = fetchPublicResource, metadata = readCharacterMetadata(root) }: any = {}) {
  const cached = readDynamicCgMetadata(root); if (cached && !refresh) return cached;
  if (!metadata?.characters?.length) throw new Error('请先更新花骑士角色目录。');
  const response = await fetchResource(DYNAMIC_CG_SOURCE, { signal: AbortSignal.timeout(30000) });
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('动态 CG 资料 HTTP ' + response.status); }
  const chunks: Uint8Array[] = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length; if (length > 1024 * 1024) throw new Error('动态 CG 资料超出大小限制。'); chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const revision: any = Object.values<any>(data.query?.pages || {})[0]?.revisions?.[0];
  const source = revision?.slots?.main?.['*'] || revision?.slots?.main?.content || revision?.['*'];
  if (typeof source !== 'string') throw new Error('动态 CG 资料格式无效。');
  const result = { version: 1, source: DYNAMIC_CG_SOURCE, signature: sha256(Buffer.from(source)),
    characters: parseDynamicCgMetadata(source, metadata.characters) };
  writeAtomicFileSync(path.join(root, FILE), JSON.stringify(result)); return result;
}
