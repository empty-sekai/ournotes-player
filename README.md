# ournotes-player

[简体中文](README.md) | [English](README.en.md)

ournotes-player 是 BanG Dream! Our Notes 谱面的浏览器播放器。它用 WebGL2 和 WebAudio 在网页中重现游戏的 Live 画面，以自动演奏播放一张谱面，可以作为自定义元素 `<ournotes-player>`、JavaScript 模块或 iframe 嵌入其他网页。

本项目为非官方爱好者项目，与游戏的开发、发行和运营方无关。仓库与 npm 包不包含任何游戏资源：播放器读取按[数据格式](docs/data-format.md)准备的谱面数据，数据由使用者自行提供；[nnnotes](https://github.com/MetaSekaiLab/nnnotes) 工具包可以从使用者自己的游戏文件生成这种数据。BanG Dream! 及相关名称与商标归各自权利人所有。

## 重现内容

- 3D 轨道与舞台（游戏的 LightWeight 背景模式），音符、长按线、引导线与同时按连线；
- 击打特效与粒子；
- 判定与连击（combo）界面；
- 游戏自身的着色器：从数据中读取 Unity 编译的 GLSL ES 3.00 程序，在 WebGL2 中运行，包括 URP 后处理；
- BGM 与音符音效，谱面时钟跟随音频时钟。

播放方式与游戏的自动演奏一致：全部判定为 Perfect，使用默认设置，按 60 fps 模拟，计算采用 float32。哪些部分与游戏逐帧一致、哪些是播放器自己的功能，见 [docs/fidelity.md](docs/fidelity.md)。

## 观看控制

控制栏提供播放 / 暂停、进度与跳转、速度（0.5–1.5 倍）、音乐开关、音效开关；播放时自动隐藏，移动指针、轻触或按键时显示。播放器获得焦点时的键盘操作：Space 或 K 播放 / 暂停，← / → 后退 / 前进 5 秒，↑ / ↓ 调整速度，M 音乐，S 音效。

跳转时播放器从谱面开始（或当前位置）逐帧重新模拟到目标时间，判定、连击、音符与界面状态与不间断播放到该时间时相同。

## 快速开始

```sh
npm install github:empty-sekai/ournotes-player
```

从 GitHub 安装时会在安装过程中构建 `dist/`。包发布到 npm 之后，也可以用 `npm install ournotes-player` 安装同一个包。

自定义元素（打包工具）：

```js
import "ournotes-player/element";
```

```html
<ournotes-player src="https://example.org/site/charts/100001_expert.json" controls></ournotes-player>
```

不使用打包工具时，可以直接从 CDN 加载（包发布到 npm 之后可用；在此之前，可随页面一起提供已安装包中的 `dist/` 文件）：

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player/dist/ournotes-player.element.min.js"></script>
```

JavaScript 模块：

```js
import { ChartPlayer } from "ournotes-player";

const player = await ChartPlayer.create(document.getElementById("stage"), {
  src: "https://example.org/site/charts/100001_expert.json",
});
button.onclick = () => player.play();   // 浏览器要求在用户操作中开始播放音频
```

iframe：[examples/iframe.html](examples/iframe.html) 是一个只含一个播放器的页面，可以用 `<iframe>` 嵌入。

谱面列表：[examples/chart-list](examples/chart-list) 列出站点的 `charts.json` 并播放所选谱面；服务多个区服或多种语言的站点可用 `?region=&lang=` 切换。

- 接口：[docs/api.md](docs/api.md)
- 嵌入方式与数据托管：[docs/embedding.md](docs/embedding.md)
- 数据格式：[docs/data-format.md](docs/data-format.md)
- 性能：[docs/performance.md](docs/performance.md)

## Live2D 模型

同一个包还包含 Live2D 模型查看器 `ournotes-player/live2d`（自定义元素 `<ournotes-live2d>`）：按游戏剧情画面的方式显示一个角色（待机动作、自动眨眼、呼吸、物理），并可播放动作、切换表情，绘制使用数据中游戏自身的 Live2D 着色器。它需要 Live2D Cubism Core for Web（Live2D 的 `live2dcubismcore.min.js`，适用 Live2D Inc. 的许可），由页面自行加载；本仓库、npm 包与打包文件均不包含它。见 [docs/live2d.md](docs/live2d.md)。

## 浏览器支持

需要 WebGL2 与 WebAudio（自定义元素另需 Custom Elements 与 ResizeObserver），并能用 `decodeAudioData` 解码 FLAC 与 AAC（MP4）。目前在 Chromium 内核浏览器中测试。

## 开发

需要 Node.js 20 或更高版本。

```sh
npm ci
npm test                  # 单元测试（node --test，仅使用合成输入）
npm run build             # 构建 dist/ 下的浏览器包
npm run typecheck         # 检查 types/ 下的类型声明
npm run validate-data -- <站点目录> [谱面 id ...]              # 按数据格式校验一个站点
OURNOTES_DATA=<站点目录> npm run test:data                     # 可选：用真实谱面数据在 Node 中运行播放器
```

提交约定、测试与数据政策见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

仓库采用 AGPL-3.0-only（见 [LICENSE](LICENSE)）。`dist/` 下通过 npm 分发的浏览器包另附 [LICENSE-EXCEPTION](LICENSE-EXCEPTION) 中的浏览器嵌入例外：在终端用户浏览器中原样加载该浏览器包、并与自己的前端代码链接时，前端代码不因此受 AGPL 约束。修改播放器、在服务端或其他非浏览器环境中使用仍受完整 AGPL 约束，包括网络交互场景下的源代码提供义务。
