---
title: clean-login 工作流瘦身新规（主人已批准，2026-11-09 初号机广播生效）
description: >-
  工作流瘦身新规六条 + 2026-11-10 新增第七条「每个 PR 自判是否同步 CLI」：贡献线 PR 不碰
  version、复核分级、merge-release.mjs 机械段、本地全量一次、记忆只记三类、跨机请求带原话、CLI 判断写进 PR 描述
type: project
updatedAt: '2026-11-10T00:24:01.750Z'
---
## 生效与来源

2026-11-09 初号机广播，主人已批准，范围=全部同源工作线（规则变更才广播四线）。方案全文在初号机 `workspace/documents/2026-11-09-cl-workflow-lean-plan.md`，仓库侧说明在 `docs/releasing.md`「机械段由脚本代跑」。

## 六条规则

1. **贡献线 PR 一律不碰 package.json version**（PR #62 起的规则不变）；一个 PR 一件事、从最新 main 开分支、带测试、提 PR 时给全量 `bun test` 的 files/expect 数。
2. **复核分级由合并方执行**（不是让贡献线少写测试）：高=凭据读写/DELETE/清扫/生产配置/安全红线 → 读全 diff + 全量 + 破坏性验证 + 真机只读抽查；中=lib/ui 功能且带测试 → 读 diff + 相关测试 + 全量一次；低=docs/test-only/CI/文案/scripts/AGENTS.md → 静态审查 + 相关测试，CI 两 job 兜底。**CI 两 job 与 main push 全量一行没砍，破坏性验证没砍**，主人明确「ci等待是应该的」。
3. **机械段已脚本化**：`scripts/merge-release.mjs`（PR #65，main `0051b29`）。合并方一条命令代跑 fetch→worktree→install→tests→bump 一行→push→等 CI→rebase 合并→tag→同步 main。护栏：绝不 force-push、只许改 version 一行、CI 不绿不合、tag 打在合并后的 main 尖、**docs/test/scripts PR 不凭空发版本**。贡献线不需要用它。
4. 本地全量从 3 次降到 1 次（只在含版本号的最终 head 跑）；回执只发合并方→贡献方，只有规则变更才广播四线；读 diff 不读全文、测试输出只取结论行。
5. **记忆以后只记三类**：新规/制度、可复用教训、未闭环待定夺；**不再逐 PR 记流水账**（结论/版本/测试数/commit 以 git 与 PR 页面为事实源）。47 个历史 PR 流水账 shard 已归档：原文 51 份完整保存在初号机 `workspace/memory-archive/2026-11-09-cl-pr-shards/`，逐 PR 索引 `pr-archive-index.md`；记忆里由 `project_clean-login-pr-history-archive.md` 取代；4 个同前缀主题 shard 保留（provider-card-copy、provider-first-use-registration、provider-logos、release-at-merge-point）。
6. **待定夺项：零**（2026-11-09 事实更正）。这里原写的「PR #63 `state === \"removed\"` 复原语义待主人定夺、别自行改」是误判：查四号机会话 `ccb83d08-fbec-4dcf-a65e-dd417b39b55f` 原件，主人 `2026-11-08T16:04:56.446Z` 原话「主动移除过cl也可以补\n完全没有记录的本质上和从未在magpie完成首次使用有什么区别」，早已拍板。PR #63 的实现（removed 也补 `magpie provider add`）正是照此办理，**行为保持现状、不是待定项、不用再问主人**。误判根因是跨机请求没转述主人原话，见 `feedback_cross-agent-owner-verbatim-rule.md`。

## 二号机独立核实（2026-11-09）

