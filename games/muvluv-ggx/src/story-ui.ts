import { renameFileSync } from '../../../app/atomic-file.ts';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { downloadUrls } from '../../../app/download.ts';
import { fetchPublicResource } from '../../../app/public-fetch.ts';
import { loadPack, routeKey, sha256 } from '../../../app/pack.ts';
import { readCatalog, readJson, writeJson } from './catalog.ts';
import { resourceKind } from './format.ts';
import { runUnity } from './unity.ts';

export const DIRECTORY = 'story-ui/muvluv';
export const WINDOW_FILE = DIRECTORY + '/native/window.json';
export const UI_ADDRESSES = ['GameUi/Scenario', 'GameUi/SystemSettingWindow', 'GameUi/TextModalWindow'];
const MANIFEST = 'metadata/story-ui.json';

function uiFiles(output: string) {
  const base = fs.realpathSync(output), files = new Set<string>();
  const add = (file: unknown) => {
    if (typeof file !== 'string' || !file.startsWith(DIRECTORY + '/') || file.includes('\\')
      || file.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error('Muv-Luv 界面文件路径无效。');
    const target = path.join(output, file), stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > 32 * 1024 * 1024
      || !fs.realpathSync(target).startsWith(base + path.sep) || files.size >= 512) throw new Error('Muv-Luv 界面文件不完整。');
    files.add(file); return target;
  };
  const native = JSON.parse(fs.readFileSync(add(WINDOW_FILE), 'utf8'));
  if (native.version !== 1 || native.game !== 'muvluv-ggx'
    || ['menu', 'options', 'confirm', 'logRow'].some(name => !Array.isArray(native.views?.[name]) || !native.views[name].length)
    || !native.fonts || !Object.keys(native.fonts).length) throw new Error('Muv-Luv 界面布局不完整。');
  for (const rows of Object.values<any>(native.views)) for (const row of rows) if (row.image) add(row.image.file);
  for (const file of Object.values(native.fonts)) {
    const font = JSON.parse(fs.readFileSync(add(file), 'utf8'));
    // Muv-Luv's Japanese font spans multiple atlas pages. Every page is needed.
    if (!Array.isArray(font.pages) || !font.pages.length || font.pages.length > 16) throw new Error('Muv-Luv 字体图集不完整。');
    for (const page of font.pages) { add(page.fill); add(page.outline); }
    if (font.fill) add(font.fill);
    if (font.outline) add(font.outline);
  }
  return [...files].sort();
}
function saveInstallation(root: string, files: string[], origin: string) {
  const manifest = { version: 1, file: WINDOW_FILE, origin, files: files.map(file => {
    const bytes = fs.readFileSync(path.join(root, 'library', file)); return { file, bytes: bytes.length, sha256: sha256(bytes) };
  }) };
  writeJson(path.join(root, MANIFEST), manifest); return manifest;
}
export function readStoryUi(root: string) {
  try {
    const output = path.join(root, 'library'), files = uiFiles(output), manifestFile = path.join(root, MANIFEST);
    let manifest;
    if (!fs.existsSync(manifestFile)) manifest = saveInstallation(root, files, 'existing-local');
    else {
      manifest = readJson(manifestFile, null);
      if (manifest?.version !== 1 || manifest.file !== WINDOW_FILE || !Array.isArray(manifest.files) || manifest.files.length !== files.length) return null;
      const records = new Map(manifest.files.map(item => [item.file, item]));
      for (const file of files) {
        const item: any = records.get(file), bytes = fs.readFileSync(path.join(output, file));
        if (!item || item.bytes !== bytes.length || item.sha256 !== sha256(bytes)) return null;
      }
    }
    return { file: WINDOW_FILE, files, source: 'local-cache', origin: manifest.origin, exportVersion: 2 };
  } catch { return null; }
}

export async function ensureStoryUi(root: string, { fetchResource = fetchPublicResource, onProgress = () => {},
  exportUi = request => runUnity(request, { worker: path.join(__dirname, '../python/export_story_ui.py') }) }: any = {}) {
  const installed = readStoryUi(root); if (installed) return installed;
  const catalog = readCatalog(root), assets = UI_ADDRESSES.map(address => catalog.assets[address]);
  if (assets.some(item => !item || !Array.isArray(item.bundles) || !item.bundles.length)) throw new Error('Muv-Luv 资源目录缺少播放器界面。');
  const urls = [...new Set<string>(assets.flatMap(item => item.bundles))];
  if (urls.some(url => resourceKind(url) !== 'bundle')) throw new Error('Muv-Luv 界面资源地址无效。');
  const result = await downloadUrls(root, urls.map(url => ({ url })), { fetchResource, concurrency: 2, maxBytes: 80 * 1024 * 1024,
    validate: bytes => { if (bytes.length < 48 || bytes.subarray(0, 8).toString('ascii') !== 'UnityFS\0') throw new Error('Muv-Luv 界面素材包响应无效。'); },
    onProgress: state => onProgress({ phase: 'ui', targets: state.total, checked: state.done, saved: state.saved, skipped: state.skipped, bytes: state.bytes }) });
  if (result.failed) throw new Error('Muv-Luv 界面下载未完成：' + result.errors[0]?.error);
  const pack = loadPack(path.join(root, 'cache'));
  const input = (url: string) => {
    const record = pack.manifest.routes[routeKey('GET', url)]?.at(-1);
    if (!record || !/^[a-f0-9]{64}$/.test(record.body)) throw new Error('Muv-Luv 界面原件缓存缺失。');
    return path.join(pack.root, 'bodies', record.body);
  };
  const parent = path.resolve(root, 'state'); fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, '.ui-build-' + randomUUID()); fs.mkdirSync(staging);
  try {
    const output = path.join(staging, 'library'); fs.mkdirSync(output);
    onProgress({ phase: 'ui', targets: urls.length, checked: urls.length, saved: result.saved, skipped: result.skipped });
    await exportUi({ output, assets: assets.map(item => ({ ...item, inputs: item.bundles.map(input) })) });
    const files = uiFiles(output);
    // Publish only a complete export and write its integrity manifest last.
    for (const file of files) {
      const target = path.join(root, 'library', file); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(output, file), target + '.tmp'); renameFileSync(target + '.tmp', target);
    }
    saveInstallation(root, files, 'game-server');
    const installed = readStoryUi(root); if (!installed) throw new Error('Muv-Luv 界面缓存校验失败，请重试。');
    return installed;
  } finally {
    if (path.dirname(staging) === parent && path.basename(staging).startsWith('.ui-build-') && fs.realpathSync(staging) === staging) fs.rmSync(staging, { recursive: true, force: true });
  }
}
