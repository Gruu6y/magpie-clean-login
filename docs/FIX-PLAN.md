# clean-login 最小修复方案与验证步骤

配套 `TEST-REPORT.md`。每条：**根因 → 最小改动（文件:行）→ 验证步骤**。均为「最小」方案——改动面最小、不动架构；更彻底的重构在各条备注里提示。严重度沿用报告：H=高，M=中，L=低，Q=可疑待验证。

---

## H-1 畸形 request-target 杀死进程（DoS）

- **根因**：`lib/server.mjs:979` `const url = new URL(req.url || "/", ...)` 在请求 `try`（~1041 行才开始）之外；`GET http://[::1/x` 抛 `ERR_INVALID_URL` 未捕获 → Bun 进程退出。
- **最小改动**：把 `new URL(...)` 包进 try/catch，失败 `writeHead(400)` + `res.end()` 后 return；或在其上更早挂 `server.on("clientError", (err, socket) => socket.destroy())`（Node 对坏 request-target 会走 clientError，双保险）。改动 ~6 行。
- **验证**：
  1. 新增 `test/server.test.mjs` 用例：起 server，`net.Socket` 发送 `GET http://[::1/ HTTP/1.1\r\nHost: x\r\n\r\n`，断言收到 400 且后续 `GET /` 仍 200。
  2. 手工：对 4597 重放 `printf 'GET http://[::1/x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n' | nc 127.0.0.1 4597`，确认进程存活。
  3. `bun test` 全绿。

## H-2 原生供应商登录双断

### H-2a UI 走错端（`ui/app.js:4699,4810-4822`）
- **根因**：`signInContext.provider = provider.signInProvider`（native 卡为 `null`）；`signInDoor(context.provider)` 对 null → `"none"` → 走 `/api/signin` 且 `provider:""` → 400。
- **最小改动**：`openSignInDialog` 改存完整 card：`signInContext = { provider, card: provider }`；4810 行 `signInDoor(context.card)`；native 分支 `body: { agent: context.card.id }`（registry 卡 id 即 agent 名；magpie-only 卡 `agentId`）。`signInPayload` 处传 `context.card.signInProvider`。
- **验证**：
  1. `test/signin-ui.test.mjs`/`accounts-page-ui.test.mjs` 已有 UI 状态测试模式——给 `signInDoor` 补一条 native 卡用例（`nativeSignIn:true, signInProvider:null` → `"native"`）。
  2. 手工：供应商页 Codex 卡 → 添加账号 → 开始登录 → 断言请求是 `POST /api/native-signin` 且 body `{agent:"codex"}`，UI 出现"等待打开链接"态而非 400。

### H-2b 服务端 OAuth 链接被 issue 白名单拒（`lib/server.mjs:567-570`）
- **根因**：`openUrl: (url) => openExternal(url)`，`open-external.mjs` 默认 `allow = isAllowedIssueUrl`（仅 `github.com/Gruu6y/magpie-clean-login/issues/new`）。
- **最小改动**：`openExternal` 第二参传一个放宽的 allow：`{ allow: (u) => /^https:\/\/([a-z0-9-]+\.)?(google\.com|microsoftonline\.com|anthropic\.com|openai\.com|x\.ai|github\.com|gitlab\.com)(\/|$)/i.test(u) }`（按 provider registry 的 `authHosts` 汇总，或干脆「任意 https」——链接来源是 magpie 自身 stdout，信任级别等同于已执行该进程）。更小且更稳的做法：`openExternal` 新增 `allowAnyHttps` 选项，native-signin 专用。
- **验证**：
  1. `test/open-external.test.mjs` 增用例：`accounts.google.com/o/oauth2/...` 放行、`javascript:`/`file:` 仍拒。
  2. 手工：native-signin 流程到 URL 出现 → 系统浏览器打开 OAuth 页（或 headless 下断言 `spawn` 被调用且 argv 为 URL）。

## H-3 `waiting-code` 永不超时 → 永久 busy + 连锁关停续期

