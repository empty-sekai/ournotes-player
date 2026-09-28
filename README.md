# ournotes-player

[简体中文](README.md) | [English](README.en.md)

ournotes-player 在网页中重现 BanG Dream! Our Notes 的三类画面：Live 谱面的自动演奏、剧情（ADV，包括据点对话与演出结束对话），以及 Live2D 角色。画面用游戏自身的着色器绘制：数据中由 Unity 编译的 GLSL ES 3.00 程序在 WebGL2 中运行。声音使用 WebAudio。三者都可以作为自定义元素、JavaScript 模块或 iframe 嵌入其他网页。

本项目为非官方爱好者项目，与游戏的开发、发行和运营方无关。仓库与 npm 包不包含任何游戏资源：播放器读取按数据格式（[Live 与 Live2D](docs/data-format.md)、[剧情](docs/story-data-format.md)）准备的数据，数据由使用者自行提供；[nnnotes](https://github.com/MetaSekaiLab/nnnotes) 工具包可以从使用者自己的游戏文件生成这种数据。BanG Dream! 及相关名称与商标归各自权利人所有。

## 组件

| | Live 谱面 | 剧情 | Live2D 模型 |
|---|---|---|---|
| 自定义元素 | `<ournotes-player>` | `<ournotes-story>` | `<ournotes-live2d>` |
| 模块 | `ournotes-player`、`ournotes-player/element` | `ournotes-player/story`、`ournotes-player/story/element` | `ournotes-player/live2d`、`ournotes-player/live2d/element` |
| 主要的类 | `ChartPlayer` | `StoryPlayer` | `ModelPlayer` |
| 浏览器包（`dist/`） | `ournotes-player.*` | `ournotes-player.story.*` | `ournotes-player.live2d.*` |
| 页面需自行加载 | — | Live2D Cubism Core；口型另需 MotionSync Core；据点对话另需 Spine 运行时 | Live2D Cubism Core |
| 文档 | [api.md](docs/api.md) | [story.md](docs/story.md) | [live2d.md](docs/live2d.md) |

模块 `…/element` 在导入时定义对应的自定义元素，并导出与不带 `/element` 的模块相同的接口。每个浏览器包有三种形式：ESM 接口、ESM 自定义元素，以及定义元素并提供全局对象的经典脚本（`OurnotesPlayer`、`OurnotesStory`、`OurnotesLive2D`）。每种形式都另有 `.min.js` 与 source map。Live 谱面的入口不包含剧情与 Live2D 的代码。

Live2D Cubism Core、MotionSync Core 与 Spine 运行时是各自权利人的软件，适用各自的许可；本仓库、npm 包与浏览器包均不包含它们，由页面在创建播放器之前加载。

## 快速开始

```sh
npm install ournotes-player
```

也可以从 GitHub 安装（`npm install github:empty-sekai/ournotes-player`），这时会在安装过程中构建 `dist/`。

Live 谱面（打包工具中用 `import "ournotes-player/element";`；不用打包工具时从 CDN 加载）：

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player@0.1/dist/ournotes-player.element.min.js"></script>
<ournotes-player src="https://example.org/site/charts/100001_expert.json" controls></ournotes-player>
```

剧情：

```html
<script src="live2dcubismcore.min.js"></script>
<script src="live2dcubismmotionsynccore.min.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player@0.1/dist/ournotes-player.story.element.min.js"></script>
<ournotes-story src="https://example.org/site/stories/10462.json" lang="ja"></ournotes-story>
```

Live2D 模型：

```html
<script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player@0.1/dist/ournotes-player.live2d.element.min.js"></script>
<ournotes-live2d src="https://example.org/site/models/adv_live2d_rana_003_casual_spring_01.json"
                 style="width: 360px"></ournotes-live2d>
```

JavaScript 模块：

```js
import { ChartPlayer } from "ournotes-player";

const player = await ChartPlayer.create(document.getElementById("stage"), {
  src: "https://example.org/site/charts/100001_expert.json",
});
button.onclick = () => player.play();   // 浏览器要求在用户操作中开始播放音频
```

示例页面（在仓库根目录用任意静态服务器打开）：

| 页面 | 内容 |
|---|---|
| [examples/basic.html](examples/basic.html) | 一个 `<ournotes-player>` |
| [examples/iframe.html](examples/iframe.html) | 只含一个播放器的页面，可用 `<iframe>` 嵌入（`?src=`） |
| [examples/chart-list](examples/chart-list) | 列出站点的 `charts.json` 并播放所选谱面；多区服或多语言的站点用 `?region=&lang=` 切换 |
| [examples/story-list](examples/story-list) | 列出站点的 `stories.json` 并播放所选剧情 |
| [examples/story](examples/story) | 播放一集剧情（`?story=` 或 `?src=`；Live2D 的两个文件用 `?core=`、`?motionsync=`，据点对话的 Spine 运行时用 `?spine=`） |
| [examples/live2d](examples/live2d) | 列出站点的 `models.json`，显示所选模型并播放其动作与表情 |

## Live 谱面

`<ournotes-player>` 以游戏的自动演奏播放一张谱面：

- 3D 轨道与舞台（游戏的 LightWeight 背景模式），音符、长按线、引导线与同时按连线；
- 击打特效与粒子；
- 判定与连击（combo）界面；
- URP 后处理；
- BGM 与音符音效，谱面时钟跟随音频时钟。

播放方式与游戏的自动演奏一致：全部判定为 Perfect，使用默认设置，按 60 fps 模拟，计算采用 float32。

控制栏提供以下控制：
- 播放 / 暂停、进度与跳转、播放速度（0.5–1.5 倍）；
- 音符速度：− / + 每次 0.1，按住 Shift 每次 1，也可以直接输入数值；
- 设置面板：游戏自己的 Live 设置（音符速度、判定与音符时机、轨道与界面显示、音量等），按游戏的分组排列，范围与默认值与游戏相同，只列出当前谱面数据支持的项目。

控制界面有简体中文、繁体中文、英语、日语、韩语五种语言，跟随页面语言；键盘操作见 [docs/api.md](docs/api.md)。

跳转时，播放器逐帧重新模拟到目标时间，判定、连击、音符与界面状态与不间断播放到该时间时相同。

哪些部分与游戏逐帧一致、哪些是播放器自己的功能，见 [docs/fidelity.md](docs/fidelity.md)。

## 剧情

`<ournotes-story>` 按游戏的剧情画面播放一集剧情，在游戏的播放循环上逐行执行命令：
- 舞台：背景、灯光与 volume；
- Live2D 角色：动作、表情、视线与口型；
- 镜头、对焦、模糊与后处理；
- 画框、静帧、粒子特效、闪光与聊天手机；
- 对话框：打字机效果、说话人、地点字幕与标题；
- 规则转场；
- 音乐、音效与语音。

游戏的 68 种剧情命令都有对应的处理。另外：

- **据点对话与演出结束对话**：按游戏的简易剧情播放器在各自的宿主画面中播放。据点对话显示 3D 据点房间与 Spine 角色，演出结束对话显示结算画面的奖励阶段（见 [docs/story-simple.md](docs/story-simple.md)）。
- **视频**：Movie 与 Clip 行的视频带有自己的声音，按游戏的影片音量播放，不受音乐、音效与语音音量影响。视频可以暂停，也可以拖动进度条跳转。
- **控制栏**：
  - 游戏剧情菜单的项目：下一句、自动、快进（×1 → ×1.5 → ×1.7 → ×2）、跳过（带确认）以及三种音量；
  - 播放器自己的项目：播放 / 暂停、按台词跳转的进度条、视频的进度条。
- **语言**：剧情文本有数据中提供的语言（日语、英语、繁体中文、简体中文、韩语），可在播放中切换，切换后从当前台词重新开始。控制栏的语言默认跟随剧情语言，也可以用 `ui-lang` 指定。
- **胶片颗粒**：默认不绘制；`film-grain` 属性按游戏的强度绘制（[#1](https://github.com/empty-sekai/ournotes-player/issues/1)）。

用到播放器尚未重现的部分的剧情，会在开始前被拒绝播放，错误信息会指明该部分，不会播放到一半。唯一的例外是静帧上的 UIParticle 图形：它只在绘制时才被发现，剧情会在该帧停止（见 [docs/story.md](docs/story.md#episodes-the-player-refuses)）。

在一个区服的 946 集剧情数据（无音频；除注明外为英语文本）上检验：

- 不绘制（加速时钟）：946 集全部播放到结尾。
- 以正常速度绘制，覆盖各类绘制功能的 57 集抽样（包括画框上的画布粒子、居中对话框、聊天手机与使用 URP 光照的据点房间）：57 集全部播放到结尾。
- 含表情符号的 9 集，日语与英语各一次，以加速时钟绘制：18 次全部播放到结尾。
- 抽样的 20 集与 18 次表情符号剧情各绘制两次，两次的命令、台词与逐帧状态一致。
- 每集读取的文件都在其清单之内。

## Live2D 模型

`<ournotes-live2d>` 按游戏剧情画面的方式显示一个角色：待机动作、自动眨眼、呼吸、物理。它可以播放动作、切换表情，绘制使用数据中游戏自身的 Live2D 着色器。它只是模型查看器，不含剧情的舞台、镜头与文本。见 [docs/live2d.md](docs/live2d.md)。

## 数据

播放器读取一个静态站点：
- `charts.json` 与 `charts/`：谱面；
- `models.json` 与 `models/`：Live2D 模型，模型查看器与剧情共用；
- `stories.json` 与 `stories/`：剧情，每集的清单列出它用到的模型；
- 内容寻址的资源文件：JSON、GLSL、moc3 等在更小时以 gzip（或 brotli）编码存储，由播放器解码。

nnnotes 从使用者自己的游戏文件生成这样的站点，例如：

```sh
nnnotes web out/site --all --all-live2d --all-stories --player <ournotes-player 目录>
```

- 播放器也读取较早格式的数据：未编码的资源，以及把模型文件放在每集剧情之内的剧情清单（`ournotes.story-manifest/1`）。
- 托管方式（路径、CORS、编码资源、缓存）：[docs/embedding.md](docs/embedding.md#hosting-the-data)。以 brotli 编码的站点要在 Chromium 系浏览器中播放，需以 `Content-Encoding: br` 提供 `.br` 资源。
- 校验：`npm run validate-data -- <站点目录>` 按数据格式与 `schema/` 检查谱面、模型与剧情，包括剧情与其模型之间的对应。

## 文档

| 主题 | 文档 |
|---|---|
| 嵌入与托管、多个播放器、移动端 | [embedding.md](docs/embedding.md) |
| Live 谱面：接口 / 数据格式 / 还原程度 | [api.md](docs/api.md) / [data-format.md](docs/data-format.md) / [fidelity.md](docs/fidelity.md) |
| 剧情：接口与还原程度 / 功能模块 / 简易剧情播放器 / 数据格式 | [story.md](docs/story.md) / [story-features.md](docs/story-features.md) / [story-simple.md](docs/story-simple.md) / [story-data-format.md](docs/story-data-format.md) |
| 没有 MotionSync 控制器的模型的口型（CRI Lips 分析） | [crilips.md](docs/crilips.md) |
| Live2D 模型：接口与行为 / 数据格式 / 还原程度 | [live2d.md](docs/live2d.md) / [data-format.md](docs/data-format.md#live2d-models) / [fidelity.md](docs/fidelity.md#live2d-models) |
| 性能 | [performance.md](docs/performance.md) |

## 浏览器支持

需要 WebGL2、WebAudio 与 ES2022 模块，自定义元素另需 Custom Elements 与 ResizeObserver。音频需要能用 `decodeAudioData` 解码 FLAC 与 AAC（MP4），剧情视频需要能播放 WebM（VP9 与 Opus）。目前在 Chromium 内核浏览器中测试。

## 开发

需要 Node.js 22 或更高版本。

```sh
npm ci
npm test                  # 单元测试（node --test，仅使用合成输入）
npm run build             # 构建 dist/ 下的浏览器包
npm run typecheck         # 检查 types/ 下的类型声明
npm run validate-data -- <站点目录> [谱面 id ...]              # 按数据格式校验一个站点
OURNOTES_DATA=<站点目录> npm run test:data                     # 可选：用真实谱面数据在 Node 中运行播放器
```

分支、提交约定、测试与数据政策见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

仓库采用 AGPL-3.0-only（见 [LICENSE](LICENSE)）。`dist/` 下通过 npm 分发的浏览器包另附 [LICENSE-EXCEPTION](LICENSE-EXCEPTION) 中的浏览器嵌入例外：在终端用户浏览器中原样加载该浏览器包、并与自己的前端代码链接时，前端代码不因此受 AGPL 约束。修改播放器、在服务端或其他非浏览器环境中使用仍受完整 AGPL 约束，包括网络交互场景下的源代码提供义务。
