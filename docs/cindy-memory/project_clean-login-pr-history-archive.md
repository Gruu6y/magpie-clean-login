---
title: clean-login PR 历史索引（2026-11-09 归档 47 个流水账 shard）
description: >-
  归档 47 个 clean-login PR 流水账 shard；原文与逐 PR 索引在
  workspace/memory-archive/2026-11-09-cl-pr-shards/；PR #63 removed
  复原已查明为误判（主人早已拍板），待定夺项为零
type: project
updatedAt: '2026-11-08T23:05:27.849Z'
---
原文 47 份 / 280397 字节完整保存在 workspace/memory-archive/2026-11-09-cl-pr-shards/，逐 PR 一行索引、全部教训、未闭环项在同一目录的 pr-archive-index.md，未删除；功能细节的事实源是 git 与 PR 页面。
保留的 4 个同前缀主题 shard：process-and-repo / provider-card-copy / provider-first-use-registration / provider-logos（非流水账，未归档）。

## 归档的 47 个 shard（逐 PR 结论与全部教训见 pr-archive-index.md）
- pr15-remove-identity-card / pr18-method-inputs / pr19-proxy-keyword-filter
- pr20-code-signin / pr21-plugin-cards / pr22-pr25-native-and-egress
- pr23-market-catalog / pr26-pr27-search-and-agent-surface / pr27-agent-surface
- pr28-pr29-editorial-ui-and-fingerprint-fix / pr30-readme-rewrite-and-real-screenshots / pr32-repo-rename-magpie-discoverability
- pr34-sandbox-notice-and-pending-pr35-pr36 / pr35-signin-proxy-order / pr36-magpie-only-copy
- pr36-magpie-only-no-prose / pr37-editorial-brand-mark / pr38-signin-proxy-latency
- pr39-pr42-merged-0-1-70 / pr40-antigravity-unpaid-notice / pr41-follow-host-theme
- pr42-provider-latency / pr43-version-gate-monotonic / pr43-version-gate
- pr45-pr46-and-0-1-72 / pr45-pr46-followups-v2 / pr45-pr46-followups
- pr45-pr46-merge-0-1-72 / pr48-provider-logos / pr49-market-install
- pr50-icon-embed-table / pr51-user-guide-tab / pr53-guide-two-sections
- pr54-account-fingerprint-rotation / pr54-rotate-fingerprint-and-0-1-84 / pr55-renew-hosting
- pr56-readme-beginner-screenshots / pr56-readme-rewrite-real-screenshot-generator / pr57-readme-screenshot-privacy
- pr58-renew-hosting-race / pr58-renew-hosting-refinements / pr59-import-magpie-credentials
- pr62-release-rule-centralization / pr62-release-rule-reform / pr63-first-use-registration-and-0-1-91
- pr63-pr64-merge-point-runs / pr64-import-native-logins

## 现在的制度（覆盖这些 shard 里的旧说法）
- PR #62 起贡献者不碰 version，合并方在合并点单点分配，一 PR 一格一 annotated tag；发版细则见 docs/releasing.md，机械段由 scripts/merge-release.mjs（PR #65）代跑。
- 版本降级/让号坑、两次 rebase 的根治经过见 project_clean-login-merge-point-release.md。
- 反复踩的通用坑：复现门禁要用目标版本的脚本（#45）；报测试数前先 bun install（缺 fpgen-js 会假红）；release.mjs 拒绝落后 main 的分支；non-fast-forward 先 fetch 再 rebase、绝不 force-push；不要在真工作区 `git checkout -- .`；不要改被测源码插探针。完整版见归档索引。

## 仍生效的产品事实（完整版见归档索引）
- 直连即真直连（signInProxyUrl(null) → ""）；providers:list 信封走 page/boot.js 的 target.hash；图标必须落在 page/ 内且 currentColor 恒黑；magpie 有 plugin-auth.json 与 logins.json 两个凭据存储、判活/导入/清扫/DELETE 必须取并集；antigravity 文案是主人定版不得改动；README 首图不重截。

## 待定夺项：零（2026-11-09 事实更正）
- 这里原先挂着的「PR #63 `state === "removed"` 复原待主人定夺」**是误判，已关闭**。查四号机会话 `ccb83d08-fbec-4dcf-a65e-dd417b39b55f` 原件，主人 `2026-11-08T16:04:56.446Z` 原话「主动移除过cl也可以补\n完全没有记录的本质上和从未在magpie完成首次使用有什么区别」，早已拍板；PR #63 的实现正是照此办理，行为保持现状、无需再问。归档目录 `pr-archive-index.md` 里的「唯一未闭环项」是当时的历史快照，勿再引用。误判根因：跨机请求没转述主人原话，见 `feedback_cross-agent-owner-verbatim-rule.md`。

## 旧结论勿再引用
- 「每个 PR 自己 bump」「两格版本」「截图未重渲」「#35/#36 待合并」「仓库名 clean-login」均已过时。
