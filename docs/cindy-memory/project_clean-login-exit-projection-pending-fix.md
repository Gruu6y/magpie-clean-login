---
title: 'cl 出口投影：PR #77 发版 0.1.101，及待补的一处显示回退修复'
description: 'PR #77 已合并发版 0.1.101；本线待办：custom 出口节点不在本地库时不投影的显示回退修复'
type: project
updatedAt: '2026-11-10T00:44:45.708Z'
---
PR #77（cl 出口下拉「已使用」口径1 修复）已由初号机合并发版：
- 合并提交 `3aeb0429fa`；我的 `8246ff9` 先被 rebase 成 `7bcb814` 再叠合并点版本提交。最终版本 0.1.100 → **0.1.101**，annotated tag `v0.1.101` → 3aeb042，main push CI success（run 42730136456），远端分支已随合并删除。
- base 从 `491ead6` 被 rebase 到 `ab96d6d`（因 PR #78 把「每个 PR 自判 CLI」写进 AGENTS.md + docs/releasing.md），**内容一字未改**；排队 reabse 是初号机常规动作，本线不用自己 rebase。
- 初号机复核：全量 1118 pass / 0 fail / 11264 expect / 83 files。三条破坏性验证全部真护栏：D1 把 `usedSignInProxies` 退回 `loginHistory + lastLogin` → `test/signin-proxy-order.test.mjs` 7 pass/3 fail；D2 去掉 `lib/server.mjs` 的 `extras.exit = exitFallback` → `test/accounts-routes.test.mjs` 31/1；D3 把 `renderDetailExit()` 提到身份更新前 → `test/accounts-page-ui.test.mjs` 10/1。均还原、git diff 为空。

【本线待办：下一个 cl PR 带上】非红线小瑕疵（初号机发现，我已同意修）：
`lib/server.mjs` 中当 `read.ok && read.mode === "custom"` 但该出口 URL **不在本地代理库**时（节点已删、providers.json 仍持有该 URL），`proxyByUrl.get(read.url) ?? null` 得到 null，仍赋值全 null 快照 → `formatExit` 因 `proxyId === null` 显示「直连」；而 PR #77 之前这类账号回退显示 `lastLogin` 的节点名 —— 属本次引入的显示回退（把「在用某个自定义出口」说成「直连」）。
修法一行：`const record = proxyByUrl.get(read.url) ?? null; if (record) fallback = loginSnapshot(record, null);`（`direct` 模式的 null 快照保留）。附一条「节点不在本地库时不投影」的用例。
不为它单开 PR（不值一格版本），合到下一个 cl PR 里。不投影后 `extras.exit` 缺省 → 列表回退 `view.exit ?? view.lastLogin`，与口径1一致。

其它：初号机不主动合远端 open PR，等各线开口；远端现只剩 #79（四号机 assets-cli）。
