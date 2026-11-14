---
title: Antigravity 供应商现状：封禁申诉待办、quotaReads 回滚与人机验证结论
description: >-
  antigravity 供应商已 off/hidden；qhlzy66 403 封禁待改区新加坡申诉；quotaReads 已回滚（上游无
  per-provider 不读用量开关）；人机验证无法自动过
type: project
updatedAt: '2026-11-12T19:41:01.583Z'
---
## 当前状态（2026-11-12 核实）
- `C:/Users/Administrator/.config/magpie/providers.json` 里 `antigravity` 为 `off:true, hidden:true`，即整个供应商已关掉；`accountProxies` 只剩 2 条（ashleighfox18 / qhl25133 各一条本地 http 出口）。
- 账号池现状：qhl25133@gmail.com（Google AI Pro / g1-pro-tier）曾正常承接；qhlzy66@gmail.com 于 2026-11-06 被 Google 403 停用；yqi7309@gmail.com 的 antigravity 登录已被 magpie 自行移除（其失败形态是 VALIDATION_REQUIRED，即要过人机验证）。

## 2026-11-06 封禁与申诉计划（仍未办）
qhlzy66 收到：`This service has been disabled in this account for violation of Terms of Service. Please submit an appeal to continue using this product.`。aibo 的决定：先移出供应商，等谷歌风控冷却几天，把账号地区改到新加坡，再提交申诉。**这条待办至今未执行。**

## 用量读取（quotaReads）—— 2026-11-11 拍板回滚
- 曾把 `settings.json` 的 `quotaReads` 改成 `"asked"`，aibo 选「回滚」：已删该键回到默认自动读取，接受 antigravity 账号每分钟被读一次用量。回滚前备份：`C:/Users/Administrator/.config/magpie/settings.json.bak-20261111-2350-cindy-before-rollback`。
- 结论：上游**没有** per-provider「不读用量」开关。`hidden`/`off`/`quiet`/`tucked`/`refreshEvery`/`panelUsageHidden`/`usageCardsHidden` 都不行——轮询判据是 `hidden[p.ID] = p.Hidden || p.Off`，想不读用量只能把整个供应商关掉。
- 已做的无害项：清掉 providers.json 里 antigravity.accountProxies 的孤儿条目（3 条→2 条）。

## 人机验证（VALIDATION_REQUIRED）无法自动过
评估过 https://github.com/lbjlaq/Antigravity-Manager （只读，未采用）：它对 VALIDATION_REQUIRED 只是把 Google 给的链接抽出来交给用户点（`src-tauri/src/modules/account.rs:2200` 取 `error.details[].metadata.validation_url`；`AccountErrorDialog.tsx:125` 就是个 `<a>`），全仓库 captcha/recaptcha/playwright/selenium/puppeteer/2captcha 命中 0。上游同类 issue 仍开着（#2362/#2154/#1976/#1430/#3035/#3160）。
