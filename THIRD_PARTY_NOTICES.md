# 第三方许可与素材权利

根目录的 [MIT 许可证](LICENSE) 适用于本项目作者有权许可的原创代码和文档，不改变第三方代码或游戏资源的权利归属。修改、分发或商用时，请保留适用的版权和许可声明。

## 播放器运行库

- PixiJS、`pixi-live2d-display-advanced` 等依赖采用各自的许可；前端打包涉及的依赖声明保存在 [licenses/frontend-dependencies.txt](licenses/frontend-dependencies.txt)，构建产物也保留上游许可注释。
- Spine 运行库适用 **Spine Runtimes License Agreement**，并非本项目的 MIT 许可。相关许可原文随上述依赖声明提供；使用和再次分发须符合[上游条款](https://esotericsoftware.com/spine-runtimes-license)。
- `games/dotabyss/viewer/vendor/live2dcubismcore.min.js` 属于 Live2D Cubism Core，保留了原文件的版权与许可声明，来源和校验值记录在同目录的 `cubism-core-source.json`。它适用 [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)，不属于 MIT 授权范围。
- Live2D Framework 代码适用 [Live2D Open Software License Agreement](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)，涉及应用发布时还需遵守 Live2D 的相关条件。

`npm ci` 和各游戏 `requirements.txt` 安装的其他依赖，仍适用其软件包附带的许可证；本仓库不重新许可这些依赖。

少女艺术绮谭的离线视频转换通过 `imageio-ffmpeg`（BSD-2-Clause）调用本机 FFmpeg。该依赖的 Windows 二进制声明适用 GPL-3.0-or-later；二进制由 Python 依赖安装到本地环境，不随本仓库源码或发行包提供。重新分发此二进制时需遵守其附带许可和源代码提供要求。

## 游戏资料

游戏名称、商标、角色、美术、动画、剧情、语音、字体、界面、布局以及从游戏客户端或服务器提取的其他资料，权利均归原权利人。仓库中的 `seed/` 元数据以及用户后续下载的资源，不因工具代码开源而获得 MIT 授权。DOTABYSS、Muv-Luv 和少女艺术绮谭的游戏 UI、布局和字体由用户首次使用时下载到本地，不随源码分发。

公开源码不等于授予第三方游戏资源的使用或再分发权。使用者应自行取得所需授权，并遵守相应条款。