- **根因**：`lib/signin-flow.mjs:951-1005` `isCodeMethod` 分支 `state="waiting-code"` 后 `return`，未启动 `CALLBACK_TIMEOUT_MS`；`agent-surface.mjs:87` `isSettledSignIn` 把 `SIGNIN_NEEDS_INPUT` 当 settled → `renew-hosting.mjs:402-405` `signInBusy()` 返回 false → 续期 `perform` 撞 `busy` → 失败后 `failStreak≥2` → `enabled:false`。
- **最小改动**（两处，缺一不可）：
  1. `waiting-code` 也启动同一个 `CALLBACK_TIMEOUT_MS` 定时器（与 `waiting-login` 同一 arm 函数），到点 `state="timeout"`+`resolveSettled`；
  2. `isSettledSignIn` 剔除 `SIGNIN_NEEDS_INPUT`（或 `signInBusy` 改成 `flow && !TERMINAL.has(flow.state)`）——语义修正：等码也是"进行中"。
- **验证**：
  1. `test/signin-flow.test.mjs` 增：进 waiting-code 后时钟快进 `CALLBACK_TIMEOUT_MS+1` → `flow.state==="timeout"`，`TERMINAL` 含它，再次 `startSignIn` 不抛 busy。
  2. `test/renew-hosting.test.mjs` 增：sign-in 停 waiting-code 时 `perform` 记一次 busy 失败但 `enabled` 不翻 false（因 `signInBusy()` 前置拦截，走 needsUser/skip 路径而非 failStreak 累加到关停）；或直接断言 `signInBusy()`===true 时 perform 不再调 `startSignIn`。

## H-4 等待期 orphan sweep 删活动账号目录

- **根因**：`lib/account-prune.mjs` `isInFlight` 只看 marker mtime（`now-startedAt < CALLBACK_TIMEOUT_MS`），marker 只在 `startSignIn` 写一次；`POST /api/accounts/prune`（`server.mjs`）不查 sign-in busy；`markInFlight`（signin-flow.mjs:429）`startedAt=createdAt` 不续期。
- **最小改动**（两层）：
  1. `pruneOrphanAccounts` 增可选参 `inFlightDirs: Set<string>`；`runPrune`/`runStartupPrune` 处把 `signIn.status()` 非终态 flow 的 `key`/`dir` 填进去（以及 native-signin flow 的 dir）。
  2. `submitCode` 与每次 `startCallback` 成功回调里重写 marker（`markInFlight` 改成每次刷新 mtime，或 `touchInFlight(dir)` 新函数），把 6 分钟滑动窗续上。
  3. 防御性：`POST /api/accounts/prune` 前查 `signIn.status()` 非终态 → 409 `signin_busy`（可选，语义更严）。
- **验证**：`test/account-prune.test.mjs` 增：marker 过期 + `inFlightDirs` 含该 dir → 保留；`test/signin-routes.test.mjs`：waiting-code 中 POST prune → 该目录仍在。

## H-5 浏览器下载写穿沙箱到用户共享缓存（装不上）

- **根因**：`lib/browser-environment.mjs:277` `redirectCamoufoxCache` 是「先 set env，再 `await loadCamoufox()`，finally 恢复」——但 `camoufox/dist/paths.js:53` `INSTALL_DIR` 在**模块求值时固定**。只要 camoufox 已被任何路径先 import（`account-identity.mjs:214`、`browser-launcher.mjs:193` 的裸 `import("camoufox")`、或上一次 install），redirect 就失效，装进真实 `%LOCALAPPDATA%\camoufox`。实测已复现：沙箱 `installDir` 空、真实缓存 531MB、`installed:false`。
- **最小改动**（二选一，推荐 A）：
  - **A（根治，~40 行）**：新增 `lib/camoufox-loader.mjs`，导出唯一 `loadCamoufox(env, browserDir)`——内部先 `redirectCamoufoxCache`（不恢复，或记录一次性 previous），再 `import("camoufox")`。把 `browser-environment.mjs:263`、`account-identity.mjs:214`、`browser-launcher.mjs:193` 三处裸 `import("camoufox")` 全部改走它。保证首次 import 时 env 已是插件目录。
  - **B（治标）**：`defaultInstaller` 末尾断言 `camoufox` 实际 INSTALL_DIR ⊆ `dir`；不符则 `EnvironmentError("install_dir_mismatch")` 并拒绝——不装也不污染。A 修功能、B 兜底诊断，建议都做。
  - 顺手删 `browser-environment.mjs:487` `env.CAMOUFOX_INSTALL_DIR = dir`（camoufox 源码无此读取点，误导性死代码）。
