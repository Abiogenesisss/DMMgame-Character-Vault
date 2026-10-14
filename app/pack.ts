import { writeAtomicFileSync } from './atomic-file.ts';
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizedUrl(input) {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP(S) URLs are replayable');
  if (url.username || url.password) throw new Error('URLs containing credentials are not supported');
  url.hash = '';
  return url.href;
}

function routeKey(method, url, body = Buffer.alloc(0), range = '') {
  return JSON.stringify([method.toUpperCase(), normalizedUrl(url), sha256(body), range]);
}

function safeLabel(input) {
  try {
    const url = new URL(input);
    return url.origin + url.pathname;
  } catch {
    return '(invalid URL)';
  }
}

function emptyManifest(sourceUrl = null) {
  return { version: 1, sourceUrl, routes: {}, documents: [], issues: [],
    skippedLogin: 0, websocketCount: 0, stats: { recordedRequests: 0 } };
}

function updateStats(manifest) {
  const routes = Object.values<any>(manifest.routes);
  const bodies = new Map(routes.flat().map(record => [record.body, record.size]));
  manifest.stats = { ...manifest.stats, replayableRoutes: routes.length,
    uniqueBodies: bodies.size, savedBytes: [...bodies.values()].reduce((sum, size) => sum + size, 0),
    documents: manifest.documents.length, incompleteOrUnsupported: manifest.issues.length,
    changingRoutes: routes.filter(variants => variants.length > 1).length };
  return manifest;
}

function saveManifest(directory, manifest) {
  fs.mkdirSync(directory, { recursive: true });
  updateStats(manifest);
  const file = path.join(directory, 'manifest.json');
  writeAtomicFileSync(file, JSON.stringify(manifest));
  return manifest;
}

function loadPack(directory) {
  const root = path.resolve(directory);
  // Download originals are disposable; reading a cleared cache recreates it.
  if (!fs.existsSync(path.join(root, 'manifest.json'))) {
    fs.mkdirSync(path.join(root, 'bodies'), { recursive: true });
    saveManifest(root, emptyManifest());
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !manifest.routes || !Array.isArray(manifest.documents)) {
    throw new Error('Unsupported or incomplete pack manifest');
  }
  return { root, manifest };
}

function rangeSlice(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (start >= size || end < start || start < 0) return null;
  return { start, end };
}

export { sha256, normalizedUrl, routeKey, safeLabel, loadPack, emptyManifest, updateStats, saveManifest, rangeSlice };
