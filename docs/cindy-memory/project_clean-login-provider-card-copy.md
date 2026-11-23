---
title: clean-login 供应商卡片的用户可见文案决定
description: >-
  clean-login 供应商卡片特化提醒最新拍板（2026-11-23：Google AGY 系与 Claude 系按家族匹配并配醒目警示样式、开放登录入口；Codex 清空旧沙箱提醒）
type: project
updatedAt: '2026-11-23T12:48:00.000Z'
---
# clean-login 供应商卡片的用户可见文案决定

## 2026-11-23 供应商页特化提醒更新（取代旧 0.1.53 / 0.1.65 口径）
- 主人原话：
  1. 针对 Google AGY 系：`提醒:未实付的账号无法通过本插件缓解你的封禁焦虑,且暂时不建议通过magpie使用agy供应商`
  2. 针对 Claude：`提醒:请不要通过本插件来使用claude,请使用claude-cage`
  3. Codex：`codex这个不需要特殊提醒了,openai不管反代,只要通过本插件做好隔离,可以一定程度上降低降智风险`
- 拍板细则：
  - **样式与入口**：卡片与登录弹窗使用醒目警示样式（AGY 系 `noticeTone: "warn"` 琥珀色警示框；Claude 系 `noticeTone: "danger"` 朱红色警示框），**但开放登录入口**（不禁用、不隐藏任何可登录供应商的「添加账号」入口）。
  - **家族匹配**：`lib/provider-registry.mjs` 的 `providerSpecialNotice()` 统一按家族匹配并接到 `lib/provider-sources.mjs` 的 `magpie-only`、`plugin-only`、`catalog` 层——AGY 系覆盖 `antigravity` / `agy-cli` 及 `antigravity-*` / `agy-*`（含插件包名与名称）；Claude 系覆盖 `claude` / `claude-*` / `claudecode`（不含裸 `anthropic`）。
  - **旧文案清理**：移除 `NO_SANDBOX_NOTICE` 与 `CLAUDE_TOKEN_NOTICE`；Claude 卡片只保留新的 `claude-cage` 提醒并简化 description；Codex 清空特殊提醒（`notice: {}`, `noticeTone: null`）。

## 历史记录：codex / claude 沙箱提示（0.1.53，已于 2026-11-23 取代）
- 旧决定：codex 与 claude 曾共享 `NO_SANDBOX_NOTICE`（claude 另拼 `CLAUDE_TOKEN_NOTICE`）。已于 2026-11-23 撤除。

## 历史记录：antigravity 未付费提醒（0.1.65，已于 2026-11-23 改口更新）
- 旧口径（「一块钱都没给 Google 付的订阅账号，神仙来了也得封了。」）已按 2026-11-23 主人新原话更新为 `AGY_FAMILY_NOTICE` 并扩展至整个 Google AGY 系。

## 其他订阅类卡片去文案 + 排版（2026-11-08，PR #39，实发 0.1.67/0.1.68）
- 主人连着三轮「动一处修一处」，要求去掉重复段落。
- 落地：`pluginOnlyProvider()` 不再输出 description/notice/capability 文案（`description: {}`、`notice: null`、`reason: {}`）；市场卡新增 `sources.market` 与四语言 `providerSourceMarket`；`PROSE_FREE_PRESENCES = ["local-only"]` 让本地注册表卡只留注册表自己那句提醒；`local-unknown` 保持原样。
- 排版：`.provider-head` 允许 `flex-wrap`（四列时名字只剩 ~82px，`WorkBuddy` 断词、`QwenWo...` 被省略号切掉）、`.provider-name` 加 `overflow-wrap: anywhere`、方法 chip `flex-wrap: wrap` + `max-width: 100%` 而 tag `flex: 0 0 auto; white-space: nowrap`、label line-height 1 → 1.3。九档宽度 × 191 个 token 逐张量过。
- 护栏：新增 `test/card-chrome-layout.test.mjs`（5 条纯 CSS 断言）；`test/other-cards-no-prose.test.mjs` 钉去文案行为与 `.providers-more .provider-grid { align-items: start; }`。
- **版本第二次撞上**：本线基于 0.1.62 申报 0.1.64，main 已被推到 0.1.66（PR #41 占 0.1.63/0.1.64、PR #40 占 0.1.65/0.1.66），rebase 后改 0.1.67。
- 远端核对：PR #39 MERGED，合并点 `130a4e1` = tag `v0.1.67`，发布提交 `ba62b02` = tag `v0.1.68`，main = `ba62b02` version 0.1.68，远端分支已删；CI 三处 test + version-bump 全绿。

## clean-login 测试基线（已实测纠正）
- 根因不是 bun 版本（CI 和本机都是 bun 1.4.4，CI 全绿）。真正原因是缺依赖：`bun install` 装齐后为全绿基线。先前误以为的「fpgen pin 不匹配 / 预存环境红灯」作废。

## 待主人拍的两条（原第 1 条 antigravity 与第 3 条 shownLines 护栏已结）
1. 市场卡丢了唯一可操作句「在 magpie 里安装对应插件，然后重新加载此页」，现在只剩 `未安装` tag + `名单来源: magpie 市场`。
2. local-only 卡丢了「magpie 里没有这个供应商」，只剩汇总行「仅本地 N 个」间接暗示。
（原第 3 条：删掉的 `test/plugin-only-copy.test.mjs` 里钉 `ui/app.js` `shownLines` 去重的静态护栏，已由初号机通过 PR #44 合入 `test/other-cards-no-prose.test.mjs`，main `feb0f54` 闭环恢复）。

## 记住的口径
- 提示写给用户看的事实必须准：「读不到 magpie 名单」就说读不到，不要写成「magpie 里没有」。
- 卡片上一句话只出现一次（`ui/app.js` 的 `shownLines` 去重），重复叙述会被当缺陷退回。
- 卡片文案属于主人的声音，主人亲口定版的话保留原样执行，不因口径不一而擅自修改。