- **验证**：
  1. 新增单测：先在进程里 `import("camoufox")`（模拟先被加载），再跑 `defaultInstaller`，断言写盘目标 = `dir`（用 fake fetcher 或断言 INSTALL_DIR 前缀）。
  2. 手工：干净进程起服务 → POST `/api/environment/prepare` → 断言文件落在 `MAGPIE_CLEAN_LOGIN_BROWSER_DIR` 且 `%LOCALAPPDATA%\camoufox` 无新增。
  3. `bun test` 全绿；真实磁盘 `%LOCALAPPDATA%\camoufox` 体积不变。

## H-6 点击劫持：`/` 无 XFO/CSP + `Origin:null` 放行

- **根因**：`lib/server.mjs:1929-1948` `/` 响应只 `nosniff+no-referrer`；`originAllowed`（:148）放行 `Origin: null`（magpie 沙箱 iframe 就是 null-origin，不能砍）。
- **约束**：magpie 需要把本页嵌进它自己的沙箱 frame，所以**不能** `frame-ancestors 'none'`——那会把自己也掐死。需要在「允许 magpie 嵌」和「拒绝外站嵌」之间找区分点。
- **最小改动**（按可行性排序，先验证 1）：
  1. `frame-ancestors` 白名单：先发请求看 magpie frame 的 `Origin`/`Sec-Fetch-Site` 实际值；若 magpie 是 `magpie://` 或固定 origin，`Content-Security-Policy: frame-ancestors 'self' <magpie-origin>` 即可。先用 devtools/日志抓一次真实值再写死。
  2. 若无法区分（magpie 也是 `Origin: null`）：UI bootstrap 加一道「必须在 `window.magpie` 桥存在时才渲染功能」的闸（page 本身已是 magpie 专属入口，直接打开/被外站嵌时桥不存在 → 显示 "only inside magpie"）。这是 0 网络改动的 UI 层缓解。
  3. 次优：`X-Frame-Options` 不设、但给 `/` 加 `Sec-Fetch-Site`/`Sec-Fetch-Dest` 日志便于发现真实嵌入源。
- **验证**：
  1. 抓 magpie 实际嵌本页时的请求头（`Sec-Fetch-Site`/`Sec-Fetch-Dest`/`Origin`）。
  2. 外站 iframe 测试页（`Origin: https://evil.test`）确认被 CSP 拒或 UI 降级。
  3. magpie 内仍正常打开（冒烟）。

## M-1 CLI：flag 前置吞命令名

- **根因**：`lib/agent-cli.mjs:88-97` `parseArgs` 不区分「取值的 flag」和「布尔 flag」，`--raw proxies` 把 `proxies` 当 `--raw` 的值。
- **最小改动**：给 `parseArgs` 一个「布尔 flag 集合」——`raw|help|version|force|run|...` 遇到即 `true` 不消费下一个；或统一改成只认 `--key=value` / `--key value` 的白名单 flag 表，未知 `--` 一律报 `unknown_flag`。
- **验证**：`bun clean-login.mjs --raw proxies` 应输出 proxies 列表而非 help；`test/agent-cli.test.mjs` 增该参数序用例。

## M-2 CLI：裸 flag 变 `"true"` / 静默全量导入

- **根因**：同上 `parseArgs`；`--note`（无值）存 `"true"`；`--only`（裸）在 import run 未配白名单 → 全量。
- **最小改动**：布尔集合（同 M-1）+ `accounts import run` 的 `--only` 强制要求值或改用 `--ids a,b`；裸 `--note`/`--user` 报错 `missing_value`。
- **验证**：`--note`（无值）→ 非零退出 + `missing_value`；`--only` 裸 → 错误而非全量；`--raw`（布尔）仍工作。

## M-3 README 与 CLI 用法不一致

- **根因**：文档 `accounts exit <provider>#<recordId>` vs 实现 `<provider> <key>`。
- **最小改动**：改 README 成 `<provider> <key>`，或 CLI 同时接受 `provider#key` 单参数（split on last `#`）。改文档成本最低。
- **验证**：`bun clean-login.mjs accounts exit p k` 与 README 描述一致；`test/agent-cli.test.mjs` 参数解析用例。

## M-4 CLI：check 指向不存在 provider/key 返 rc=0

