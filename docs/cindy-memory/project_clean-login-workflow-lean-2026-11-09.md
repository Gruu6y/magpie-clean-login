---
title: clean-login 工作流瘦身六条（主人 2026-11-09 批准并执行）
description: clean-login 工作流瘦身六条（A–F）已批准执行；验收数据与待定夺项已清零（#63 removed 复原为误判，主人早已拍板）
type: project
updatedAt: '2026-11-08T22:58:50.715Z'
---
适用仓库 magpie-clean-login（REPO = workspace/clean-login-standalone）。方案文档：workspace/documents/2026-11-09-cl-workflow-lean-plan.md。主人于 m06343 批准「两点都同意，按这个方案执行，先把C的PR提了」（B 复核分级与 E-② 归档均同意），整套执行。

## A 本地全量测试 3 次 → 1 次
只在「含版本号的最终 head」跑一次全量 bun test；贡献方的自测数字直接引用（需其给出 files/expect 数与 CI 链接），不再在我这边重复开 worktree 跑一遍。

## B 复核按风险分级（不是放松，是把力气放对地方）
- 高（凭据读写、DELETE/清扫、生产配置、安全红线）→ 读完整 diff + 全量 + 破坏性验证（把护栏改掉看它红、还原看它绿）+ 真机只读抽查。
- 中（lib/ui 功能且带测试）→ 读 diff + 相关测试 + 全量一次。
- 低（docs / test-only / CI / 文案 / 截图 / scripts / AGENTS.md）→ 静态审查 + 相关测试，不跑全量，由 CI 两 job 兜底。
- 一律不砍：CI 两 job 与 main push 全量、破坏性验证、读 diff、版本号单点分配、一个 PR 一件事。

## C 机械段脚本化（PR #65 已上线 main 0051b29）
`scripts/merge-release.mjs` 把 fetch→worktree→install→tests→bump 一行→push→等 CI→rebase 合并→tag→同步 main 串成一条命令。护栏绝不 force-push、只许改 package.json 一行、CI 不绿不合、tag 打在合并后的 main 尖、docs/test/scripts PR 不凭空发版本。复核与破坏性验证**不进脚本**。`node scripts/merge-release.mjs 65` 真跑成功，输出 stages = preflight→checkout→install→version-skipped→tests→push-skipped→wait-for-ci→merge→tag-skipped→cleanup，从 12+ 工具调用降到 1 条命令。

## D 通信模板化 + 按需广播
回执只发合并方给贡献方（合并 commit / tag / 版本 / 测试数 / 护栏结论）；只有「规则变更」才广播四线。合并结果不再逐线重复通报。

## E 记忆
- E-① 以后 PR 只记三类：新规/制度、可复用教训、未闭环待定夺项。不记逐 PR 流水账（结论、版本、测试数、commit 这些以 git 与 PR 页面为事实源）。
- E-② 已归档 47 个 PR 流水账 shard：原文 51 份 / 280397 字节完整保存在 workspace/memory-archive/2026-11-09-cl-pr-shards/（含逐 PR 一行索引 pr-archive-index.md、lessons.txt、pr-shards-extract.json、build-pr-index.mjs、drop-pr-shards.mjs），一条精简索引记忆 project_clean-login-pr-history-archive.md 取代之。4 个同前缀主题 shard 保留。五条线同步删除（镜像 R3 不会自动删除，必须同时删否则复活），最后一次镜像 slugs=70 conflicts=0。
- E-③ 镜像按需：只在新增/修订记忆时跑，不再每个 PR 跑。

## F 读法
读 diff 不读全文；测试输出只取结论行（pass/fail/expect/files），不回显逐条用例。

## 验收
PR #65 本身即新流程第一次真跑：`gh pr checks 65` 双绿 → 一条命令合并 → main push CI test + version-bump 双绿；main 版本仍 0.1.92（该 PR 只动 scripts/test/docs/AGENTS，按新规不 bump 不打 tag）。

## 待定夺项：零（2026-11-09 事实更正）
原先此处挂着的「PR #63 `state === \"removed\"` 复原是否待主人定夺」**是误判，已关闭**：查四号机会话 `ccb83d08-fbec-4dcf-a65e-dd417b39b55f` 原件，主人早在 `2026-11-08T16:04:56.446Z` 就拍板过，原话「主动移除过cl也可以补\n完全没有记录的本质上和从未在magpie完成首次使用有什么区别」。PR #63 的实现（removed 也补 `magpie provider add`）正是照此拍板做的，行为保持现状，无需改动、无需再问。误判根因是四号机跨机请求没转述主人原话，见 `feedback_cross-agent-owner-verbatim-rule.md`。
