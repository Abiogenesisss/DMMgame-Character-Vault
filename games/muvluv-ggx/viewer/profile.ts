'use strict';
const content=require('./character-content.ts');
export ={...{
  "label": "Muv-Luv",
  "title": "MUV-LUV GIRLS GARDEN X",
  "favoriteKey": "muvluv-favorites-v1",
  "storyPositionPrefix": "muvluv-position-",
  "description": "选择角色，鉴赏立绘、CG、语音与剧情。",
  "roleDescription": "立绘、CG、角色语音与剧情鉴赏",
  "note": "不同角色卡独立收藏。点 ☆ 可加入收藏。",
  "glyph": "✦",
  "features": {
    "presentation": true,
    "sections": true,
    "voices": true,
    "stories": true,
    "motions": true,
    "dynamicCg": true,
    "rarity": true,
    "artists": false,
    "discovery": false
  },
  "rarities": [
    {
      "id": 5,
      "label": "★5"
    },
    {
      "id": 3,
      "label": "★3"
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
      "label": "CG",
      "savedFrom": ["cg", "motions"]
    },
    "motions": {
      "label": "动态 CG"
    },
    "voices": {
      "label": "角色语音"
    },
    "stories": {
      "label": "完整 CG 剧情"
    },
    "ui": {
      "label": "播放器 UI",
      "cachedLabel": "检查播放器 UI"
    }
  }
},...content};
