---
title: 'clean-login 版本号改由合并方在合并点统一分配（PR #62，main 5ba2bf5）'
description: 'clean-login 发版改制：版本号由合并方在合并点统一分配（PR #62 已合并，main 5ba2bf5）'
type: project
updatedAt: '2026-11-08T16:53:06.145Z'
---
# 版本号改由合并方在合并点统一分配（PR #62 已合并，main 5ba2bf5）

2026-11-08 主人通过二号机转达：PR #59 交付 39 分钟里「两次 rebase + 两次让号」独占约 10 分钟，责任在初号机没管好并行发版，方案由初号机出并同步各线。主人明确「CI 等待是应该的」，方案只针对 main 漂移导致的重复重基/让号，**不砍不绕 CI**。

## 新规则（取代旧「每条分支必须自己 bump version」）

旧规则见 `project_clean-login-process-and-repo` 的 c004/c010，已作废。

1. **贡献线不改 `package.json` 的 `version`**，照常从最新 main 开分支、带测试、全量 `bun test`、提 PR。若自己写了版本，仍会被门禁拦「降级」与「等于已发布号」。
2. **合并点即发版点**：初号机在 PR 分支上把 version 设为「当前 main + 1」、提交（主题 `chore(release): assign X.Y.Z at the merge point`）并推送，等 head CI 双绿再 rebase 合并。
3. 合并后在**新 main 尖**打 annotated tag `vX.Y.Z` 并推送（main 线性历史 + rebase 合并会重写分支 SHA，合并前打 tag 会脱钩）。**一个 PR 只占一格版本、只打一个 tag**，不再跑 `release.mjs` 二次发版（该脚本保留作手工/应急）。
4. **主人 2026-11-09 确认方案 1 保持现状**（m06260）：「一个 PR 只做一件事」不变，合并点叠上去的**只是版本号那一行**，绝不夹带功能。曾给他三个选项（现状 / squash 压成一格 / 完全不碰贡献方分支但 PR 会显示 closed），他选现状。
5. 纯 docs/scripts/test/CI 改动**不 bump、不打 tag**（PR #62/#47/#57 先例），不为演示流程发无意义版本。

## 门禁按事件区分

`scripts/check-version-bump.mjs` 新增 `--event <event>`，缺省读 `GITHUB_EVENT_NAME`。`pull_request` 下改了 shipped 代码却没 bump = 放行 `OK (pull_request)`；`push`（main）下没 bump = 仍 fail；本地不带事件 = 严格。`lib/ ui/ page/ index.mjs` 是 release-relevant 集合。合并前必须在 PR 分支完成 bump，否则合并提交推到 main 时门禁红。`ci.yml` 的 version-bump job 已传 `GITHUB_EVENT_NAME: ${{ github.event_name }}` 与 `--event`。本地复核命令：`bun scripts/check-version-bump.mjs --base origin/main --event pull_request`。

## 第二处机械冲突已消除

55 项按钮 id 曾同时硬编码在 `test/server.test.mjs` 与 `test/accounts-page-ui.test.mjs`，并行 PR 必在尾部冲突。已抽成 `test/button-ids.mjs`（`export const buttonIds`），两个测试 import 同一份。加按钮只改这一处。

## 串行队列与广播

同一时刻只合并一个 PR；有在途 PR 时先广播「即将发版 + 目标版本号」，让各线推送前对齐。机械冲突（package.json 版本、按钮清单）由合并方代解，贡献线不用反复重基。**CI 等待是必要成本，不优化它。** 已广播一/二/三/四号机，制度写在 `docs/releasing.md`，AGENTS.md 与两份 README 同步更新。

验证：PR #62 全量 968 pass / 0 fail / 76 files；破坏性验证两次（拆掉 `isPullRequest` → 3 条新用例红；往按钮清单塞 ghost id → 两个文件同红），均还原。

首次真跑（PR #63 / #64）见 `project_clean-login-pr63-pr64-merge-point-runs.md`。
