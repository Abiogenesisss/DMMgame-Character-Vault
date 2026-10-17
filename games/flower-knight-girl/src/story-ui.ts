import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { downloadUrls } from '../../../app/download.ts';
import { loadPack, routeKey, sha256 } from '../../../app/pack.ts';
import { writeAtomicFileSync, renameFileSync } from '../../../app/atomic-file.ts';
import { fetchPublicResource } from '../../../app/public-fetch.ts';
import { BASE, decode } from './format.ts';

export const DIRECTORY = 'story-ui/flower-knight-girl';
export const THEME_FILE = DIRECTORY + '/theme.json';
export const LAYOUT_URL = BASE + 'layout/data/pc/layout.json.gz';
export const VIEWS = {
  menu: 'event_script', message: 'event_script_message_window',
  log: 'event_script_log_window', settings: 'dialog_option_config'
};
const MANIFEST = 'metadata/story-ui.json';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const parse = (bytes: Buffer) => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const textureId = (name: unknown) => typeof name === 'string' && /^[a-f0-9]{32}(?:\.png)?$/.test(name) ? name.replace(/\.png$/, '') : null;
const finite = (value: unknown, fallback = 0) => value == null ? fallback : Number.isFinite(value) && Math.abs(Number(value)) <= 4096 ? Number(value) : NaN;

// The game supplies its layout and art at installation time. Only the parser
// and control bindings belong to the distributable module.
export function parseLayouts(bytes: Buffer) {
  const layouts = parse(decode(bytes)), views: Record<string, any[]> = {};
  for (const [view, name] of Object.entries(VIEWS)) {
    const rows = Object.values<any>(layouts[name] || {});
    if (!rows.length || rows.length > 64) throw new Error('花骑士剧情界面布局不完整。');
    views[view] = rows.map((row, index) => {
      const result: any = { name: typeof row.name === 'string' ? row.name : 'decoration-' + index,
        x: finite(row.x), y: finite(row.y), w: finite(row.w), h: finite(row.h),
        kind: row.class === 'button' ? 'button' : row.class === 'textBox' ? 'text' : 'image' };
      if (![result.x, result.y, result.w, result.h].every(Number.isFinite) || result.w <= 0 || result.h <= 0) throw new Error('花骑士界面尺寸无效。');
      for (const key of ['texture', 'textureon']) if (row[key]) {
        result[key] = textureId(row[key]); if (!result[key]) throw new Error('花骑士界面纹理引用无效。');
      }
      if (result.kind === 'text') { result.size = finite(row.fontsize, 16); result.color = finite(row.fontcolor, 0); }
      if (row.visible === false) result.hidden = true;
      return result;
    });
  }
  const frame = views.menu.find(row => row.name === 'sideBarBackGround');
  const viewport = views.menu.find(row => row.name === 'showLayer');
  if (!frame || !viewport || viewport.x < 0 || viewport.y < 0 || viewport.x + viewport.w > frame.w || viewport.y + viewport.h > frame.h) throw new Error('花骑士剧情画面尺寸无效。');
  return { version: 1, width: frame.w, height: frame.h, viewport, views, sprites: {} };
}

