---
title: 'clean-login 凭据边界：出口 URL 只回 scheme://host:port'
description: >-
  不变式：代理/出口凭据不出服务端，HTTP 边界只回 scheme://host:port；含仓库四处先例、exitDisplayUrl 实现、复核清单与
  PR #69 教训
type: project
updatedAt: '2026-11-09T02:16:28.461Z'
---
## 不变式

**代理/出口凭据不出服务端。** 任何回给页面的结构，出口 URL 最多只能是 `scheme://host:port`；用户名密码、`user:pass@` 段一律不得出现。这条同时适用于 HTTP 响应体、DOM 文本、README 截图和 issue 正文。

## 仓库里的既有先例（复核时拿它们当判据，不是我自己加的标准）

- `lib/proxies.mjs` 的 `publicProxy(record)`：只给 `hasPassword: Boolean(record.password)`，从不返回 password。
- `lib/agent-surface.mjs` 文件头注释：「It never reads or returns a credential. A password is reported only as a boolean」。
- `lib/issue-report.mjs`：固定字段白名单，注释明写「proxy credentials therefore cannot reach the issue」。
- `ui/app.js` 的登录出口选择器 `renderSignInProxies()`：注释「Name, address and probe latency/status only; never the password (the API omits it and the page never sees it)」，选项文案走 `ui/proxy-state.js` 的 `formatAddress()`（只 `host:port`）。
- 主人点名「和供应商页面做得差不多」时，参照物就是这几处——所以「差不多」等于**不显示凭据**。

## 已落地的实现

`lib/server.mjs` 的 `exitDisplayUrl(value)`：非字符串/空/`"direct"`/不可解析 → `null`；能解析 → `${url.protocol}//${url.host}`。结构上不可能回显凭据，所以调用方不需要再判断。账号出口视图 `exitView()` 只回 `displayUrl` 与 `exitDisplayUrl(providerProxy)`，**没有裸 `url` 字段**；孤儿 custom 出口显示 `accountDetailExitCustom` + 脱敏地址。lib 层 `readAccountExit`/`writeAccountExit` 保持原样返回真实 URL（那是服务端内部读写需要）。

## 复核这类改动的检查清单

1. 新路由/新视图字段是否把 `provider.proxy`、`accountProxies`、`proxyUrlFor()` 的结果原样透传（main 上这两个字段从不进页面，出现即新暴露面）。
2. 测试是否断言 `JSON.stringify(body)` 不含完整 URL 也不含其凭据段（只断言「有 displayUrl」不够）。
3. 破坏性验证三处：脱敏函数改成回传真值、视图改回裸 url、providerProxy 改回原样透传——三处都该变红。
4. UI 侧是否还有 `accountDetailExit.url` / `exit.url` 残留。
5. 截图：详情对话框若会显示出口，确认截图生成器注入的是中性值。

## 教训来源

PR #69（账号详情按账号改出口）第一版把 `read.url` 与 `providerProxy` 原样送进页面，并在 UI 下拉里显示；它自己的测试还把「响应里出现完整带密码 URL」写成断言，说明是有意为之而非手滑。退回作者后按上面的方式修好（新 head 5c9252bc），我复跑 1063/0 + 三次破坏性验证后合并为 0.1.94。**判断依据是仓库既有先例，不是我临时加的标准——所以这类 finding 可以直接退回，不必请示主人。**
