import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { GameInfo } from './module.ts';

interface Seed { version: 1; game: string; files: Record<string, unknown> }

/** Restore missing metadata only. Existing downloads and catalogs always win. */
export function initializeGameData(game: GameInfo, root: string): void {
  const seedFile = path.join(game.root, 'seed/catalog.json.gz');
  if (!fs.existsSync(seedFile)) return;
  const index = path.join(root, 'library/index.json');
  if (fs.existsSync(index) && fs.existsSync(path.join(root, 'metadata/catalog.json'))) return;
  const seed: Seed = JSON.parse(gunzipSync(fs.readFileSync(seedFile), { maxOutputLength: 128 * 1024 ** 2 }).toString('utf8'));
  if (seed.version !== 1 || seed.game !== game.id || !seed.files) throw new Error('游戏初始目录无效。');
  for (const [relative, data] of Object.entries(seed.files)) {
    if (!/^(?:metadata\/[a-z0-9-]+\.json|library\/index\.json)$/.test(relative)) throw new Error('游戏初始目录包含无效路径。');
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try { fs.writeFileSync(target, JSON.stringify(data), { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const project = path.join(root, 'project.json');
  try { fs.writeFileSync(project, JSON.stringify({ version: 1, id: game.id, adapter: game.id, name: game.name }), { flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
