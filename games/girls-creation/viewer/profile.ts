'use strict';
const content=require('./character-content.ts');
export ={...{
  "requireCgAvailability": true,
  "label": "少女艺术绮谭",
  "title": "GIRLS CREATION R",
  "favoriteKey": "girlscreation-favorites-v1",
  "storyPositionPrefix": "girlscreation-position-",
  "description": "选择角色，鉴赏已保存的立绘、插画与剧情。",
  "emptyCatalogMessage": "首次使用请点击“拉取新角色”，在线获取角色目录。",
  "discoveryHint": "留空刷新游戏目录；也可填写七位角色编号确认收录情况，例如 4011601。角色名称以已导入的主数据为准。",
  "roleDescription": "角色立绘、插画与已保存剧情",
  "note": "类型 1 为艺术家，类型 2 为艺术品拟人；每张角色卡均可独立筛选、收藏和下载。",
  "glyph": "✧",
  "features": {
    "presentation": true,
    "sections": true,
    "voices": true,
    "stories": true,
    "motions": true,
    "dynamicCg": false,
    "rarity": true,
    "artists": false,
    "discovery": true
  },
  "missingStoryMessage": "此角色暂无已保存的剧情脚本。",
  "rarities": [{"id":5,"label":"★5"},{"id":4,"label":"★4"},{"id":3,"label":"★3"}],
  "scopes": {
    "story-ui": {"label":"播放器界面", "cachedLabel":"检查播放器界面"},
    "all": {
      "label": "角色资源"
    },
    "portraits": {
      "label": "立绘与插画"
    },
    "cg": {
      "label": "视频 CG"
    },
    "voices": {
      "label": "角色语音"
    },
    "stories": {
      "label": "剧情脚本与配音"
    }
  }
},...content};
