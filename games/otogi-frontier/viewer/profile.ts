'use strict';
const content=require('./character-content.ts');
export ={...{
  "label": "童话边境",
  "title": "OTOGI FRONTIER",
  "favoriteKey": "otogi-favorites-v1",
  "description": "选择角色，鉴赏立绘、CG 与语音。",
  "roleDescription": "立绘、CG 与语音鉴赏",
  "voiceDescription": "CG 配套语音，可逐段播放。",
  "note": "进化形态归在同一角色中。点 ☆ 可加入收藏。",
  "glyph": "♧",
  "discoveryHint": "留空更新公开角色表；也可填写编号或范围，例如 23911, 23921-24001。本体编号范围按 10 递增，每次最多 500 个编号。",
  "features": {
    "presentation": true,
    "sections": true,
    "voices": true,
    "stories": false,
    "motions": true,
    "dynamicCg": false,
    "rarity": true,
    "artists": false,
    "discovery": true
  },
  "rarities": [
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
    },
    {
      "id": 1,
      "label": "★1"
    }
  ],
  "scopes": {
    "all": {
      "label": "角色资源"
    },
    "portraits": {
      "label": "立绘"
    },
    "cg": {
      "label": "CG"
    },
    "voices": {
      "label": "配套语音"
    }
  }
},...content,rarities:require('../src/rarity.ts').RARITIES};
