# Vesper 当前版本说明

本目录为 Vesper 网页版，主体基于 [Mineradio](https://github.com/XxHuberrr/Mineradio) 源码改造，其 GPL-3.0 许可文本保留在 [LICENSE](LICENSE)。新增 Folia 歌词布局适配模块保留 AGPL-3.0 声明，组件许可说明见 [LICENSES.md](LICENSES.md)。下方保留归档时的上游 NOTICE 原文；其中桌面客户端、其他音乐平台和实验功能的声明，不代表它们已在当前网页版本开放或通过验收。

本版本另记录以下参考与依赖：

- [MIMI Music Player](https://github.com/NanQiaoMi/music_source_code)（MIT）：首页卡片堆叠与歌单架交互参考，在 `public/js/modules/20-vesper/` 中以原生 JavaScript / CSS 改写相应交互。
- [Folia](https://github.com/chthollyphile/folia-major)：旧版为歌词 PV 视觉参考；新版 `04b-vesper-lyric-renderers.js` 进一步根据其源码适配了 12 种布局，使用固定提交 `b0d2d74e4f4458879f6a53c31bcdb4144d06d754`。此改编模块按上游 AGPL-3.0 提供，[许可原文](public/licenses/Folia-AGPL-3.0.txt)、[改编说明](public/licenses/Folia-NOTICE.md) 与源文件一并保留；未移植 Folia 的整个应用或全部特效引擎。
- NeteaseCloudMusicApi：`../netease-api/package.json` 中的直接依赖，当前固定为 `4.32.0`，安装包声明 MIT；Vesper 通过本地服务桥接调用。

随 Mineradio 继承的 Cuefield、Mineradio-LX-Music 等社区贡献及其具体修订，继续按下方原文记录。

---

# NOTICE

Mineradio 使用了以下第三方项目或服务。各项目版权归其原作者所有。

## Third-party Libraries

- Electron
- Three.js
- GSAP
- music-tempo
- NeteaseCloudMusicApi
- mpg123-decoder

## Community Contributions

- Cuefield AutoMix planner/runtime: adapted for experimental local testing from [SLYysl/cuefield-mineradio](https://github.com/SLYysl/cuefield-mineradio) at revision `c16f05a0bc731a49da7d42c135337fcac58f6dba` (GPL-3.0). The optional remote-feedback component from that repository is not included; Mineradio stores Cuefield ratings locally in the current user's data directory.
- Wallpaper Engine local-library detection and import UX: independently adapted from the approach used by [ww085213/Mineradio-LX-Music](https://github.com/ww085213/Mineradio-LX-Music) at commit `a5ef80a219709080700be5b1d00f1ea71a5a2576` (GPL-3.0). Mineradio only indexes local `project.json` metadata; it does not execute imported Web/Application projects or replace the user's existing background-media settings.
- Full-desktop main-window mode and home-dashboard information hierarchy: initially adapted from [ww085213/Mineradio-LX-Music](https://github.com/ww085213/Mineradio-LX-Music) at commit `82826df814c32853d99697c0ee60f749a2fcad79`, with the homepage refreshed against `812e2dc2e18bbc263e61dbd0206cb765e003d6e9` (GPL-3.0). Mineradio keeps its own provider, queue, playlist, listening-history, WorkerW validation, DPI, lifecycle, and cleanup implementations; see `docs/THIRD_PARTY_PORTS.md` in the corresponding source distribution.
- Qishui Passport Web QR authentication bridge: focused port from [Wx2yZx/Mineradio-Qishui-QR-Login](https://github.com/Wx2yZx/Mineradio-Qishui-QR-Login) at commit `aaadaab7d011714f94fbe45b382ba8dcc7cf17b9` (declared `GPL-3.0-only`). Only the official QR create/poll, security-signing host, session persistence, and second-verification path are integrated; Mineradio keeps its own catalogue, playlist, entitlement, and playback adapters. The bundled ByteDance/Qishui web security runtime resources remain the property of their respective rights holders and are used only to interoperate with the user's own official account session.

## Third-party Services

Mineradio 可能与网易云音乐、QQ 音乐等第三方音乐服务进行用户自有账号相关的本地客户端交互。

Mineradio 不是任何音乐平台的官方客户端，也不隶属于网易云音乐、QQ 音乐或腾讯音乐娱乐集团。请用户自行遵守对应平台的服务协议、版权规则和会员权益规则。

## Original Design

Mineradio 名称、MR Logo、界面视觉设计、启动动画方向、粒子视觉体验和电影镜头系统的产品表达属于作者原创设计。

emily 作为 Mineradio 早期视觉底层想法与 `emily` 视觉预设改进方向的共创者和灵感来源之一，特此致谢。

感谢小天才e宝、应春日、锋将军、軌跡、林中、骊、风痕、花椰菜🥦在早期体验、测试反馈和发布准备中的帮助。
