'use strict';
const fs = require('node:fs'), path = require('node:path');
const { createRegistry, DEFAULT_GAMES } = require('../app/index.ts');
function buildViewer({ gamesRoot = DEFAULT_GAMES, shell = true, ids }: any = {}) {
  const esbuild = require('esbuild'), options = { bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', minify: true, legalComments: 'eof' };
  if (shell) esbuild.buildSync({ ...options, entryPoints: [path.resolve(__dirname, '../app/viewer/app-source.ts')], outfile: path.resolve(__dirname, '../app/viewer/app.js') });
  const games = createRegistry(gamesRoot).list().filter(game => !ids || ids.includes(game.id));
  for (const game of games) {
    const entry = path.join(game.root, 'viewer/entry.ts');
    if (!fs.existsSync(entry)) throw new Error('游戏缺少前端入口：' + game.id);
    esbuild.buildSync({ ...options, entryPoints: [entry], outfile: path.join(game.root, 'dist/module.js') });
  }
  return games.map(game => game.id);
}
if (require.main === module) console.log('Built shell and installed games: ' + buildViewer().join(', '));
export { buildViewer };
