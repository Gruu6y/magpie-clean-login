---
title: 'clean-login agent CLI 覆盖面（0.1.97 / PR #73）'
description: 'clean-login agent CLI（0.1.97 PR #73）覆盖的读写命令、位置参数/编码契约与 --only 语义'
type: project
updatedAt: '2026-11-09T23:51:44.139Z'
---
# clean-login agent CLI 覆盖面（0.1.97 / PR #73）

## 是什么
`lib/agent-cli.mjs` + `bin/clean-login.mjs` 是随插件发布的**零依赖命令行客户端**：自己发现端口与页面 token（loopback 自动读页、远端 `magpie web` 须 `--token`），一次请求走一步，**从不打印 token**，除运行时 `fetch` 外无依赖（不加载浏览器模块，毫秒级启动）。

## 0.1.97 起的完整覆盖（此前只到「读摘要」）
- 读：`status` / `providers` / `proxies` / `accounts` / `signin status` / `score status` / `env` / `proxy test` / `check`。
- **新增写操作与作业控制**：`proxies add <name> <type> <host> <port> [--user --pass]`、`proxies delete <proxyId>`、`proxies targets`；`accounts import plan` / `accounts import run [--only KEY ...]`、`accounts delete|note|exit|prune|hosting`、`score cancel`、`env cancel`、`report --provider --note [--language]`、`market status|install <package>`。

## 必须遵守的接口契约（CLI ↔ 服务端）
- `accountPath(provider, key, child)` 对 provider 与 key **都做 `encodeURIComponent`**（slot key 含 `#`，不编码就会被路由截断）。破坏性验证证实：去掉 key 的编码 → `test/agent-cli.test.mjs` 变红。
- `accounts exit` GET → `/api/accounts/<p>/<k>/exit`；写用 PATCH `{mode}`，`--mode custom` 追加 `{proxyId}`（服务端绝不读客户端提交的 URL 文本）。
- `accounts import run` 的 `--only` 是**可重复**旗标（`--input`、`--only` 是仅有的两个可重复项；`--key` 保持普通字符串，因为 `check` 那样读）。
- `proxies add` **刻意用位置参数**传出口 host/port（`--port` 已是服务端口）；`--user`/`--pass` 映射到存储字段 username/password。
- `/api/accounts/import/plan`(GET) 与 `/api/accounts/import`(POST) 是**精确匹配**，必须排在 `/api/accounts/<provider>/<key>` 匹配器之前；预览与真导入走同一个 `planImportFromDisk`，所以预览与导入不可能对不上。

## README
中英 README 的「命令行」小节都列了这批命令与示例（`accounts import run --only <provider>#<recordId>` 等），改 CLI 覆盖面时要同步两处。
