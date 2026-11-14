---
title: 'clean-login 发版规则改制：合并点统一分配版本号（PR #62 / 5ba2bf5）'
description: >-
  clean-login PR #62（5ba2bf5）发版改制：PR 不再改 package.json version，由初号机在合并点唯一分配（单次 +1
  + annotated tag），按钮 id 收拢到 test/button-ids.mjs
type: project
updatedAt: '2026-11-08T16:00:00.170Z'
---
# clean-login 发版规则改制（PR #62 / 5ba2bf5，2026-11-08 生效）

- **核心变化**：版本号不再由贡献者在 PR 分支里预猜/预填，改为由 **Cindy初号机（`cindy-default`）在合并点唯一分配**。
- **贡献者规矩**：
  1. PR 分支**不改 `package.json` 的 `version`**（即使改动了 `lib/`、`ui/`、`page/`、`index.mjs`）。
  2. `scripts/check-version-bump.mjs` 现读取 `--event` / `GITHUB_EVENT_NAME`：`pull_request` 事件下允许保持 `package.json` 版本不变；`push` 到 `main` 时仍要求携带新版本号；若分支显式改了版本号，仍拒绝降级（`order < 0`）或等于 main 已发布号（`order === 0`）。
  3. 55 个按钮 id 已抽到唯一共享清单 `test/button-ids.mjs`（`test/server.test.mjs` 与 `test/accounts-page-ui.test.mjs` 共同 import），新增按钮只改 `test/button-ids.mjs`。
- **合并方（初号机）规矩**：
  - 合并前在 PR 分支上把 `version` 设为「当前 main 版本 +1」，提交推送并等 CI 再绿一次后合并。
  - 合并后在新 main 尖打 annotated tag；**一个 PR 只占一格版本、只打一个 tag**（取消原先「合并点一次、发布点再一次」的双 bump 惯例）。
  - 完整说明见仓库 `docs/releasing.md` 与 `AGENTS.md`（main `5ba2bf5`，基线 0.1.90，968 pass / 0 fail / 76 files）。
