'use strict';
const path = require('node:path');
module.exports.root = process.env.RESOURCE_PROJECT_DIR || path.resolve(__dirname, '../../parsed-data/flower-knight-girl');
