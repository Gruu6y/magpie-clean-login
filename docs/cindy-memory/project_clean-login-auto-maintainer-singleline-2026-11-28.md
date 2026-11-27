---
title: 'clean-login 巡检交接：AGY 退出，Cindy 单线全量接管（2026-11-28）'
description: >-
  AGY 退出 clean-login GitHub 巡检（仅巡检，插件开发需求仍可能找 AGY）；Cindy GitHub App Webhook 自动化接管全量 Issue/Comment/外部 PR 审计，
  agent:cindy/agent:agy 路由与零 LLM 打标废弃，notify.mjs 微信通知链路暂维持现状
type: project
updatedAt: '2026-11-27T16:56:16Z'
---

## 来源与背景

AGY 交接消息（2026-11-28，主人经 AGY 转达）：clean-login 的 GitHub 巡检与自动维护工作**完全交付给 Cindy**，AGY 退出巡检任务（仅退出巡检；后续插件需求主人仍可能按需找 AGY 开发）。交接时 main 在 v0.2.12，Open Issue / Open PR 均为 0，AGY 侧无在跑巡检任务。

## 切换结果（已生效）

- Cindy 自动化（schedule id `ebc2599c-7242-408f-87e0-7695165c6f25`，仓库 `Gruu6y/magpie-clean-login`）已切换为全量 Webhook 监听：`issues.opened`、`issues.reopened`、`issues.labeled`、`issue_comment.created`、`pull_request.opened`、`pull_request.reopened`、`pull_request.synchronize`；source = `github-app` preset。
- 不再依赖 `issues.opened` 阶段由 AGY 侧车零 LLM 规则打 `agent:cindy` 才启动；新 Issue 一律直接接单。`agent:cindy` / `agent:agy` 路由标签与「超范围退回 AGY」逻辑全部废弃，AGY 不再消费 `agent:agy`。
- 接管范围：全部 Tier 3 Issue（复杂/核心区改动、`from-plugin` 报告、空白 Issue、需要 CLI 支持的功能建议）、`issue_comment` 续办（尤其 `agent:needs-info` 补充后）、Tier 4 外部贡献者 PR 审计（非 `cindy-default/*` 分支，仅安全/注入与规范审计，绝不自动合并）。
- 文档/模板同步见 PR #131（分支 `cindy-default/auto-maintainer-singleline`，docs-only 不 bump 版本）：`docs/auto-maintainer.md` 改为单线手册；`.github/ISSUE_TEMPLATE/` 去掉「执行器分流/路由」措辞。
- 微信通知 bot 链路**暂时不动**：Cindy 复用 AGY 侧车的 `notify.mjs`（`C:/Users/Administrator/.gemini/config/sidecars/clean-login-maintainer/notify.mjs`）发异常/审计告警，标题必须以 `Cindy：` 开头、正文第一行注明来源；待主人后续决定去留。原微信双向指令通道随 AGY 退出失效。
- 防循环标记统一为 `<!-- cl-cindy-maintainer -->`；历史 `<!-- cl-auto-maintainer -->` 仅作忽略用。

## AGY 退出确认（2026-11-28，主人转达 AGY）

AGY 侧已确认完成巡检退出，Cindy 单线接管无重复处理风险：

1. GitHub 仓库 Webhook **#715332111**（`qhl.tailafb0fb.ts.net/github-webhook`）已停用，`active: false`。
2. 本地 `clean-login-maintainer` 侧车的 `webhookEnabled` 与 `cindyRoutingEnabled` 均设为 `false` 并重启验证；`/github-webhook` 请求直接忽略，不再派发任何巡检任务或处理 `agent:agy`。
3. 微信 `notify.mjs` / `/internal/notify` 通知链路保持现状，供 Cindy 异常时复用。

## 待办 / 边界

- AGY 侧停掉 GitHub Webhook 分流与任务派发已完成（见上节确认）；无遗留巡检任务或 `agent:agy` 消费。
- 巡检继续遵守仓库 `AGENTS.md`：从最新 `main` 开 `cindy-default/<topic>`、不直推 `main`、全量 `bun test`、tmpdir 隔离、不碰真实 `~/.config/magpie/`、贡献 PR 不改 `version`、每个 PR 自判 CLI 同步。
- 合并仍由 Cindy 自己执行：低/中风险自研 PR 用 `scripts/merge-release.mjs`，`Stopped` 绝不绕过；高风险停在 `agent:ready-to-merge` 交主人。Tier 4 外部 PR 绝不合并。