- **根因**：check 路由对不存在账户返回 idle job 而非 404。
- **最小改动**：`/api/accounts/<p>/<k>/check` 路由先 `readAccountMeta` 校验存在（同 DELETE 分支），不存在 → 404 `not_found`。
- **验证**：CLI `check` 不存在账户 → 非零退出 + `not_found`；`test/identity-check-routes.test.mjs` 增用例。

## M-5 全新安装下 DELETE 账户 503

- **根因**：`server.mjs:680-694` `liveAccountKeySet` 在 auth+logins 双 missing 时返回 `auth.ok:false`；DELETE（:1742）一律 503。但 `countAccountsNow` 对 `auth_missing` 当 `keys=∅`。语义不一致。
- **最小改动**：`liveAccountKeySet` 双 missing 时返回 `{ok:true, keys:new Set()}`（missing=没有已登录账号），与 `countAccountsNow` 一致；仅「文件存在但读不出」才 `!ok`。
- **验证**：`test/server.test.mjs`/`account-*-routes`：config 无 plugin-auth/logins 时 DELETE 已退休目录 → 200；config 里放一个**损坏**的 plugin-auth.json → 仍 503（区分 missing vs unreadable）。

## M-6 SOCKS5 插件腿静默直连

- **根因**：`lib/signin-egress.mjs:46-53` `signInProxyUrl` 对 socks* 返回 `undefined` → `withSignInEgress`（:117）直接 `fn()` 直连。
- **最小改动**：`withSignInEgress` 在 `type==="socks*"` 时**不要静默直连**——改为 `throw SignInError("egress_unsupported","该代理协议暂不支持登录")`（明确报错比静默走真实 IP 安全）；或在 UI/CLI 选代理时就对 socks 禁选并提示。真正「经代理转发插件 fetch」是更大工程，作为后续。
- **验证**：`test/signin-egress.test.mjs` 增 socks 代理 → 报 `egress_unsupported` 而非发起直连（assert `fetch` 未被调用/被调用走代理）。

## M-7 `rotateIdentity` 半残

- **根因**：`lib/account-identity.mjs:346-353` 先 `remove(profile)` 后 `drawIdentity`；draw 失败留旧 pin + 空 profile。
- **最小改动**：`drawIdentity` 先画到**临时目录**（`dir/.pending-identity-<uuid>`），成功后再 `remove(profile)` + 把新 identity 落位；失败则清理 pending、旧 profile 不动。若 `drawIdentity` 接口不支持换目录，则失败时至少 `remove(identity.json)`，让状态变成「无指纹」而非「旧指纹+空 profile」这种自相矛盾的半残。
- **验证**：`test/account-rotation.test.mjs` 增：注入 generate 抛错 → 断言 profile 仍存在、identity.json 仍是旧 pin（或目录干净无 pin，二选一但不许"旧pin+空profile"）。

## M-8 `importAccounts` 无逐项隔离

- **根因**：`lib/account-import.mjs:278-290` for 循环 `ensureIdentity`+`writeMeta` 无 try/catch → 一项失败整批 500，已成功的无报告。
- **最小改动**：逐项 `try/catch`，收集 `{item, ok, error}` 明细；最后返回 `200 {ok:true, imported:n, failed:[...]}`（部分成功）或全失败才 500。plan 路由顺手探测 `ensureIdentity` 可用性（如 fpgen 是否就绪）提前报错。
- **验证**：`test/account-import.test.mjs` 增：plan 3 项中第 2 项注入失败 → 200，`imported:2, failed:[{key,error}]`，前两项目录存在、第三项不在。

## M-9 proxies.json 损坏全 API 500 无恢复

- **根因**：`lib/proxies.mjs:336-345` `ensureLoaded` JSON 失败 throw → `loaded` 永 false。
- **最小改动**：catch 里把坏文件 `rename` 成 `proxies.json.corrupt-<ts>`，`this.records=[]` 继续（保留数据隔离备份，服务可用并提示）；并在 `/api/agent`/`/api/proxies` 响应加 `recovered:{corruptFile}` 字段告知用户。
- **验证**：`test/proxies.test.mjs` 增：写入非法 JSON → list 返 `[]`+`recovered` 字段，坏文件被重命名仍在；`bun test` 全绿。

## M-10 `update` 漏清 `latencyByProvider`

