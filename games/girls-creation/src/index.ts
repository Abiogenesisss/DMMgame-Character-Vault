'use strict';
const path=require('node:path');
const createService=options=>require('./service.ts').createCatalogService({...options,validId:require('./format.ts').validId,readCatalog:require('./catalog.ts').readCatalog,collectionScope:require('./collect.ts').collectionScope,collect:require('./collect.ts').collect,statusName:'girlscreation'});
async function extract(root,progress){await require('./catalog.ts').prepareCatalog(root);const index=await require('./extract.ts').extract(root,progress);return {state:'ready',stats:index.stats};}
export ={webRoot:path.join(__dirname,'../../../app/viewer'),extract,createService,createDiscoveryService:createService};
