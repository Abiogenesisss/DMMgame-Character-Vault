import { renameFileSync } from '../../../app/atomic-file.ts';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { downloadUrls } from '../../../app/download.ts';
import { loadPack, routeKey, sha256 } from '../../../app/pack.ts';
import { fetchPublicResource } from '../../../app/public-fetch.ts';
import { readCatalog, readJson, writeJson } from './catalog.ts';
import { ORIGIN, resourceKind } from './format.ts';
import { CLIENT_URL, unpackClient } from './public-version.ts';
import { UI_SCENE } from './story-program.ts';
import { runUnity } from './unity.ts';

export const DIRECTORY = 'story-ui/dotabyss';
export const THEME_FILE = DIRECTORY + '/theme.json';
const MANIFEST = 'metadata/story-ui.json';
const PREFABS = ['Popup_NovelLog', 'Popup_NovelOption', 'Popup_NovelSkip', 'CharaBalloon', 'UserBalloon', 'NarrationBalloon'];
export const WEB_IMAGES = [
  { file: 'web-background.png', url: ORIGIN + '/resources/web/img/background/img_1.png' },
  { file: 'fullscreen.png', url: ORIGIN + '/img/loading/fullscreen-button.png' }
];

function safeFile(file: unknown): file is string {
  return typeof file === 'string' && file.startsWith(DIRECTORY + '/') && !file.includes('\\')
    && !file.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'));
}
// Follow the theme's dependencies, including font atlas pages. Older releases
// with a complete local UI are adopted without contacting the game server.
function uiFiles(output: string) {
  const realOutput = fs.realpathSync(output);
  const files = new Set<string>();
  const add = (file: unknown) => {
    if (!safeFile(file)) throw new Error('剧情界面文件路径无效。');
    const target = path.join(output, file), stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > 32 * 1024 * 1024) throw new Error('剧情界面文件不完整。');
    if (!fs.realpathSync(target).startsWith(realOutput + path.sep) || files.size >= 512) throw new Error('剧情界面文件路径或数量无效。');
    files.add(file); return target;
  };
  const theme = JSON.parse(fs.readFileSync(add(THEME_FILE), 'utf8'));
  if (theme.version !== 1 || !theme.native) throw new Error('剧情界面配置无效。');
  for (const part of ['normal', 'adult', 'marker']) add(theme[part]?.file);
  add(theme.webBackground); add(theme.fullscreen);
  for (const part of ['name', 'body']) if (theme[part]?.font) add(theme[part].font);
  const native = JSON.parse(fs.readFileSync(add(theme.native), 'utf8'));
  if (native.version !== 1 || !native.views?.menu?.length || !native.views?.message?.length || !native.views?.options?.length
    || !native.fonts || !Object.keys(native.fonts).length || !native.click?.layers?.length) throw new Error('剧情界面布局不完整。');
  for (const rows of Object.values<any>(native.views)) for (const row of rows) if (row.image) add(row.image.file);
  for (const layer of native.click.layers) add(layer.file);
  for (const file of Object.values(native.fonts)) {
    const font = JSON.parse(fs.readFileSync(add(file), 'utf8')); add(font.fill); add(font.outline);
  }
  return [...files].sort();
}
function saveInstallation(root: string, files: string[], origin: string) {
  const manifest = { version: 1, file: THEME_FILE, origin, files: files.map(file => {
    const bytes = fs.readFileSync(path.join(root, 'library', file)); return { file, bytes: bytes.length, sha256: sha256(bytes) };
  }) };
  writeJson(path.join(root, MANIFEST), manifest); return manifest;
}
export function readStoryUi(root: string) {
  try {
    const output = path.join(root, 'library'), manifestFile = path.join(root, MANIFEST), files = uiFiles(output);
    let manifest;
    if (!fs.existsSync(manifestFile)) manifest = saveInstallation(root, files, 'existing-local');
    else {
      manifest = readJson(manifestFile, null);
      if (manifest?.version !== 1 || manifest.file !== THEME_FILE || !Array.isArray(manifest.files) || manifest.files.length !== files.length) return null;
      const expected = new Map(manifest.files.map(item => [item.file, item]));
      for (const file of files) {
        const item: any = expected.get(file), bytes = fs.readFileSync(path.join(output, file));
        if (!item || item.bytes !== bytes.length || item.sha256 !== sha256(bytes)) return null;
      }
    }
    return { file: THEME_FILE, files, exportVersion: 6, source: 'local-cache', origin: manifest.origin };
  } catch { return null; }
}