- **根因**：`lib/proxies.mjs:457-480` connectionKey 变化清空列表漏了 `latencyByProvider`。
- **最小改动**：在清空列表里加 `delete next.latencyByProvider`（或置 `{}`）。
- **验证**：`test/proxies.test.mjs`：先塞 `latencyByProvider`，改 host/port `update` → 断言字段已清。

## M-11 市场安装丢版本钉

- **根因**：`lib/market-install.mjs:41-47` `packageName` `lastIndexOf("@")` 剥版本。
- **最小改动**：把完整 spec（含 `@1.2.3`）传给 `magpie plugin add`（`spawn(cli,["plugin","add",spec])`）；allowlist 校验用规范化后的 `name`（仍防注入），但 spawn 用原始 spec。
- **验证**：`test/market-install.test.mjs`：`pkg@1.2.3` → spawn argv 含 `@1.2.3`。

## M-12 GET hosting 对不存在账户返 200

- **根因**：`server.mjs:1527-1537` GET 直接 `renewHosting.inspect` 不查存在。
- **最小改动**：GET 分支同 DELETE 先 `readAccountMeta`，不存在 → 404 `not_found`（与 exit/DELETE 一致）。
- **验证**：`GET /api/accounts/nope/nope/hosting` → 404；`test/renew-hosting.test.mjs`/`accounts-routes` 增用例。

## M-13 服务断连页脚仍报已连接

- **根因**：`ui/app.js:5199-5201` `setServiceState` 只在 bootstrap 调。
- **最小改动**：全局 `api()` fetch 包装器在非网络错误外的失败（fetch reject/5xx/超时）时调 `setServiceState("failed")` 并显示 Retry；恢复时再 `ready`。
- **验证**：手工杀服务后任一操作 → 页脚变 failed + Retry；`ui` 已有 fetch mock 测试可补断言。

## M-14 native-signin stdin EPIPE

- **根因**：`lib/native-signin.mjs` `child.stdin.write` 无 error listener，子进程已退出时 EPIPE unhandled。
- **最小改动**：`child.stdin.on("error", () => {})`（吞掉、走 flow 的 timeout/error 路径）；或 write 前 `child.stdin.writable` 检查 + `.on("error")`。
- **验证**：mock child 立即退出后 `paste` → 进程不崩；`test/native-signin.test.mjs` 增用例。

## M-15 `identity_mismatch` 守卫可绕

- **根因**：`lib/signin-flow.mjs` 守卫 `existingMeta && ledgerId && incomingId && ledgerId!==incomingId`——`incomingId`/`ledgerId` 任一为空即跳过 → 他账号凭据可写穿被 claim 的 key。
- **最小改动**：把守卫收紧为「**任一**无法核验即拒绝」：`existingMeta && (ledgerId==="" || incomingId==="" || ledgerId!==incomingId)` → `identity_mismatch`。代价是插件不返 uid 时也会拒（宁可误拒不可写穿）；若需兼容无 uid 插件，退而求其次在 `ledgerId===""` 时仍拒（空 ledger 不应接写回）。
- **验证**：`test/signin-writeback.test.mjs`/`signin-flow.test.mjs`：插件 callback 不返 uid → 写回 `identity_mismatch`；返不同 uid → 同；返相同 uid → 放行。

---

## L 组（低风险，按聚合提交，每条 1–6 行）

