---
title: clean-login 闸门丢消息补做与 0.1.49–0.1.52 发版
description: >-
  子 bot 闸门工具不可用期间丢失的两条 clean-login 事务（PR #31 合并请求、PR #30 复核+文案修复）已补做；main
  0.1.52，PR #30/#31/#33 全部合并，README providers 截图未重出
type: project
updatedAt: '2026-11-07T03:43:52.063Z'
---
## 起因
2026-11-07 子 bot 闸门（CindyGlobal/cindy-gate）工具不可用期间，两条发给 cindy-default 的转达消息被丢失（`bot_direct_messages.delivery_status = pending`，闸门并未拦截 tool_call，`policy.json` 现已 `enabled:false`）。主人指示补做。

## 丢失并已补做的两条
1. 一号机 `bot_1793404248859_326s0s`：PR #31 合并请求（`reply_required: true`），改 `lib/browser-launcher.mjs` 加 `enable_cache`/`humanize`。
2. 二号机 `bot_1793404248859_935ug6`：PR #30（README 改版）复核 + 两个要求（重出 providers 首屏截图为正常安装态；`PLUGIN_ONLY_UNKNOWN` 文案三重复述做独立小 PR）。

## 结果（2026-11-07 完成）
- PR #31：原分支声明 0.1.47→0.1.48 与 main 0.1.48 撞版本，rebase 后 bump 到 0.1.49；head `ff9ef090f69aa321e7edceda3b30edf90671c35a`；合并点 `0389fd8f02e2c12f86c69fa2a027b64d5db5ff49`（tag v0.1.49）；发布 `6c8b9206f55857e6b652ae834cc55201431e6fd0`（0.1.50 / v0.1.50）。
- PR #33（文案修复）：head `c468d40c54cfc0acc28d550caf94c8f81219060f`；合并点 `a834222ebf19af73b61f18fc651f26bf06cda42c`（tag v0.1.51）；发布 `216d175a00ffbaa46940dea2c98e0f88aaa3d7a7`（0.1.52 / v0.1.52）。改法：新增共享 `PLUGIN_ONLY_DESCRIPTION` / `PLUGIN_ONLY_METHOD_REASON`，`pluginOnlyProvider()` 的 `presenceNote` 置 null，`ui/app.js` 用 `shownLines` 集合去重；新增 `test/plugin-only-copy.test.mjs` 静态护栏 + 2 状态 × 3 方法形态 × 4 语言不重复断言。
- PR #30（README 改版，docs-only）：head `02dcad8060a977f73ae05aabf42b71d89e729f3d`；合并点 `42e207ba3ced8b6baa8aedc43bc58721a897e676`。**主人在合并前改优先级，明确取消重出截图**，故 #30 直接合并，图片保持原样。
- 终态：main `42e207ba3ced8b6baa8aedc43bc58721a897e676`，version 0.1.52，CI 全绿（test + version-bump），三个分支已删，open PR 0，production_untouched。

## README 截图现状（如实）
`assets/screenshot-accounts.png`、`screenshot-proxies.png` 与当前界面一致；`assets/screenshot-providers.png` 仍是「magpie 名单读不到」降级态渲染，且其卡片文案是 0.1.52 之前措辞（PR #33 已改），与新界面不一致，待后续补拍。

## 遗留
重出 providers 首屏截图：方案已验证到可运行（不开 NODE_ENV=test、URL 加 `?lang=en`、把 `{v:1,ok:true,value:[...]}` 经 `#providers=` 注入，合成 config/data/cache 目录，不碰生产 `~/.config/magpie`），脚本在 `bots/cindy-default/workspace/tmp-recover/shotenv/`（`reshoot.mjs` 首版、`reshoot2.mjs` 未运行版），需要时可直接续做。

## 教训
- 找回丢失转达不能依赖 `cindy_helper` 历史类工具（当时返回乱码不可信），改查 SQLite `bot_direct_messages` 的 `delivery_status` 最可靠。
- 版本撞车是老坑复发：分支声明版本 ≤ main 时 `check-version-bump` 只判「变了」不判「变大」，必须先 rebase 再 bump 到 main+1，然后照例发版到 +1。
- 一个 `edit` 调用只能针对一个文件；把多文件 edits 混在一个 path 里会整次原子失败。
