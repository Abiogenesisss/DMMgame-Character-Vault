'use strict';
const content=require('./character-content.ts');
export ={...{
  "label": "千年战争",
  "title": "MILLENNIUM WAR AIGIS",
  "favoriteKey": "aigis-favorites-v1",
  "description": "选择角色，鉴赏立绘与 CG。",
  "roleDescription": "立绘与 CG 鉴赏",
  "note": "基础与觉醒立绘归在同一角色中。点 ☆ 可加入收藏。",
  "glyph": "◇",
  "catalogHarImport": true,
  "selectCatalogHar": require('../src/catalog-har.ts').selectCatalogHar,
  "discoveryHint": "请自行在浏览器网络面板禁用缓存，重新进入千年战争，再导出包含响应内容的 HAR。这里仅离线解析包内的角色清单和名称表，无需逐个打开角色。",
  "features": {
    "presentation": true,
    "sections": false,
    "voices": false,
    "stories": false,
    "motions": false,
    "rarity": true,
    "artists": true,
    "discovery": true
  },
  "rarities": [
    {
      "id": 5,
      "label": "黑"
    },
    {
      "id": 4,
      "label": "白金"
    },
    {
      "id": 7,
      "label": "蓝宝石"
    },
    {
      "id": 3,
      "label": "金"
    },
    {
      "id": 2,
      "label": "银"
    },
    {
      "id": 1,
      "label": "铜"
    },
    {
      "id": 0,
      "label": "铁"
    }
  ],
  "scopes": {
    "all": {
      "label": "立绘和 CG"
    },
    "portraits": {
      "label": "立绘"
    },
    "cg": {
      "label": "CG"
    }
  }
},...content,readRoute:(hash,library)=>({...content.readRoute(hash,library),section:'presentation'}),routeHash:(tab,id,section='presentation')=>'#'+tab+(id?'/'+id+'/'+section:''),roleContent:(library,character)=>({portraits:(character.portraits||[]).filter(item=>item.file&&require('../src/portraits.ts').isGamePortrait(item)),cg:(character.cg||[]).filter(item=>item.file),stories:[],voices:[],motions:[]}),rarities:require('../src/rarity.ts').RARITIES};
