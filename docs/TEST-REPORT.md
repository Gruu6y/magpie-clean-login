# clean-login 测试报告

- **对象**：`@gruu6y/page-clean-login` v0.1.106（仓库 `C:/Users/Administrator/projects/clean-login`）
- **方式**：基线单测（`bun test` 1129 用例）+ 沙箱服务实例黑盒 API 探针 + CLI 全命令探针 + 真实 Chrome（playwright-core）UI 实测 + 登录/续期与代理/环境两条线的代码审查。所有数据均在沙箱目录（`MAGPIE_*` env 指向临时目录）完成，未触碰真实 `~/.config/magpie`。
- **产出**：5 份域发现文件（`/tmp/cl-test/findings/{api,ui,cli,review-signin,review-proxy}.md`）+ 90 张 UI 截图。本报告为汇总与定级。
- **约定**：严重度 = 用户实际踩到的概率 × 后果。高 = 核心功能失效或数据/安全受损；中 = 特定路径下错误或危险残留；低 = 可用性/一致性/边界问题。

---

## 一、结论摘要

| 严重度 | 数量 | 概述 |
|---|---|---|
| **高** | 7 | 单包 DoS 杀死进程；native 供应商登录两条路径全断（UI 走错误端 + 服务端拒开 OAuth 链接）；`waiting-code` 永不超时连锁关停续期托管；验证码等待期 orphan sweep 删活动账号目录；登录浏览器下载写穿沙箱到用户共享缓存且插件目录落空（功能实际装不上）；点击劫持可内嵌完整管理 UI |
| **中** | ~11 | 裸 flag 吞参数/`"true"`；flag 前置吞命令；README 与 CLI 用法不一致；全新安装下删除账户 503；SOCKS5 插件腿静默直连；rotate 失败留半残；导入无逐项隔离；identity_mismatch 守卫可绕；proxies.json 损坏全 API 500；latencyByProvider 残留；市场安装丢版本钉；服务断连页脚仍报已连接 |
| **低** | ~20 | 错误不本地化、空闲形状不统一、favicon 404、Enter 无响应、375px 断行、IPv6 代理、installedBytes 重复计数、GET 带写副作用等 |
| **已验证正常** | 大量 | 见末节清单：token/Origin 门、编码与路径穿越、XSS 全转义、对话框 a11y、8 种 lang×theme、原子写、竞态修订保护等 |

**总体判断**：安全模型（token + Origin + Host 白名单 + CORS + 错误白名单）设计严谨且大多正确；真正的重灾区在**原生供应商登录链路**（两条路径都断，等于该功能从未真正跑通过端到端）和**环境下载/沙箱隔离**（装到真实用户缓存）。建议优先修复高 1–4。

---

## 二、高危发现（确认）

### H-1 单包 DoS：畸形 request-target 杀死整个 bun 进程
`lib/server.mjs:979` `const url = new URL(req.url || "/", ...)` 位于请求 try 块之外；`GET http://[::1/x`（或 `http://]bad[/x`）抛 `ERR_INVALID_URL` → 未捕获 → **进程退出**。沙箱内两次实杀复现，serve.log 有 panic 栈。任何能连 127.0.0.1 端口的本地进程/网页都能一键打死插件服务。
*修复方向：URL 解析包 try，或挂 `server.on("clientError")`。*

### H-2 原生（native）供应商"添加账号"完全失效 —— 两条路径都断
- **UI 侧**（实测 100% 复现，全语言）：`ui/app.js:4699` `signInContext.provider = provider.signInProvider`，而 native-only 卡的 `signInProvider` 为 `null` → `signInDoor(null)` 不命中 native 分支 → `POST /api/signin` `{provider:""}` → 400 `invalid_provider`。即便修好走 native，`context.provider.id` 对 null 仍是 undefined → 400 `invalid_agent`。
- **服务端侧**（代码审查确认）：`lib/server.mjs:570` 把 native-signin 的 OAuth 链接交给 `openExternal`，而 `lib/open-external.mjs:42` 默认 `allow = isAllowedIssueUrl` **只允许 GitHub issue URL**。`magpie accounts add` 打印的 `accounts.google.com` 等链接必被拒 → `fail(flow)`。
- **后果**：Codex/Antigravity/Claude/Grok 等全部 magpie 内置供应商无法通过本插件登录。两个缺陷各自独立即可致命，需同修。

