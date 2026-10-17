const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const { downloadUrls } = require('../../../app/download.ts');
const { loadPack, routeKey } = require('../../../app/pack.ts');
const { writeAtomicFileSync } = require('../../../app/atomic-file.ts');
const { readJson, writeJson } = require('./catalog.ts');
const { hash, validVersion, VERSION_URL } = require('./format.ts');
const { decodeUuid, unpackAsset } = require('./cocos.ts');
const CLIENT = 'https://minasigo-no-shigoto-pd-r-client.orphans-order.com';
const DIRECTORY = 'story-ui/minashigo', THEME_FILE = DIRECTORY + '/theme.json';
const PREFABS = { normal: 'NormalAdvSubRoot', adult: 'AdultAdvSubRoot', settings: 'AdvConfigPopup', log: 'AdvLogPopup', skip: 'AdvSkipConfirmPopup' };
const localFile = file => typeof file === 'string' && new RegExp('^' + DIRECTORY + '/(?:theme\\.json|[a-f0-9]{64}\\.(?:png|ttf))$').test(file);
function readStoryUi(root) {
  try {
    const meta = readJson(path.join(root, 'metadata/story-ui.json'));
    if (meta?.version !== 1 || meta.file !== THEME_FILE || !Array.isArray(meta.files) || !meta.files.length || meta.files.length > 128) return null;
    for (const record of meta.files) {
      if (!localFile(record.file)) return null;
      const file = path.join(root, 'library', record.file), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024 || stat.size !== record.bytes || hash(fs.readFileSync(file)) !== record.sha256) return null;
    }
    const theme = readJson(path.join(root, 'library', THEME_FILE)), files = new Set(meta.files.map(record => record.file));
    if (theme?.version !== 1 || theme.layoutVersion !== 2 || theme.width !== 1280 || theme.height !== 720 || !files.has(THEME_FILE) || !files.has(theme.font?.file)) return null;
    for (const name of Object.keys(PREFABS)) if (!theme.views?.[name]?.rows?.length) return null;
    for (const view of Object.values<any>(theme.views)) for (const row of view.rows) if (row.sprite && !files.has(row.sprite.file)) return null;
    return { file: THEME_FILE, files: [...files], source: 'local-cache', clientVersion: theme.clientVersion };
  } catch { return null; }
}
function nodeRect(node, world) {
  const size = node._contentSize || {}, anchor = node._anchorPoint || { x: .5, y: .5 };
  return { x: world.x - (size.width || 0) * (anchor.x ?? .5) * world.sx,
    y: -world.y - (size.height || 0) * (1 - (anchor.y ?? .5)) * world.sy,
    w: (size.width || 0) * world.sx, h: (size.height || 0) * world.sy };
}
const rgba = value => { const n = value?.rgba ?? 0xffffffff; return '#' + [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24].map(n => n.toString(16).padStart(2, '0')).join(''); };
function layoutPrefab(prefab) {
  if (prefab?.__type__ !== 'cc.Prefab' || !prefab.data) throw new Error('播放器界面预制体无效。');
  const root = prefab.data, nodes = new Map<any, any>(), paths = new Map<any, string>(), rows = [], width = root._contentSize?.width, height = root._contentSize?.height;
  if (!(width > 0 && width <= 1280 && height > 0 && height <= 720)) throw new Error('播放器界面画布无效。');
  function walk(node, parent, prefix, active) {
    if (nodes.has(node) || nodes.size > 1200) throw new Error('播放器界面节点无效。');
    const t = node._trs || [0, 0, 0, 0, 0, 0, 1, 1, 1, 1];
    const world = { x: parent.x + t[0] * parent.sx, y: parent.y + t[1] * parent.sy, sx: parent.sx * t[7], sy: parent.sy * t[8] };
    if (Object.values(world).some(n => !Number.isFinite(n))) throw new Error('播放器界面坐标无效。');
    const id = prefix ? prefix + '/' + node._name : '', rect = nodeRect(node, world), enabled = active && node._active !== false && node._opacity !== 0 && !['FadeNode', 'SlideNode'].includes(node._name);
    rect.x += width / 2; rect.y += height / 2; nodes.set(node, { ...rect, world, enabled }); paths.set(node, id);
    const sprite = node._components?.find(c => c.__type__ === 'cc.Sprite' && c._spriteFrame && c._enabled !== false);
    const label = node._components?.find(c => c.__type__ === 'cc.Label' || c._N$fontSize != null);
    const button = node._components?.some(c => c.__type__ === '20561+aA/xGYavW8kgVKrc2');
    if ((sprite || label) && enabled) rows.push({ id, ...rect, world: undefined, enabled: undefined,
      ...(sprite ? { frame: sprite._spriteFrame.__uuid__, sliced: sprite._type === 1 } : {}),
      ...(label ? { text: label._string ?? label._N$string ?? '', fontSize: (label._fontSize || label._N$fontSize || 20) * world.sx,
        lineHeight: (label._lineHeight || label._N$lineHeight || 30) * world.sy, color: rgba(node._color), align: label._N$horizontalAlign === 1 ? 'center' : 'left' } : {}) });
    if (button) rows.push({ id: id + '@button', ...rect, world: undefined, enabled: undefined, button: true });
    for (const child of node._children || []) walk(child, world, id || node._name, enabled);
  }
  // UI node positions are centered in the prefab's own canvas.
  walk(root, { x: 0, y: 0, sx: 1, sy: 1 }, '', true);
  const rect = node => { const value = nodes.get(node); if (!value) throw new Error('播放器界面控件缺失。'); const { world, enabled, ...r } = value; return r; };
  const component = root._components?.find(c => c.messageView || c.soundSettingView || c.advLogMessageThumbnailPrefab || c.windowNode);
  const fields: any = {}, controls: any = {};
  if (component?.messageView) {
    const message = component.messageView;
    for (const [key, label] of [['name', message.nameText], ['body', message.messageText]] as any[]) fields[key] = {
      ...rect(label.node), fontSize: label._N$fontSize, lineHeight: label._N$lineHeight, color: rgba(label.node._color), align: 'left'
    };
    for (const key of ['auto', 'fastForward', 'skip', 'log', 'hideUi', 'config']) {
      const node = component[key + 'Btn']?.node; controls[key] = { ...rect(node), path: paths.get(node) };
    }
    controls.next = { ...rect(component.clickWaitCursorNode), path: paths.get(component.clickWaitCursorNode) };
    // The adult rich text is inactive in the asset and enabled by the game on
    // first dialogue; its design size is still the authoritative placement.
    fields.name.y -= Math.max(0, (fields.name.lineHeight - fields.name.h) / 2);
  }
  if (component?.soundSettingView) for (const key of ['bgm', 'voice', 'se']) fields[key] = { ...rect(component.soundSettingView[key + 'Slider'].node), path: paths.get(component.soundSettingView[key + 'Slider'].node) };
  for (const [node, id] of paths) if (/\/(DecisionButton|CancelButton|CloseButton)$/.test(id)) controls[id.split('/').at(-1)] = { ...rect(node), path: id };
  return { width, height, rows, fields, controls };
}
async function cropFrame(bytes, frame) {
  const [x, y, w, h] = frame.rect || [], meta = await sharp(bytes, { limitInputPixels: 4096 ** 2 }).metadata();
  const rw = frame.rotated ? h : w, rh = frame.rotated ? w : h;
  if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + rw > meta.width || y + rh > meta.height) throw new Error('播放器图集裁切范围无效。');
  let output = sharp(bytes).extract({ left: x, top: y, width: rw, height: rh }); if (frame.rotated) output = output.rotate(270);
  return output.png().toBuffer();
}
async function ensureStoryUi(root, { fetchResource = require('../../../app/public-fetch.ts').fetchPublicResource, onProgress = () => {} }: any = {}) {
  const installed = readStoryUi(root); if (installed) return installed;
  let checked = 0;
  const sources = new Map<string, Promise<Buffer>>();
  const get = url => {
    if (!sources.has(url)) sources.set(url, (async () => {
      const result = await downloadUrls(root, [{ url }], { fetchResource, timeoutMs: 60000, maxBytes: 32 * 1024 * 1024 });
      if (result.failed) throw new Error('原版播放器界面下载未完成。');
      const pack = loadPack(path.join(root, 'cache')), record = pack.manifest.routes[routeKey('GET', url)]?.at(-1);
      if (!record || !/^[a-f0-9]{64}$/.test(record.body)) throw new Error('播放器界面缓存缺失。');
      const bytes = fs.readFileSync(path.join(pack.root, 'bodies', record.body)); if (hash(bytes) !== record.body) throw new Error('播放器界面缓存损坏。');
      checked++; onProgress({ phase: 'ui', checked, targets: 0 }); return bytes;
    })()); return sources.get(url);
  };
  let version = readJson(path.join(root, 'metadata/source.json'), {}).clientVersion;
  if (!validVersion(version)) version = JSON.parse((await get(VERSION_URL)).toString('utf8')).version?.clientVersion;
  if (!validVersion(version)) throw new Error('播放器客户端版本无效。');
  const base = CLIENT + '/client/' + version + '/assets/resources/';
  const config = JSON.parse((await get(base + 'config.json')).toString('utf8'));
  if (!Array.isArray(config.uuids) || config.uuids.length > 100000 || !config.paths || !config.packs) throw new Error('播放器资源目录无效。');
  const indices = new Map<string, number>(config.uuids.flatMap((value, i) => { try { return [[decodeUuid(value), i]]; } catch { return []; } }));
  const imports = new Map<string, Promise<any>>();
  const load = uuid => {
    if (!imports.has(uuid)) imports.set(uuid, (async () => {
      decodeUuid(uuid); const id = indices.get(uuid), pack = Object.entries<any>(config.packs).find(([, ids]) => ids.includes(id)), file = pack?.[0] || uuid;
      if (!/^(?:[a-f0-9]{8,16}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(file)) throw new Error('播放器资源包编号无效。');
      return unpackAsset(JSON.parse((await get(base + 'import/' + file.slice(0, 2) + '/' + file + '.json')).toString('utf8')), pack ? pack[1].indexOf(id) : 0);
    })()); return imports.get(uuid);
  };
  const views: any = {}, sprites = new Map<string, any>(), files = new Map<string, Buffer>(); let fontUuid;
  for (const [name, prefab] of Object.entries(PREFABS)) {
    const record = Object.entries<any>(config.paths).find(([, row]) => row[0] === 'prefab/adv/window/' + prefab && config.types[row[1]] === 'cc.Prefab');
    if (!record) throw new Error('缺少官方播放器界面：' + prefab);
    const value = await load(decodeUuid(config.uuids[record[0]]));
    if (!fontUuid) { const visit = node => { for (const c of node._components || []) fontUuid ||= (c._N$font || c._N$file)?.__uuid__; for (const child of node._children || []) visit(child); }; visit(value.data); }
    views[name] = layoutPrefab(value);
    for (const row of views[name].rows) if (row.frame) {
      if (!sprites.has(row.frame)) {
        const frame = await load(row.frame), texture = decodeUuid(frame._textureSetter?.__uuid__), bytes = await cropFrame(await get(base + 'native/' + texture.slice(0, 2) + '/' + texture + '.png'), frame);
        const file = DIRECTORY + '/' + hash(bytes) + '.png'; files.set(file, bytes);
        sprites.set(row.frame, { file, width: frame.rect[2], height: frame.rect[3], insets: frame.capInsets || [0, 0, 0, 0] });
      }
      row.sprite = sprites.get(row.frame); delete row.frame;
    }
  }
  const font = await load(fontUuid);
  if (font.__type__ !== 'cc.TTFFont' || !/^[A-Za-z0-9_.-]+\.ttf$/.test(font._native)) throw new Error('播放器字体无效。');
  const fontBytes = await get(base + 'native/' + fontUuid.slice(0, 2) + '/' + fontUuid + '/' + font._native);
  if (!['00010000', '4f54544f', '74727565'].includes(fontBytes.subarray(0, 4).toString('hex'))) throw new Error('播放器字体格式无效。');
  const fontFile = DIRECTORY + '/' + hash(fontBytes) + '.ttf'; files.set(fontFile, fontBytes);
  const theme = { version: 1, layoutVersion: 2, clientVersion: version, width: 1280, height: 720, font: { file: fontFile, name: font._name }, views };
  files.set(THEME_FILE, Buffer.from(JSON.stringify(theme)));
  for (const [file, bytes] of files) writeAtomicFileSync(path.join(root, 'library', file), bytes);
  writeJson(path.join(root, 'metadata/story-ui.json'), { version: 1, file: THEME_FILE, files: [...files].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: hash(bytes) })) });
  const result = readStoryUi(root); if (!result) throw new Error('播放器界面缓存校验失败。');
  onProgress({ phase: 'ui', checked, targets: checked }); return result;
}
export { CLIENT, DIRECTORY, THEME_FILE, PREFABS, ensureStoryUi, readStoryUi, layoutPrefab, cropFrame };
