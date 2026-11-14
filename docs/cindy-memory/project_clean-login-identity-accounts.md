---
title: project.clean-login-identity-accounts
description: p=cindy.memory.v1;t=project;kc=32;c=54;v=192;o=7;raw=1
type: project
updatedAt: '2026-11-05T01:08:36.197Z'
---
{
  "protocol": "cindy.memory.v1",
  "id": "project_clean-login-identity-accounts",
  "type": "project",
  "keys": [
    "clean",
    "login",
    "identity",
    "pinning.md",
    "https://who.1ms.dog/zh-cn/",
    "clean-login-trial/",
    "dist/utils.js",
    "launchoptions",
    "fingerprint",
    "fingerprint_preset",
    "navigator.useragent",
    "config",
    "canvas_noise:false",
    "todataurl",
    "clean-login-trial/probe-who.mjs",
    "canvas-hash.mjs",
    "identity.json",
    "clean-login-trial/proxy.local.json",
    "server",
    "block_webrtc",
    "geoip",
    "asia/shanghai",
    "asia/taipei",
    "en-us",
    "zh-tw",
    "pinning",
    "invariant.md",
    "account",
    "retirement.md",
    "magpie-plugins-dev/packages/clean-login",
    "account.json",
    "lib/account-identity.mjs"
  ],
  "claims": [
    {
      "k": "c001",
      "v": "**已验证的修法**：`generateFingerprint({os:\"windows\"})` 出一份 fingerprint，按 profile 存下来复用 → pin 之后**屏幕 / 显卡 / UA / WebGL / 音频 / 字体列表哈希两次完全一致**（字体列表 `cd44ab3d·1a329bd4` 两次相同）。→ **T3 必须给每个 profile 绑定并持久化一份 fingerprint**。",
      "kind": "rule"
    },
    {
      "k": "c002",
      "v": "`firefoxGpus(\"win\")` 实测只有 **11 条**，没有本机的 `AMD Radeon RX 6800 XT`；于是 `planRendering()` 判定 canvas 需覆盖。站点自己也写明「显卡是 Radeon R9 200 Series（Firefox 给的同档替代型号，**不是你的真实显卡**）」。`canvas_noise:false` 也换不来宿主 GPU：那条路会变成「不声称任何 GPU」（WebGL 缺位本身是破绽）。两条路不能兼得。",
      "kind": "rule"
    },
    {
      "k": "c003",
      "v": "**未收口**：pin 之后站点面板上 **Canvas 一项仍在变**，进而把「综合指纹」带偏；但主代理本地自算 canvas（`toDataURL`）连跑 8 次哈希完全相同 `33a65eba3c847f3095805bf1`。说明差异更可能在站点那一项的测法，要定论需单独拆站点脚本。",
      "kind": "decision"
    },
    {
      "k": "c004",
      "v": "**工具**：`clean-login-trial/probe-who.mjs`（`--headless/--pin/--pin-file/--no-canvas-noise/--settle`，落 `who-<tag>.txt|.json|.png`）、`canvas-hash.mjs`（本地自算 canvas 哈希，隔离站点因素）、`identity.json`（已生成的一份 windows fingerprint pin）。",
      "kind": "state"
    },
    {
      "k": "c005",
      "v": "**关键 1：WebRTC 不需要 `block_webrtc`。** 配上代理后 `media.peerconnection.ice.proxy_only_if_behind_proxy`（camoufox.cfg 自带）自动生效，站点从 `!` 降为 `i`。实测 `--block-webrtc` 也能把 D 抬到 C，但那是\"没代理时的兜底\"，不该做默认。→ 上轮\"配了代理走硬化、没配才一刀切\"的判断被实测证实。",
      "kind": "rule"
    },
    {
      "k": "c006",
      "v": "**关键 2：配代理必须开 `geoip`，否则身份时区/语言跟宿主而不是出口。** 启动器会报 `LeakWarning: When using a proxy, it is heavily recommended that you pass geoip=True`。实测：",
      "kind": "rule"
    },
    {
      "k": "c007",
      "v": "这次没露馅纯属巧合——台湾与上海同为 UTC+8。**换一个非 UTC+8 的节点，\"时区与 IP\"会立刻不一致**，所以 T3 必须「有代理就开 geoip」。副作用：会连带覆盖 locale 口径。",
      "kind": "rule"
    },
    {
      "k": "c008",
      "v": "**aibo 定的产品约束（2026-11-03）**：**一个出口地址可以接受多个指纹；但一个供应商凭据不能接受多个指纹。**",
      "kind": "rule"
    },
    {
      "k": "c009",
      "v": "- **同一个供应商凭据（一个账号）绝不能对应多个指纹** —— 同一个账号反复以不同设备指纹登录，会被登录风控判为异常。这是 clean-login 的**核心不变量**。",
      "kind": "rule"
    },
    {
      "k": "c010",
      "v": "**直接推到的工程要求**：",
      "kind": "rule"
    },
    {
      "k": "c011",
      "v": "1. 每个账号的 **fingerprint pin 必须持久化、与该账号的 profile 一一对应**。之前实测出的\"不 pin 每次启动换一套身份\"就是直接违反这条约束的——那条修复因此从\"建议\"升级为\"不可商量的前置\"。",
      "kind": "rule"
    },
    {
      "k": "c012",
      "v": "2. **pin 与 profile 必须同生同死**：profile 里存 pin；删 profile 则 pin 一起删；绝不能出现\"同一账号换 pin\"或\"同一 pin 被两个账号共用\"。",
      "kind": "rule"
    },
    {
      "k": "c013",
      "v": "3. 出口与账号**不必一对一绑定**（可以多个账号共用一个出口），但**地域一致性**要单独评估：**同一账号频繁换国家/地区出口**是否也触发风控，目前**没有实测**，不能当作已知结论。",
      "kind": "rule"
    },
    {
      "k": "c014",
      "v": "**待实测确认的问题**：同一账号 pin 不变、但出口地区变化，供应商会不会当作异常登录？（这条约束只覆盖了指纹维度，没覆盖地理维度。）",
      "kind": "open"
    },
    {
      "k": "c015",
      "v": "**2026-11-03 完成（aibo 要求「登出也不回收指纹、下次登录复用同一指纹」）。** 代码在 cindy四号机 workspace 的 `magpie-plugins-dev/packages/clean-login`（git untracked，未 commit/push）。**magpie 未重启，插件库未动。**",
      "kind": "rule"
    },
    {
      "k": "c016",
      "v": "**API/UI**：`GET /api/accounts`、`DELETE /api/accounts/<provider>/<key>`（已签入 409 `signed_in`）、`POST /api/signin` 接受 `account:{key}`、`/api/health` 加 `retired` 计数；UI 加 Account identities 卡片（Clear identity，二次确认）与登录对话框「Continue with an existing identity」（唯一时默认选中）。",
      "kind": "rule"
    },
    {
      "k": "c017",
      "v": "**脚本**：`scripts/backfill-account-meta.mjs`（默认 dry-run，`--apply` 才写；只因 key 在 auth 里才归属）、`scripts/smoke-accounts.mjs`（临时数据目录起真实 startServer 打两个路由）。",
      "kind": "rule"
    },
    {
      "k": "c018",
      "v": "**已对真实数据做的事**：给 秦昊麟(裸键 workbuddy, uid 3ce63568…) 与 静静的外婆(#mbg4c2, uid 57c94741…) 回填台账（`signedInAt:null`）；`identity.json` 字节与 mtime 未变；真实启动扫描结果 `2 kept, 0 retired, 2 pruned`（pruned 是残留的空壳 `__probe__`/`__probe_nonexistent__`）。",
      "kind": "state"
    },
    {
      "k": "c019",
      "v": "**验收**：`bun test` 416 pass / 0 fail（bun 1.4.4，经 `npm i -g bun` 装，PATH 加 `%APPDATA%\\npm`）。magpie 无 `fs.watch`，**服务端改动需重启 magpie 或重载插件才生效**。UI 未在真实 magpie 沙箱里点过（只有单测 + 路由测试 + 冒烟）。",
      "kind": "state"
    },
    {
      "k": "c020",
      "v": "**已知代价**：磁盘不自动回收（55M+/账号）、退役 profile 里的站点 cookie 长期留盘，靠 UI 的 Clear identity 手动清。",
      "kind": "state"
    },
    {
      "k": "c021",
      "v": "**2026-11-03 11:16–11:20 真机验证通过（aibo 授权）。** 走实时服务 API（`http://127.0.0.1:3492`；`originAllowed` 对**无 Origin 头**的调用放行，只需页面 HTML 里的 64 位 token，头名 `x-clean-login-token`）发起 `POST /api/signin {provider, account:{key}, proxy:{id}}`。magpie 在 11:14:42 已被重启过，新服务端代码已在线。",
      "kind": "state"
    },
    {
      "k": "c022",
      "v": "**站点侧关键事实**：她的 profile 会话仍有效，登录页直接弹「选择登录账号」，**没有要密码/SMS/验证码**，认设备直接过 —— 站点看到的仍是同一台机器。",
      "kind": "decision"
    },
    {
      "k": "c023",
      "v": "**操作坑（下次直接用）**：本机双屏，DISPLAY2 在**负坐标区**（Bounds X=-2160,Y=-812，1440x2560），虚拟屏原点 `-2160,-812`；截图图像坐标 ≠ 屏幕坐标，必须 `screen = image + (Left,Top)`。正确做法：`GetWindowRect` 取 camoufox 窗口矩形 → 矩形内截图定位 → 用屏幕绝对坐标 `SetCursorPos`+`mouse_event`。Camoufox 窗口会被 Cindy 全屏压住，需先 `SetForegroundWindow`。",
      "kind": "rule"
    },
    {
      "k": "c024",
      "v": "**未验**：插件自己的新 UI（Account identities 卡片、Continue with an existing identity 下拉）没在 magpie webview 里点过——两个账号现在都是已登录态，列表里没有退役身份可点；真实登录是走同一套 HTTP API 驱动的，不是点 webview 控件。",
      "kind": "state"
    },
    {
      "k": "c025",
      "v": "**副作用（有益）**：静静的外婆拿到一枚新签发的 60 天 token，07:10/00:05 的 WorkBuddy 例行任务凭证已刷新。",
      "kind": "state"
    },
    {
      "k": "c026",
      "v": "**秦昊麟（裸键 `workbuddy`）同样真机验证通过（11:24:09–11:26:25，2 分 16 秒）**：`claimed=true`、`identityCreated=false`、`state=done`；pin `29a86643526fb4fd…` 字节与 mtime 全部未变；token 于 11:26:23 新签发（exp 2027-01-02）；台账 `signedInAt=11:26:25.049`；profile 176→199 文件 / 132M。站点同样只弹「选择登录账号」，无密码无验证码。",
      "kind": "decision"
    },
    {
      "k": "c027",
      "v": "**窗口定位定稿做法（第二次一次命中）**：`Get-Process camoufox` 里 `MainWindowTitle -match 'Camoufox'` 且 `MainWindowHandle -ne 0` 的那个 → `GetWindowRect`（本例 4,4,1444,1036）→ `AttachThreadInput(GetCurrentThreadId(), GetWindowThreadProcessId(GetForegroundWindow()))` + `SetWindowPos(HWND_TOPMOST→HWND_NOTOPMOST)` + `BringWindowToTop` + `SetForegroundWindow` 才能压过全屏的 Cindy → 按 rect 原点截 1440x1032 → `CopyFromScreen(rect.Left, rect.Top)` 后 **图像坐标 = 屏幕坐标 − (Left,Top)** → 行中心换算后 `SetCursorPos`+`mouse_event`，点完还原光标。这两个浏览器都**没开 remote-debugging**，只能走鼠标。",
      "kind": "rule"
    },
    {
      "k": "c028",
      "v": "**UI 控件真机验收（11:52–11:57）**：clean-login 页面在 magpie 的 webview 里无法查 DOM（Wails/WebView2 未开调试口），改用 Playwright 驱动**同一份页面代码** `http://127.0.0.1:3492/` + 本机 Chrome(headless)。关键技巧：页面的 magpie 供应商名单来自 **URL hash `#providers=<urlencoded JSON>`**（`magpiePayloadFromHash()`，在 magpie 里由 host 自动注入；不带 hash 时页面显示「未取得 magpie 名单 · 使用本地名单」，只剩 3 个本地供应商、**没有 workbuddy 卡片**）。补上 `{\"providers\":[{\"id\":\"workbuddy\",\"name\":\"WorkBuddy\"}]}` 后 WorkBuddy 卡片与「添加账号」按钮（`button.provider-add`）才出现。",
      "kind": "preference"
    },
    {
      "k": "c029",
      "v": "**认领链路（真实账号，一次通过）**：卡片→添加账号→对话框 `#signin-account` 两项（`\"\"`=新账号新的指纹 / `workbuddy`=秦昊麟ོོ · 上次登录于…）→另需在 `#signin-proxy` 选出口（59 项，含「不使用代理（直连）」）→POST `{\"provider\":\"workbuddy\",\"proxy\":{id,type,host,port,username},\"account\":{\"key\":\"workbuddy\"}}`→`claimed=true, identityCreated=false, done`；pin 字节与 mtime 未变；token 11:54:38 新签发；台账 11:54:40；站点仍只弹「选择登录账号」。",
      "kind": "decision"
    },
    {
      "k": "c030",
      "v": "**坑**：第一次跑漏选代理导致 `proxy:null`（走直连），已 `POST /api/signin/cancel` 取消重来——区域一致性要记得选出口。",
      "kind": "state"
    },
    {
      "k": "c031",
      "v": "**清除身份按钮**：用一次性诱饵身份（`workbuddy#zzdecoy`，假 pin+假台账，不在 auth 里）验删除链路，未碰真实指纹：badge 1→点清除→二次确认弹窗文案正确（`#confirm-dialog` / `#confirm-action`）→`DELETE /api/accounts/...` 200 `{\"ok\":true}`→badge 0 + 「身份已清除。」→目录真被删。诱饵已清，无残留。",
      "kind": "decision"
    },
    {
      "k": "c032",
      "v": "**小观察（未改）**：`/api/health.accounts` 的 `kept/retired/pruned` 是**上一次扫描的快照**，不是实时；两人都上线后仍显示 `retired:1`，易误读。",
      "kind": "state"
    },
    {
      "k": "c033",
      "v": "# clean-login 账号页与身份检测：已在 PR #6 落地（待初号机合并）",
      "kind": "open"
    },
    {
      "k": "c034",
      "v": "aibo 2026-11-04 定的范围（实用主义裁剪）只做三块：账号页 UI 重做进生产、记录登录时使用的出口、账号身份检测（只用第三方站点判定）。供应商全量真机验证、providers:list 真实 payload 专项核对、prune 并发/EBUSY 压测、退役身份自动磁盘回收、release.mjs 优化、上游 #4823、原生登录接管、Mac/跨平台、主动换地区测风控——全部明确不做。",
      "kind": "preference"
    },
    {
      "k": "c035",
      "v": "## 已实现（PR #6，CI 绿）",
      "kind": "state"
    },
    {
      "k": "c036",
      "v": "- 开发在隔离克隆 `bots/bot_1793404248859_935ug6/workspace/ship/clean-login-repo`；生产副本 `bots/cindy-default/workspace/clean-login-standalone` 已复位到 main 且未改（仅遗留未跟踪 `_scan-probe.mjs`）。未重启/未改生产 magpie，未读写真实 `~/.config/magpie/`。",
      "kind": "state"
    },
    {
      "k": "c037",
      "v": "- 账号页：第 3 个 tab，已登录+已登出统一表格（账号/指纹/上次登录/身份检测/状态/操作）；已登出行主操作「重新登录」预选保留身份（`openSignInDialog(provider,{accountKey})` + `renderSignInPreselection`）；搜索、排序、状态过滤、等级图例、toast 堆叠、空/加载/失败态、移动端字段标签；「未验证流程」标记由真实 provider 能力派生。html 40 个按钮全部 `type=\"button\"` 且有绑定，无死按钮、无演示数据。新增纯函数模块 `ui/account-view.js`。",
      "kind": "open"
    },
    {
      "k": "c038",
      "v": "## 仍未决",
      "kind": "open"
    },
    {
      "k": "c039",
      "v": "1. **等初号机合并 PR #6**，合并后按规范重跑 CI 并打 tag `v0.1.4`（发布= bump+tag；本次 bump 已含在 PR 内）。",
      "kind": "state"
    },
    {
      "k": "c040",
      "v": "4. 契约与审计文件：`bots/bot_1793404248859_326s0s/workspace/documents/2026-11-04-clean-login-0.1.4-contract.md`、`2026-11-04-clean-login-未决事务审计.md`。",
      "kind": "open"
    },
    {
      "k": "c041",
      "v": "【端到端闭环已验收 2026-11-03】POST /api/signin(provider=workbuddy, proxy=http://127.0.0.1:17806 → 出口 58.152.58.159) → 弹出可见 Camoufox 窗口 → 用户在窗口内登录 → 回调自动回写 magpie 的 plugin-auth.json，落到新键 workbuddy#d6jtgo（静静的外婆）。裸键 workbuddy（秦昊麟ོོ）逐字节未变，其余 5 个 WorkBuddy 账号原样；登录后 camoufox 子进程全部自退。aibo 不需要在 magpie UI 里走任何步骤，magpie 侧只是“看到”结果。",
      "kind": "rule"
    },
    {
      "k": "c042",
      "v": "1. windowsHide 必须为 false。fork 浏览器宿主时 windowsHide:true 会在 Windows 上隐藏该子进程及其所有 GUI 窗口 —— 浏览器其实起来了，但用户完全看不到窗口，这就是“看不到浏览器”的真因。",
      "kind": "rule"
    },
    {
      "k": "c043",
      "v": "2. 指纹模型必须装进插件自己的 modelDir。fpgen 模型 MODEL_PIN = model-2/2026（约 1.5 MB 下载 / 204 MB 解压，主体是 211 MB 的 values.dat）原本不在精简包里也不在安装流程里。模型目录环境变量是 FPGEN_DATA_DIR（fpgen-js 读它），但 camoufox 在 import 时会调 setModelDir 覆盖，所以必须在 launch 输入里显式 setModelDir，不能只靠环境变量。environment 的 downloadBytes/extractedBytes/requiredDiskBytes 需含模型部分。",
      "kind": "rule"
    },
    {
      "k": "c044",
      "v": "【必须保持的不变量】auth 文件读不出来时绝不清空。readAuthKeys 原本自己吞掉所有异常并返回空 Set，于是“文件缺失/权限错误/JSON 损坏/半写入”会让每个 pin 目录都被判成孤儿而一次性全部 rm -rf，直接违反“pin 与账号同生同死”。现由 readAuthKeysResult 区分 auth_missing / auth_unreadable / auth_invalid（一律整体跳过并在报告 skipped 里写明原因）与合法的空对象 {}（照常清理孤儿）；readAuthKeys 保留并委托给它，对外行为不变。",
      "kind": "rule"
    },
    {
      "k": "c045",
      "v": "【代码事实】safeSegment 不是单射（转义没有长度前缀，#a 与 U+023A 都编码成 %23a），所以“某目录是否属于已知键”不能靠解码判断，只能比较 safeSegment(authKey) 与磁盘上的原始段名；decodeSegment 只用于展示。",
      "kind": "rule"
    },
    {
      "k": "c046",
      "v": "【已知边界】清理只在插件启动时跑，运行期间新产生的孤儿要等下次重载；并发 prune 与写标记的竞态、真实 Windows EBUSY 锁、真实权限拒绝均未实测（只用注入的失败 rm / EISDIR 覆盖）。",
      "kind": "state"
    },
    {
      "k": "c047",
      "v": "【产品决策：不要\"验证通过才给入口\"（2026-11-03，aibo 明确否掉）】clean-login 原先的卡片策略是\"该供应商的登录流程没在插件里验证过，就不给任何操作入口\"，只有一句诚实的\"尚未实现该流程，因此这里仍不能添加账号\"。aibo 否掉了这套：**入口先放出去，让用户点、让用户实测、失败就如实报错，靠用户反馈来发现和修 bug**。理由：没有入口就没有真实使用，也就拿不到问题反馈。",
      "kind": "open"
    },
    {
      "k": "c048",
      "v": "落地（已实现并真机验收）：",
      "kind": "state"
    },
    {
      "k": "c049",
      "v": "- 卡片在**已安装插件扫描出一个 browser 类登录方法**时就渲染「添加账号」按钮（`type=\"button\"`，沙箱硬约束），不再用 `capability.state === \"ready\"` 当门槛。",
      "kind": "rule"
    },
    {
      "k": "c050",
      "v": "- 关键字段 `signInProvider`：`defaultLoadProvider` 是按**已安装插件条目的 id** 查插件的，而卡片的 id 可能是按 magpie 名单 id 或显示名 slug 匹配出来的，两者不一定相等；所以卡片必须显式带出插件条目 id，前端用之。没有匹配到插件条目时为 null，不造。",
      "kind": "rule"
    },
    {
      "k": "c051",
      "v": "- 登录对话框：代理下拉（默认直连；其余来自已存代理，只显示名称+地址，**绝不回传密码**）→ `POST /api/signin` → 轮询展示状态 → done 显示账号键 / error 原样展示服务端 code+message → 可取消。",
      "kind": "rule"
    },
    {
      "k": "c052",
      "v": "【顺带在真实环境里验证到的一件事】把 静静的外婆 从 magpie 移除后（`plugin-auth.json` 里 `workbuddy#d6jtgo` 消失，2026-11-03 08:08），下次插件启动清理如实记录 `accounts: 0 kept, 1 pruned, 0 failed`，那个 780 MB 的 pin 目录被正确回收 —— 孤儿回收在真实使用中按预期工作了。",
      "kind": "preference"
    },
    {
      "k": "c053",
      "v": "【2026-11-05 已发布】clean-login 0.1.9（PR #9 `feat: sync account proxy exits into magpie providers.json`，rebase 合并提交 `0421158`、发布提交 `5527075`）起，登录成功会把该账号使用的出口写进 magpie 的 `providers[].accountProxies`（键 = 登录用户名小写，值 = http/https/socks5 URL），账号运行流量不再回落到 provider 级代理；服务启动时 `backfillAccountProxies` 按账号台账补写缺失键，已存在的键（含用户手设）不动。实现：`lib/account-proxies.mjs` 的 `writeAccountProxies` 进程内串行 + 0600 临时文件 + rename 原子替换，拒绝 `__proto__`/`constructor`/`prototype`，遇到非法 JSON 既不修复也不写；`syncAccountProxy` 在 `lib/signin-flow.mjs` 的 `runCallback` 里于凭证与台账落盘之后 best-effort 调用，写失败不影响登录；`lib/server.mjs` 启动时 fire-and-forget 跑 backfill。配置目录由 `magpieConfigDir(env)` 决定并尊重 `MAGPIE_CONFIG_DIR`，单测全部走临时目录。",
      "kind": "state"
    },
    {
      "k": "c054",
      "v": "【已知边界，未收口】① Windows 上该原子写会先 `rm` 目标再 rename，那一瞬间 `providers.json` 不存在；② `providers.json` 还有别的写者（magpie 自己、DSH），并发读改写理论上可交错覆盖；③「magpie 热加载外部原子写」只有实现方说明，初号机未独立验证（验证必须真写生产配置，属禁区）。",
      "kind": "open"
    }
  ],
  "values": {
    "paths": [
      "s://who.1ms.dog/zh-cn/",
      "/utils.js",
      "/probe-who.mjs",
      "/--pin/--pin-file/--no-canvas-noise/--settle",
      "/proxy.local.json",
      "/Shanghai",
      "/packages/clean-login",
      "/account-identity.mjs",
      "/writeAccountMeta/readAccountMeta/listAccountDirsWithMeta",
      "/api/accounts",
      "/api/accounts/",
      "/api/signin",
      "/api/health",
      "/backfill-account-meta.mjs",
      "/smoke-accounts.mjs",
      "p://127.0.0.1",
      "/WebView2",
      "/api/signin/cancel",
      "/api/accounts/...",
      "/api/health.accounts",
      "/retired/pruned",
      "/clean-login",
      "/accounts-page-v2",
      "s://github.com/Gruu6y/clean-login/pull/6",
      "/check-version-bump.mjs",
      "/bot_1793404248859_935ug6/workspace/ship/clean-login-repo",
      "/cindy-default/workspace/clean-login-standalone",
      "/.config/magpie/",
      "/account-view.js",
      "/account-records.mjs",
      "/signin-flow.mjs",
      "/checks/loginHistory",
      "/name/region/type/at",
      "/port/password",
      "/identity-check.mjs",
      "/identity-check-browser-host.mjs",
      "/check/cancel",
      "/browser-launcher.mjs",
      "/ui-preview",
      "/bot_1793404248859_326s0s/workspace/documents/2026-11-04-clean-login-0.1.4-contract.md",
      "/extractedBytes/requiredDiskBytes",
      "/account-prune.mjs",
      "/api/accounts/prune",
      "/mnt/c/..."
    ],
    "hashes": [
      "c8b26515",
      "410da1c4",
      "f27944cc",
      "a413c04e",
      "cd44ab3d",
      "1a329bd4",
      "33a65eba3c847f3095805bf1",
      "3ce63568",
      "57c94741",
      "29a86643526fb4fd",
      "f0f85c6",
      "abbc48f",
      "41804455304"
    ],
    "versions": [
      "167.17.68.82",
      "127.0.0.1",
      "134.195.100.26",
      "118.166.22.182",
      "1.4.4",
      "00.700",
      "25.049",
      "0.1.3",
      "0.1.4",
      "v0.1.4",
      "0.1.4-contract.md",
      "58.152.58.159",
      "1.5",
      "24.04"
    ],
    "urls": [
      "https://who.1ms.dog/zh-cn/",
      "http://127.0.0.1:3492",
      "http://127.0.0.1:3492/",
      "https://github.com/Gruu6y/clean-login/pull/6",
      "http://127.0.0.1:17806"
    ],
    "refs": [
      "PR #6",
      "#4823",
      "#8"
    ],
    "ports": [
      "127.0.0.1:17603",
      "127.0.0.1:3492",
      "127.0.0.1:17806"
    ],
    "envs": [
      "CONNECT",
      "SOCKS5",
      "ACCOUNT_META_FILE",
      "DELETE",
      "APPDATA",
      "DISPLAY2",
      "HWND_TOPMOST",
      "HWND_NOTOPMOST",
      "MODEL_PIN",
      "FPGEN_DATA_DIR",
      "CALLBACK_TIMEOUT_MS",
      "EISDIR"
    ],
    "literals": [
      "https://who.1ms.dog/zh-cn/",
      "clean-login-trial/",
      "c8b26515·410da1c4",
      "f27944cc·a413c04e",
      "dist/utils.js",
      "launchOptions",
      "identitySalt(pinned)",
      "fingerprint",
      "fingerprint_preset",
      "navigator.userAgent",
      "config",
      "randomBytes(8)",
      "generateFingerprint({os:\"windows\"})",
      "cd44ab3d·1a329bd4",
      "firefoxGpus(\"win\")",
      "AMD Radeon RX 6800 XT",
      "planRendering()",
      "canvas_noise:false",
      "toDataURL",
      "33a65eba3c847f3095805bf1",
      "clean-login-trial/probe-who.mjs",
      "--headless/--pin/--pin-file/--no-canvas-noise/--settle",
      "who-<tag>.txt|.json|.png",
      "canvas-hash.mjs",
      "identity.json",
      "127.0.0.1:17603",
      "clean-login-trial/proxy.local.json",
      "server",
      "解析器在中国、IP 在新加坡 |",
      "本站与国内站出口不同 |",
      "泄露 167.17.68.82 |",
      "134.195.100.26",
      "magpie-plugins-dev/packages/clean-login",
      "account.json",
      "{version,provider,key,accountId,uid,signedInAt}",
      "lib/account-identity.mjs",
      "ACCOUNT_META_FILE/writeAccountMeta/readAccountMeta/listAccountDirsWithMeta",
      "account-prune.mjs",
      "kept",
      "retired",
      ".signin-flow.json",
      "skippedLive",
      "rm",
      "skipped",
      "startSignIn({account:{key}})",
      "meta.provider",
      "retired_missing",
      "opts.forceKey",
      "identity_mismatch",
      "retiredAccountKeys",
      "existingKeysFor",
      "opts.takenKeys",
      "writeBack",
      "single:true",
      "GET /api/accounts",
      "DELETE /api/accounts/<provider>/<key>",
      "signed_in",
      "POST /api/signin",
      "account:{key}",
      "/api/health",
      "scripts/backfill-account-meta.mjs",
      "--apply",
      "scripts/smoke-accounts.mjs",
      "cindy-326s0s/accounts-page-v2",
      "f0f85c6",
      "abbc48f",
      "bun test",
      "bun scripts/check-version-bump.mjs --base origin/main",
      "bots/bot_1793404248859_935ug6/workspace/ship/clean-login-repo",
      "bots/cindy-default/workspace/clean-login-standalone",
      "_scan-probe.mjs",
      "~/.config/magpie/",
      "openSignInDialog(provider,{accountKey})",
      "renderSignInPreselection",
      "type=\"button\"",
      "ui/account-view.js",
      "lib/account-records.mjs",
      "lib/signin-flow.mjs",
      "withLogin(meta, loginSnapshot(current.proxyMeta,signedAt))",
      "lib/identity-check.mjs",
      "lib/identity-check-browser-host.mjs",
      "check-profile/",
      "评分 A|B|C|D",
      "N 处可能暴露你",
      "浏览器指纹 ID",
      "readIdentity(dir)",
      "PATCH /api/accounts/<p>/<k>",
      "POST|GET /api/accounts/<p>/<k>/check",
      ".../check/cancel",
      "lib/browser-launcher.mjs",
      "headless",
      "v0.1.4",
      "capability.state === \"ready\"",
      "signInProvider",
      "defaultLoadProvider",
      "plugin-auth.json",
      "workbuddy#d6jtgo",
      "accounts: 0 kept, 1 pruned, 0 failed"
    ]
  },
  "state": {
    "active": true,
    "claim_count": 54,
    "open_count": 7,
    "member_count": 5,
    "merged_from": [
      "project_clean-login-identity-pinning",
      "project_clean-login-identity-pinning-invariant",
      "project_clean-login-account-identity-retirement",
      "project_clean-login-accounts-page-identity-check",
      "project_clean-login-signin-loop-and-account-prune"
    ],
    "merged_at": "2026-11-04T21:42:52.272Z",
    "directive": "m01320",
    "format": "cindy.memory.v1",
    "operative_layer": "machine",
    "archive_contains_verbatim_prose": true
  },
  "open": [
    "**待实测确认的问题**：同一账号 pin 不变、但出口地区变化，供应商会不会当作异常登录？（这条约束只覆盖了指纹维度，没覆盖地理维度。）",
    "# clean-login 账号页与身份检测：已在 PR #6 落地（待初号机合并）",
    "- 账号页：第 3 个 tab，已登录+已登出统一表格（账号/指纹/上次登录/身份检测/状态/操作）；已登出行主操作「重新登录」预选保留身份（`openSignInDialog(provider,{accountKey})` + `renderSignInPreselection`）；搜索、排序、状态过滤、等级图例、toast 堆叠、空/加载/失败态、移动端字段标签；「未验证流程」标记由真实 provider 能力派生。html 40 个按钮全部 `type=\"button\"` 且有绑定，无死按钮、无演示数据。新增纯函数模块 `ui/account-view.js`。",
    "## 仍未决",
    "4. 契约与审计文件：`bots/bot_1793404248859_326s0s/workspace/documents/2026-11-04-clean-login-0.1.4-contract.md`、`2026-11-04-clean-login-未决事务审计.md`。",
    "【产品决策：不要\"验证通过才给入口\"（2026-11-03，aibo 明确否掉）】clean-login 原先的卡片策略是\"该供应商的登录流程没在插件里验证过，就不给任何操作入口\"，只有一句诚实的\"尚未实现该流程，因此这里仍不能添加账号\"。aibo 否掉了这套：**入口先放出去，让用户点、让用户实测、失败就如实报错，靠用户反馈来发现和修 bug**。理由：没有入口就没有真实使用，也就拿不到问题反馈。",
    "【已知边界，未收口】① Windows 上该原子写会先 `rm` 目标再 rename，那一瞬间 `providers.json` 不存在；② `providers.json` 还有别的写者（magpie 自己、DSH），并发读改写理论上可交错覆盖；③「magpie 热加载外部原子写」只有实现方说明，初号机未独立验证（验证必须真写生产配置，属禁区）。"
  ],
  "source": {
    "updatedAt": "2026-11-05T01:08:36.197Z",
    "migratedAt": "2026-11-04T21:42:52.272Z",
    "directive": "m01320"
  },
  "raw": {
    "title": "clean-login 身份稳定性实测与每 profile pin 要求 | clean-login 核心不变量：凭据固定指纹、出口可共享 | clean-login 账号身份退役与复用（台账 account.json + 认领 + uid 守卫） | clean-login 账号页与身份检测（PR #6 已落地，待初号机合并） | clean-login 登录闭环与账号目录回收",
    "description": "试跑接 mihomo 出口后评分 D→B；WebRTC 靠 proxy_only 硬化即可；配代理必须开 geoip 否则时区漏宿主 | 出口可共享/轮换，但同一供应商凭据必须固定单一指纹；pin 与 profile 一一对应并持久化；同账号换地区出口是否触发风控未实测 | clean-login 登出不回收指纹：台账+退役+认领+uid守卫+退役key占位；两账号真机登录 + UI 控件（认领下拉/清除身份）全部验收 | 账号页 v2、登录出口台账、who.1ms.dog 身份检测已在 PR #6 完成并 CI 绿；aibo 裁剪后的范围与剩余验收项 | clean-login 真实登录闭环验收结论、windowsHide 与 fpgen 模型两个真机坑、孤儿账号目录回收规则与 auth 不可读不清空的不变量、以及\"入口先放出去靠用户反馈\"的产品决策。 | clean-login 0.1.9 起登录出口自动写入 magpie accountProxies，启动 backfill 只补缺失键；rm+rename 窗口与并发写者两条边界未收口。",
    "body": "===== project_clean-login-identity-pinning =====\n\n**触发**：aibo 在精简浏览器里跑 `https://who.1ms.dog/zh-cn/`，得评分 D、4 处标红，说「结果不佳」。主代理复现并拆解（2026-11-03，`clean-login-trial/`）。\n\n**先说评分 D 的成分**：4 个标红里 **3 个是网络面**（DNS 泄露 / 分流 / WebRTC 泄露 167.17.68.82），根因是这次试跑**没给浏览器配代理**——而 clean-login 的产品形态本来就是「每个账号绑一个出口」。身份面 6 项里 5 项 ✓：UA 与真实系统一致、环境未被篡改、无自动化痕迹、系统语言与 IP 不矛盾。所以 D 不是精简运行时的过错。\n\n**挖出的真问题 1：不 pin 时每次启动换一套身份。**\n同一台机器、同一份精简包，连续两次启动：\n\n| | run1 | run2 |\n|---|---|---|\n| 综合指纹 ID | `c8b26515·410da1c4` | `f27944cc·a413c04e` |\n| 屏幕 | 1920×1080 | 1366×768 |\n\n对干净登录是硬伤：**同一个账号两次登录看起来是两台不同设备**，登录风控会注意到。机制在 `dist/utils.js` 的 `launchOptions`：`identitySalt(pinned)` 只在 pin 了身份时确定（`fingerprint` / 对象型 `fingerprint_preset` / 带 `navigator.userAgent` 的 `config`），否则 `randomBytes(8)` 每次新抽。\n\n**已验证的修法**：`generateFingerprint({os:\"windows\"})` 出一份 fingerprint，按 profile 存下来复用 → pin 之后**屏幕 / 显卡 / UA / WebGL / 音频 / 字体列表哈希两次完全一致**（字体列表 `cd44ab3d·1a329bd4` 两次相同）。→ **T3 必须给每个 profile 绑定并持久化一份 fingerprint**。\n\n**挖出的真问题 2：宿主 GPU 不在上游收录表。**\n`firefoxGpus(\"win\")` 实测只有 **11 条**，没有本机的 `AMD Radeon RX 6800 XT`；于是 `planRendering()` 判定 canvas 需覆盖。站点自己也写明「显卡是 Radeon R9 200 Series（Firefox 给的同档替代型号，**不是你的真实显卡**）」。`canvas_noise:false` 也换不来宿主 GPU：那条路会变成「不声称任何 GPU」（WebGL 缺位本身是破绽）。两条路不能兼得。\n\n**未收口**：pin 之后站点面板上 **Canvas 一项仍在变**，进而把「综合指纹」带偏；但主代理本地自算 canvas（`toDataURL`）连跑 8 次哈希完全相同 `33a65eba3c847f3095805bf1`。说明差异更可能在站点那一项的测法，要定论需单独拆站点脚本。\n\n**工具**：`clean-login-trial/probe-who.mjs`（`--headless/--pin/--pin-file/--no-canvas-noise/--settle`，落 `who-<tag>.txt|.json|.png`）、`canvas-hash.mjs`（本地自算 canvas 哈希，隔离站点因素）、`identity.json`（已生成的一份 windows fingerprint pin）。\n\n**出口实测（2026-11-03）**：试跑接到本机 **verge-mihomo 混合端口 `127.0.0.1:17603`**（HTTP CONNECT 与 SOCKS5 都通，站点判定完全相同）。写出 `clean-login-trial/proxy.local.json`（`server` 一行可改；本文件不入库）。\n\n| 项目 | 直连 | 走 mihomo |\n|---|---|---|\n| DNS 泄露 | `!` 解析器在中国、IP 在新加坡 | `✓` 解析器也在台湾 |\n| 分流 | `!` 本站与国内站出口不同 | `✓` 所有网站同一个出口 |\n| WebRTC 泄露 | `!` 泄露 167.17.68.82 | `✓` 没有拿到公网地址 |\n| 评分 | **D** | **B** |\n\n出口 IP：直连 `134.195.100.26` → 代理 `118.166.22.182`（Chunghwa Telecom，台湾）。\n\n**关键 1：WebRTC 不需要 `block_webrtc`。** 配上代理后 `media.peerconnection.ice.proxy_only_if_behind_proxy`（camoufox.cfg 自带）自动生效，站点从 `!` 降为 `i`。实测 `--block-webrtc` 也能把 D 抬到 C，但那是\"没代理时的兜底\"，不该做默认。→ 上轮\"配了代理走硬化、没配才一刀切\"的判断被实测证实。\n\n**关键 2：配代理必须开 `geoip`，否则身份时区/语言跟宿主而不是出口。** 启动器会报 `LeakWarning: When using a proxy, it is heavily recommended that you pass geoip=True`。实测：\n\n| | 不开 geoip | 开 geoip |\n|---|---|---|\n| 时区 | `Asia/Shanghai`（宿主）| `Asia/Taipei`（出口）|\n| 语言 | `en-US` | `zh-TW` |\n\n这次没露馅纯属巧合——台湾与上海同为 UTC+8。**换一个非 UTC+8 的节点，\"时区与 IP\"会立刻不一致**，所以 T3 必须「有代理就开 geoip」。副作用：会连带覆盖 locale 口径。\n\n**T3 清单增补**：① 每 profile 持久化一份 fingerprint（防每次启动换身份）② 有代理时开 geoip ③ WebRTC 靠 proxy_only 硬化，不无条件 `block_webrtc`。\n\n\n===== project_clean-login-identity-pinning-invariant =====\n\n**aibo 定的产品约束（2026-11-03）**：**一个出口地址可以接受多个指纹；但一个供应商凭据不能接受多个指纹。**\n\n含义：\n- **出口（代理）可以共享、可以轮换** —— 真实世界里一个 NAT 出口后面就是很多人，站点不会因为\"多个浏览器共用一个 IP\"而判定异常。所以代理池/轮换本身不是风险源。\n- **同一个供应商凭据（一个账号）绝不能对应多个指纹** —— 同一个账号反复以不同设备指纹登录，会被登录风控判为异常。这是 clean-login 的**核心不变量**。\n\n**直接推到的工程要求**：\n1. 每个账号的 **fingerprint pin 必须持久化、与该账号的 profile 一一对应**。之前实测出的\"不 pin 每次启动换一套身份\"就是直接违反这条约束的——那条修复因此从\"建议\"升级为\"不可商量的前置\"。\n2. **pin 与 profile 必须同生同死**：profile 里存 pin；删 profile 则 pin 一起删；绝不能出现\"同一账号换 pin\"或\"同一 pin 被两个账号共用\"。\n3. 出口与账号**不必一对一绑定**（可以多个账号共用一个出口），但**地域一致性**要单独评估：**同一账号频繁换国家/地区出口**是否也触发风控，目前**没有实测**，不能当作已知结论。\n\n**待实测确认的问题**：同一账号 pin 不变、但出口地区变化，供应商会不会当作异常登录？（这条约束只覆盖了指纹维度，没覆盖地理维度。）\n\n\n===== project_clean-login-account-identity-retirement =====\n\n**2026-11-03 完成（aibo 要求「登出也不回收指纹、下次登录复用同一指纹」）。** 代码在 cindy四号机 workspace 的 `magpie-plugins-dev/packages/clean-login`（git untracked，未 commit/push）。**magpie 未重启，插件库未动。**\n\n**四个机制**\n1. **归属台账** `account.json`（与 `identity.json` 同目录）：`{version,provider,key,accountId,uid,signedInAt}`。`lib/account-identity.mjs` 的 `ACCOUNT_META_FILE/writeAccountMeta/readAccountMeta/listAccountDirsWithMeta`，原子写 0o600。\n2. **回收改退役**：`account-prune.mjs` 判序 = auth 里有 key → `kept`；有台账 → `retired`（**永不删**）；新鲜 `.signin-flow.json` → `skippedLive`；其余才 `rm`。auth 读不到 → 整轮 `skipped`（不变）。\n3. **认领复用**：`startSignIn({account:{key}})` 校验目录+台账+`meta.provider`（否则 400 `retired_missing`），用该 key 保证同目录同 pin；writeBack 走 `opts.forceKey` 跳过 settle 同名匹配。\n4. **uid 守卫**：回调后比台账 uid（缺失回退 accountId），不一致 → 不写回、`identity_mismatch`、目录留在退役态。\n\n**我追加的关键一条（worker 首轮漏掉）**：非认领分配时把「有台账的目录对应的 key」并入 existingKeys（`retiredAccountKeys` + `existingKeysFor`，`opts.takenKeys` 同步传给 `writeBack`）。否则 A 登出后 B 登录会拿到裸键 → 命中 A 的目录 → **用 A 的 pin 和 A 的 Cookie 打开浏览器**。`single:true` 供应商是唯一例外（仅一槽），兜底是 uid 守卫 + UI 身份列表。\n\n**API/UI**：`GET /api/accounts`、`DELETE /api/accounts/<provider>/<key>`（已签入 409 `signed_in`）、`POST /api/signin` 接受 `account:{key}`、`/api/health` 加 `retired` 计数；UI 加 Account identities 卡片（Clear identity，二次确认）与登录对话框「Continue with an existing identity」（唯一时默认选中）。\n\n**脚本**：`scripts/backfill-account-meta.mjs`（默认 dry-run，`--apply` 才写；只因 key 在 auth 里才归属）、`scripts/smoke-accounts.mjs`（临时数据目录起真实 startServer 打两个路由）。\n\n**已对真实数据做的事**：给 秦昊麟(裸键 workbuddy, uid 3ce63568…) 与 静静的外婆(#mbg4c2, uid 57c94741…) 回填台账（`signedInAt:null`）；`identity.json` 字节与 mtime 未变；真实启动扫描结果 `2 kept, 0 retired, 2 pruned`（pruned 是残留的空壳 `__probe__`/`__probe_nonexistent__`）。\n\n**验收**：`bun test` 416 pass / 0 fail（bun 1.4.4，经 `npm i -g bun` 装，PATH 加 `%APPDATA%\\npm`）。magpie 无 `fs.watch`，**服务端改动需重启 magpie 或重载插件才生效**。UI 未在真实 magpie 沙箱里点过（只有单测 + 路由测试 + 冒烟）。\n\n**已知代价**：磁盘不自动回收（55M+/账号）、退役 profile 里的站点 cookie 长期留盘，靠 UI 的 Clear identity 手动清。\n\n**2026-11-03 11:16–11:20 真机验证通过（aibo 授权）。** 走实时服务 API（`http://127.0.0.1:3492`；`originAllowed` 对**无 Origin 头**的调用放行，只需页面 HTML 里的 64 位 token，头名 `x-clean-login-token`）发起 `POST /api/signin {provider, account:{key}, proxy:{id}}`。magpie 在 11:14:42 已被重启过，新服务端代码已在线。\n\n**结果**：`state=done`、`claimed=true`、`identityCreated=false`、耗时 3 分 31 秒；`identity.json` sha256 全等（`933a8959052db9e03af8dfc03595e20eb65f128c05c15c39c2bdf2952ad3885e`）且 mtime 未变；凭据写回原键，token iat 11:19:59（本次签发、exp 2027-01-02）；台账 `signedInAt` 落 11:20:00.700；profile 57M/177 文件 → 92M/193 文件（站点数据写进同一个 profile）；秦昊麟账号零改动；无 `.signin-flow.json` 残留。\n\n**站点侧关键事实**：她的 profile 会话仍有效，登录页直接弹「选择登录账号」，**没有要密码/SMS/验证码**，认设备直接过 —— 站点看到的仍是同一台机器。\n\n**操作坑（下次直接用）**：本机双屏，DISPLAY2 在**负坐标区**（Bounds X=-2160,Y=-812，1440x2560），虚拟屏原点 `-2160,-812`；截图图像坐标 ≠ 屏幕坐标，必须 `screen = image + (Left,Top)`。正确做法：`GetWindowRect` 取 camoufox 窗口矩形 → 矩形内截图定位 → 用屏幕绝对坐标 `SetCursorPos`+`mouse_event`。Camoufox 窗口会被 Cindy 全屏压住，需先 `SetForegroundWindow`。\n\n**未验**：插件自己的新 UI（Account identities 卡片、Continue with an existing identity 下拉）没在 magpie webview 里点过——两个账号现在都是已登录态，列表里没有退役身份可点；真实登录是走同一套 HTTP API 驱动的，不是点 webview 控件。\n\n**副作用（有益）**：静静的外婆拿到一枚新签发的 60 天 token，07:10/00:05 的 WorkBuddy 例行任务凭证已刷新。\n\n**秦昊麟（裸键 `workbuddy`）同样真机验证通过（11:24:09–11:26:25，2 分 16 秒）**：`claimed=true`、`identityCreated=false`、`state=done`；pin `29a86643526fb4fd…` 字节与 mtime 全部未变；token 于 11:26:23 新签发（exp 2027-01-02）；台账 `signedInAt=11:26:25.049`；profile 176→199 文件 / 132M。站点同样只弹「选择登录账号」，无密码无验证码。\n\n**窗口定位定稿做法（第二次一次命中）**：`Get-Process camoufox` 里 `MainWindowTitle -match 'Camoufox'` 且 `MainWindowHandle -ne 0` 的那个 → `GetWindowRect`（本例 4,4,1444,1036）→ `AttachThreadInput(GetCurrentThreadId(), GetWindowThreadProcessId(GetForegroundWindow()))` + `SetWindowPos(HWND_TOPMOST→HWND_NOTOPMOST)` + `BringWindowToTop` + `SetForegroundWindow` 才能压过全屏的 Cindy → 按 rect 原点截 1440x1032 → `CopyFromScreen(rect.Left, rect.Top)` 后 **图像坐标 = 屏幕坐标 − (Left,Top)** → 行中心换算后 `SetCursorPos`+`mouse_event`，点完还原光标。这两个浏览器都**没开 remote-debugging**，只能走鼠标。\n\n**UI 控件真机验收（11:52–11:57）**：clean-login 页面在 magpie 的 webview 里无法查 DOM（Wails/WebView2 未开调试口），改用 Playwright 驱动**同一份页面代码** `http://127.0.0.1:3492/` + 本机 Chrome(headless)。关键技巧：页面的 magpie 供应商名单来自 **URL hash `#providers=<urlencoded JSON>`**（`magpiePayloadFromHash()`，在 magpie 里由 host 自动注入；不带 hash 时页面显示「未取得 magpie 名单 · 使用本地名单」，只剩 3 个本地供应商、**没有 workbuddy 卡片**）。补上 `{\"providers\":[{\"id\":\"workbuddy\",\"name\":\"WorkBuddy\"}]}` 后 WorkBuddy 卡片与「添加账号」按钮（`button.provider-add`）才出现。\n\n**认领链路（真实账号，一次通过）**：卡片→添加账号→对话框 `#signin-account` 两项（`\"\"`=新账号新的指纹 / `workbuddy`=秦昊麟ོོ · 上次登录于…）→另需在 `#signin-proxy` 选出口（59 项，含「不使用代理（直连）」）→POST `{\"provider\":\"workbuddy\",\"proxy\":{id,type,host,port,username},\"account\":{\"key\":\"workbuddy\"}}`→`claimed=true, identityCreated=false, done`；pin 字节与 mtime 未变；token 11:54:38 新签发；台账 11:54:40；站点仍只弹「选择登录账号」。\n\n**坑**：第一次跑漏选代理导致 `proxy:null`（走直连），已 `POST /api/signin/cancel` 取消重来——区域一致性要记得选出口。\n\n**清除身份按钮**：用一次性诱饵身份（`workbuddy#zzdecoy`，假 pin+假台账，不在 auth 里）验删除链路，未碰真实指纹：badge 1→点清除→二次确认弹窗文案正确（`#confirm-dialog` / `#confirm-action`）→`DELETE /api/accounts/...` 200 `{\"ok\":true}`→badge 0 + 「身份已清除。」→目录真被删。诱饵已清，无残留。\n\n**小观察（未改）**：`/api/health.accounts` 的 `kept/retired/pruned` 是**上一次扫描的快照**，不是实时；两人都上线后仍显示 `retired:1`，易误读。\n\n\n===== project_clean-login-accounts-page-identity-check =====\n\n# clean-login 账号页与身份检测：已在 PR #6 落地（待初号机合并）\n\naibo 2026-11-04 定的范围（实用主义裁剪）只做三块：账号页 UI 重做进生产、记录登录时使用的出口、账号身份检测（只用第三方站点判定）。供应商全量真机验证、providers:list 真实 payload 专项核对、prune 并发/EBUSY 压测、退役身份自动磁盘回收、release.mjs 优化、上游 #4823、原生登录接管、Mac/跨平台、主动换地区测风控——全部明确不做。\n\n## 已实现（PR #6，CI 绿）\n- 仓库 Gruu6y/clean-login，分支 `cindy-326s0s/accounts-page-v2`，提交 `f0f85c6`，基于 main `abbc48f`。PR: https://github.com/Gruu6y/clean-login/pull/6 。CI run #8 = success（id 41804455304）。本地 `bun test` = 527 pass / 0 fail（38 文件）。`bun scripts/check-version-bump.mjs --base origin/main` = OK，version 0.1.3 → **0.1.4**。\n- 开发在隔离克隆 `bots/bot_1793404248859_935ug6/workspace/ship/clean-login-repo`；生产副本 `bots/cindy-default/workspace/clean-login-standalone` 已复位到 main 且未改（仅遗留未跟踪 `_scan-probe.mjs`）。未重启/未改生产 magpie，未读写真实 `~/.config/magpie/`。\n- 账号页：第 3 个 tab，已登录+已登出统一表格（账号/指纹/上次登录/身份检测/状态/操作）；已登出行主操作「重新登录」预选保留身份（`openSignInDialog(provider,{accountKey})` + `renderSignInPreselection`）；搜索、排序、状态过滤、等级图例、toast 堆叠、空/加载/失败态、移动端字段标签；「未验证流程」标记由真实 provider 能力派生。html 40 个按钮全部 `type=\"button\"` 且有绑定，无死按钮、无演示数据。新增纯函数模块 `ui/account-view.js`。\n- 登录出口台账：`lib/account-records.mjs`（note≤200、loginHistory cap20、checks cap10、summary cap4/500 字），`lib/signin-flow.mjs` 登录成功 `withLogin(meta, loginSnapshot(current.proxyMeta,signedAt))` 并保留 note/checks/loginHistory。只存 id/name/region/type/at，绝不存 host/port/password。\n- 身份检测：`lib/identity-check.mjs` + `lib/identity-check-browser-host.mjs`，用账号自己的 pin + 所选出口在 `check-profile/` 里 headless 开 `https://who.1ms.dog/zh-cn/`，父进程解析 `评分 A|B|C|D`、`N 处可能暴露你`、`浏览器指纹 ID` 下一行、最多 4 条「你」开头结论。明确标注第三方站点判定≠供应商风控。手动触发、可取消、失败/取消绝不写历史也不覆盖上次判定。`lib/account-identity.mjs` 新增只读 `readIdentity(dir)`，绝不生成新指纹。\n- 路由：`GET /api/accounts` 带台账与指纹摘要；`PATCH /api/accounts/<p>/<k>` 存备注；`POST|GET /api/accounts/<p>/<k>/check` + `.../check/cancel`。`lib/browser-launcher.mjs` 的 `headless` 参数化。\n\n## 仍未决\n1. **等初号机合并 PR #6**，合并后按规范重跑 CI 并打 tag `v0.1.4`（发布= bump+tag；本次 bump 已含在 PR 内）。\n2. **真机验收**：全部测试是单测/真实 loopback 服务，未在真实 magpie webview 里点过账号页、未真机跑过一次 who.1ms.dog 检测。这是合并后的验收步骤。\n3. v2 体验件（三号机 workspace/ui-preview）仍是演示件，可归档。\n4. 契约与审计文件：`bots/bot_1793404248859_326s0s/workspace/documents/2026-11-04-clean-login-0.1.4-contract.md`、`2026-11-04-clean-login-未决事务审计.md`。\n\n\n===== project_clean-login-signin-loop-and-account-prune =====\n\n【端到端闭环已验收 2026-11-03】POST /api/signin(provider=workbuddy, proxy=http://127.0.0.1:17806 → 出口 58.152.58.159) → 弹出可见 Camoufox 窗口 → 用户在窗口内登录 → 回调自动回写 magpie 的 plugin-auth.json，落到新键 workbuddy#d6jtgo（静静的外婆）。裸键 workbuddy（秦昊麟ོོ）逐字节未变，其余 5 个 WorkBuddy 账号原样；登录后 camoufox 子进程全部自退。aibo 不需要在 magpie UI 里走任何步骤，magpie 侧只是“看到”结果。\n\n【两条真机才暴露的坑】\n1. windowsHide 必须为 false。fork 浏览器宿主时 windowsHide:true 会在 Windows 上隐藏该子进程及其所有 GUI 窗口 —— 浏览器其实起来了，但用户完全看不到窗口，这就是“看不到浏览器”的真因。\n2. 指纹模型必须装进插件自己的 modelDir。fpgen 模型 MODEL_PIN = model-2/2026（约 1.5 MB 下载 / 204 MB 解压，主体是 211 MB 的 values.dat）原本不在精简包里也不在安装流程里。模型目录环境变量是 FPGEN_DATA_DIR（fpgen-js 读它），但 camoufox 在 import 时会调 setModelDir 覆盖，所以必须在 launch 输入里显式 setModelDir，不能只靠环境变量。environment 的 downloadBytes/extractedBytes/requiredDiskBytes 需含模型部分。\n\n【账号目录回收（lib/account-prune.mjs）】startSignIn 会先预分配键并立刻建账号目录（identity.json + 浏览器 profile），凭据要等回调才回写，因此任何中止的登录（回调超时/报错/magpie 重载/用户没登完）都会漏一个无凭据目录，约 780 MB，原本永远无人回收。现规则：插件启动时清理「键不在 plugin-auth.json 里的账号目录」；登录期间在账号目录写 .signin-flow.json 在飞标记，标记年龄 < 回调超时（6 分钟，CALLBACK_TIMEOUT_MS 单点定义）就跳过；有键的目录任何情况下都不删；单目录删除失败只记录不抛出。另暴露 POST /api/accounts/prune 按需跑，GET /api/health 带上次计数摘要（只放计数与短字符串，不放键名/路径）。\n\n【必须保持的不变量】auth 文件读不出来时绝不清空。readAuthKeys 原本自己吞掉所有异常并返回空 Set，于是“文件缺失/权限错误/JSON 损坏/半写入”会让每个 pin 目录都被判成孤儿而一次性全部 rm -rf，直接违反“pin 与账号同生同死”。现由 readAuthKeysResult 区分 auth_missing / auth_unreadable / auth_invalid（一律整体跳过并在报告 skipped 里写明原因）与合法的空对象 {}（照常清理孤儿）；readAuthKeys 保留并委托给它，对外行为不变。\n\n【代码事实】safeSegment 不是单射（转义没有长度前缀，#a 与 U+023A 都编码成 %23a），所以“某目录是否属于已知键”不能靠解码判断，只能比较 safeSegment(authKey) 与磁盘上的原始段名；decodeSegment 只用于展示。\n\n【环境与基线】宿主 Windows 上没有 bun，测试用 WSL Ubuntu-24.04 的 bun 1.4.4 跑（路径经 /mnt/c/...）。clean-login 基线 236 pass / 0 fail（18 文件）。\n\n【已知边界】清理只在插件启动时跑，运行期间新产生的孤儿要等下次重载；并发 prune 与写标记的竞态、真实 Windows EBUSY 锁、真实权限拒绝均未实测（只用注入的失败 rm / EISDIR 覆盖）。\n\n\n【产品决策：不要\"验证通过才给入口\"（2026-11-03，aibo 明确否掉）】clean-login 原先的卡片策略是\"该供应商的登录流程没在插件里验证过，就不给任何操作入口\"，只有一句诚实的\"尚未实现该流程，因此这里仍不能添加账号\"。aibo 否掉了这套：**入口先放出去，让用户点、让用户实测、失败就如实报错，靠用户反馈来发现和修 bug**。理由：没有入口就没有真实使用，也就拿不到问题反馈。\n\n落地（已实现并真机验收）：\n- 卡片在**已安装插件扫描出一个 browser 类登录方法**时就渲染「添加账号」按钮（`type=\"button\"`，沙箱硬约束），不再用 `capability.state === \"ready\"` 当门槛。\n- 关键字段 `signInProvider`：`defaultLoadProvider` 是按**已安装插件条目的 id** 查插件的，而卡片的 id 可能是按 magpie 名单 id 或显示名 slug 匹配出来的，两者不一定相等；所以卡片必须显式带出插件条目 id，前端用之。没有匹配到插件条目时为 null，不造。\n- 登录对话框：代理下拉（默认直连；其余来自已存代理，只显示名称+地址，**绝不回传密码**）→ `POST /api/signin` → 轮询展示状态 → done 显示账号键 / error 原样展示服务端 code+message → 可取消。\n- 代理安全传递：页面只把选中的代理**公开对象**（id 等）发给服务端，由服务端按 id 在本地 store 里取出真身（含密码）再用，密码不出服务进程。\n- 四种语言的卡片文案改成\"还没有验证过，可以直接尝试，失败会如实报错，欢迎反馈问题\"。\n- 实测（真扫描器 + 真 camoufox）：21 张卡片中 workbuddy / cursor / devin / workbuddy-ai / commandcode-plan 五个拿到按钮，点 WorkBuddy 的按钮真的弹出可见浏览器窗口并进入 waiting-login，取消正常收尾。包内测试 264 pass / 0 fail。\n\n【顺带在真实环境里验证到的一件事】把 静静的外婆 从 magpie 移除后（`plugin-auth.json` 里 `workbuddy#d6jtgo` 消失，2026-11-03 08:08），下次插件启动清理如实记录 `accounts: 0 kept, 1 pruned, 0 failed`，那个 780 MB 的 pin 目录被正确回收 —— 孤儿回收在真实使用中按预期工作了。\n\n===== clean-login.account-proxy-sync =====\n\n【2026-11-05 已发布】clean-login 0.1.9（PR #9 `feat: sync account proxy exits into magpie providers.json`，rebase 合并提交 `0421158`、发布提交 `5527075`）起，登录成功会把该账号使用的出口写进 magpie 的 `providers[].accountProxies`（键 = 登录用户名小写，值 = http/https/socks5 URL），账号运行流量不再回落到 provider 级代理；服务启动时 `backfillAccountProxies` 按账号台账补写缺失键，已存在的键（含用户手设）不动。实现：`lib/account-proxies.mjs` 的 `writeAccountProxies` 进程内串行 + 0600 临时文件 + rename 原子替换，拒绝 `__proto__`/`constructor`/`prototype`，遇到非法 JSON 既不修复也不写；`syncAccountProxy` 在 `lib/signin-flow.mjs` 的 `runCallback` 里于凭证与台账落盘之后 best-effort 调用，写失败不影响登录；`lib/server.mjs` 启动时 fire-and-forget 跑 backfill。配置目录由 `magpieConfigDir(env)` 决定并尊重 `MAGPIE_CONFIG_DIR`，单测全部走临时目录。\n\n【已知边界，未收口】① Windows 上该原子写会先 `rm` 目标再 rename，那一瞬间 `providers.json` 不存在；② `providers.json` 还有别的写者（magpie 自己、DSH），并发读改写理论上可交错覆盖；③「magpie 热加载外部原子写」只有实现方说明，初号机未独立验证（验证必须真写生产配置，属禁区）。\n"
  }
}