### H-3 `waiting-code` 永不超时 → 永久 busy + 连锁关停续期托管
`lib/signin-flow.mjs`：验证码方法下 `state="waiting-code"` 无任何 timer（`CALLBACK_TIMEOUT_MS` 只在 `startCallback` 后启动）。用户关页面不输码 → 后续登录全部 `busy`。更隐蔽：`agent-surface.mjs:87` 把它当 settled → renew-hosting 放行续期 → `startSignIn` 抛 `busy` → 凭据过期后 `failStreak≥2` → **托管被静默关停 `pausedReason:"busy"`**，一个被遗忘的验证码打死无关账号的续期。

### H-4 验证码等待期 orphan sweep 可删除活动账号目录
`lib/account-prune.mjs`：`markInFlight` 只在启动写一次 marker，`isInFlight` = `mtime < CALLBACK_TIMEOUT_MS`。`waiting-code` 停超 ~6 分钟后 `POST /api/accounts/prune`（`server.mjs` 该路由无 signin busy 检查）把目录连 identity.json/profile 一并 `rm`。用户随后交码 flow `done`，但重建目录**没有指纹** → 该账号永久 `identity_missing`。长 callback（plugin load + authorize + 浏览器启动慢）同理。

### H-5 登录浏览器下载写穿沙箱，装到真实用户缓存；插件目录落空
`lib/browser-environment.mjs:277` `redirectCamoufoxCache` 在 `import("camoufox")` **之后**才改 `LOCALAPPDATA`，而 camoufox 的 `INSTALL_DIR`（`dist/paths.js:53`）在**模块求值时固定**。一旦 camoufox 被任何路径提前 import（登录流程 `account-identity.mjs:214`、browser-launcher），redirect 成 no-op。
**实测**：沙箱 `MAGPIE_CLEAN_LOGIN_BROWSER_DIR=/tmp/cl-test/browser` 下 `/api/environment/prepare` 把 ~646MB 解包到了真实 `%LOCALAPPDATA%\camoufox\camoufox\Cache\browsers\gruu6y\...`（531MB 磁盘实测仍在），而 `installDir` 为空、`executablePath=null`、`installed=false`。即：违反"不碰用户共享缓存"的设计约束 + **环境实际装不上**（UI 报 ready 前的状态与磁盘真相矛盾）。
*附带：`env.CAMOUFOX_INSTALL_DIR = dir`（browser-environment.mjs:487）在 camoufox 源码里无任何读取点，是无效设置。*

### H-6 点击劫持：`/` 无 XFO/CSP，配合 `Origin: null` 放行可嵌入完整管理 UI
`lib/server.mjs:1929-1948`：首页响应仅 `nosniff + no-referrer`，无 `X-Frame-Options`/CSP `frame-ancestors`；`originAllowed`（:148）放行 `Origin: null`；页面 HTML 内嵌完整 token meta。恶意网页 `<iframe sandbox="allow-scripts">` 即可拿到带 token 的可交互管理面 → 删代理、触发 `/api/market/install`、发起登录。token 防线对嵌入场景失效。
*修复方向：`/` 加 `frame-ancestors 'none'` 或校验 `Sec-Fetch-*`/`Sec-Fetch-Dest`。*

### H-7（中置信）环境下载/解压阶段 bun 进程退出
UI worker 实测 `prepare` 跑到 ~96% 时端口失联、serve.log 尾部为截断栈（`server.mjs:1983`）。我复核倾向认为该次"崩溃"实为 H-1 同根因的进程死亡或 worker 间干扰，**证据不足以确证下载逻辑 panic**；但 H-5 确认的"写穿缓存 + installDir 落空"本身已使该流程实际不可用，需按 H-5 一起复验。

---

## 三、中危发现（确认）

