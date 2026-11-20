---
title: Camoufox 上游发版监控例行任务与基线
description: Camoufox/fpgen-js 上游发版监控例行任务的 id、脚本路径、基线版本与已知的 jq 坑
type: project
---
主人 2026-11-09 要求持续监控上游指纹浏览器 daijro/camoufox 与 JWriter20/fpgen-js 的发版变化。

监控机制：Cindy 例行任务 id 6bbccb5f-0268-4148-a35b-16f3b0507225「Camoufox 上游指纹浏览器发版关注」，每 6 小时一次，sessionMode=fresh，silentWhenIdle=true，preRunHook 跑初号机 workspace/scripts/schedule-checks/watch-camoufox-release.mjs（有变化 exit 0 唤醒模型汇报，无变化 exit 2 静默）。状态基线文件同目录 camoufox-watch-state.json。

基线（建立时）：GitHub 最新浏览器 release v158.0.1-beta.41；npm camoufox 0.5.9；npm fpgen-js 1.3.0。clean-login 钉住自有仓库 Gruu6y/clean-login-browser 的 browser-v158.0.1-beta.41-slim.1（URL 在 lib/browser-environment.mjs:66），fpgen 模型钉 model-2/2026。

上游 main 已合并但未发版的关键改动（下次 release 才生效，届时需重做 slim 版并 bump 依赖）：#997 Firefox 159 底座 + WebRTC 不再泄漏代理后真实地址 + Remote Settings 停止轮询 + fill/wheel 拟人化；#1006 软渲染宿主诚实上报 llvmpipe；#988 Juggler WebSocket close 参数修复；#1002 Linux zip 文件权限修复。待合并观察项：#1005 Windows WebGL2 EXT_texture_norm16、#1000 humanize 引擎。

坑（勿重犯）：gh --jq 里 select+test("^v[0-9]") 会被 shell 转义破坏并报 function not defined: v/0，且脚本 catch 会静默吞掉 —— 改为取 .[] | .tag_name 后在 JS 里 /^v\d+/ 过滤；daijro/camoufox 的 releases 列表第一条是 font-bundle-v4（非浏览器 tag），不过滤会误报更新。
