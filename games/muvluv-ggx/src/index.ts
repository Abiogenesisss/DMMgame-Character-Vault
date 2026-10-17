'use strict';
const path = require('node:path');
const { validId } = require('./format.ts');
const { readCatalog } = require('./catalog.ts');
const { collectionScope, collect } = require('./collect.ts');
const { refreshCatalog } = require('./refresh-catalog.ts');
const createService = options => require('./service.ts').createCatalogService({ ...options, validId, readCatalog, collectionScope, collect, refreshCharacters: refreshCatalog, statusName: 'muvluv' });
async function runExtraction(root, progress) { await require('./catalog.ts').prepareCatalog(root); const index = await require('./extract.ts').extract(root, progress); return { state: 'ready', stats: index.stats }; }
export = { webRoot: path.join(__dirname, '../../../app/viewer'), extract: runExtraction, createService, createDiscoveryService: createService, refreshCharacters: refreshCatalog };