| # | 位置 | 问题 |
|---|---|---|
| M-1 | `agent-cli.mjs:88-97` | flag 前置吞命令：`--raw proxies` → `proxies` 被当 `--raw` 值 → 打印 help、rc=0 |
| M-2 | `agent-cli.mjs` | 裸 flag 变 `"true"`：`--note`/`--user` 存字面量；`import run --only` 静默全量导入 |
| M-3 | README vs CLI | `accounts exit <provider>#<recordId>` vs 实际 `<provider> <key>`，按 README 用法报错 |
| M-4 | `agent-cli.mjs` check | 指向不存在的 provider/key 返 rc=0 + 空白 idle job |
| M-5 | `server.mjs:680-694,1742` | 全新安装（plugin-auth.json 不存在）时 DELETE 账户永 503 `auth_unreadable`，与 `countAccountsNow` 对 missing 的处理矛盾 |
| M-6 | `signin-egress.mjs:46-53,117` | SOCKS5 代理下插件腿（mint/发码/换码）静默走真实 IP 直连，浏览器腿走代理 → 同会话两 IP（风控敏感），无提示 |
| M-7 | `account-identity.mjs:346-353` | `rotateIdentity` 先删 profile 后 `drawIdentity`，draw 失败留"旧指纹 + 空 profile"半残 |
| M-8 | `account-import.mjs:278-290` | `importAccounts` 无逐项 try/catch，一项失败整批 500 且无部分成功报告；指纹模型未装时全批必败 |
| M-9 | `proxies.mjs:336-345` | proxies.json 损坏 → `loaded` 永 false → 代理全 API + `/api/agent` 永久 500，无隔离/备份/恢复 |
| M-10 | `proxies.mjs:463-476` | update 连接变更漏清 `latencyByProvider` → UI 按供应商显示旧连接延迟 |
| M-11 | `market-install.mjs:38-45,179` | 卡片声明 `pkg@1.2` 实际 `plugin add` 装 latest；allowlist 同步放宽 |
| M-12 | `server.mjs:1527-1537` | `GET /accounts/<p>/<k>/hosting` 对不存在账户返 200（同账户 exit/DELETE 均 404），客户端无法区分 |
| M-13 | `ui/app.js:5199` | 服务断连后页脚仍显示"本地服务已连接"，`setServiceState` 只在 bootstrap 调用 |
| M-14 | `native-signin.mjs:267` | `child.stdin.write` 无 error listener，子进程退出后 paste/risk 应答触发 EPIPE 可拖垮宿主 |
| M-15 | `signin-flow.mjs` | `identity_mismatch` 守卫在 `incomingId`/`ledgerId` 为空时跳过 → 他账号凭据可写穿被 claim 的 key，两账号共享指纹目录（核心不变量被违反） |

## 四、低危发现（部分，详见 findings 文件）

- **API/服务**：静态路径非法 `%` 编码返 500（`server.mjs:1950-1953` decodeURIComponent 无 try）；`/api/environment` 泄露绝对路径（installDir/modelDir）；代理名可重复且原样存 `<script>`（UI 已转义，服务端无消毒）；错误体形状不统一（403 无 message、空闲三种形状）；`GET /api/market/install` 有写副作用；env cancel 在 starting 窗口 `cancelled:false` 但任务继续；`installedBytes` 缺 `record.bytes` 时模型字节计两次（虚高 ~213MB）；评分窗手动关后 `browserOpen` 仍 true。
- **CLI**：`--wait` 非数字静默不等待；多余位置参数静默忽略；`accounts note` 无文本清空 note；`proxy test` 失败仍 rc=0；未文档化的 `--id/--provider/--key` fallback。
- **UI**：favicon.ico 404 噪声；环境就绪后进度文本残留；评分/登录/导入/出口/账号详情多处错误 code 不本地化（`serverErrorText` 直接拼 `code · message`）；资产"账号为空"误报"类型不匹配"；代理对话框校验错误不随输入清除且与测试结果并存；对话框内 Enter 无反应；375px 下 tab 逐字断行。
- **代码审查（窄面/待验证）**：`normalizeMethod` 自由变量 `type` → ReferenceError（`magpie-plugins.mjs:185-205`）；`toPlaywrightProxy` IPv6 不加 `[]`（`browser-launcher.mjs:100`）；`entry.methodLabel` 永不赋值致多方法插件续期可能选错方法；`safeSegment` 不转义 `.`（潜在 `..` 上溯，当前键源产不出，URL 解码 key 是可注入入口）；ledger 读-改-写无锁的丢更新窗口；启动 sweep 与首个 sign-in 的 marker 窗口竞态；launch payload 短暂明文代理密码落盘（0600，崩溃残留）。