export async function ensureStoryUi(root: string, { fetchResource = fetchPublicResource, onProgress = () => {},
  exportUi = request => runUnity(request, { worker: path.join(__dirname, '../python/export_window_ui.py') }),
  decodeClient = unpackClient }: any = {}) {
  const installed = readStoryUi(root);
  if (installed) return installed;
  const catalog = readCatalog(root), scene = catalog.assets[UI_SCENE];
  const prefabs = PREFABS.map(name => catalog.assets['Assets/Project/LazyAssets/General/UI/SceneUI/NovelUI/Prefabs/' + name + '.prefab']);
  if (!scene || prefabs.some(value => !value)) throw new Error('资源目录缺少剧情界面，请先拉取新角色更新目录。');
  const urls = [...new Set<string>([scene, ...prefabs].flatMap(value => value.bundles))];
  if (!urls.length || urls.some(url => resourceKind(url) !== 'bundle')) throw new Error('剧情界面资源地址无效。');
  const targets = [...urls.map(url => ({ url })), { url: CLIENT_URL }, ...WEB_IMAGES.map(({ url }) => ({ url }))];
  const result = await downloadUrls(root, targets, { fetchResource, maxBytes: 180 * 1024 * 1024, concurrency: 2,
    validate: (bytes, entry) => {
      if (entry.url === CLIENT_URL) decodeClient(bytes);
      else if (WEB_IMAGES.some(item => item.url === entry.url)) {
        if (bytes.length > 8 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('界面图片响应无效。');
      } else if (bytes.length < 48 || bytes.subarray(0, 8).toString('ascii') !== 'UnityFS\0') throw new Error('界面素材包响应无效。');
    }, onProgress: state => onProgress({ phase: 'ui', targets: state.total, checked: state.done, saved: state.saved, skipped: state.skipped, bytes: state.bytes }) });
  if (result.failed) throw new Error('剧情界面下载未完成：' + result.errors[0]?.error);
  const pack = loadPack(path.join(root, 'cache'));
  const body = (url: string) => {
    const record = pack.manifest.routes[routeKey('GET', url)]?.at(-1);
    if (!record || !/^[a-f0-9]{64}$/.test(record.body)) throw new Error('剧情界面缓存缺失。');
    return path.join(pack.root, 'bodies', record.body);
  };
  const parent = path.resolve(root, 'state'); fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, '.ui-build-' + randomUUID()); fs.mkdirSync(staging);
  try {
    const player = path.join(staging, 'data.unity3d');
    fs.writeFileSync(player, decodeClient(fs.readFileSync(body(CLIENT_URL))).player);
    const output = path.join(staging, 'library'); fs.mkdirSync(output);
    onProgress({ phase: 'ui', targets: targets.length, checked: targets.length, saved: result.saved, skipped: result.skipped });
    await exportUi({ output, player, scene: scene.bundles.map(body), prefabs: prefabs.map(item => ({ ...item, inputs: item.bundles.map(body) })) });
    for (const item of WEB_IMAGES) fs.copyFileSync(body(item.url), path.join(output, DIRECTORY, item.file));
    const theme = readJson(path.join(output, THEME_FILE), {});
    Object.assign(theme, { native: DIRECTORY + '/native/window.json', webBackground: DIRECTORY + '/web-background.png', fullscreen: DIRECTORY + '/fullscreen.png' });
    writeJson(path.join(output, THEME_FILE), theme);
    const files = uiFiles(output);
    // Publish only a complete export. The manifest is committed last.
    for (const file of files) {
      const target = path.join(root, 'library', file); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(output, file), target + '.tmp'); renameFileSync(target + '.tmp', target);
    }
    saveInstallation(root, files, 'game-server');
    const installed = readStoryUi(root);
    if (!installed) throw new Error('剧情界面缓存校验失败，请重试。');
    return installed;
  } finally {
    if (path.dirname(staging) === parent && path.basename(staging).startsWith('.ui-build-') && fs.realpathSync(staging) === staging) fs.rmSync(staging, { recursive: true, force: true });
  }
}
