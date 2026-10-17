'use strict';
const content=require('./character-content.ts');
export ={...{
  "label": "Muv-Luv",
  "title": "MUV-LUV GIRLS GARDEN X",
  "favoriteKey": "muvluv-favorites-v1",
  "storyPositionPrefix": "muvluv-position-",
  "requiresCompleteStories": true,
  "hideRoleRarity": true,
  "description": "选择角色，鉴赏立绘、CG、语音与剧情。",
  "roleDescription": "立绘、CG、角色语音与剧情鉴赏",
  "note": "按人物浏览与收藏，进入角色页切换衣装和样式。",
  "discoveryLabel": "拉取新角色",
  "discoveryIds": false,
  "discoveryHint": "自动检查最新主数据和资源目录，补充角色与样式。首次更新会创建独立游客身份，之后自动续期，无需登录或导入 HAR。立绘与 CG 按需下载。",
  "glyph": "✦",
  "features": {
    "presentation": true,
    "sections": true,
    "voices": true,
    "stories": true,
    "motions": true,
    "dynamicCg": true,
    "dynamicFilter": false,
    "rarity": true,
    "artists": false,
    "discovery": true
  },
  "rarities": [
    {
      "id": 5,
      "label": "SSR"
    },
    {
      "id": 3,
      "label": "SR"
    },
    {
      "id": 1,
      "label": "R"
    }
  ],
  "scopes": {
    "catalog": { "label": "图鉴立绘" },
    "all": {
      "label": "当前样式全部资源"
    },
    "portraits": {
      "label": "当前样式立绘与卡面"
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