export function atlasImageUrl(name: string, atlas: any) {
  const image = atlas?.meta?.image;
  // Resolve only the matching atlas image on the game's public CDN.
  if (typeof image !== 'string' || !new RegExp('^' + name + '\\.png(?:\\?[a-zA-Z0-9=_-]+)?$').test(image)) throw new Error('花骑士界面图集地址无效。');
  return BASE + 'layout/texture/pc/' + image;
}
function safeFile(file: unknown): file is string {
  return typeof file === 'string' && file.startsWith(DIRECTORY + '/') && !file.includes('\\')
    && !file.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'));
}
function uiFiles(output: string) {
  const files = new Set<string>(), realOutput = fs.realpathSync(output);
  const add = (file: unknown) => {
    if (!safeFile(file)) throw new Error('花骑士界面文件路径无效。');
    const target = path.join(output, file), stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > 16 * 1024 * 1024
      || !fs.realpathSync(target).startsWith(realOutput + path.sep) || files.size >= 128) throw new Error('花骑士界面文件不完整。');
    files.add(file); return target;
  };
  const theme = parse(fs.readFileSync(add(THEME_FILE)));
  if (theme.version !== 1 || !theme.viewport || !theme.sprites || !(theme.width > 0) || !(theme.height > 0)) throw new Error('花骑士界面配置无效。');
  for (const name of Object.keys(VIEWS)) {
    const rows = theme.views?.[name]; if (!Array.isArray(rows) || !rows.length || rows.length > 64) throw new Error('花骑士界面布局缺失。');
    for (const row of rows) for (const key of ['texture', 'textureon']) if (row[key]) {
      const target = add(theme.sprites[row[key]]);
      if (!fs.readFileSync(target).subarray(0, 8).equals(PNG)) throw new Error('花骑士界面图片无效。');
    }
  }
  for (const [view, names] of Object.entries({ menu: ['sideBarBackGround', 'showLayer', 'auto', 'autoSkip', 'log', 'option', 'hide', 'fullSkip', 'windowPosition'],
    message: ['windowGround', 'windowGroundBlack', 'windowGroundWhite', 'windowFrame', 'name', 'message'],
    log: ['messageLayer', 'circleClose'], settings: ['title', 'closeButton', 'circleCloseButton'] })) {
    if (names.some(name => !theme.views[view].some(row => row.name === name))) throw new Error('花骑士剧情界面控件缺失。');
  }
  return [...files].sort();
}
function saveInstallation(root: string, files: string[]) {
  writeAtomicFileSync(path.join(root, MANIFEST), JSON.stringify({ version: 1, file: THEME_FILE,
    files: files.map(file => { const bytes = fs.readFileSync(path.join(root, 'library', file)); return { file, bytes: bytes.length, sha256: sha256(bytes) }; }) }));
}
export function readStoryUi(root: string) {
  try {
    const output = path.join(root, 'library'), files = uiFiles(output), manifestFile = path.join(root, MANIFEST);
    if (!fs.existsSync(manifestFile)) saveInstallation(root, files);
    const manifest = parse(fs.readFileSync(manifestFile));
    if (manifest.version !== 1 || manifest.file !== THEME_FILE || manifest.files?.length !== files.length) return null;
    const expected = new Map<string, any>(manifest.files.map(item => [item.file, item]));
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(output, file)), item = expected.get(file);
      if (item?.bytes !== bytes.length || item?.sha256 !== sha256(bytes)) return null;
    }
    return { file: THEME_FILE, files, source: 'local-cache' };
  } catch { return null; }
}
export function publishStoryUi(root: string, ui = readStoryUi(root)) {
  const file = path.join(root, 'library/index.json');
  if (fs.existsSync(file)) {
    const index = parse(fs.readFileSync(file)); index.storyUi = ui;
    writeAtomicFileSync(file, JSON.stringify(index));
  }
}
export async function ensureStoryUi(root: string, { fetchResource = fetchPublicResource, onProgress = () => {} }: any = {}) {
  const installed = readStoryUi(root); if (installed) return installed;
  const atlasUrls = Object.values(VIEWS).map(name => BASE + 'layout/texture/pc/' + name + '.json');
  const progress = { checked: 0, saved: 0, skipped: 0, bytes: 0 }, total = 1 + atlasUrls.length * 2;
  const download = async (urls: string[], validate) => {
    const result = await downloadUrls(root, urls.map(url => ({ url })), { fetchResource, validate,
      maxBytes: 16 * 1024 * 1024, concurrency: 2, timeoutMs: 30000,
      onProgress: state => onProgress({ phase: 'ui', targets: total, checked: progress.checked + state.done,
        saved: progress.saved + state.saved, skipped: progress.skipped + state.skipped, bytes: progress.bytes + state.bytes }) });
    if (result.failed) throw new Error('花骑士播放器 UI 下载未完成：' + result.errors[0]?.error);
    progress.checked += result.done; progress.saved += result.saved; progress.skipped += result.skipped; progress.bytes += result.bytes;
  };
  await download([LAYOUT_URL, ...atlasUrls], (bytes, entry) => {
    if (entry.url === LAYOUT_URL) parseLayouts(bytes);
    else {
      const atlas = parse(bytes), name = entry.url.split('/').at(-1).replace('.json', '');
      atlasImageUrl(name, atlas);
      if (!atlas.frames || !Object.keys(atlas.frames).length || Object.keys(atlas.frames).length > 128) throw new Error('花骑士界面图集无效。');
    }
  });
  const cached = (url: string) => {
    const pack = loadPack(path.join(root, 'cache')), record = pack.manifest.routes[routeKey('GET', url)]?.at(-1);
    if (!record || !/^[a-f0-9]{64}$/.test(record.body)) throw new Error('花骑士界面原件缓存缺失。');
    return fs.readFileSync(path.join(pack.root, 'bodies', record.body));
  };
  const atlases = Object.fromEntries(Object.entries(VIEWS).map(([view, name]) => [view, parse(cached(BASE + 'layout/texture/pc/' + name + '.json'))]));
  const imageUrls = Object.entries(VIEWS).map(([view, name]) => atlasImageUrl(name, atlases[view]));
  await download(imageUrls, bytes => { if (!bytes.subarray(0, 8).equals(PNG)) throw new Error('花骑士界面图片响应无效。'); });
  const parent = path.resolve(root, 'state'); fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, '.flower-ui-' + randomUUID()); fs.mkdirSync(staging);
  try {
    const theme = parseLayouts(cached(LAYOUT_URL)), destination = path.join(staging, DIRECTORY, 'sprites'); fs.mkdirSync(destination, { recursive: true });
    for (const [view, name] of Object.entries(VIEWS)) {
      const atlas = atlases[view], bytes = cached(atlasImageUrl(name, atlas)), metadata = await sharp(bytes, { limitInputPixels: 4096 ** 2 }).metadata();
      for (const row of theme.views[view]) for (const key of ['texture', 'textureon']) if (row[key] && !theme.sprites[row[key]]) {
        const id = row[key], frame = (atlas.frames[id] || atlas.frames[id + '.png'])?.frame;
        if (!frame || ![frame.x, frame.y, frame.w, frame.h].every(Number.isSafeInteger) || frame.x < 0 || frame.y < 0 || frame.w <= 0 || frame.h <= 0
          || frame.x + frame.w > metadata.width || frame.y + frame.h > metadata.height) throw new Error('花骑士界面图集裁剪范围无效。');
        await sharp(bytes).extract({ left: frame.x, top: frame.y, width: frame.w, height: frame.h }).png().toFile(path.join(destination, id + '.png'));
        theme.sprites[id] = DIRECTORY + '/sprites/' + id + '.png';
      }
    }
    fs.writeFileSync(path.join(staging, THEME_FILE), JSON.stringify(theme));
    const files = uiFiles(staging);
    for (const file of files) {
      const target = path.join(root, 'library', file); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(staging, file), target + '.tmp'); renameFileSync(target + '.tmp', target);
    }
    saveInstallation(root, files);
    const result = readStoryUi(root); if (!result) throw new Error('花骑士播放器 UI 缓存校验失败。');
    return result;
  } finally {
    if (path.dirname(staging) === parent && path.basename(staging).startsWith('.flower-ui-') && fs.realpathSync(staging) === staging) fs.rmSync(staging, { recursive: true, force: true });
  }
}
