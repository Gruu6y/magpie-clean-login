---
title: 'clean-login CLI 补齐（PR #73）：账号与出口的完整命令行操作'
description: 'clean-login CLI 对齐服务端：PR #73 新增的账号/出口/代理子命令、两处设计取舍与验证数据'
type: project
updatedAt: '2026-11-09T23:40:44.842Z'
---
clean-login CLI 补齐到与服务端对齐：PR #73（分支 `cindy-xh2xyp/cli-parity`，head `e741d9a`，基于 origin/main `941634a` = 0.1.95）。

起因：主人问「远端加了这么多功能，cl 插件的 CLI 是不是也得更新一下」。诊断结论：服务端有改出口（0.1.95）、导入 magpie 已有账号（#64）、按账号托管续期、市场安装、清理孤儿目录，而 `bin/clean-login.mjs`（23 行，逻辑在 `lib/agent-cli.mjs`）只覆盖 agent/status/providers/proxies/accounts/signin/native/proxy/score/env/check —— 最有价值的三类（导入账号、改出口、增删代理）只能开页面点。

新增子命令（全部映射已有路由，未动服务端）：`proxies add <name> <type> <host> <port> [--user --pass]`、`proxies delete <id>`、`proxies targets`、`accounts import plan|run [--only KEY ...]`、`accounts delete|note|exit|prune|hosting`、`accounts exit --mode inherit|direct|custom --proxy ID`、`score cancel`、`env cancel`、`report --provider --note --language`、`market status|install <package>`。

两个刻意的设计取舍（改的时候别踩）：
1. `proxies add` 的出口 host/port 用**位置参数**，因为 `--port` 已经表示服务端口，同名旗标会歧义。
2. `--only` 是新引入的可重复旗标，`--key` 保持普通字符串 —— `check` 命令读 `options.key`，改成数组会静默破坏现有行为。
3. 账号路径两段都 `encodeURIComponent`，否则 `provider#slot` 的 `#` 会截断路径。

验证：局部 `bun test test/agent-cli.test.mjs` 20 pass/0 fail（新增 3 例）；全量 1079 pass / 0 fail / 10733 expect / 80 files（基线 1076+3）；破坏性验证两次都真变红（去掉 port 的 `required` → 1 fail；去掉 key 的 `encodeURIComponent` → 1 fail）。按 #62 新规**不改 package.json version**，由合并方在合并点分配。

坑：我一度把机器相关的真实账号记录 id 写进 README 示例，已改回 `<provider>#<recordId>` 通用占位；给公开仓库写示例永远用占位符。
