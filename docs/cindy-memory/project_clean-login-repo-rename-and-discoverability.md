---
title: clean-login 仓库改名与可发现性改造 (v0.1.48)
description: >-
  clean-login 仓库改名 magpie-clean-login、元数据与可发现性实测；2026-11-08 description
  改为中文优先并复测搜索排名
type: project
updatedAt: '2026-11-07T19:53:22.769Z'
---
- 2026-11-07 仓库改名：`Gruu6y/clean-login` -> `Gruu6y/magpie-clean-login`（管理员权限 PATCH 成功，HTTP 301 自动重定向生效）。
- Topics 设置为 7 个：`magpie`, `magpie-plugin`, `magpie-page`, `clean-login`, `proxy-manager`, `browser-fingerprint`, `camoufox`（未加泛词 `cl`）。
- 全仓旧地址引用清理：通过 PR #32（v0.1.48）将 `package.json`、`README.md`、`docs/reporting.md`、`lib/issue-report.mjs` 以及 4 个测试文件同步更新为新仓库地址；保留运行时资产仓库 `Gruu6y/clean-login-browser`。
- 本地所有 clone/worktree 的 `origin` remote 已全部切至新 URL `https://github.com/Gruu6y/magpie-clean-login.git`。
- 包名 `@gruu6y/page-clean-login` 与插件 ID `magpie-clean-login` 保持不变。

## Description 改为中文优先（2026-11-08，主人要求）
- 主人看到 magpie 市场「非官方插件 · GitHub」卡片里我们的简介是英文，指出「我们绝大部分的用户是中文用户」。
- **数据源已证实**：该卡片描述取自 **GitHub 仓库 description**，不是 `package.json` 的 description。证据两条：①卡片文字与仓库 description 逐字相同，而 `package.json` 的 description 完全不同（"Manage proxy IPs and provider sign-ins in magpie..."）；②`magpie.exe` 里市场卡片结构体含 `Stars.json:"stargazers_count"`，即直接映射 GitHub 搜索 API 字段。`~/.cache/magpie/plugin-market.json` 里没有 clean-login（该 tab 是实时按 topic 搜 GitHub，95 条 cache 无命中）。
- 新 description（159 字符 / 254 字节，PATCH 成功）：
  `干净登录（CL）· magpie 非官方插件：每个账号用独立浏览器身份登录供应商，按账号绑定代理 IP，登录出口延迟实测。Unofficial magpie plugin for isolated provider sign-ins, per-account browser profiles and proxies.`
- 保留英文尾巴的理由：GitHub 仓库搜索只匹配「仓库名 + description + topics」，英文关键词留在 description 里才不丢掉改名任务挣来的可发现性；中文放最前面保证卡片可见区是中文。
- 改后未登录 REST 实测（per_page=100）：`magpie clean login` 1/1、`magpie clean-login` 1/1、`magpie-clean-login` 1/1、`magpie 干净登录` 1/1 —— 精确词全部保持第 1；`magpie CL` 71 条第 36（改前 69 条第 14，**有回落**）；`magpie plugin` 299 条未进前 100、`magpie-plugin` 479 条未进前 100、`topic:magpie-plugin` 346 条未进前 100、`topic:magpie` 259 条未进前 100（这四条改前也未进前 100，无回归）。
- `package.json` 的 description 仍是英文，未动：它不在 magpie 市场卡片的数据链路上（magpie 的 `json:"description"` 结构体挨着 `inputSchema`，属 MCP tool 而非插件 manifest），只影响 npm 页面。要不要一并中文化属独立决定。
- 旧 description（已被取代，留档）：`Magpie Clean Login (CL) · 干净登录 — unofficial magpie plugin for isolated provider sign-ins, per-account browser profiles and proxies.`
