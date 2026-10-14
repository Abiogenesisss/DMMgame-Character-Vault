'use strict';
const path=require('node:path');
const {createCatalogService}=require('./service.ts');
const createService=options=>createCatalogService({...options,validId:require('./format.ts').validId,readCatalog:require('./catalog.ts').readCatalog,
  collectionScope:require('./collect.ts').collectionScope,collect:require('./collect.ts').collect,statusName:'dotabyss'});
async function runExtraction(root,progress){await require('./catalog.ts').prepareCatalog(root);const index=await require('./extract.ts').extract(root,progress);return {state:'ready',stats:index.stats};}
const adapter ={webRoot:path.join(__dirname,'../../../../app/viewer'),extract:runExtraction,createService,refreshCharacters:require('./refresh-catalog.ts').refreshCatalog};

const createDiscoveryService =options=>require('./discovery.ts').createDiscoveryService({...options,refreshCharacters:adapter.refreshCharacters});

export = { ...adapter, createDiscoveryService };
