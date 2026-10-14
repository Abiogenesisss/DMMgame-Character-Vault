'use strict';
const content=require('./character-content.ts');
export ={...{
  "label": "花骑士",
  "title": "FLOWER KNIGHT GIRL",
  "favoriteKey": "flower-favorites-v1",
  "description": "选择角色，鉴赏立绘、语音与剧情。",
  "roleDescription": "立绘、角色语音与剧情鉴赏",
  "note": "进化与开花形态归在同一角色中。点 ☆ 可加入收藏。",
  "glyph": "✿",
  "discoveryHint": "留空更新角色清单；也可填写六位角色编号或范围，例如 150001, 150003-150021。每次最多 500 个编号。",
  "features": {
    "presentation": true,
    "sections": true,
    "voices": true,
    "stories": true,
    "motions": true,
    "dynamicCg": true,
    "rarity": true,
    "artists": false,
    "discovery": true
  },
  "rarities": [
    {
      "id": 6,
      "label": "★6"
    },
    {
      "id": 5,
      "label": "★5"
    },
    {
      "id": 4,
      "label": "★4"
    },
    {
      "id": 3,
      "label": "★3"
    },
    {
      "id": 2,
      "label": "★2"
    }
  ],
  "scopes": {
    "all": {
      "label": "角色全部资源",
      "phase": "scripts"
    },
    "portraits": {
      "label": "立绘",
      "phase": "portraits"
    },
    "cg": {
      "label": "CG",
      "phase": "indexing"
    },
    "motions": {
      "label": "动态 CG",
      "phase": "indexing"
    },
    "stories": {
      "label": "剧情",
      "phase": "scripts"
    },
    "voices": {
      "label": "角色语音",
      "phase": "voices"
    }
  },
  "CATALOG_PAGES": [
    "characters",
    "favorites"
  ],
  "CHARACTER_SECTIONS": [
    "presentation",
    "stories",
    "voices"
  ]
},...content,rarities:require('../character-types.ts').RARITIES,scopes:require('../collection-scope.ts').COLLECTION_SCOPES};
