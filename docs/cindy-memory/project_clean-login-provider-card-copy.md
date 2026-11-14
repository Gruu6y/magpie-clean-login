---
title: clean-login 供应商卡片的用户可见文案决定
description: >-
  clean-login 卡片文案决定（antigravity已确认立住不再动、沙箱/其他订阅卡去文案+排版已上线
  0.1.68）与两条待拍事项（shownLines 护栏已在 PR #44 闭环）
type: project
updatedAt: '2026-11-07T18:30:17.827Z'
---
# clean-login 供应商卡片的用户可见文案决定

## codex / claude 沙箱提示（0.1.53）
- 主人决定：codex 与 claude「暂时不建议使用本插件登录」，原因「暂时未准备提供沙箱服务」。
- 落地：`lib/provider-registry.mjs` 里两者的 `notice`（共享常量 `NO_SANDBOX_NOTICE`；claude 另拼 `CLAUDE_TOKEN_NOTICE`）。只是提示，没有禁用入口。撤除条件：沙箱就绪或主人改口。

## antigravity 未付费提醒（0.1.65，三号机 PR #40，口径已定立住）
- `ANTIGRAVITY_NOTICE` 四语言进 antigravity 的 `notice`。
- 口气（「一块钱都没给 Google 付的订阅账号，神仙来了也得封了。」）：**已于 2026-11-08 由三号机与主人确认彻底立住**。三号机证实此句为主人亲口原话（原句「一块钱都没给google付的订阅账号,神仙来了也得封了」），提交前预览图给主人看过，主人亲口确认「行联系初号机合并吧」。虽与 codex/claude 的克制口径不统一，但既然是主人原话定版，**在主人明确改口前任何伙伴均不动它**，不再列入待拍事项。

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
