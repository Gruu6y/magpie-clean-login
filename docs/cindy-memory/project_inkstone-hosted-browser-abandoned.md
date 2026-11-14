---
title: 端砚（intern-inkstone）改走 cl 自带浏览器：方案已放弃（2026-11-10）
description: 端砚不走 cl 的 Camoufox：方案已实现但主人 2026-11-10 放弃并清理；含端砚登录链的真实形状与残留状态
type: project
updatedAt: '2026-11-10T04:57:00.351Z'
---
状态：**已放弃**。主人 2026-11-10 明确说「没事我放弃了 清理一下资产吧 我接受这个供应商不用我们插件的浏览器登录」。基于此，cl（magpie-clean-login）**不再**为 intern-inkstone 做托管浏览器登录；端砚继续用 magpie 自己的流程 + 系统浏览器（Edge/Chrome）。不要再主动提议这条改造。

背景与已核实事实（供以后判断，不必重新调查）：
- 端砚插件 `@magpie-community/opencode-inkstone-auth` 的 `browserAuthorize` 返回 `{url:"", opened:true, method:"auto", callback}`；它内部用 `spawn(msedge.exe)` 开可见窗，再用 CDP `Network.getAllCookies` 读 `uaa-token`（域 intern-ai.org.cn）——所以走的是系统 Edge，且带的是 magpie 注入的代理，不是 cl 卡片上选的出口。
- cl 全仓只支持 Camoufox（Firefox 内核），没有 Chromium 分支；`lib/signin-flow.mjs` 遇到 `url` 为空会抛 `no_url`（502），所以 cl 那张卡片对端砚本来就开不了浏览器。
- magpie 插件 host 会给 spawn 的子进程注入 `HTTPS_PROXY/HTTP_PROXY/ALL_PROXY`（若 process.env 里已有则原样放行）——这是「出口对不齐」的根因。
- 曾实现但已删除（未提交、未推 PR）的方案：`lib/browser-launcher.mjs` 的 host cookie 通道（`createCookieReader`）、新 `lib/hosted-console.mjs`（`hostedAdapter`/`harvestConsoleToken`/`completeConsoleSignIn`）、`lib/signin-flow.mjs` 里对 intern-inkstone 的托管分支。结构可参考本项目记忆里的实现记录，将来若重启可直接照抄。
- 端砚控制台契约（可复用）：`https://discovery.intern-ai.org.cn/api/tokenplan/v1`，`usersValidate` 用 Bearer，`/keys` GET/POST/DELETE 用 `uaa-token` cookie，key 名 `ink-<host4>-<acct4>-<4hex>`，上限 10 把。

残留状态（截至 2026-11-10 13:00，我未清理这些）：
- `~/.config/magpie/plugin-auth.json` 的 `intern-inkstone` 条目（accountId 18601718676，apiKey + 会话）——这是 magpie 里端砚正在用的登录态。
- cl 数据目录 `~/.config/magpie/magpie-clean-login/accounts/intern-inkstone/`。
- `providers.json` 里 `intern-inkstone` 的 `accountProxies = {"18601718676":"http://127.0.0.1:7103"}`（cl 写入的出口绑定，指向柳老师家宽02）。
- 端砚控制台 3 把 active key：`1`（2026-10-29 主人自建）、`ink-4bf8-a587-2997`（11-10 10:09）、`ink-4bf8-a587-bb25`（11-10 10:41，我验证时建的）。
- cl 的资产页（`assets.json`：google-mail/microsoft-mail/cn-phone/apple-id 资源库）是空的，与端砚无关。
