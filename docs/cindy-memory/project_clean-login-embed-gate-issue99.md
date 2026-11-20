---
title: 'clean-login embed gate 的宿主 origin 事实（issue #99 / v0.2.2）'
description: 'embed-gate 信任的宿主挂载形态与 Windows wails.localhost 回归修复（PR #100）'
type: project
updatedAt: '2026-11-20'
---
# embed gate 的宿主 origin 事实（issue #99，修复于 v0.2.2 / PR #100）

## 宿主挂载形态（上游 yetone/magpie 源码确认）

- magpie 桌面端把插件页放 `<iframe sandbox="allow-scripts">`（`internal/gui/pluginpage.go` +
  `assets/pluginpages.js`），插件 iframe 自导航到 loopback 服务（如 `127.0.0.1:3492`），sandbox
  标记随之保留 → 管理页永远是 opaque origin（`window.origin === "null"`），`location.origin`
  仍是真实 URL origin。
- **桌面窗口的窗口 origin 分平台**：Windows 上 Wails 用 `http://wails.localhost`（Tauri 为
  `tauri.localhost`），macOS/Linux 用 `wails://wails`（`internal/gui/window_peer.go`、
  `internal/gateway/cors.go`）。Windows 浏览器解析不了 `*.localhost` 这些名字，只有原生
  webview 能成为该祖先 → 信任它是安全的。
- **`magpie web` 模式**（`internal/gui/pageservice.go`，前缀 `_magpie/service/`）：窗口和插件
  服务同 origin，`ancestorOrigins` 等于页面自己的 `location.origin` → 也要信任。

## issue #99 经过与修法

- 症状：v0.2.1（含 6877050 clickjacking gate）在 Windows 全部显示「此页面只能在 magpie 内
  运行」；v0.1.111 正常。根因：旧 gate 只放行非-http(s) ancestor，`http://wails.localhost`
  被当 foreign 拒掉。
- 修法（ui/embed-gate.js）：ancestorOrigins 全链扫描；http(s) 祖先只放行
  `wails.localhost`/`tauri.localhost`（hostname 归一化）或与 `pageOrigin`
  （location.origin）相同者；其余 http(s) 祖先一律拒绝。app.js 多传 `pageOrigin`。
- 负向行为保持不变：top===self 拒、非 null origin 拒、外来 http(s) 祖先拒。

## 云验证结论（Devin sandbox c2a6f4e8…，2026-11-20，真实引擎）

- Chromium（模拟 Windows WebView2）：`http://wails.localhost` 父 + `sandbox=allow-scripts` →
  ALLOW（ancestors 实测 `["http://wails.localhost"]`）；两层链 `["null","http://wails.localhost"]`
  → ALLOW；:8088 同源 web 挂载 → ALLOW；外来 :8088 父 → DENY；顶层直开 → DENY。
- WebKit（复盖 macOS WKWebView / Linux WebKitGTK 引擎家族）：同形全部一致 —— 信任祖先
  ALLOW，外来祖先/顶层 DENY。WebKit 也实现 `location.ancestorOrigins`。
- wails:// 自定义 scheme 父页在 Playwright 下模拟不稳定（Chromium route 拦截导航
  ERR_ABORTED、WebKit 未挂 frame），未实测；该路径 gate 逻辑相对 v0.1.111 未变（非 http(s)
  永远放行），且单元测试覆盖，风险低。
- 环境注：Devin 云盒只给 Linux（无 macOS 沙箱）；playwright webkit 需
  `npx playwright-core@1.62.0 install webkit` + `sudo env "PATH=$PATH" npx … install-deps webkit`；
  本机跑 scripts/merge-release.mjs 需 `BUN=<bun.exe 真实路径>`（PATH 上 bun 是 shell shim，
  Node execFileSync 无法 spawn）。
