import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../../app/pack.ts';
import { Resources, readJson, writeJson } from './resources.ts';
import { runUnity } from './unity.ts';

export const UI_ASSET = 'Assets/AssetBundles/Adventure/Prefab/TitleBand/TitleBand.prefab';
export const UI_ASSETS = [UI_ASSET, 'Assets/Sprites/Common/Button/btn_common.png'];
const themeFile = 'story-ui/theme.json';
const localFile = file => typeof file === 'string' && /^story-ui\/(?:theme\.json|[a-f0-9]{64}\.png)$/.test(file);
export function readStoryUi(root: string) {
  try {
    const meta = readJson(path.join(root, 'metadata/story-ui.json'));
    if (meta?.version !== 3 || meta.file !== themeFile || !Array.isArray(meta.files) || meta.files.length > 64 || !meta.files.some(f => f.file === themeFile)) return null;
    for (const item of meta.files) {
      if (!localFile(item.file)) return null;
      const bytes = fs.readFileSync(path.join(root, 'library', item.file));
      if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) return null;
    }
    const theme = readJson(path.join(root, 'library', themeFile));
    if (theme.version !== 3 || !theme.sprites?.message || !theme.sprites?.modal || !theme.sprites?.choice || Object.values<any>(theme.sprites).some(s => !meta.files.some(f => f.file === s.file))) return null;
    return { file: themeFile };
  } catch { return null; }
}
export async function ensureStoryUi(root: string, catalog: any, resources = new Resources(root), exportUi = runUnity) {
  const previous = readStoryUi(root); if (previous) return previous;
  const assets = UI_ASSETS.map(id => catalog.assets[id]); if (assets.some(a => !a)) throw new Error('目录缺少原版界面资源，请刷新角色目录。');
  const files = []; for (const name of new Set<string>(assets.flatMap(a => a.bundles))) files.push(await resources.get(name)); resources.save();
  const result = await exportUi({ command: 'ui', files, output: path.join(root, 'library') });
  if (result.file !== themeFile || !Array.isArray(result.files) || result.files.some(f => !localFile(f)) || !result.files.includes(themeFile)) throw new Error('原版界面导出结果无效。');
  writeJson(path.join(root, 'metadata/story-ui.json'), { version: 3, file: result.file, files: result.files.map(file => {
    const bytes = fs.readFileSync(path.join(root, 'library', file)); return { file, bytes: bytes.length, sha256: sha256(bytes) };
  }) });
  const installed = readStoryUi(root); if (!installed) throw new Error('原版界面导出不完整。'); return installed;
}
