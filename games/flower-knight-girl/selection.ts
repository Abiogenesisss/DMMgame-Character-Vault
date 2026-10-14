'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { baseId } = require('./character-identity.ts');
const { COLLECTION_SCOPES, collectionScope } = require('./collection-scope.ts');
function readScopes(root, catalog) {
  if (!catalog) {
    const file = path.join(root, 'metadata/catalog.json');
    if (fs.existsSync(file)) catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const file = path.join(root, 'state/flower-selected.json');
  if (!fs.existsSync(file)) return new Map();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const scopes = new Map();
  for (const id of data.characters.filter(id => typeof id === 'string' && /^1\d{5}$/.test(id))) {
    const canonical = baseId(id, catalog), requested = data.scopes?.[id] ?? data.scopes?.[canonical];
    // Legacy selections authorized all resources. New category selections are
    // retained across extraction so indexing-only scripts stay out of stories.
    const values = requested === undefined ? ['all'] : Array.isArray(requested) ? requested.filter(value => Object.hasOwn(COLLECTION_SCOPES, value)) : [];
    if (!scopes.has(canonical)) scopes.set(canonical, new Set<string>());
    values.forEach(value => scopes.get(canonical).add(value));
  }
  return scopes;
}
function readSelection(root, catalog) { return new Set(readScopes(root, catalog).keys()); }
function selectRoles(root, roles, catalog, scope = 'all') {
  scope = collectionScope({ scope });
  if (!catalog) {
    const file = path.join(root, 'metadata/catalog.json');
    if (fs.existsSync(file)) catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const scopes = readScopes(root, catalog);
  roles.forEach(id => {
    const canonical = baseId(id, catalog); if (!canonical) return;
    if (!scopes.has(canonical)) scopes.set(canonical, new Set<string>());
    scopes.get(canonical).add(scope);
  });
  const file = path.join(root, 'state/flower-selected.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ version: 2, characters: [...scopes.keys()], scopes: Object.fromEntries([...scopes].map(([id, values]) => [id, values.has('all') ? ['all'] : [...values]])), updated: new Date().toISOString() }));
  fs.renameSync(file + '.tmp', file);
}
export { readSelection, readScopes, selectRoles };