- `git fetch` 后远端 main = `0051b29 chore(release): one guarded command for the merge-and-release steps`（= PR #65 merge commit），`scripts/merge-release.mjs` 在 main 上；最新 tag 仍 `v0.1.92`，**docs/test/scripts PR 不发版本属实**；PR #65 未碰 lib/ui/page/index.mjs，version 仍 0.1.92。
- 归档目录文件完整：`pr-archive-index.md`（47 个 PR）+ 47 份 `project_clean-login-pr*.md` + `pr15~pr58-renew-hosting-race.md`（51 份 PR 相关）+ 4 份保留主题 shard + `before-MEMORY.md` + `after-MEMORY.md`。
- 共享记忆索引已指向 `project_clean-login-pr-history-archive.md`；初号机 shard 含「历史 PR 流水账归档边界」与移出清单，47 个旧 shard 名逐条列出。
- 二号机自己的 PR #66（AGENTS.md 引用军规）在 main 推进后仍 `MERGEABLE/CLEAN`（`git merge-tree` 无冲突标记）：main 只在发布纪律段加了一行 merge-release.mjs，与 #66 改的顶部新节/ownership 行不重叠。#66 属低级复核类，CI 两 job 双绿，本地全量 996/0/10180/78 已给 files/expect。

## 对二号机的执行口径

- 后续 PR 照第 1 条提（不碰 version、带测试、给全量 files/expect）；本级功能 PR 在描述里写清属高/中/低哪一级，方便合并方分级。
- 不给初号机回「收到」类消息（回执只发合并方→贡献方）；记忆不再逐 PR 记流水账，本条属「新规/制度」故记。
- 主人 2026-11-09 01:47 指令「初号机先不动」仍有效：不铺军规到初号机、不主动发合并请求，PR #66 等主人一句话。
- 2026-11-09 新增（主人 m06913）：**跨机请求必须逐字带上主人原话**，不得概括成「主人已批准」；完整规则见 `feedback_cross-agent-owner-verbatim-rule.md`。


## 七、每个 PR 自判是否同步 CLI（主人 2026-11-10 新规，三号机转达，全四线适用）

主人原话（逐字）：「关于插件cli的问题,每个pr都要自己判断需不需要更新cli,不单单针对你,针对所有cindy」。

- **范围**：合规线（clean-login / magpie-clean-login）的**每一个 PR**，不是只针对某条线。
- **口径**：提 PR 的人自己判断这次改动要不要同步 CLI（`lib/agent-cli.mjs`，必要时 README 的 CLI 段）；结论**必须写进 PR 描述** —— 要么「已更新 CLI：改了哪几条命令」，要么「不需要动 CLI：理由 X」，不许省略这一步。
- **判据**：CLI 的意义是「不开网页也能把整套操作做完」。凡是新增/改动了 `lib/server.mjs` 的 `/api/*` 路由、参数形状或语义 —— 尤其账号（导入/备注/删除/续管托管）、出口（改出口、出口检查）、代理（增删/探测目标）、市场安装、报 issue 这类能纯靠命令行完成的动作 —— 就要看 CLI 有没有对应子命令。纯内部实现（扫描器、渲染、图标、测试）一般不用动。`clean-login help` 可看全现有命令。
- **背景（含我自己的教训）**：CLI 曾长期落后服务端。**我自己的 0.1.95 PR #71（账号出口 GET/PATCH `/api/accounts/:p/:k/exit`）就是漏网的那一个** —— 当时只改了 lib/server/ui/test，没碰 CLI，导致改出口只能开网页点，直到三号机的 PR #73（提交 `1a0f268 feat(cli): drive accounts and exits without opening the page`，发版 0.1.100）才补齐。可复用教训：**新增/改动路由的那次 PR 内就要判断 CLI，不要留到后续补**。
- 仓库文档侧：三号机已请初号机把这条写进 `AGENTS.md` 与 `docs/releasing.md` 的合并方检查清单。
- **二号机独立核实（2026-11-10）**：main 尖 `491ead6` = 0.1.100；`git show origin/main:lib/agent-cli.mjs` 确有 `case "accounts"` 下的 `action === "exit"` 分支（`:375-383`，GET 无 `--mode`、PATCH 带 `--mode inherit|direct|custom`，custom 需 `--proxy ID`），help 文案在 `:233-234`。即我的出口路由缺口**已由 #73 关闭，无需我补做**。
