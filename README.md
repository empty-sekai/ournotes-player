# ournotes-player

[简体中文](README.md) | [English](README.en.md)

ournotes-player 是 BanG Dream! Our Notes 谱面的浏览器播放器（WebGL2 + WebAudio），可以作为组件嵌入其他网页。

本项目为非官方爱好者项目，与游戏的开发和运营方无关。仓库不包含任何游戏资源：播放器读取按[数据格式](docs/data-format.md)准备的谱面数据，数据由使用者自行提供。

## 状态

开发中。数据格式与公开接口会在 `0.1.0` 发布前陆续提交；`0.x` 期间接口仍可能调整。

## License

仓库采用 AGPL-3.0-only（见 [LICENSE](LICENSE)）。`dist/` 下通过 npm 分发的浏览器包另附 [LICENSE-EXCEPTION](LICENSE-EXCEPTION) 中的浏览器嵌入例外：在终端用户浏览器中原样加载该浏览器包、并与自己的前端代码链接时，前端代码不因此受 AGPL 约束。修改播放器、在服务端或其他非浏览器环境中使用仍受完整 AGPL 约束，包括网络交互场景下的源代码提供义务。