| # | 位置 | 最小改动 | 验证 |
|---|---|---|---|
| L-1 | `server.mjs:1950-1953` | 静态路径 `decodeURIComponent` 包 try → 400 | `curl '/%'` → 400 非 500 |
| L-2 | `server.mjs:1259` env 路由 | `environment.status()` 投影剔除 `installDir`/`modelDir`（或前端不展示） | `/api/environment` 无绝对路径 |
| L-3 | `proxies.mjs` validateCreate | name 唯一性校验（重名 → 409 `name_taken`）；控制符/`<` 消毒 | 重名/`<script>` 拒绝 |
| L-4 | `server.mjs` sendError | 403/unauthorized 体补 `message`；空闲 job/flow 形状统一（都返 idle 对象） | 各端点错误体一致 |
| L-5 | `market-install.mjs` GET | read() 内 `writeState` 移到仅 done/failed 首次落盘或 POST | 两次 GET 不改文件 mtime |
| L-6 | `browser-environment.mjs:786,816` | `record.bytes==null` 时用 `directoryBytes(dir)` 不再加 modelBytes | installedBytes 不重复计 |
| L-7 | `browser-environment.mjs:832` | starting 窗口 cancel 返回 `cancelled:false` 前先 `await` job 进入 running（或排队 cancel 到启动后执行） | prepare→立即 cancel → 真正取消 |
| L-8 | `proxy-score.mjs`/`browser-launcher.mjs:581` | child exit 时清 `handle`（`handle=null`） | 手动关评分窗 → `browserOpen:false` |
| L-9 | `cli` 各命令 | 多余位置参数报 `unexpected_arg`；`accounts note` 无文本报 `missing_text` 而非清空；`proxy test` 失败 rc=1 | 各命令按新契约 |
| L-10 | `cli` `--wait` | 非数字报 `invalid_wait` 而非静默 0 | `--wait abc` → 非零退出 |
| L-11 | `ui/index.html` | 内联 `<link rel="icon" href="data:...">` 或服务端 `/favicon.ico` → 204 | console 无 404 |
| L-12 | `ui/app.js:5299-5310` | 非 preparing 态清空 `#environment-progress-text`/bar | ready 态无残留文本 |
| L-13 | `ui/app.js` serverErrorText | 错误 code 先查 `checkErrorKeys`/`errorKeys` 映射表再回退原文 | zh-Hans 下评分/登录/导入错提示中文化 |
| L-14 | `ui/asset-view.js:38` | `!normalizedAccount` 单独报 `account_required` | 空账号提示"请输入账号" |
| L-15 | `ui/app.js:7414` | proxy 表单 input 监听同步 `setFormError("")` | 校验错随输入清 |
| L-16 | `ui/index.html`/app.js | proxy 表单 input 绑 Enter→`saveProxy()`（保留 `type="button"`） | 表单内 Enter 触发保存 |
| L-17 | `ui/style.css` | `.tabs` 375px 横向滚动或压缩 padding | 375px 标签不逐字断行 |
| L-18 | `magpie-plugins.mjs:185-205` | `normalizeMethod` 内 `type` 改引参数/局部（`method.type`）或删该死分支 | 构造 `browser:false` 无 category payload → 不 ReferenceError |
| L-19 | `browser-launcher.mjs:100` | IPv6 host 加 `[...]`（对齐 `account-proxies.mjs:71`） | IPv6 代理登录可启动 |
| L-20 | `account-*`（可选）| ledger 读-改-写加 per-key 串行化（同 `account-proxies`） | 并发 PATCH 不丢更新 |

## Q 组（可疑待验证 → 先复验再定方案）

- `entry.methodLabel` 永不赋值（`renew-hosting.mjs`）：复验多方法插件续期是否选错方法；若属实→enable 时把当前 method label 写进 entry。
- `safeSegment` 不转义 `.`：确认 URL 解码 key 能否注入 `..`；若属实→`safeSegment` 加 `.`/`..` 特判或 `accountDir` 断言 `safeSegment` 结果不含 `..`。
- launch payload 明文密码落盘（`.signin-launch.*.json` 0600）：确认崩溃残留面；若属实→加 `try/finally` 确保清理或改传 stdin。
- unscoped 插件枚举、probe target 域名内网、acceptAnyStatus interim：属安全面边缘，复验后按需。

---

## 实施与验收总览

1. **优先级**：H-1（一行 try，收益最大）→ H-2a/H-2b（核心功能打通）→ H-5（沙箱隔离+装得上）→ H-3/H-4（生命周期）→ M 组 → L 组。
2. **每条修复配套**：对应域的 `test/*.test.mjs` 增用例 + `bun test` 全绿 + 一条手工冒烟（curl/CLI/UI）。本仓库已有 84 个测试文件的现成模式（`server.test.mjs`、`signin-flow.test.mjs`、`proxies.test.mjs`、`renew-hosting.test.mjs` 等），直接往里加。
3. **回归门禁**：改完跑 `bun test`（基线 1129）+ 起沙箱重放 H-1 崩溃包、H-2a native 登录、H-5 下载落盘路径三条端到端。
4. **不做**：本文件只出方案，未改任何代码；`%LOCALAPPDATA%\camoufox`（H-5 写穿的 531MB）与 `/tmp/cl-test` 沙箱留待人工清理。
