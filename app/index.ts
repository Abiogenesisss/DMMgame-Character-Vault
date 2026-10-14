import fs from 'node:fs';
import path from 'node:path';
import type { GameInfo, GameAdapter } from './module.ts';
const DEFAULT_GAMES = path.resolve(__dirname, '../games');
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function createRegistry(gamesRoot = DEFAULT_GAMES) {
  const loaded = new Map<string, GameInfo & { adapter: GameAdapter }>();
  function forget(id: string) {
    const previous = loaded.get(id);
    if (previous) for (const file of Object.keys(require.cache)) if (file.startsWith(previous.root + path.sep)) delete require.cache[file];
    loaded.delete(id);
  }
  function list(): GameInfo[] {
    const entries: GameInfo[] = [];
    for (const folder of fs.existsSync(gamesRoot) ? fs.readdirSync(gamesRoot, { withFileTypes: true }) : []) {
      if (!folder.isDirectory() || !ID.test(folder.name)) continue;
      const root = path.resolve(gamesRoot, folder.name), manifest = path.join(root, 'game.json');
      try {
        const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (data.id !== folder.name || typeof data.name !== 'string' || typeof data.label !== 'string' || !fs.existsSync(path.join(root, 'src/index.ts'))) continue;
        const files = ['game.json', 'src/index.ts', 'dist/module.js'].map(file => { try { const stat = fs.statSync(path.join(root, file)); return stat.mtimeMs + ':' + stat.size; } catch { return 'missing'; } });
        entries.push({ id: data.id, name: data.name, label: data.label, root, revision: files.join('-'), stylesheet: fs.existsSync(path.join(root, 'viewer/styles.css')) });
      } catch { /* Incomplete directories do not disable other installed games. */ }
    }
    const present = new Set(entries.map(entry => entry.id));
    for (const id of loaded.keys()) if (!present.has(id)) forget(id);
    return entries.sort((a,b) => a.id.localeCompare(b.id));
  }
  function get(id: string) {
    const entry = list().find(entry => entry.id === id); if (!entry) return null;
    if (loaded.get(id)?.revision !== entry.revision) {
      forget(id);
      const adapter: GameAdapter = require(path.join(entry.root, 'src/index.ts'));
      if (typeof adapter.createService !== 'function') throw new Error('游戏服务入口无效：' + id);
      loaded.set(id, { ...entry, adapter });
    }
    return { ...entry, adapter: loaded.get(id).adapter };
  }
  return { list, get };
}
const registry = createRegistry();
const getAdapter = (id: string) => registry.get(id)?.adapter || null;
export { DEFAULT_GAMES, createRegistry, getAdapter };
