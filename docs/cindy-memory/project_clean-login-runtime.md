---
title: project.clean-login-runtime
description: p=cindy.memory.v1;t=project;kc=32;c=58;v=235;o=5;raw=1
type: project
updatedAt: '2026-11-04T21:42:52.272Z'
---

{
  "protocol": "cindy.memory.v1",
  "id": "project_clean-login-runtime",
  "type": "project",
  "keys": [
    "clean",
    "login",
    "browser",
    "repo.md",
    "gruu6y/clean-login-browser",
    "f227a24c",
    "browser-v158.0.1-beta.41-slim.1",
    "artifacts/github-release-verify.md",
    "uploadreleaseasset",
    "deleterepository",
    "delete_repo",
    "dsh_secret_github_token_mailwatch",
    "mailwatch-280",
    "cindy_browser",
    "app_bound_encryption_unsupported",
    "my-browser",
    "tmp-upload-probe",
    "tmp-delete-probe-2",
    "fonts/twemojimozilla.ttf",
    "font-hijacker.patch",
    "isstockbundledfontfile",
    "fonts/",
    "slim",
    "runtime",
    "trial",
    "harness.md",
    "launch.mjs",
    "node_modules/",
    "spikes/camoufox-bun/",
    "readme.md",
    "last-run.json",
    "last-run.png"
  ],
  "claims": [
    {
      "k": "c001",
      "v": "**状态(2026-11-02 已闭环)**:README 已提交(commit `f227a24c`);draft release `browser-v158.0.1-beta.41-slim.1`(release id `431827074`,prerelease,**保持 draft 未发布**)已带上 4 个资产,全部 `state=uploaded`,并由主代理独立回读核对:",
      "kind": "state"
    },
    {
      "k": "c002",
      "v": "- **cindy-github 插件的 117 个操作里没有“上传 release 资产”**(releases 类目只有 list_releases / get_release_by_tag / create_release / get_latest_release / list_release_assets);GraphQL 无 `uploadReleaseAsset` / `deleteRepository`。所以**插件凭证只能建仓库/提交文件/建 release,不能传资产、不能删仓库**。",
      "kind": "rule"
    },
    {
      "k": "c003",
      "v": "- 传 release 资产必须用 REST(`POST https://uploads.github.com/repos/{owner}/{repo}/releases/{id}/assets?name=…`),需要 fine-grained `Contents: Read and write`;**删仓库**需要 `Administration: Read and write`(或 classic `delete_repo`)。",
      "kind": "rule"
    },
    {
      "k": "c004",
      "v": "- 环境变量 `DSH_SECRET_GITHUB_TOKEN_MAILWATCH` 里曾放的 `mailwatch-280` 已被主人删除;新 token 由主人配进插件、并曾在对话中明文给出,**建议用完轮换**。",
      "kind": "state"
    },
    {
      "k": "c005",
      "v": "**未决**:正式发给用户前必须让仓库转公开或把资产移到公开托管(私有仓库 release 资产不能匿名下载)。两个临时探测仓库 `tmp-upload-probe` / `tmp-delete-probe-2` 已删除并复核 404。",
      "kind": "open"
    },
    {
      "k": "c006",
      "v": "**精简运行时关键事实**(供复用):官方 Windows 包 1258.9 MiB 下载 / 2468.0 MiB 安装;核心 167.2 / 411.4;字体 1091.3 / 2056.6。精简包 167.9 MiB / 412.8 MiB。Windows 身份在 Windows 宿主下只激活 `fonts/TwemojiMozilla.ttf`(上游 `font-hijacker.patch` 的 `IsStockBundledFontFile`),其余字面全部跳过。宿主缺字形只能靠装 Windows 用户字体补救,往 `fonts/` 放文件无效。",
      "kind": "rule"
    },
    {
      "k": "c007",
      "v": "**用途**：aibo 说「还没测试」精简运行时 → 给他一个亲手试的入口，不是插件。官方未修改 Camoufox 启动器 + 自托管 slim 构建，`portable`: `--url` / `--profile`（持久独立 profile）/ `--proxy` / `--os`（默认宿主 OS，`random` 走上游随机）/ `--check`（headless 自检 + 截图后退出）。",
      "kind": "rule"
    },
    {
      "k": "c008",
      "v": "- 不传 `os` 时上游随机抽身份 → 抽到 `X11; Linux x86_64`。**日常身份必须显式传宿主 OS**，否则瘦身包会被当成跨 OS 身份用。",
      "kind": "rule"
    },
    {
      "k": "c009",
      "v": "- 开窗口（`headless:false`）那条路径**尚未跑过**（会在 aibo 桌面弹窗，等他同意）。",
      "kind": "open"
    },
    {
      "k": "c010",
      "v": "**环境事实**：本机已无 bun（spike 当年的 Bun 1.4.4 不在 PATH，`~/.bun/bin` 不存在）；Node v22.23.2 直接跑得通 camoufox 0.5.9。",
      "kind": "state"
    },
    {
      "k": "c011",
      "v": "**aibo 实机试跑结果（2026-11-03）**：截图确认九个语系**零豆腐块**（宿主字体全在），并在精简浏览器里真实登录 WorkBuddy 成功。字体这条论证成立 → 精简路线可以继续。",
      "kind": "decision"
    },
    {
      "k": "c012",
      "v": "**同日实测出的身份不一致（要紧）**：这台宿主上默认启动**身份 ≠ 宿主**：",
      "kind": "rule"
    },
    {
      "k": "c013",
      "v": "**根因（已读启动器源码 + 实测确认，不是猜测）**：`dist/utils.js` 的 `planRendering()` 只在「targetOs == 宿主 OS」**且**「宿主 GPU 在 `firefoxGpus(targetOs)` 收录表里」时才让身份 = 宿主（含宿主 GPU）。实测 `firefoxGpus(\"win\")` **只有 11 条**，其中没有 RX 6800 XT / Radeon(TM) Graphics；不命中就落到 `return [canvasNoise == null, null]` → 默认 `canvasNoise` 为 undefined → **canvas 被覆盖、身份改为画出来的 + canvas 噪声**（也解释了为什么 q1 等价性测试必须 `canvas_noise:false`）。",
      "kind": "rule"
    },
    {
      "k": "c014",
      "v": "- 「身份 = 宿主」在这台机器上**达不到**，不是配置问题，是上游只收录 11 款 Windows GPU。别把它当验收标准；能要求的是「身份自洽 + 字体与身份相符」。",
      "kind": "rule"
    },
    {
      "k": "c015",
      "v": "- 传 `--locale zh-CN` 已验证生效（`language` 变为 `zh-CN`）；但跟随宿主语言是**产品选择**，不是必错项，要明确口径而不是留在默认。",
      "kind": "rule"
    },
    {
      "k": "c016",
      "v": "- `canvas_noise:false` 能拿到宿主 OS 身份，但 GPU 会变成不声称（WebGL 缺位本身也是破绽）。两条路不能兼得。",
      "kind": "rule"
    },
    {
      "k": "c017",
      "v": "**通道清查结论（实测，别再重查）**：magpie 的 page 插件只能通过 `_magpie/bridge.js` 读数据，而 magpie 二进制里写死的读名**全文只有两个**：",
      "kind": "rule"
    },
    {
      "k": "c018",
      "v": "**已落地的派生第一层**（`packages/clean-login`，未提交）：`magpie.permissions: [\"providers:list\"]`；`page/boot.js` 读该值（1.5s 超时，失败/无 bridge 都不阻断导航），通过**导航 URL 的 hash** 交给界面（page 不能 fetch、不能用存储，只能导航）；新增纯函数模块 `lib/provider-sources.mjs` 做容错归一化与合并，产出四态 `both / local-only / magpie-only / local-unknown`；magpie-only 卡片**不带添加入口**并如实说明原因；名单没拿到时降级为纯本地并标明来源。",
      "kind": "rule"
    },
    {
      "k": "c019",
      "v": "1. 本地 id 写成 `google-antigravity`，而 magpie 的 id 是 **`antigravity`** → 合并把它判成 local-only，界面会对一个 magpie 真有的供应商说「magpie 里没有这个供应商」。**`test/server.test.mjs` 里有一条断言把这个错固化住了**。已把本地 id 改成 `antigravity`。",
      "kind": "state"
    },
    {
      "k": "c020",
      "v": "2. 读接口文档写的是 \"names\"，若真返回**显示名**而不是 id，`slug(\"Google Antigravity\")` = `google-antigravity`，同样对不上。已改成**双键匹配**（id 与名称 slug 都参与），并加了「magpie 只返回显示名时也必须命中」的回归测试。",
      "kind": "rule"
    },
    {
      "k": "c021",
      "v": "**未验证项（已如实标注在代码里）**：`providers:list` 的**真实 payload 形状**无法在本机挂载 magpie 验证，实测只能靠行为验证 + 容错分支覆盖。",
      "kind": "open"
    },
    {
      "k": "c022",
      "v": "**测试计划（aibo 已定：每个机制测一个）**：① 真·网页登录 → `workbuddy`（免费号，且已有一次成功先例）+ `workbuddy-ai`（同会话第二账号）；② 设备码 → `factory`；③ 短信验证码 → `loomy`；④ 复用本地登录态 → `zcode`；⑤ API key → 无需浏览器。`kiro` 留作\"代理 Google 风控\"的安全靶子，避免拿主 Google 号试。",
      "kind": "state"
    },
    {
      "k": "c023",
      "v": "【工程位置】开发仓库 C:\\Users\\Administrator\\AppData\\Roaming\\CindyGlobal\\owners\\984709c7221453028169\\bots\\bot_1793484737606_f2yq7i\\workspace\\magpie-plugins-dev（yetone/magpie-community/plugins 浅克隆，main 分支），插件 packages/clean-login，包名 @magpie-community/page-clean-login，MIT，目标官方社区 PR 采纳。主代理负责规划/编排/验收，实现和测试尽量交子代理；用户不再逐步确认，可并发处理互不依赖任务。所有交互控件必须可用且闭环，不能有演示死按钮。",
      "kind": "rule"
    },
    {
      "k": "c024",
      "v": "【已完成】",
      "kind": "state"
    },
    {
      "k": "c025",
      "v": "1. 工程结构：Page + Host 页面插件，page/ 带路页，ui/ 本地服务界面，lib/ 服务端，port 3492，registry.json 已登记 kind=page。",
      "kind": "state"
    },
    {
      "k": "c026",
      "v": "3. 代理 IP 管理：proxies.json 原子写、目录 0700/文件 0600；CRUD；password 不回传（hasPassword）；真实 HTTP/HTTPS CONNECT 与 SOCKS5 测试，支持认证、12s 超时、无直连回退；失败安全提示；删除确认、取消、Escape、旧测试失效均闭环。",
      "kind": "decision"
    },
    {
      "k": "c027",
      "v": "4. 供应商能力注册表：固定 google-antigravity/codex/claude；均 capability=pending，含 agentId、signInMode、linkOnly、authHosts、callbackPort、风险说明；/api/providers 与 bootstrap 返回；UI 只显示卡片和待验证状态，无添加账号死按钮。",
      "kind": "open"
    },
    {
      "k": "c028",
      "v": "5. 官方运行时安装（第 6 步）已闭环：lib/browser-environment.mjs + environment API/UI，安装/进度/取消/重试/磁盘门限/可执行文件发现/校验状态如实展示；真机实测约 432 MB、25 秒、checksumVerified。",
      "kind": "state"
    },
    {
      "k": "c029",
      "v": "6. 真实登录闭环与账号目录回收已完成并端到端验收，详见同目录另一份记忆「clean-login 登录闭环与账号目录回收」；原「步骤 7-12 未完成」的结论已被它取代。",
      "kind": "state"
    },
    {
      "k": "c030",
      "v": "- 字体包是上游独立资产 fonts-bundle-v1.tar.xz：约 804 MB 压缩 / 2.1 GB 解压，带 sha256；当前官方浏览器 zip 仍把字体打进去。",
      "kind": "state"
    },
    {
      "k": "c031",
      "v": "- Camoufox 字体策略 = OS 基座 + 权重化语言/软件字体扩展 + marker fonts；宿主之间的真实字体差异是正常环境的一部分，目标是身份、字体和宿主环境相互一致，而不是所有设备使用同一套字体。",
      "kind": "preference"
    },
    {
      "k": "c032",
      "v": "- Windows/macOS 原生身份按 Camoufox 原生策略使用宿主字体，这是当前正确默认；此前“绝不使用宿主字体”及“默认全 Linux + OFL 语料”的路线已撤销，它源自对字体使用与再分发问题的错误推导。",
      "kind": "rule"
    },
    {
      "k": "c033",
      "v": "- 自定义字体实验仅保留为历史技术事实，不是当前产品路线：Windows 原生身份只从 fonts/ 加载 Twemoji，非宿主身份才加载自定义字体；custom_fonts_only=true 会关闭字体加载；最小 OFL 包能渲染但不足以复刻 Camoufox 完整策略。",
      "kind": "state"
    },
    {
      "k": "c034",
      "v": "- 字体文件的再分发、许可证和包体积独立审查；不得再由此推出禁止读取宿主字体。插件自身不分发宿主字体，也不修改官方浏览器的 fonts/、字体配置或 macOS .app。",
      "kind": "rule"
    },
    {
      "k": "c035",
      "v": "【已定原则】",
      "kind": "state"
    },
    {
      "k": "c036",
      "v": "- 使用官方未修改的 Camoufox 浏览器与原生身份默认策略；不通过 JS 伪造 Canvas/WebGL，不预先引入自定义字体分叉。",
      "kind": "rule"
    },
    {
      "k": "c037",
      "v": "- 官方浏览器/字体资产不随插件 npm 包发布；运行时下载，明确大小、可取消、可重试；有可靠哈希才标记已校验。",
      "kind": "state"
    },
    {
      "k": "c038",
      "v": "【后续迭代点：原生登录流程接管（暂缓）】aibo 决定当前不实施“劫持 Magpie 原生登录流程”，以后作为功能迭代点。候选方向不是自行拼供应商 URL，而是在原供应商 authorize() 返回后、默认 ShellExecute 前按单次流程接管：保留原 URL/state/callback，由 clean-login 用隔离浏览器打开，Magpie 原生完成账号去重、accountKey 分配和凭据保存。重启评估前必须验证存在可局部拦截的接口、不会打开系统默认浏览器、原 callback 可闭环，以及最终 accountKey 能与正确 profile/pin 对齐；若只能全局补丁或修改二进制，则继续保留当前自行运行流程并 auth.set 回填的路线。",
      "kind": "rule"
    },
    {
      "k": "c039",
      "v": "**冲突（已定位，2026-11-03）**：magpie 里「插件被识别为 page」要求包**没有** `main`/`exports`（`github.go` 的 `Kind=\"page\"` 判定），而 page 插件的 Service 只在**有** `main`/`exports` 时才挂载（`page.go:196`，`Window()` 的 `only` 又在 `pluginpage.go:164` 再挡一次）。服务要 `main`，`kind=page` 要没 `main`。`p.service` 全仓库只有一处赋值，panels/actions 不支持 service，`exports` 同样触发排除 —— **包层面无绕法**。",
      "kind": "rule"
    },
    {
      "k": "c040",
      "v": "**选择**：保留 `main: ./index.mjs`（功能优先，标签显示不是 page 可接受）。曾删 `main`（73d68aa），后果是 magpie 主动关掉服务，UI 报「127.0.0.1 拒绝连接」。`f642fce` 把 `main` 加回即恢复。",
      "kind": "rule"
    },
    {
      "k": "c041",
      "v": "**上游**：`yetone/magpie#4823`（作者 manjughosa，同一问题）。已用 Gruu6y 身份补真实案例 + 最小改法（只需改 `readTagged()` 判定顺序，`page.go` 安全门槛不用动）。**aibo 2026-11-03 决定：不提 PR**，issue 里说清改法即可。",
      "kind": "decision"
    },
    {
      "k": "c042",
      "v": "**验收口径**：`.bun-tag` = `Gruu6y-clean-login-f642fce`、`package.json main = ./index.mjs`、服务端口可连。",
      "kind": "decision"
    },
    {
      "k": "c043",
      "v": "**发布必须 bump 版本号（2026-11-03 踩坑纠正）**：magpie 判定「有没有新版本」看的是 package.json 的 `version` 字符串。`f4fea29`/`73d68aa`/`f642fce` 三个 commit 都停在 `0.1.0`，结果 `plugin-updates.json`（21:49 那次检查，晚于 `f642fce` 的 21:05）`waiting: null`、无 clean-login 条目 —— magpie 认定没有更新，用户在 UI 上\"看不出更新\"，点更新/安装也拿不到修复。修法：bump 到 `0.1.1`（commit `e7a250b`）并让测试从 package.json 读版本，不再硬钉字符串。**以后每次要用户吃到的改动都必须带上版本号。**",
      "kind": "rule"
    },
    {
      "k": "c044",
      "v": "**状态：T3 代码完成并已真机验收（2026-11-03，初号机）。** 仓库 `Gruu6y/clean-login-browser` 已由 aibo 手动转为 **public**；但 **draft release 尚未发布**，所以资产仍匿名 404 —— 这是 T3 之后唯一的阻塞项。",
      "kind": "open"
    },
    {
      "k": "c045",
      "v": "- 常量换成 slim：`DOWNLOAD_BYTES=176_170_139`、`EXTRACTED_BYTES=432_909_728`（旧 1_320_075_455 / 2_587_913_229 已删）；门限 = 两值 + 256 MiB = 877,515,323。",
      "kind": "state"
    },
    {
      "k": "c046",
      "v": "- 新增 `DEFAULT_ASSET_URL`（自托管 slim 资产）+ `DEFAULT_ASSET_SHA256` + `MAGPIE_CLEAN_LOGIN_BROWSER_SHA256`；`resolveBrowserAsset(env)` 决定 url/sha256/source。",
      "kind": "decision"
    },
    {
      "k": "c047",
      "v": "- **修掉一个真 bug**：旧代码 `fetcher.install(target, hooks)` 是错的 —— `install()` 只吃一个布尔量，于是 target 被当成 replace、hooks 全丢、URL 覆盖永不生效（即：无进度、不能取消）。现在改为 `new CamoufoxFetcher(repoConfig, selectedVersion)` + `install(false)`。",
      "kind": "rule"
    },
    {
      "k": "c048",
      "v": "- 取消/进度：子类化 `CamoufoxFetcher` 覆盖 `static downloadFile(file,url)`（源码明说这是扩展点），fetch + 流写回，遵守 AbortSignal 与 onProgress；用子类静态属性 `downloadHook` 交接。",
      "kind": "rule"
    },
    {
      "k": "c049",
      "v": "- 诚实性：只有真的走完校验才 `checksumVerified: true`；覆盖 URL 没给 sha 一律 false；`readRecord`/`writeRecord` 不再硬编码 false；404→`asset_not_found`、429/403→`rate_limited`。",
      "kind": "rule"
    },
    {
      "k": "c050",
      "v": "| 默认 URL 打真实 GitHub | 1.4 s 报 `asset_not_found`（因为 release 还是 draft）→ 发布后同一条路径即可真下 |",
      "kind": "rule"
    },
    {
      "k": "c051",
      "v": "**顺带修掉第 6 步的两个遗留（原本 53 pass / 2 fail）**：`ui/index.html` 的 `environment-prepare/cancel/retry` **三颗是死按钮**（app.js 里零监听、也没有状态渲染函数），两个红灯测试正是抓它——不是测试过时。已接活：状态渲染 + prepare/cancel/retry + preparing 轮询，卡片显示规则写进注释；校验文案四处语言全部从「publishes no checksum」改成如实分支。测试断言按原意窄化（provider 网格不得有操作按钮；index.html 每颗 button 必须被列出且真的接线）。**现在 65 pass / 0 fail，`bun scripts/check.mjs` 里 `✓ clean-login`。**",
      "kind": "rule"
    },
    {
      "k": "c052",
      "v": "- 本机原本没有 bun；已装到 `cindy-default/workspace/tools/bun-windows-x64/bun.exe`（**Bun 1.4.4**，与当年 spike 同版本），未动系统 PATH。",
      "kind": "state"
    },
    {
      "k": "c053",
      "v": "- `packages/clean-login/node_modules` 是从试跑目录做的 **junction**（.gitignore 已忽略 nodes_modules），仅用于本地跑起来；正式开发应换成真正的 `bun install`。",
      "kind": "state"
    },
    {
      "k": "c054",
      "v": "**2026-11-03 更新：阻塞已清除，T4 的测量半程实际已完成。**",
      "kind": "state"
    },
    {
      "k": "c055",
      "v": "- → T4 里\"新装用户首次登录实测下载量/安装量\"那半已达成；剩下的是真实账号登录，依赖第 7 步供应商登录闭环。",
      "kind": "state"
    },
    {
      "k": "c056",
      "v": "**能力边界（已实测确认，别再试探）**：cindy-github 插件**无法**发布 draft release，也**无法**改仓库可见性——`releases` 类目只有 list/get/create/latest/list_assets，`repo` 类目只有 create_repository；`meta.graphql` 逃生口也救不了：GitHub GraphQL **根本没有 release 变更**（`UpdateReleaseInput` 不存在），`UpdateRepositoryInput` 也**没有 visibility 字段**。这两件事只能人工点，或换有权限的 REST 凭证。README 可以用 `create_or_update_file_contents` 改（已验证，推完逐字节核对一致）。",
      "kind": "rule"
    },
    {
      "k": "c057",
      "v": "**残留**：release **正文**仍写着旧的「Status: DRAFT… assets pending upload…repo must be made public」，是过期文本；因为上面那条边界，只能人工 Edit 改掉，不影响功能。README 已改成准确版本（commit `ac1af8e9…`，blob `19d696fa…`，1600 字节）。",
      "kind": "rule"
    },
    {
      "k": "c058",
      "v": "**一处环境怪癖（别被误导）**：显示层会把某些字符串呈现成另一个样子（例如字体文件名会显示成 `TwemojiMozilla.ttf`，而磁盘上、以及 base64 里的真实字节是别的）。**判断文件内容不要靠肉眼读显示输出**，要用 xxd / cmp / 在 bash 内直接比对（已验证浏览器 sha256 常量与 zip 实测值逐字符一致）。",
      "kind": "rule"
    }
  ],
  "values": {
    "paths": [
      "/clean-login-browser",
      "/github-release-verify.md",
      "s://uploads.github.com/repos/",
      "/releases/",
      "/TwemojiMozilla.ttf",
      "/cindy-default/workspace/clean-login-trial/",
      "/camoufox-bun/",
      "/20100101",
      "/Shanghai",
      "/browser-environment.mjs",
      "/.bun/bin",
      "/UILanguage",
      "/utils.js",
      "/bridge.js",
      "/clean-login",
      "/provider-sources.mjs",
      "/server.test.mjs",
      "/check.mjs",
      "C:\\Users\\Administrator\\AppData\\Roaming\\CindyGlobal\\owners\\984709c7221453028169\\bots\\bot_1793484737606_f2yq7i\\workspace\\magpie-plugins-dev",
      "/magpie-community/plugins",
      "/page-clean-login",
      "/api/bootstrap",
      "/api/health",
      "/codex/claude",
      "/api/providers",
      "/state/callback",
      "/index.mjs",
      "/.config/magpie/plugins/bun.lock",
      "/page-clean-login/.bun-tag",
      "/.config/magpie/magpie-clean-login/",
      "/packages/clean-login",
      "/sha256/source",
      "/verify-install.mjs",
      "/index.html",
      "/cancel/retry",
      "/workspace/tools/bun-windows-x64/bun.exe",
      "/clean-login/node_modules",
      "/camoufox/camoufox/Cache/browsers/gruu6y/",
      "\\camoufox\\Cache",
      "/get/create/latest/list_assets"
    ],
    "hashes": [
      "f227a24c",
      "431827074",
      "20100101",
      "984709c7221453028169",
      "73d68aa",
      "f642fce",
      "f4fea29",
      "e7a250b",
      "ac1af8e9",
      "19d696fa"
    ],
    "versions": [
      "v158.0.1-beta.41",
      "158.0.1-beta.41.zip",
      "1258.9",
      "2468.0",
      "167.2",
      "411.4",
      "1091.3",
      "2056.6",
      "167.9",
      "412.8",
      "0.5.9",
      "1.62.0",
      "5.0",
      "10.0",
      "158.0",
      "1.4.4",
      "v22.23.2",
      "127.0.0.1",
      "v26.3.0",
      "1.23",
      "2.59",
      "2.16",
      "1.62",
      "2.1",
      "1.3",
      "0.1.0",
      "0.1.1",
      "8.5",
      "0.9",
      "1.4",
      "168.0",
      "4.5"
    ],
    "urls": [
      "https://uploads.github.com/repos/{owner}/{repo}/releases/{id}/assets?name=…"
    ],
    "refs": [
      "#4823"
    ],
    "ports": [],
    "envs": [
      "README",
      "DSH_SECRET_GITHUB_TOKEN_MAILWATCH",
      "APP_BOUND_ENCRYPTION_UNSUPPORTED",
      "CONNECT",
      "SOCKS5",
      "DOWNLOAD_BYTES",
      "EXTRACTED_BYTES",
      "DEFAULT_ASSET_URL",
      "DEFAULT_ASSET_SHA256",
      "MAGPIE_CLEAN_LOGIN_BROWSER_SHA256",
      "LOCALAPPDATA"
    ],
    "literals": [
      "Gruu6y/clean-login-browser",
      "f227a24c",
      "browser-v158.0.1-beta.41-slim.1",
      "431827074",
      "state=uploaded",
      "sha256:07bfbe8148b7b2b6a520074b6766b4aac493c6f2364e4d6af21c31b453026dd1",
      "artifacts/github-release-verify.md",
      "uploadReleaseAsset",
      "deleteRepository",
      "POST https://uploads.github.com/repos/{owner}/{repo}/releases/{id}/assets?name=…",
      "Contents: Read and write",
      "Administration: Read and write",
      "delete_repo",
      "DSH_SECRET_GITHUB_TOKEN_MAILWATCH",
      "mailwatch-280",
      "cindy_browser",
      "APP_BOUND_ENCRYPTION_UNSUPPORTED",
      "my-browser",
      "tmp-upload-probe",
      "tmp-delete-probe-2",
      "fonts/TwemojiMozilla.ttf",
      "font-hijacker.patch",
      "IsStockBundledFontFile",
      "fonts/",
      "bots/cindy-default/workspace/clean-login-trial/",
      "launch.mjs",
      "node_modules/",
      "spikes/camoufox-bun/",
      "README.md",
      "last-run.json",
      "last-run.png",
      "portable",
      "--url",
      "--profile",
      "--proxy",
      "--os",
      "random",
      "--check",
      "--os windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0",
      "platform Win32",
      "Asia/Shanghai",
      "webdriver false",
      "hasChrome false",
      "os",
      "X11; Linux x86_64",
      "headless:false",
      "lib/browser-environment.mjs",
      "~/.bun/bin",
      "en-US",
      "zh-CN",
      "ANGLE (AMD, Radeon R9 200 Series …)",
      "AMD Radeon RX 6800 XT",
      "AMD Radeon(TM) Graphics",
      "dist/utils.js",
      "_magpie/bridge.js",
      "const READS = { \"usage:summary\": \"your usage totals, by model\", \"providers:list\": \"your providers' names\" };",
      "providers:list",
      "server(input,options)",
      "client.auth.set",
      "/v1/*",
      "provider-registry.mjs",
      "packages/clean-login",
      "magpie.permissions: [\"providers:list\"]",
      "page/boot.js",
      "lib/provider-sources.mjs",
      "both / local-only / magpie-only / local-unknown",
      "google-antigravity",
      "antigravity",
      "test/server.test.mjs",
      "slug(\"Google Antigravity\")",
      "bun test",
      "bun scripts/check.mjs",
      "✓ clean-login",
      "workbuddy",
      "workbuddy-ai",
      "factory",
      "loomy",
      "zcode",
      "kiro",
      "main",
      "exports",
      "github.go",
      "Kind=\"page\"",
      "page.go:196",
      "Window()",
      "only",
      "pluginpage.go:164",
      "kind=page",
      "p.service",
      "main: ./index.mjs",
      "f642fce",
      "~/.config/magpie/plugins/bun.lock",
      "github:Gruu6y/clean-login#<commit>",
      "node_modules/@gruu6y/page-clean-login/.bun-tag",
      "Gruu6y-clean-login-<新commit>",
      "~/.config/magpie/magpie-clean-login/",
      "yetone/magpie#4823",
      "readTagged()",
      "page.go",
      ".bun-tag",
      "Gruu6y-clean-login-f642fce",
      "package.json main = ./index.mjs",
      "version",
      "f4fea29",
      "73d68aa",
      "0.1.0",
      "plugin-updates.json",
      "waiting: null",
      "0.1.1",
      "e7a250b",
      "magpie-plugins-dev/packages/clean-login",
      "DOWNLOAD_BYTES=176_170_139",
      "EXTRACTED_BYTES=432_909_728",
      "DEFAULT_ASSET_URL",
      "DEFAULT_ASSET_SHA256",
      "MAGPIE_CLEAN_LOGIN_BROWSER_SHA256",
      "resolveBrowserAsset(env)",
      "fetcher.install(target, hooks)",
      "install()",
      "new CamoufoxFetcher(repoConfig, selectedVersion)",
      "install(false)",
      "CamoufoxFetcher",
      "static downloadFile(file,url)",
      "downloadHook",
      "checksumVerified: true",
      "readRecord",
      "writeRecord",
      "asset_not_found",
      "rate_limited",
      "checksumVerified:true",
      "checksum_mismatch",
      "checksumVerified:false",
      "unavailable",
      "clean-login-trial/verify-install.mjs",
      "verify-ui.mjs",
      "verify-install-*.json",
      "ui/index.html",
      "environment-prepare/cancel/retry",
      "cindy-default/workspace/tools/bun-windows-x64/bun.exe"
    ]
  },
  "state": {
    "active": true,
    "claim_count": 58,
    "open_count": 5,
    "member_count": 6,
    "merged_from": [
      "project_clean-login-browser-repo",
      "project_clean-login-slim-runtime-trial-harness",
      "project_clean-login-runtime-derived-providers",
      "project_clean-login-magpie-plugin",
      "project_clean-login-main-field-conflict",
      "project_clean-login-t3-installer-closure"
    ],
    "merged_at": "2026-11-04T21:42:52.272Z",
    "directive": "m01320",
    "format": "cindy.memory.v1",
    "operative_layer": "machine",
    "archive_contains_verbatim_prose": true
  },
  "open": [
    "**未决**:正式发给用户前必须让仓库转公开或把资产移到公开托管(私有仓库 release 资产不能匿名下载)。两个临时探测仓库 `tmp-upload-probe` / `tmp-delete-probe-2` 已删除并复核 404。",
    "- 开窗口（`headless:false`）那条路径**尚未跑过**（会在 aibo 桌面弹窗，等他同意）。",
    "**未验证项（已如实标注在代码里）**：`providers:list` 的**真实 payload 形状**无法在本机挂载 magpie 验证，实测只能靠行为验证 + 容错分支覆盖。",
    "4. 供应商能力注册表：固定 google-antigravity/codex/claude；均 capability=pending，含 agentId、signInMode、linkOnly、authHosts、callbackPort、风险说明；/api/providers 与 bootstrap 返回；UI 只显示卡片和待验证状态，无添加账号死按钮。",
    "**状态：T3 代码完成并已真机验收（2026-11-03，初号机）。** 仓库 `Gruu6y/clean-login-browser` 已由 aibo 手动转为 **public**；但 **draft release 尚未发布**，所以资产仍匿名 404 —— 这是 T3 之后唯一的阻塞项。"
  ],
  "source": {
    "updatedAt": "2026-11-04T21:42:52.272Z",
    "migratedAt": "2026-11-04T21:42:52.272Z",
    "directive": "m01320"
  },
  "raw": {
    "title": "clean-login 精简运行时托管仓库与凭证边界 | clean-login 精简运行时试跑入口与宿主字体实测 | clean-login 供应商名单从 magpie 运行时派生（第一层已落地） | magpie 干净登录插件：工程状态与原生字体基线 | clean-login 的 main 字段两难：服务要 main、kind=page 要没 main（上游结构性冲突） | clean-login T3 安装器改造与第6步UI收口（已验收）",
    "description": "clean-login 精简运行时仓库 Gruu6y/clean-login-browser（私有）现状、凭证边界与体积事实 | 初号机 workspace 里的 clean-login-trial 试跑入口；aibo 实机试跑通过；宿主 GPU 不在上游 11 款收录表导致身份改画 | magpie 只暴露两个读名，providers:list 仅给名字→名单可派生、登录方式不可；已落地第一层并修掉 id 与显示名双形态匹配 bug | clean-login 已完成 Page+Host、代理管理、供应商注册表、官方运行时安装与真实登录闭环；字体基线为原生宿主字体。 | clean-login main 字段两难已定位为上游结构性冲突；插件靠\"卸载重装\"才能吃到新 commit；#4823 只留 issue 评论不提 PR；发布必须 bump 版本号否则更新检测看不见 | release 已发布，公网端到端22秒跑通并启动成功；插件无法发布release/改可见性（GraphQL也无）；显示层字符串替换的坑",
    "body": "===== project_clean-login-browser-repo =====\n\n**仓库**:`Gruu6y/clean-login-browser`(**private**,2026-11-02 由 cindy-github 插件建)。用途:托管 clean-login 插件的精简 Camoufox 运行时资产。不是 Camoufox 上游镜像。\n\n**状态(2026-11-02 已闭环)**:README 已提交(commit `f227a24c`);draft release `browser-v158.0.1-beta.41-slim.1`(release id `431827074`,prerelease,**保持 draft 未发布**)已带上 4 个资产,全部 `state=uploaded`,并由主代理独立回读核对:\n\n| 资产 | 字节 |\n|---|---|\n| camoufox-slim-win-x86_64-158.0.1-beta.41.zip | 176,170,139 |\n| ….zip.sha256 | 111 |\n| inventory.json | 3,781 |\n| build-report.md | 7,520 |\n\nzip 的 GitHub 端 digest 与本地均为 `sha256:07bfbe8148b7b2b6a520074b6766b4aac493c6f2364e4d6af21c31b453026dd1`;证据 `artifacts/github-release-verify.md`。\n\n**凭证边界(重要,踩过坑)**:\n- **cindy-github 插件的 117 个操作里没有“上传 release 资产”**(releases 类目只有 list_releases / get_release_by_tag / create_release / get_latest_release / list_release_assets);GraphQL 无 `uploadReleaseAsset` / `deleteRepository`。所以**插件凭证只能建仓库/提交文件/建 release,不能传资产、不能删仓库**。\n- 传 release 资产必须用 REST(`POST https://uploads.github.com/repos/{owner}/{repo}/releases/{id}/assets?name=…`),需要 fine-grained `Contents: Read and write`;**删仓库**需要 `Administration: Read and write`(或 classic `delete_repo`)。\n- 环境变量 `DSH_SECRET_GITHUB_TOKEN_MAILWATCH` 里曾放的 `mailwatch-280` 已被主人删除;新 token 由主人配进插件、并曾在对话中明文给出,**建议用完轮换**。\n- 浏览器代点(GitHub 设置页)不通:`cindy_browser` 借真实 Chrome 登录态被 Windows **App-Bound Encryption** 挡住(`APP_BOUND_ENCRYPTION_UNSUPPORTED`);`my-browser` 插件需 Chrome 扩展,当时未安装。\n\n**未决**:正式发给用户前必须让仓库转公开或把资产移到公开托管(私有仓库 release 资产不能匿名下载)。两个临时探测仓库 `tmp-upload-probe` / `tmp-delete-probe-2` 已删除并复核 404。\n\n**精简运行时关键事实**(供复用):官方 Windows 包 1258.9 MiB 下载 / 2468.0 MiB 安装;核心 167.2 / 411.4;字体 1091.3 / 2056.6。精简包 167.9 MiB / 412.8 MiB。Windows 身份在 Windows 宿主下只激活 `fonts/TwemojiMozilla.ttf`(上游 `font-hijacker.patch` 的 `IsStockBundledFontFile`),其余字面全部跳过。宿主缺字形只能靠装 Windows 用户字体补救,往 `fonts/` 放文件无效。\n\n\n===== project_clean-login-slim-runtime-trial-harness =====\n\n**位置**：`bots/cindy-default/workspace/clean-login-trial/`（初号机 Home 内，可写）。文件：`launch.mjs`（入口）、`node_modules/`（从 `spikes/camoufox-bun/` 拷来，camoufox 0.5.9 + playwright-core 1.62.0，35 MB，离线可用）、`README.md`、`last-run.json` / `last-run.png`。\n\n**用途**：aibo 说「还没测试」精简运行时 → 给他一个亲手试的入口，不是插件。官方未修改 Camoufox 启动器 + 自托管 slim 构建，`portable`: `--url` / `--profile`（持久独立 profile）/ `--proxy` / `--os`（默认宿主 OS，`random` 走上游随机）/ `--check`（headless 自检 + 截图后退出）。\n\n**实测（2026-11-03，本机 Windows 宿主）**：\n- `--os windows` 自检启动 2173 ms；UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0`、`platform Win32`、时区 `Asia/Shanghai`、`webdriver false`、`hasChrome false`。\n- 不传 `os` 时上游随机抽身份 → 抽到 `X11; Linux x86_64`。**日常身份必须显式传宿主 OS**，否则瘦身包会被当成跨 OS 身份用。\n- 九语系墨迹全部非零：简体 1185 / 日文 847 / 泰文 674 / 阿拉伯 353 / emoji 1077 / 空 0；截图目视**零豆腐块**。→ 删掉 2056.6 MiB `fonts/` 对「宿主 Windows + Windows 身份」确实无伤害，页面文字来自宿主 DirectWrite。\n- 开窗口（`headless:false`）那条路径**尚未跑过**（会在 aibo 桌面弹窗，等他同意）。\n\n**边界**：插件端到端此时测不了——`lib/browser-environment.mjs`（第 6 步）未最终验收，供应商登录（第 7 步）未做。能测的只有浏览器本体。\n\n**环境事实**：本机已无 bun（spike 当年的 Bun 1.4.4 不在 PATH，`~/.bun/bin` 不存在）；Node v22.23.2 直接跑得通 camoufox 0.5.9。\n\n**aibo 实机试跑结果（2026-11-03）**：截图确认九个语系**零豆腐块**（宿主字体全在），并在精简浏览器里真实登录 WorkBuddy 成功。字体这条论证成立 → 精简路线可以继续。\n\n**同日实测出的身份不一致（要紧）**：这台宿主上默认启动**身份 ≠ 宿主**：\n\n| 项 | 浏览器声称 | 宿主实际 |\n|---|---|---|\n| 语言 | `en-US` | `zh-CN`（SystemLocale/UILanguage 均 zh-CN，HomeLocation 中国）|\n| WebGL | `ANGLE (AMD, Radeon R9 200 Series …)` | `AMD Radeon RX 6800 XT` / `AMD Radeon(TM) Graphics` |\n| 屏幕 | 1440x1080 @1dpr | 主屏 1920x1080（另有副屏 1440x2560）|\n\n**根因（已读启动器源码 + 实测确认，不是猜测）**：`dist/utils.js` 的 `planRendering()` 只在「targetOs == 宿主 OS」**且**「宿主 GPU 在 `firefoxGpus(targetOs)` 收录表里」时才让身份 = 宿主（含宿主 GPU）。实测 `firefoxGpus(\"win\")` **只有 11 条**，其中没有 RX 6800 XT / Radeon(TM) Graphics；不命中就落到 `return [canvasNoise == null, null]` → 默认 `canvasNoise` 为 undefined → **canvas 被覆盖、身份改为画出来的 + canvas 噪声**（也解释了为什么 q1 等价性测试必须 `canvas_noise:false`）。\n\n**结论与影响**：\n- 「身份 = 宿主」在这台机器上**达不到**，不是配置问题，是上游只收录 11 款 Windows GPU。别把它当验收标准；能要求的是「身份自洽 + 字体与身份相符」。\n- 传 `--locale zh-CN` 已验证生效（`language` 变为 `zh-CN`）；但跟随宿主语言是**产品选择**，不是必错项，要明确口径而不是留在默认。\n- `canvas_noise:false` 能拿到宿主 OS 身份，但 GPU 会变成不声称（WebGL 缺位本身也是破绽）。两条路不能兼得。\n\n\n===== project_clean-login-runtime-derived-providers =====\n\n**目标**：aibo 定了范围——clean-login 要服务 magpie **全部内置供应商 + 官方收录的全部供应商**，所以静态注册表不成立，改成从 magpie 运行时派生。\n\n**通道清查结论（实测，别再重查）**：magpie 的 page 插件只能通过 `_magpie/bridge.js` 读数据，而 magpie 二进制里写死的读名**全文只有两个**：\n`const READS = { \"usage:summary\": \"your usage totals, by model\", \"providers:list\": \"your providers' names\" };`\n→ **`providers:list` 只给名字，拿不到登录方式。** 其他通道也不通：host 的 `server(input,options)` 里全仓只出现过 `client.auth.set`；magpie 监听 3425 的只有模型网关（`/v1/*`，管理端点会回 404 并列出允许的路径）；读它的配置文件越界。\n→ **结论：名单能派生，登录方式派不出来**。现阶段登录机制仍来自本地 `provider-registry.mjs`。\n\n**已落地的派生第一层**（`packages/clean-login`，未提交）：`magpie.permissions: [\"providers:list\"]`；`page/boot.js` 读该值（1.5s 超时，失败/无 bridge 都不阻断导航），通过**导航 URL 的 hash** 交给界面（page 不能 fetch、不能用存储，只能导航）；新增纯函数模块 `lib/provider-sources.mjs` 做容错归一化与合并，产出四态 `both / local-only / magpie-only / local-unknown`；magpie-only 卡片**不带添加入口**并如实说明原因；名单没拿到时降级为纯本地并标明来源。\n\n**验收时抓到并修掉的两个真 bug（同类两形态）**：\n1. 本地 id 写成 `google-antigravity`，而 magpie 的 id 是 **`antigravity`** → 合并把它判成 local-only，界面会对一个 magpie 真有的供应商说「magpie 里没有这个供应商」。**`test/server.test.mjs` 里有一条断言把这个错固化住了**。已把本地 id 改成 `antigravity`。\n2. 读接口文档写的是 \"names\"，若真返回**显示名**而不是 id，`slug(\"Google Antigravity\")` = `google-antigravity`，同样对不上。已改成**双键匹配**（id 与名称 slug 都参与），并加了「magpie 只返回显示名时也必须命中」的回归测试。\n\n**验收**：`bun test` **90 pass / 0 fail**（基线 65），`bun scripts/check.mjs` → `✓ clean-login`。另做了 8 种输入形状的行为验证（含 undefined / 失败信封 / 空数组 / 垃圾对象 / 真 id 列表 / 纯显示名 / {providers:[…]} 包装）。\n\n**未验证项（已如实标注在代码里）**：`providers:list` 的**真实 payload 形状**无法在本机挂载 magpie 验证，实测只能靠行为验证 + 容错分支覆盖。\n\n**测试计划（aibo 已定：每个机制测一个）**：① 真·网页登录 → `workbuddy`（免费号，且已有一次成功先例）+ `workbuddy-ai`（同会话第二账号）；② 设备码 → `factory`；③ 短信验证码 → `loomy`；④ 复用本地登录态 → `zcode`；⑤ API key → 无需浏览器。`kiro` 留作\"代理 Google 风控\"的安全靶子，避免拿主 Google 号试。\n\n\n===== project_clean-login-magpie-plugin =====\n\n【工程位置】开发仓库 C:\\Users\\Administrator\\AppData\\Roaming\\CindyGlobal\\owners\\984709c7221453028169\\bots\\bot_1793484737606_f2yq7i\\workspace\\magpie-plugins-dev（yetone/magpie-community/plugins 浅克隆，main 分支），插件 packages/clean-login，包名 @magpie-community/page-clean-login，MIT，目标官方社区 PR 采纳。主代理负责规划/编排/验收，实现和测试尽量交子代理；用户不再逐步确认，可并发处理互不依赖任务。所有交互控件必须可用且闭环，不能有演示死按钮。\n\n【已完成】\n1. 工程结构：Page + Host 页面插件，page/ 带路页，ui/ 本地服务界面，lib/ 服务端，port 3492，registry.json 已登记 kind=page。\n2. Page+Host 最小闭环：Host 仅 127.0.0.1，页面令牌 + Host + Origin 校验；/api/bootstrap、/api/health；主题/语言；失败重试；实际 Chrome 截图通过。\n3. 代理 IP 管理：proxies.json 原子写、目录 0700/文件 0600；CRUD；password 不回传（hasPassword）；真实 HTTP/HTTPS CONNECT 与 SOCKS5 测试，支持认证、12s 超时、无直连回退；失败安全提示；删除确认、取消、Escape、旧测试失效均闭环。\n4. 供应商能力注册表：固定 google-antigravity/codex/claude；均 capability=pending，含 agentId、signInMode、linkOnly、authHosts、callbackPort、风险说明；/api/providers 与 bootstrap 返回；UI 只显示卡片和待验证状态，无添加账号死按钮。\n5. 官方运行时安装（第 6 步）已闭环：lib/browser-environment.mjs + environment API/UI，安装/进度/取消/重试/磁盘门限/可执行文件发现/校验状态如实展示；真机实测约 432 MB、25 秒、checksumVerified。\n6. 真实登录闭环与账号目录回收已完成并端到端验收，详见同目录另一份记忆「clean-login 登录闭环与账号目录回收」；原「步骤 7-12 未完成」的结论已被它取代。\n\n【浏览器与字体事实】\n- Camoufox 0.5.9 + playwright-core 1.62.0 可在 Bun 1.4.4 原生运行，无需 Node sidecar；Bun process.version 显示 v26.3.0。\n- 官方 Windows x64 浏览器 zip 约 1.23 GB，解压约 2.59 GB；字体目录 1513 个文件、2.16 GB；首次安装受 GitHub API 403 限流，pinned 路径无 sha256 校验。npm 启动器包仅 1.62 MB，浏览器运行时下载。\n- 字体包是上游独立资产 fonts-bundle-v1.tar.xz：约 804 MB 压缩 / 2.1 GB 解压，带 sha256；当前官方浏览器 zip 仍把字体打进去。\n- Camoufox 字体策略 = OS 基座 + 权重化语言/软件字体扩展 + marker fonts；宿主之间的真实字体差异是正常环境的一部分，目标是身份、字体和宿主环境相互一致，而不是所有设备使用同一套字体。\n- Windows/macOS 原生身份按 Camoufox 原生策略使用宿主字体，这是当前正确默认；此前“绝不使用宿主字体”及“默认全 Linux + OFL 语料”的路线已撤销，它源自对字体使用与再分发问题的错误推导。\n- 自定义字体实验仅保留为历史技术事实，不是当前产品路线：Windows 原生身份只从 fonts/ 加载 Twemoji，非宿主身份才加载自定义字体；custom_fonts_only=true 会关闭字体加载；最小 OFL 包能渲染但不足以复刻 Camoufox 完整策略。\n- 字体文件的再分发、许可证和包体积独立审查；不得再由此推出禁止读取宿主字体。插件自身不分发宿主字体，也不修改官方浏览器的 fonts/、字体配置或 macOS .app。\n\n【已定原则】\n- 使用官方未修改的 Camoufox 浏览器与原生身份默认策略；不通过 JS 伪造 Canvas/WebGL，不预先引入自定义字体分叉。\n- 官方浏览器/字体资产不随插件 npm 包发布；运行时下载，明确大小、可取消、可重试；有可靠哈希才标记已校验。\n- 不静默下载 1.3 GB；不把专有字体单独打进插件。\n- 本地服务只监听 127.0.0.1，令牌只给自身页面；日志不出现敏感凭据。\n\n【后续迭代点：原生登录流程接管（暂缓）】aibo 决定当前不实施“劫持 Magpie 原生登录流程”，以后作为功能迭代点。候选方向不是自行拼供应商 URL，而是在原供应商 authorize() 返回后、默认 ShellExecute 前按单次流程接管：保留原 URL/state/callback，由 clean-login 用隔离浏览器打开，Magpie 原生完成账号去重、accountKey 分配和凭据保存。重启评估前必须验证存在可局部拦截的接口、不会打开系统默认浏览器、原 callback 可闭环，以及最终 accountKey 能与正确 profile/pin 对齐；若只能全局补丁或修改二进制，则继续保留当前自行运行流程并 auth.set 回填的路线。\n\n\n===== project_clean-login-main-field-conflict =====\n\n**冲突（已定位，2026-11-03）**：magpie 里「插件被识别为 page」要求包**没有** `main`/`exports`（`github.go` 的 `Kind=\"page\"` 判定），而 page 插件的 Service 只在**有** `main`/`exports` 时才挂载（`page.go:196`，`Window()` 的 `only` 又在 `pluginpage.go:164` 再挡一次）。服务要 `main`，`kind=page` 要没 `main`。`p.service` 全仓库只有一处赋值，panels/actions 不支持 service，`exports` 同样触发排除 —— **包层面无绕法**。\n\n**选择**：保留 `main: ./index.mjs`（功能优先，标签显示不是 page 可接受）。曾删 `main`（73d68aa），后果是 magpie 主动关掉服务，UI 报「127.0.0.1 拒绝连接」。`f642fce` 把 `main` 加回即恢复。\n\n**安装副本会被 bun.lock 钉死**：`~/.config/magpie/plugins/bun.lock` 记录 `github:Gruu6y/clean-login#<commit>`，magpie 内「更新」若只重跑安装而不重新解析引用，会原地不动。判断看 `node_modules/@gruu6y/page-clean-login/.bun-tag` 是否变成 `Gruu6y-clean-login-<新commit>`。**可靠路径 = 卸载后重装**（重新解析 main HEAD）。账号数据 `~/.config/magpie/magpie-clean-login/`（accounts、proxies.json）在插件安装目录之外，卸载重装不丢。\n\n**上游**：`yetone/magpie#4823`（作者 manjughosa，同一问题）。已用 Gruu6y 身份补真实案例 + 最小改法（只需改 `readTagged()` 判定顺序，`page.go` 安全门槛不用动）。**aibo 2026-11-03 决定：不提 PR**，issue 里说清改法即可。\n\n**验收口径**：`.bun-tag` = `Gruu6y-clean-login-f642fce`、`package.json main = ./index.mjs`、服务端口可连。\n\n**发布必须 bump 版本号（2026-11-03 踩坑纠正）**：magpie 判定「有没有新版本」看的是 package.json 的 `version` 字符串。`f4fea29`/`73d68aa`/`f642fce` 三个 commit 都停在 `0.1.0`，结果 `plugin-updates.json`（21:49 那次检查，晚于 `f642fce` 的 21:05）`waiting: null`、无 clean-login 条目 —— magpie 认定没有更新，用户在 UI 上\"看不出更新\"，点更新/安装也拿不到修复。修法：bump 到 `0.1.1`（commit `e7a250b`）并让测试从 package.json 读版本，不再硬钉字符串。**以后每次要用户吃到的改动都必须带上版本号。**\n\n\n===== project_clean-login-t3-installer-closure =====\n\n**状态：T3 代码完成并已真机验收（2026-11-03，初号机）。** 仓库 `Gruu6y/clean-login-browser` 已由 aibo 手动转为 **public**；但 **draft release 尚未发布**，所以资产仍匿名 404 —— 这是 T3 之后唯一的阻塞项。\n\n**改动位置**：`magpie-plugins-dev/packages/clean-login`（该目录在 git 里仍是未跟踪，未提交）。\n\n**T3 改了什么（lib/browser-environment.mjs）**\n- 常量换成 slim：`DOWNLOAD_BYTES=176_170_139`、`EXTRACTED_BYTES=432_909_728`（旧 1_320_075_455 / 2_587_913_229 已删）；门限 = 两值 + 256 MiB = 877,515,323。\n- 新增 `DEFAULT_ASSET_URL`（自托管 slim 资产）+ `DEFAULT_ASSET_SHA256` + `MAGPIE_CLEAN_LOGIN_BROWSER_SHA256`；`resolveBrowserAsset(env)` 决定 url/sha256/source。\n- **修掉一个真 bug**：旧代码 `fetcher.install(target, hooks)` 是错的 —— `install()` 只吃一个布尔量，于是 target 被当成 replace、hooks 全丢、URL 覆盖永不生效（即：无进度、不能取消）。现在改为 `new CamoufoxFetcher(repoConfig, selectedVersion)` + `install(false)`。\n- 取消/进度：子类化 `CamoufoxFetcher` 覆盖 `static downloadFile(file,url)`（源码明说这是扩展点），fetch + 流写回，遵守 AbortSignal 与 onProgress；用子类静态属性 `downloadHook` 交接。\n- 诚实性：只有真的走完校验才 `checksumVerified: true`；覆盖 URL 没给 sha 一律 false；`readRecord`/`writeRecord` 不再硬编码 false；404→`asset_not_found`、429/403→`rate_limited`。\n\n**真机验收（不是静态测试，四跑全对）**：用本地 HTTP 源冒充资产喂进真实安装路径。\n| case | 结果 |\n|---|---|\n| 正确 sha | ready，`checksumVerified:true`，**8.5 s**，进度到 100%，解包 432,910,039 B，exe 存在 |\n| 错误 sha | 0.9 s 报 `checksum_mismatch`，**不留残留安装**（installedBytes 0、无 exe） |\n| 覆盖 URL 无 sha | ready 但 `checksumVerified:false` / `unavailable`（如实） |\n| 默认 URL 打真实 GitHub | 1.4 s 报 `asset_not_found`（因为 release 还是 draft）→ 发布后同一条路径即可真下 |\n\n工具：`clean-login-trial/verify-install.mjs`、`verify-ui.mjs`；证据 `verify-install-*.json`。\n\n**顺带修掉第 6 步的两个遗留（原本 53 pass / 2 fail）**：`ui/index.html` 的 `environment-prepare/cancel/retry` **三颗是死按钮**（app.js 里零监听、也没有状态渲染函数），两个红灯测试正是抓它——不是测试过时。已接活：状态渲染 + prepare/cancel/retry + preparing 轮询，卡片显示规则写进注释；校验文案四处语言全部从「publishes no checksum」改成如实分支。测试断言按原意窄化（provider 网格不得有操作按钮；index.html 每颗 button 必须被列出且真的接线）。**现在 65 pass / 0 fail，`bun scripts/check.mjs` 里 `✓ clean-login`。**\n\n**环境事实（供复用）**\n- 本机原本没有 bun；已装到 `cindy-default/workspace/tools/bun-windows-x64/bun.exe`（**Bun 1.4.4**，与当年 spike 同版本），未动系统 PATH。\n- `packages/clean-login/node_modules` 是从试跑目录做的 **junction**（.gitignore 已忽略 nodes_modules），仅用于本地跑起来；正式开发应换成真正的 `bun install`。\n- 安装目录形如 `<插件目录>/camoufox/camoufox/Cache/browsers/gruu6y/<version>-<build>/<sha8>` —— 双层 camoufox\\camoufox\\Cache 来自 LOCALAPPDATA 重定向叠加 userCacheDir，能用但名字难看。\n\n**2026-11-03 更新：阻塞已清除，T4 的测量半程实际已完成。**\n\naibo 手动做了两件事（插件做不到，见下）：① 仓库 `Gruu6y/clean-login-browser` 转 public；② 发布 draft release `browser-v158.0.1-beta.41-slim.1`（现 `draft:false`、`published_at` 有值）。\n\n**公网端到端实测（走插件自己的安装器，不是模拟）**：\n- 四个资产匿名下载全 **HTTP 200**，字节数 176,170,139 / 111 / 3,781 / 7,520 与本地完全对上。\n- `verify-install.mjs default --launch`：**22 s** 完成下载（168.0 MiB）→ sha256 校验通过 → 解包，`state=ready`、`checksumVerified:true`、`installedBytes=432,910,039`（412.8 MiB）；随后**启动刚装出来的 exe 冷启 4.5 s**，UA `Windows NT 10.0; Win64; x64 … Firefox/158`、`platform Win32`、`webdriver false`。\n- → T4 里\"新装用户首次登录实测下载量/安装量\"那半已达成；剩下的是真实账号登录，依赖第 7 步供应商登录闭环。\n\n**能力边界（已实测确认，别再试探）**：cindy-github 插件**无法**发布 draft release，也**无法**改仓库可见性——`releases` 类目只有 list/get/create/latest/list_assets，`repo` 类目只有 create_repository；`meta.graphql` 逃生口也救不了：GitHub GraphQL **根本没有 release 变更**（`UpdateReleaseInput` 不存在），`UpdateRepositoryInput` 也**没有 visibility 字段**。这两件事只能人工点，或换有权限的 REST 凭证。README 可以用 `create_or_update_file_contents` 改（已验证，推完逐字节核对一致）。\n\n**残留**：release **正文**仍写着旧的「Status: DRAFT… assets pending upload…repo must be made public」，是过期文本；因为上面那条边界，只能人工 Edit 改掉，不影响功能。README 已改成准确版本（commit `ac1af8e9…`，blob `19d696fa…`，1600 字节）。\n\n**一处环境怪癖（别被误导）**：显示层会把某些字符串呈现成另一个样子（例如字体文件名会显示成 `TwemojiMozilla.ttf`，而磁盘上、以及 base64 里的真实字节是别的）。**判断文件内容不要靠肉眼读显示输出**，要用 xxd / cmp / 在 bash 内直接比对（已验证浏览器 sha256 常量与 zip 实测值逐字符一致）。\n"
  }
}
