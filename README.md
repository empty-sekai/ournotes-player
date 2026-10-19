# ournotes-player

[简体中文](README.md) | [English](README.en.md)

在浏览器中播放 BanG Dream! Our Notes 的 Live 谱面、剧情和 Live2D 模型。播放器通过 WebGL2 运行数据中的游戏
着色器，通过 WebAudio 播放声音。可作为自定义元素、JavaScript API 或 iframe 页面嵌入。

**0.2.0** 读取 **nnnotes 0.3.x** 生成的共享对象产物，也支持格式 2 的谱面和 Live2D 模型站点。
游戏数据由各用户自行提供；[nnnotes](https://github.com/MetaSekaiLab/nnnotes) 从用户自己的游戏文件生成产物和静态站点。

## 安装与嵌入

```sh
npm install ournotes-player@0.2.0
```

使用打包工具时导入 `ournotes-player/element`。普通 HTML 页面可以直接加载：

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/ournotes-player@0.2.0/dist/ournotes-player.element.min.js"></script>
<ournotes-player src="https://example.org/site/charts/100001_expert.json" controls></ournotes-player>
```

先按[快速开始](docs/getting-started.md)准备站点，再参阅[嵌入与托管](docs/embedding.md)。
音频从用户操作开始播放，游戏数据通过 HTTP(S) 提供。

## 组件

| 内容 | 自定义元素 | JavaScript 模块 | API |
|---|---|---|---|
| Live 谱面 | `<ournotes-player>` | `ournotes-player` | [ChartPlayer](docs/api.md) |
| 剧情 | `<ournotes-story>` | `ournotes-player/story` | [StoryPlayer](docs/story.md) |
| Live2D 模型 | `<ournotes-live2d>` | `ournotes-player/live2d` | [ModelPlayer](docs/live2d.md) |
| 实验性 UI 预览 | `<ournotes-ui>` | `ournotes-player/ui` | [UIPlayer](docs/ui-preview.md) |

各模块都有自动注册自定义元素的 `/element` 入口。`dist/` 提供 ESM、自动注册元素的 ESM 和经典脚本，
同时提供压缩文件和 source map。经典脚本的全局对象为 `OurnotesPlayer`、`OurnotesStory`、`OurnotesLive2D`、`OurnotesUI`。

Live2D 需要 Cubism Core；剧情口型可能需要 MotionSync Core；据点对话需要 Spine 运行时。
嵌入页面应按各自许可取得这些运行时，并在创建播放器前加载，详见[运行时配置](docs/getting-started.md#browser-runtimes)。

## 播放功能

- **Live 谱面**：自动 Perfect 演奏、舞台与音符、特效、判定 UI、音频、跳转、速度和数据支持的 Live 设置。
  模拟采用固定 60 Hz 时钟和 float32 运算。
- **剧情**：ADV 命令、场景与镜头特效、Live2D、本地化文本、视频及音频。据点与演出结束对话使用对应宿主产物。
  语言选择器列出产物实际提供的语言。
- **Live2D**：待机、表情、眨眼、呼吸与物理，使用模型的着色器数据。
- **UI 预览**：通过 Canvas 2D 查看 `nnnotes export ui` 产物的布局和部分动画。

支持范围见[还原程度](docs/fidelity.md)、[剧情功能](docs/story-features.md)和[简易剧情](docs/story-simple.md)。

## 剧情编写工具（实验性）

`scripts/story-author.mjs` 是随仓库提供的命令行工具，用 JSON 脚本制作自定义对话剧情：脚本指定一集已有剧情作为场景底本（背景、音乐、对话框与播放设置）、站点里的 Live2D 模型和每一句台词；工具检查脚本，用剧情播放器把每句台词画成 PNG，再把剧情写入站点，由播放器播放。每条命令向标准输出打印一个 JSON 对象，进度写到标准错误，方便程序和智能体调用。脚本格式和命令在版本之间可能变化。

直接克隆仓库即可使用，不需要先构建：

```sh
git clone https://github.com/empty-sekai/ournotes-player.git
cd ournotes-player
S=--site=path/to/site                                         # 含 stories.json 与 models.json 的站点目录，也可设 OURNOTES_SITE
node scripts/story-author.mjs bases $S                         # 列出可作底本的剧情
node scripts/story-author.mjs new stories/10002.json $S > story.json   # 生成起始脚本，然后编辑 story.json
node scripts/story-author.mjs check story.json $S              # 检查，错误与警告带 JSON 指针
node scripts/story-author.mjs render story.json $S --out shots # 每句台词一张图，加一张总览 shots/sheet.png
node scripts/story-author.mjs build story.json $S --name my-story   # 写入站点的 custom-stories/
node scripts/story-author.mjs serve $S                         # 打印可在 examples/story 播放的地址
```

需要 Node.js 22+。出图的命令（`render`，以及带 `--out` 的 `base`、`model`）需要本机装有 Chrome、Chromium 或 Edge（用 `--chrome <路径>` 或 `CHROME_PATH` 指定），并默认从 Live2D 官方分发地址加载 Cubism Core（需要网络，`--core` 可改用其他副本）。站点中的剧情需为剧情产物格式（`nnnotes.product/1`），见[剧情数据](docs/story-data-format.md)。
全部命令、脚本格式、错误码与自动修复见[剧情编写工具](docs/story-author.md)。

## 生成与校验数据

配置好 nnnotes 的输入，并安装字体与音频工具后：

```sh
nnnotes site build --name example -o out/site --pair 100001:expert --fonts game --player node_modules/ournotes-player
node node_modules/ournotes-player/scripts/validate-data.mjs out/site
```

站点包含谱面、模型和剧情索引，公开入口清单，不可变产物清单及共享资源；播放器也可以读取独立产物布局。
[数据格式](docs/data-format.md)与[剧情格式](docs/story-data-format.md)说明具体契约。
校验器检查 Schema 和引用关系；浏览器播放用于检查画面及托管配置。

## 文档与示例

| 主题 | 文档 |
|---|---|
| 安装与第一个站点 | [快速开始](docs/getting-started.md) |
| 嵌入、运行时、CORS、缓存与压缩 | [嵌入](docs/embedding.md) |
| Live API 与设置 | [API](docs/api.md) |
| 剧情、语言、媒体与控制 | [剧情 API](docs/story.md) |
| 命令行制作自定义对话（实验性） | [剧情编写工具](docs/story-author.md) |
| Live2D API | [Live2D](docs/live2d.md) |
| 产物与站点契约 | [数据格式](docs/data-format.md)、[剧情数据](docs/story-data-format.md) |
| UI 与口型 | [UI 预览](docs/ui-preview.md)、[CRI Lips](docs/crilips.md) |
| 性能分析 | [性能](docs/performance.md) |

示例页面：[谱面](examples/chart-list)、[模型](examples/live2d)、[剧情列表](examples/story-list)、
[单集剧情](examples/story)、[歌曲统计](examples/songs)和 [UI](examples/ui)。

## 开发

需要 Node.js 22+：

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run contract:check
npm run build
```

单元测试使用合成输入。`npm run validate-data -- path/to/site` 校验提供的数据目录；可选数据测试使用
`OURNOTES_DATA` 和 `npm run test:data`。开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 浏览器与许可

需要 WebGL2、WebAudio、ES2022 模块、Custom Elements 和 ResizeObserver，浏览器还需支持数据使用的音视频格式。
主要播放目标是 Chromium 浏览器；brotli 资源的响应头要求见[托管说明](docs/embedding.md#hosting-the-data)。

这是非官方爱好者项目，与游戏开发或运营方无关。游戏资源和商标归各自权利人所有。
项目采用 [AGPL-3.0-only](LICENSE)，通过 npm 分发的原样浏览器包另有[浏览器嵌入例外](LICENSE-EXCEPTION)。
修改播放器及在服务端使用仍受完整许可约束。