## 五、已验证无明显问题（抽样清单）

- **认证/边界**：token 门严格（拒绝 query token、错 token 与无 token 同形）；Origin 严格比对（evil.com/后缀/大写 scheme/多点 IP 全 403）；Host 白名单；OPTIONS 预检在 token 门前但不含 ACAO 泄露；`report/open` 仅允许严格 GitHub issue URL。
- **注入/遍历**：`..%2F`/`%252e`/双重编码/`%00`/unicode/超长段全 404/400；静态目录无法逃出 UI_ROOT；XSS 全向量（`<script>`/`<svg onload>`/`"><img>`/`javascript:`/资产 note）UI 全转义、零弹窗。
- **UI 健壮性**：8 种 lang×theme 零 pageerror/零请求失败；4 语言 guide 无占位符；`lang=klingon`/`theme=banana` 正确降级；对话框 Escape/取消/焦点还原/Tab 不逃逸 modal 全对；375/1920 无水平溢出；dark 可读；测速/评分轮询、筛选、校验、增删、删除确认正常。
- **数据层**：plugin-auth/providers/account.json tmp+rename 原子写 + 0600/0700；proxies.json serialized chain；password 不出现在任何 public/compact 投影；test 与 update/delete 竞态有 `expectedUpdatedAt` 修订保护；探测无直连回退；错误消息白名单不把凭据写进 ledger/flow。
- **CLI**：所有错误路径 rc=1 + stderr 单行 JSON；列出命令输出可解析；**page token 在任何命令输出中均未出现**。
- **测试基线**：`bun test` 1129 pass / 0 fail。

## 六、复现入口与产物

- 沙箱服务：`/tmp/cl-test/serve.mjs`（port 4597），env 指向 `/tmp/cl-test/{config,data,cache,browser}`；日志 `/tmp/cl-test/serve.log`（含 H-1 panic 栈与 H-5 真实缓存提取日志）。
- 域发现：`/tmp/cl-test/findings/{api,ui,cli,review-signin,review-proxy}.md`
- UI 截图：`/tmp/cl-test/work-ui/*.png`；探针脚本：`/tmp/cl-test/work-{api,cli,ui}/`
- **遗留环境痕迹（需人工决定）**：`/tmp/cl-test/`（沙箱，可整目录删）；`%LOCALAPPDATA%\camoufox\`（H-5 写穿的 ~531MB，属真实用户目录，未自动清理）。

## 七、修复优先级建议（仅排序，不改代码）

1. **H-1**（DoS）：一行 try 包住 URL 解析，影响面最大成本最低。
2. **H-2**（native 登录双断）：功能从未端到端跑通，需 UI context 存完整 card + `openExternal` 为 native OAuth 放行（建议独立 allowlist，不要复用 issue 白名单）。
3. **H-5**（沙箱写穿 + 装不上）：把 camoufox import 移到 redirect 之后的函数体内（所有 import 路径统一走 `loadCamoufox` 且其内部先做 redirect），或改用 `INSTALL_DIR` 可控的注入 seam。
4. **H-3/H-4**（waiting-code 生命周期）：给 waiting-code 挂超时 timer + prune 路由前查 sign-in busy + marker 续期。
5. **M-9/M-5**（数据文件健壮性）：proxies.json 损坏隔离备份 + auth/logins 双 missing 语义统一。
6. 其余中/低项按用户可感知度排期。
