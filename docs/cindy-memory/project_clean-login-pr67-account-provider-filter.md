---
title: 'clean-login PR #67：账号页按供应商筛选（已合并发版 v0.1.93）'
description: 'clean-login PR #67 账号页按供应商筛选：已合并发版 0.1.93（main a7ad2ca，1034/0）'
type: project
updatedAt: '2026-11-08T18:58:15.713Z'
---
# clean-login PR #67：账号页按供应商筛选（已合并发版 v0.1.93）

- 用户 m03099「原型通过了，直接开发吧」→ 把已批准的交互原型落到真代码。
- **PR #67**：https://github.com/Gruu6y/magpie-clean-login/pull/67
- **已合并发版**：初号机已于 2026-11-08T18:46:43Z 合并发版，分配版本号 **0.1.93**，打 annotated tag `v0.1.93`（tag object `0979646`，commit `96dbafc`），main CI 双绿。
- 分支 `cindy-default/account-provider-filter` 两个提交进入 main 链：`c9942ce`(功能) + `1a5ed84`(README/截图)；合并点由初号机追加入 `96dbafc`(chore(release): assign 0.1.93 at the merge point)；随后初号机合入修合并脚本传播延迟的 PR #68（`a7ad2ca`），当前 main 为 `a7ad2ca`（仍是 0.1.93）。

## 信息架构与实现
- 主行 = `全部供应商` + 账号数最多的 4 家（`PRIMARY_PROVIDER_LIMIT=4`，count desc→label→provider 稳定排序）；其余收进**唯一**一个折叠区且**穷举**（含已在主行的），不靠折叠藏东西；折叠区可按显示名或原始 id 搜索，每项显示名称 + id + 计数。
- 从折叠区选中的项会 promote 进主行并加 `is-selected-extra`（CSS `border-style:double; 3px`），当前筛选始终可见。
- chip 计数基于**全部账号**，不随搜索/状态变化，避免指针下跳动。
- 与状态筛选、搜索、排序 AND 组合；一行摘要列出全部生效条件；一个「清除筛选」复位三者 + 排序。
- 供应商消失 → `normalizeSelectedAccountProvider` 回退 `all`；无 provider 字段的账号归入「未知供应商」桶。

## 顺带修掉的既有缺陷
- `filterAccounts`/`sortAccounts` 原本吃原始身份（只有 `provider` id、无目录显示名）→ 搜「Qoder CN」搜不到、按供应商按 id 排。修法：`ui/app.js` 的 `accountForList(account)` spread 原记录、只加 `providerLabel`，再投影给过滤与排序。**勘误**：`accountView` 返回值已含所有行动作处理器要读的字段，故「必须 spread 否则 accountId 丢失」不成立；保留 spread 是更稳妥写法。
- `.provider-more-panel` 原 `right:0`，而 toggle 在行首，340px 面板向左越出视口、内容被裁 → 改 `left:0` + `background:var(--paper-3)` + shadow；780px 断点内 `left:0; right:0; width:auto`。

## 验证与双向核对
- 新增 `ui/account-provider-filter.js`（纯函数，无 DOM）；`ui/account-view.js` 加 provider 维度；新增 `test/account-provider-filter.test.mjs` 14 条；`test/button-ids.mjs` 55→57。
- 折叠区用 button+div[hidden]（页面仍只有 1 个 `<details>`）；四语言各 11 个新键无 innerHTML/localStorage；深浅色走主题令牌；行动作在新管线下仍解析同一 provider/key/指纹。
- 本线与初号机独立复跑结果完全一致：`bun test` → **1034 pass / 0 fail / 10415 expect / 80 files**。
- 真 Chrome 验收脚本 `workspace/tools/verify-account-provider-picker.mjs`：33 条断言全过（含桌面浅深色与 320px 视口无溢出、面板全在视口内、弹窗正常）；出图 `documents/2026-11-09-账号页-供应商筛选-{浅色,深色,320}.png`。
- 破坏性验证：7 条本线全红 + 3 条初号机独立全红后还原。
- README 一并收口：说明书节数从十节改成十一节（补上续期托管主题）；`assets/screenshot-accounts.png` 重新出图（中性路径与磁盘数字）。

生产状态：代码已合入 main 并发布 v0.1.93，等 magpie 更新插件即可在实际环境看到。
