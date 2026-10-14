'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadPack, emptyManifest, saveManifest, safeLabel } = require('./pack.ts');
const lock = require('./download-lock.ts');

const DEFAULT_DATA = path.resolve(__dirname, '../parsed-data');
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function projectPath(id, dataRoot = DEFAULT_DATA) {
  if (!PROJECT_ID.test(id) || RESERVED.test(id)) throw Object.assign(new Error('项目标识只能使用小写字母、数字、短横线和下划线。'), { status: 400 });
  const root = path.resolve(dataRoot, id);
  if (fs.existsSync(root) && path.relative(root, fs.realpathSync(root))) throw Object.assign(new Error('项目目录不能是符号链接。'), { status: 400 });
  return root;
}

function readProject(id, dataRoot = DEFAULT_DATA) {
  const root = projectPath(id, dataRoot);
  const file = path.join(root, 'project.json');
  if (!fs.existsSync(file)) throw Object.assign(new Error('项目不存在。'), { status: 404 });
  return { ...JSON.parse(fs.readFileSync(file, 'utf8')), id, root };
}

function createProject({ id, name }, dataRoot = DEFAULT_DATA) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw Object.assign(new Error('请输入不超过 100 字的项目名称。'), { status: 400 });
  const root = projectPath(id, dataRoot);
  fs.mkdirSync(dataRoot, { recursive: true });
  try { fs.mkdirSync(root); }
  catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error('项目标识已存在，请换一个。'), { status: 409 }); throw error; }
  const project = { version: 1, id, name: name.trim(), createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify(project, null, 2));
  fs.mkdirSync(path.join(root, 'cache/bodies'), { recursive: true });
  saveManifest(path.join(root, 'cache'), emptyManifest());
  return { ...project, root };
}

function listProjects(dataRoot = DEFAULT_DATA) {
  if (!fs.existsSync(dataRoot)) return [];
  return fs.readdirSync(dataRoot, { withFileTypes: true }).filter(item => item.isDirectory()
    && PROJECT_ID.test(item.name) && fs.existsSync(path.join(dataRoot, item.name, 'project.json')))
    .map(item => readProject(item.name, dataRoot)).map(({ root, ...project }) => project)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function acquirePackLock(root) {
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  const file = path.join(root, 'state/pack.lock');
  const token = lock.acquire(file);
  if (!token) throw Object.assign(new Error('此项目正在导入、下载或解包，请等当前任务完成。'), { status: 409 });
  return () => lock.release(file, token);
}

async function withPackLock(root, work) {
  const release = acquirePackLock(root);
  try { return await work(); }
  finally { release(); }
}

function categoryOf(record) {
  const mime = (record.mimeType || '').split(';')[0].toLowerCase();
  const pathname = new URL(record.url).pathname.toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(pathname)) return 'image';
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/.test(pathname)) return 'audio';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov)$/.test(pathname)) return 'video';
  if (/\.(bytes|bundle|unity3d|data|wasm)(\.gz)?$/.test(pathname)) return 'bundle';
  if (/json|text|javascript|xml/.test(mime) || /\.(json|txt|js|html|css|atlas)$/.test(pathname)) return 'text';
  return 'other';
}

function listResources(root, { query = '', category = '', offset = 0, limit = 60 }: any = {}) {
  const { manifest, root: packRoot } = loadPack(path.join(root, 'cache'));
  const unique = new Map();
  for (const variants of Object.values<any>(manifest.routes)) {
    const record = variants.at(-1);
    if (record.method !== 'GET' || record.status < 200 || record.status >= 300 || !record.size || unique.has(record.body)) continue;
    const url = new URL(record.url);
    let name; try { name = decodeURIComponent(url.pathname.split('/').at(-1)) || url.hostname; } catch { name = url.pathname.split('/').at(-1); }
    unique.set(record.body, { body: record.body, name, host: url.hostname, url: safeLabel(record.url),
      size: record.size, mimeType: record.mimeType, category: categoryOf(record), partial: record.status === 206 });
  }
  const resources = [...unique.values()];
  const counts = Object.fromEntries(['image', 'audio', 'video', 'bundle', 'text', 'other'].map(type => [type, 0]));
  let bytes = 0;
  for (const resource of resources) { counts[resource.category]++; bytes += resource.size; }
  const search = String(query).toLowerCase();
  const matches = resources.filter(item => (!category || item.category === category)
    && (!search || [item.name, item.url, item.body].some(value => value.toLowerCase().includes(search))));
  offset = Math.max(0, Number(offset) || 0); limit = Math.max(1, Math.min(200, Number(limit) || 60));
  return { total: matches.length, offset, limit, summary: { total: resources.length, bytes, counts,
    issues: manifest.issues.length, entryUrl: manifest.entryUrl || null },
    resources: matches.slice(offset, offset + limit).map(item => ({ ...item,
      saved: /^[a-f0-9]{64}$/.test(item.body) && fs.existsSync(path.join(packRoot, 'bodies', item.body)) })) };
}

export { DEFAULT_DATA, projectPath, readProject, createProject, listProjects, acquirePackLock, withPackLock, categoryOf, listResources };
