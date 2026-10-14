'use strict';
const content=require('./character-content.ts');
export ={...{
  "label": "DOTABYSS",
  "title": "DOTABYSS X",
  "favoriteKey": "dotabyss-favorites-v1",
  "storyPositionPrefix": "dotabyss-position-",
  "description": "选择角色，鉴赏立绘、动态 CG、语音与剧情。",
  "roleDescription": "立绘、动态 CG、角色语音与剧情鉴赏",
  "note": "皮肤归入本体；泳装等独立角色单列。疑似未实装角色标注“实装待确认”，搜索“未实装”可查找。点 ☆ 可加入收藏。",
  "glyph": "◈",
  "groupedCharacters": true,
  "features": {
    "presentation": true,
    "sections": true,
    "voices": true,
    "stories": true,
    "motions": true,
    "dynamicCg": true,
    "rarity": false,
    "artists": false,
    "discovery": true
  },
  "discoveryHint": "留空即可检查最新资源目录并补充新角色，无需再次抓包。也可填写九位角色 ID，补齐目录中对应的资料；皮肤会归入本体。",
  "missingStoryMessage": "此角色暂无已保存的 CG 剧情。",
  "rarities": [],
  "scopes": {
    "all": {
      "label": "本体资源"
    },
    "portraits": {
      "label": "本体立绘"
    },
    "cg": {
      "label": "CG"
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
