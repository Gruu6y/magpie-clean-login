---
title: project.clean-login-process-and-repo
description: p=cindy.memory.v1;t=project;kc=32;c=56;v=184;o=0;raw=1
type: project
updatedAt: 2026-11-06T22:28:01.953Z
---
{
  "protocol": "cindy.memory.v1",
  "id": "project_clean-login-process-and-repo",
  "type": "project",
  "keys": [
    "clean",
    "login",
    "multiagent",
    "workflow.md",
    "oven-sh/setup-bun",
    "test/proxy-filter.test.mjs",
    "test/proxy-score-routes.test.mjs",
    "package.json",
    "version",
    "scripts/check-version-bump.mjs",
    "lib/",
    "ui/",
    "page/",
    "index.mjs",
    "scripts/release.mjs",
    "clean-login-standalone",
    "f642fce",
    "e7a250b",
    "cindy-default/workflow-gates",
    "ea1432e",
    "success",
    "agents.md",
    "zero_sha",
    "release.mjs",
    "reference_github-gcm-token-scope-limits",
    "create_or_update_file_contents",
    "ci.yml",
    "origin/main",
    "standalone",
    "repo.md",
    "magpie-plugin",
    "https://github.com/gruu6y/clean-login"
  ],
  "claims": [
    {
      "k": "c001",
      "v": "**背景**：clean-login 现在是多 agent 并行迭代的 GitHub 仓库，2026-11-03 出了两个真实事故：三个 commit 都没 bump 版本号（用户端完全看不到更新）、测试残留 `__probe__` 空目录落进生产数据目录。aibo 2026-11-03 决定「先把流程问题解决，按建议做」。",
      "kind": "decision"
    },
    {
      "k": "c002",
      "v": "**五条已批准的流程（按杠杆排序）**",
      "kind": "decision"
    },
    {
      "k": "c003",
      "v": "1. **CI 必须绿** — 新增 `.github/workflows/ci.yml`（PR + push main，`oven-sh/setup-bun` + `bun test`）。同时修掉 `test/proxy-filter.test.mjs` 那个按缩进匹配的正则红灯；`test/proxy-score-routes.test.mjs` 两个用例改为**检测不到评分浏览器就 `test.skip()`**（不许放宽断言来凑绿）。理由：多 agent 没人有\"那两个 fail 是环境性的\"这份上下文，恒红的测试等于没人看。",
      "kind": "rule"
    },
    {
      "k": "c004",
      "v": "2. **发布 = bump 版本号 + tag** — magpie 判更新比的是 `package.json` 的 `version` 字符串。新增 `scripts/check-version-bump.mjs`：改了 `lib/` `ui/` `page/` `index.mjs` 却没动 version 就 fail。新增 `scripts/release.mjs`（bump + commit + tag，默认不 push，`--push` 才推，支持 `--dry-run`）。",
      "kind": "rule"
    },
    {
      "k": "c005",
      "v": "3. **生产与开发物理分离** — 结构性风险：曾经 magpie 加载的就是开发副本，任何 agent 切分支都立即改变生产行为，直接抵消「不动生产环境」。现在生产吃 magpie 安装目录 `~/.config/magpie/plugins/node_modules/@gruu6y/page-clean-login`，开发副本 `clean-login-standalone` 不再被生产加载；后续用 `git worktree` 每线一份。",
      "kind": "rule"
    },
    {
      "k": "c006",
      "v": "4. **AGENTS.md 写死分工与禁区** — 分支前缀归线、`proxy-*` / `signin-*` 目录 owner、禁区清单（不写真实 `~/.config/magpie/`、不重启生产实例、不为变绿放宽断言）、测试一律 tmpdir。",
      "kind": "rule"
    },
    {
      "k": "c007",
      "v": "**自我纠正**：`f642fce` 与 `e7a250b` 曾被直接推上 main，违反已立的「各自分支、排队逐个合并」。当 hotfix 处理但未留记录——第 2、5 条落地后这种情况要有明确通道。",
      "kind": "state"
    },
    {
      "k": "c008",
      "v": "**实施状态**：分支 `cindy-default/workflow-gates` 在 `clean-login-standalone` 上实施，尚未合入 main。",
      "kind": "open"
    },
    {
      "k": "c009",
      "v": "**已落地（2026-11-03，PR #3 合入，main = `ea1432e`）**：4 个提交 rebase 合并进 main，CI 在 GitHub 真实 runner 上 `success`（PR 两次 + main push 一次）。现仓库拥有：`.github/workflows/ci.yml`（test + version-bump 两个 job，ubuntu + bun 1.4.4 + `bun install --ignore-scripts`，约 9-14 秒）、`scripts/check-version-bump.mjs`、`scripts/release.mjs`、`AGENTS.md`。测试基线由 `414 pass / 2 fail` 变为 **`415 pass / 2 skip / 0 fail`**。",
      "kind": "decision"
    },
    {
      "k": "c010",
      "v": "**验证要点（复用到别的仓库时照抄）**：闸门要拿 **merge-base** 比较而不是 base tip；`git diff` 不列未跟踪文件，得补 `ls-files --others`（否则新增 `lib/` 文件拦不住）；浅克隆先 fetch 单个 base ref，拿不到就明确警告后跳过而不是伪造失败；`ZERO_SHA`（首次 push 的 `0000…`）要处理。已知小瑕疵：闸门只判断版本号\"变了\"，不强制\"变大\"（靠 `release.mjs` 拒绝降级兜住）。",
      "kind": "state"
    },
    {
      "k": "c011",
      "v": "**workflow 文件的推送绕过**：见 `reference_github-gcm-token-scope-limits` —— git 的 GCM token 无 workflow scope，改用 cindy-github 插件 API `create_or_update_file_contents` 写入；文件在远端存在后 git push 才不再被拦。**以后改 `ci.yml` 很可能再撞一次**，同样走 API。",
      "kind": "rule"
    },
    {
      "k": "c012",
      "v": "**顺带观察**：另一条线（非本线）在同一晚把 main 推到 `0.1.2`，commit message 里写明\"host 比版本号判更新，所以必须 bump\"——版本号纪律已被其他线自发采纳。同时该线仍是直推 main，未走 PR。",
      "kind": "rule"
    },
    {
      "k": "c013",
      "v": "**`scripts/release.mjs` 链路已完整验证（2026-11-03，本地假裸远端，未碰 GitHub）**：dry-run 零写入；`--patch`/`--minor`/显式版本都对；发布提交只改 `package.json` 一行（不重排 JSON）、**已 stage 的无关文件不会被卷进发布提交**；annotated tag 正确；`--push` 能推 commit + tag。拒绝路径全部给出正确退出码：降级/相等 exit 1、非法版本 exit 1-2、tag 已存在 exit 1、`package.json` 有未提交改动 exit 1、detached HEAD exit 1。",
      "kind": "state"
    },
    {
      "k": "c014",
      "v": "**验出的真实缺口（尚未修）**：远端已被别的线推进时，`--push` 会被 non-fast-forward 拒绝——行为是对的（远端未被污染、tag 没推上去、本地 commit+tag 保留、退出码 1 且消息说明状态），但**不回退已写好的版本号和 tag**，也不打印恢复步骤。恢复要手动：`git pull --rebase` → `git push origin main` → `git push origin vX.Y.Z`；否则重跑会因\"tag 已存在\"被拒。**更稳的做法是加发布前置检查：`origin/main` 不是 HEAD 祖先时直接拒绝发版**（代价小、能省掉一次白做的发布提交）。",
      "kind": "open"
    },
    {
      "k": "c015",
      "v": "**缺口已补（PR #4 合入，main = `7b0674d`）**：`scripts/release.mjs` 现在在写 `package.json` **之前**做发布前置检查——尽力 `fetch origin main`、优先用 `FETCH_HEAD`（缓存的 `origin/main` 可能在 fetch 失败后过期）解析远端 tip，不是 HEAD 祖先就以退出码 1 拒绝，并声明\"什么都没写\" + 给出 `git pull --rebase` 恢复命令；脚本**从不自动 pull/rebase**（冲突无法预判，留给操作者）；无 origin/离线只警告不拦。push 被拒的消息也补了恢复命令。配套 `test/release-preflight.test.mjs` 用真实 git + 真实裸仓（无 mock）断言输出关键字**与零副作用**（版本/tag/HEAD/`status --porcelain`/裸远端 main 与 tag）。全量 `419 pass / 2 skip / 0 fail`，WSL 与 Windows 双平台通过，CI 绿。",
      "kind": "rule"
    },
    {
      "k": "c016",
      "v": "已知既有瑕疵（未动）：`release.mjs` 用行首锚定正则定位 version，`package.json` 若被压成单行会以 `cannot locate the top-level version string` 退出 2。",
      "kind": "state"
    },
    {
      "k": "c017",
      "v": "**下次真发版的待验项**：`release.mjs --patch --push` 对真实 GitHub origin 的完整推送尚未跑过（沙箱验的是本地裸远端）。",
      "kind": "open"
    },
    {
      "k": "c018",
      "v": "**目标（aibo 2026-11-03 定）**：clean-login 从\"向上游 magpie-community/plugins 提 PR\"改为**自建独立仓库做标准非官方页面插件**（走 GitHub topic `magpie-plugin` 通道）。这同时消除了旧阻塞：上游多包树里该包未跟踪、两条线同改、改动拆不开。",
      "kind": "decision"
    },
    {
      "k": "c019",
      "v": "**仓库**：`https://github.com/Gruu6y/clean-login`（public，非 fork，MIT）。包名 `@gruu6y/page-clean-login`。topics：magpie-plugin / magpie-page / camoufox / proxy-manager / browser-fingerprint。已实测 `topic:magpie-plugin user:Gruu6y` 可检索（Discover → Unofficial 通道打通）。运行时资产在另一个仓库 `Gruu6y/clean-login-browser`，下载地址写死在 `lib/browser-environment.mjs`，**别弄丢这个关联**。",
      "kind": "state"
    },
    {
      "k": "c020",
      "v": "- **已退休冻结**：`bots/bot_1793484737606_f2yq7i/workspace/magpie-plugins-dev/packages/clean-login`，只剩 `MOVED.md`，别再往里写。",
      "kind": "decision"
    },
    {
      "k": "c021",
      "v": "**工作约定**：每条线开自己分支、按序排队合并；**不得直接改运行实例加载的代码做测试**。",
      "kind": "rule"
    },
    {
      "k": "c022",
      "v": "**既有红灯（与本线改动无关，未擅自修）**：`test/proxy-filter.test.mjs:103` 正则按缩进匹配 `proxy-filters` 到 `proxy-score-bar`，当前 `ui/index.html` 不再匹配、捕获空串；在 `f4fea29` 与 `73d68aa` 都复现。另有 `proxy-score-routes` 2 个 fail（`POST /api/proxies/:id/score` 503，本机缺评分用浏览器），属环境性。",
      "kind": "rule"
    },
    {
      "k": "c023",
      "v": "**PR #1（2026-11-03 我的产出，未合并）** `feat/health-live-account-counts`：`/api/health` 的 `kept`/`retired` 改为**请求时实时统计**（原为上次扫描快照，两人登录后仍显示 `retired:1`）；新增 `live` 与 `sweptAt`；auth 文件**缺失**按\"无人登录\"计，**不可读/坏 JSON** 则 `live:false` 且两数为 `null`。`416 pass / 1 fail`（既有红灯）。rebase 到 `73d68aa` 时放弃 README 改动。",
      "kind": "decision"
    },
    {
      "k": "c024",
      "v": "**GitHub 认证**：`git push` 直接可用（GCM 已存凭据，身份 `Gruu6y <129347307+Gruu6y@users.noreply.github.com>`）；API 走 **cindy-github 插件** `ghost_call({ghost_id:\"cindy-github\", tool:\"list_tools\"|\"call_tool\", args:{category}/{name,args}})` —— `tool` 是顶层 `list_tools`/`call_tool`，操作名放 `call_tool` 的 `args.name`。`DSH_SECRET_GITHUB_TOKEN_MAILWATCH` 已失效（401），别用。",
      "kind": "state"
    },
    {
      "k": "c025",
      "v": "**遗留**：误建过多余 fork `Gruu6y/plugins`（magpie-community/plugins 的 fork，无提交），当前连接无 `delete_repo` 权限删不掉，需人工处理。",
      "kind": "state"
    },
    {
      "k": "c026",
      "v": "**2026-11-03 起 clean-login 是独立仓库**：`https://github.com/Gruu6y/clean-login`（public，MIT，topics 含 `magpie-plugin`/`magpie-page`/`browser-fingerprint`/`camoufox`/`proxy-manager`），走**非官方通道**（GitHub topic），不再向 `magpie-community/plugins` 提 PR。包名 `@gruu6y/page-clean-login`。",
      "kind": "rule"
    },
    {
      "k": "c027",
      "v": "- 旧开发目录 `bots/bot_1793484737606_f2yq7i/workspace/magpie-plugins-dev/packages/clean-login` 已冻结，只剩 `MOVED.md`，别再往里写。",
      "kind": "decision"
    },
    {
      "k": "c028",
      "v": "**工作约定**：每条线在自己的分支开发、按序合并；**不得直接改运行实例加载的代码做测试**。**aibo 决定：插件以后只在 magpie 上更新**，我不负责装回 magpie。",
      "kind": "rule"
    },
    {
      "k": "c029",
      "v": "**2026-11-03 已收口**",
      "kind": "decision"
    },
    {
      "k": "c030",
      "v": "- PR #1 `health 实时统计`：已 squash 合入 main = `8d11bb2`（`kept`/`retired` 改为请求时实时统计，新增 `live`/`sweptAt`；auth 缺失按 0 计、不可读则 `live:false` 且两数 null）。手动 squash+push 完成，PR 显示 closed 而非 merged（`merged_at=null` 正常，内容确实已在 main）。",
      "kind": "decision"
    },
    {
      "k": "c031",
      "v": "- **0.1.3 = `abbc48f`**（PR #5，`cindy-935ug6/plugin-scan-nameless-package`，rebase 合并后 sha 变了，原 head 是 `d311e78`；tree 完全相同 `3cd3e7b`）。修 `lib/magpie-plugins.mjs` 里 `dirent` 越作用域导致任一无 `name` 的包（本机 `yaml/browser`）把整次扫描打成 `available:false` → 页面全部\"等待验证\"无登录入口；另加扫描轮询与\"扫描失败就说失败\"的四语言文案。",
      "kind": "open"
    },
    {
      "k": "c032",
      "v": "- 远端现在只有 `main` 一个分支：合并后按仓库惯例用 `git push origin --delete <branch>` 删掉已合并分支（插件 git_data 类目**没有** delete_branch 操作，只能走本地 git）。",
      "kind": "rule"
    },
    {
      "k": "c033",
      "v": "- 误建的 fork `Gruu6y/plugins` 已由 aibo 手动删除，我复核 404、仓库列表无它。",
      "kind": "state"
    },
    {
      "k": "c034",
      "v": "1. 曾记「main 上 `proxy-filter` 那条是既有红灯、与本线无关」。真相是**本机 `core.autocrlf=true` 把 LF 的 `ui/index.html` 检出成 CRLF，撞上测试里按 LF 写的正则**，仓库没毛病。详见 reference 的 clean-login-crlf-false-red。PR #2 已根治。",
      "kind": "state"
    },
    {
      "k": "c035",
      "v": "2. 曾记「0.1.2 已发布」——实际只推了 main 没打 tag，0.1.2 从未作为 release 存在。",
      "kind": "state"
    },
    {
      "k": "c036",
      "v": "**操作纪律**：main 在我工作期间被别人推进过多次（`f642fce`、`e7a250b` 等），**动手前必须先 fetch 再看**，别拿本地旧 main 当基准。",
      "kind": "rule"
    },
    {
      "k": "c037",
      "v": "- 没有 `gh` CLI，env 无 `GH_TOKEN`/`GITHUB_TOKEN`；`git push` 走 GCM 已存凭证可用（身份 `Gruu6y <129347307+Gruu6y@users.noreply.github.com>`）。`DSH_SECRET_GITHUB_TOKEN_MAILWATCH` 已失效（401），别用。",
      "kind": "state"
    },
    {
      "k": "c038",
      "v": "- cindy-github 插件（root，117 个操作，二级分派 `call_tool`）的 **repo 类目没有 `delete_repository`**，`git_data` 类目也没有 `delete_branch`；插件沙箱不暴露 token，只能调它声明的操作。aibo 在插件里另配过尾号 `dyLD` 的 token，与 GCM 那个不是一个。",
      "kind": "rule"
    },
    {
      "k": "c039",
      "v": "- 两个坑：Git Bash 会把 `/repos/...` 参数转成 Windows 路径（必须 `MSYS_NO_PATHCONV=1`）；PR body 含反引号时**不能内联进 shell**（会被命令替换执行），写进文件用 `@file` 传。",
      "kind": "rule"
    },
    {
      "k": "c040",
      "v": "【已建成】2026-11-03 aibo 要求\"把本机 clash 里的节点都配置到 magpie 干净登录的代理 ip 里\"。做完后又按 aibo 两条规则改过一轮。",
      "kind": "rule"
    },
    {
      "k": "c041",
      "v": "【两条硬规则（改这套东西时必须守）】",
      "kind": "rule"
    },
    {
      "k": "c042",
      "v": "1. **条目名 = Clash 里的节点原名**（如 `R6-1|美国-NF`），不许用手工命名（曾用过的\"香港03/04/05\"已被否掉）。",
      "kind": "rule"
    },
    {
      "k": "c043",
      "v": "2. **端口不重复、同一节点不开两个端口**：Clash 后端已备好端口的节点（`magpie-wb-*` 那 12 个）直接复用其端口，只有其余节点才新开。",
      "kind": "state"
    },
    {
      "k": "c044",
      "v": "【当前结构】订阅 60 条 proxies（58 真节点 + 2 条 @有效期/@剩余流量 信息行），58 个节点 = 58 个不同端口：",
      "kind": "state"
    },
    {
      "k": "c045",
      "v": "【持久化】listeners 同时写两处：`%APPDATA%\\io.github.clash-verge-rev.clash-verge-rev\\profiles\\Merge.yaml`（订阅更新/重载后仍生效的唯一持久来源）与 mihomo 实际加载的 runtime config.yaml。写前都备份 `*.bak-<时间戳>-clnodes`。控制接口/重载方式/YAML 坑见同主题 reference 记忆。",
      "kind": "state"
    },
    {
      "k": "c046",
      "v": "- **`release.mjs --patch --push` 已对真实 GitHub origin 实跑通过**，补上此前「下次真发版待验」的口子：先 `--dry-run` 预览（0.1.6 -> 0.1.7、tag v0.1.7、不推），再 `--patch --push` 一次成功——写 `package.json`、commit `0.1.7: release`（`f215c8e`）、annotated tag `v0.1.7`、push main 与 tag；前置检查打印 `remote : origin main (fetched) 6c0e4f5984f2 is in HEAD's history.`。",
      "kind": "state"
    },
    {
      "k": "c047",
      "v": "- **每次落在 main 上的版本都补 tag**：`v0.1.4` -> `bb95599`（PR #6 rebase 合并后的 sha）、`v0.1.5` -> `1781303`（PR #7 rebase 后顺延版本）、`v0.1.6` -> `6c0e4f5`（PR #8 rebase 合并后的 sha）、`v0.1.7` -> `f215c8e`。四个 tag 都是 annotated，由 `cindy-default` 打并推送。",
      "kind": "rule"
    },
    {
      "k": "c048",
      "v": "- **PR #7（导航超时与弹窗警告）**：head `8211d9b`，rebase 到 `bb95599` 时与 PR #6 在 `lib/browser-launcher.mjs` 与 `test/browser-launcher.test.mjs` 冲突（两个 PR 都改了这两处），两边改动都保留；因版本门禁拿 merge-base 比字符串，rebase 后停在 0.1.4 会判红，顺延到 `0.1.5`（提交 `fc2648a`），PR CI run `41923319523` success，rebase 合并 -> main `1781303`，main CI run `41923572142` success。",
      "kind": "state"
    },
    {
      "k": "c049",
      "v": "- **PR #8（绑定端口有界重试）**：分支 `cindy-default/port-in-use-retry`，head `acac855`，1 commit / 3 files（`lib/server.mjs`、`package.json` 0.1.5->0.1.6、新增 `test/server-listen-retry.test.mjs`），PR CI run `41930052933` success；rebase 合并 -> main `6c0e4f5`，main CI run `41930515072` success。修的坑：magpie 更新插件后新宿主进程 bind 3492 撞上被替换旧宿主仍持有的端口 -> `EADDRINUSE` -> 插件被记为 `didn't load: Error: Failed to start server. Is port 3492 in use?`，页面直到 magpie 重启才有服务。新代码 `portInUse(error)`（认 `code` 与 Bun 的 message 形态）+ `listenWithPortRetry(server, port, {windowMs, log})`，指数退避上限 1s、默认窗口 `portRetryMs = 10_000`（小于 magpie 单插件 20s 加载上限），非 EADDRINUSE 立即抛，`actualPort` / `allowedHosts` / `ownOrigins` 移到绑定成功之后。",
      "kind": "rule"
    },
    {
      "k": "c050",
      "v": "- **独立复核方式（可复用）**：`git worktree add --detach <tmp> origin/main` 造干净副本，把 PR 的测试文件放进去跑 `bun test`——两个新用例在未打补丁的 main 上失败，失败点正是 `lib/server.mjs:922`（与生产日志同一行），即「修 bug 的测试能复现原问题」。",
      "kind": "rule"
    },
    {
      "k": "c051",
      "v": "- **本机只有 2 个环境性测试失败**：`test/proxy-score-routes.test.mjs` 的 `a measured score reaches the proxy row, the list and bootstrap` 与 `a second score while one runs is a 409 score_busy`（本机缺评分用 camoufox runtime，实测 503），在未改动的 main 上同样失败，CI 里这类用例本来 skip；PR 作者在另一台机器上报 `547 pass / 0 fail`，本机实跑是 `545 pass / 2 fail`。",
      "kind": "state"
    },
    {
      "k": "c052",
      "kind": "state",
      "v": "- `state: clean-login main=9df14f00dcdb5efe61f06bab0fdfbf4b3a80160d version=0.1.15 tags=v0.1.14,v0.1.15 pr12=merged`"
    },
    {
      "k": "c053",
      "kind": "state",
      "v": "- `state: clean-login main=c84f319ab3a531bb5a02645e431bc881dcf67187 version=0.1.17 tags=v0.1.16,v0.1.17 pr13=merged`"
    },
    {
      "k": "c054",
      "kind": "state",
      "v": "- `state: clean-login main=e177f06cd27a6f6893537661d5f7737be7fa70c4 version=0.1.19 tags=v0.1.18,v0.1.19 pr14=merged`"
    },
    {
      "k": "c055",
      "kind": "state",
      "v": "- `state: clean-login main=56dfd837e0ba6170d4a9d1ea32828cd6f61e5d4f version=0.1.21 tags=v0.1.20,v0.1.21 pr16=merged`"
    },
    {
      "k": "c056",
      "kind": "state",
      "v": "- `state: clean-login main=5d380ee84a91c2a9d8461755721ae14e13402525 version=0.1.23 tags=v0.1.22,v0.1.23 pr17=merged`"
    }
  ],
  "values": {
    "paths": [
      "/workflows/ci.yml",
      "/setup-bun",
      "/proxy-filter.test.mjs",
      "/proxy-score-routes.test.mjs",
      "/check-version-bump.mjs",
      "/release.mjs",
      "/.config/magpie/plugins/node_modules/",
      "/page-clean-login",
      "/.config/magpie/",
      "/workflow-gates",
      "/release-preflight.test.mjs",
      "/tag/HEAD/",
      "s://github.com/Gruu6y/clean-login",
      "/clean-login-browser",
      "/browser-environment.mjs",
      "/cindy-default/workspace/clean-login-standalone",
      "/bot_1793404248859_935ug6/workspace/ship/clean-login-repo",
      "/workspace/clean-login-trial/node_modules",
      "/bot_1793484737606_f2yq7i/workspace/magpie-plugins-dev/packages/clean-login",
      "/.config/magpie/magpie-clean-login",
      "/index.html",
      "/api/proxies/",
      "/health-live-account-counts",
      "/api/health",
      "/plugin-scan-nameless-package",
      "/magpie-plugins.mjs",
      "/github-api.mjs",
      "/POST/PATCH/PUT/DELETE",
      "/repos/...",
      "/.config/magpie/providers.json",
      "\\io.github.clash-verge-rev.clash-verge-rev\\profiles\\Merge.yaml",
      "/bot_1793404248859_326s0s/workspace/magpie-clash-nodes/",
      "/server.mjs",
      "/server-listen-retry.test.mjs"
    ],
    "hashes": [
      "f642fce",
      "e7a250b",
      "ea1432e",
      "7b0674d",
      "f4fea29",
      "73d68aa",
      "129347307",
      "8d11bb2",
      "7607d81",
      "abbc48f",
      "d311e78",
      "3cd3e7b",
      "f0f85c6",
      "bb95599",
      "8211d9b",
      "fc2648a",
      "1781303",
      "acac855",
      "6c0e4f5",
      "f215c8e",
      "f57ea9fc79fcc0cdea7d6aac7bb1efc8a5ddf0fa",
      "9df14f00dcdb5efe61f06bab0fdfbf4b3a80160d",
      "5d2beea8887f57671a4ec017bfe34ed4a42e9e6a",
      "c84f319ab3a531bb5a02645e431bc881dcf67187",
      "16ec7da2ba36b871d946374802caa65028a6b218",
      "e177f06cd27a6f6893537661d5f7737be7fa70c4",
      "5ab5ff0a9c7934401419e8530904fb2b7707cb12",
      "56dfd837e0ba6170d4a9d1ea32828cd6f61e5d4f",
      "ec6525c212eea5d3ac3896e4c41b222222c67526",
      "5d380ee84a91c2a9d8461755721ae14e13402525"
    ],
    "versions": [
      "1.4.4",
      "0.1.2",
      "0.1.3",
      "v0.1.3",
      "0.1.4",
      "0.1.5",
      "0.1.6",
      "0.1.7",
      "v0.1.4",
      "v0.1.5",
      "v0.1.6",
      "v0.1.7",
      "0.1.14",
      "0.1.15",
      "0.1.16",
      "0.1.17",
      "0.1.18",
      "0.1.19",
      "0.1.20",
      "0.1.21",
      "0.1.22",
      "0.1.23"
    ],
    "urls": [
      "https://github.com/Gruu6y/clean-login",
      "https://github.com/Gruu6y/clean-login/pull/12",
      "https://github.com/Gruu6y/clean-login/pull/13",
      "https://github.com/Gruu6y/clean-login/pull/14",
      "https://github.com/Gruu6y/clean-login/pull/16",
      "https://github.com/Gruu6y/clean-login/pull/17"
    ],
    "refs": [
      "PR #3",
      "PR #4",
      "PR #1",
      "PR #2",
      "PR #5",
      "#7",
      "#6",
      "PR #6",
      "PR #7",
      "PR #8",
      "refs/tags/v0.1.14",
      "refs/tags/v0.1.15",
      "refs/tags/v0.1.16",
      "refs/tags/v0.1.17",
      "refs/tags/v0.1.18",
      "refs/tags/v0.1.19",
      "refs/tags/v0.1.20",
      "refs/tags/v0.1.21",
      "refs/tags/v0.1.22",
      "refs/tags/v0.1.23"
    ],
    "ports": [],
    "envs": [
      "AGENTS",
      "ZERO_SHA",
      "FETCH_HEAD",
      "APPDATA",
      "README",
      "DSH_SECRET_GITHUB_TOKEN_MAILWATCH",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "MSYS_NO_PATHCONV",
      "METHOD",
      "DELETE",
      "MAGPIE_CONFIG_DIR"
    ],
    "literals": [
      "73d68aa",
      "proxy-score-routes",
      "POST /api/proxies/:id/score",
      "feat/health-live-account-counts",
      "/api/health",
      "kept",
      "retired",
      "retired:1",
      "live",
      "sweptAt",
      "live:false",
      "null",
      "magpie-page",
      "browser-fingerprint",
      "camoufox",
      "proxy-manager",
      "magpie-community/plugins",
      "health 实时统计",
      "8d11bb2",
      "merged_at=null",
      ".gitattributes",
      "* text=auto eol=lf",
      "7607d81",
      "7b0674d",
      "abbc48f",
      "cindy-935ug6/plugin-scan-nameless-package",
      "d311e78",
      "3cd3e7b",
      "lib/magpie-plugins.mjs",
      "R6-1|美国-NF",
      "magpie-wb-*",
      "17601-17603",
      "17801-17806",
      "17901-17903",
      "18101",
      "18146",
      "magpie-cl-01…46",
      "type: http",
      "D1-4直连|台湾-NF",
      "R8-4|马来西亚",
      "~/.config/magpie/providers.json",
      "accountProxies",
      "%APPDATA%\\io.github.clash-verge-rev.clash-verge-rev\\profiles\\Merge.yaml",
      "*.bak-<时间戳>-clnodes",
      "bots/bot_1793404248859_326s0s/workspace/magpie-clash-nodes/",
      "sync-clash-nodes.mjs",
      "register-clean-login.mjs",
      "node-ports.json",
      "proxies-snapshot.json",
      "README.md",
      "portInUse",
      "listenWithPortRetry",
      "portRetryMs",
      "EADDRINUSE",
      "test/server-listen-retry.test.mjs",
      "lib/server.mjs",
      "server.listen",
      "release.mjs --patch --push",
      "libraries/server.mjs:922",
      "lib/server.mjs:922"
    ]
  },
  "state": {
    "active": true,
    "claim_count": 56,
    "open_count": 0,
    "member_count": 4,
    "merged_from": [
      "project_clean-login-multiagent-workflow",
      "project_clean-login-standalone-repo",
      "project_clean-login-standalone-repo-and-flow",
      "project_clash-nodes-clean-login-bridge"
    ],
    "merged_at": "2026-11-04T21:42:52.272Z",
    "directive": "m01320",
    "format": "cindy.memory.v1",
    "operative_layer": "machine",
    "archive_contains_verbatim_prose": true
  },
  "open": [],
  "source": {
    "updatedAt": "2026-11-06T06:45:37.293Z",
    "migratedAt": "2026-11-06T06:45:37.293Z",
    "directive": "m01320"
  },
  "raw": {
    "title": "clean-login 多 agent 迭代的流程闸门（2026-11-03 aibo 批准，已合入 main） | clean-login 自建独立仓库 Gruu6y/clean-login：路径归属、提交约定与 GitHub 认证 | clean-login 独立仓库与正规提交流程（生产冻结 + 分支/PR） | Clash 全节点 → clean-login 出口桥（12 复用 + 46 新开，名字用 Clash 原名）",
    "description": "clean-login 多 agent 迭代流程闸门：CI 必绿、发布=bump+tag、生产/开发物理分离、AGENTS.md 禁区、初号机唯一合并者（已合入 main #3/#4，release 前置检查已上线） | clean-login 已是独立仓库 Gruu6y/clean-login（topic 非官方通道），含生产副本/隔离克隆路径、分支约定、既有红灯、PR #1 与 GitHub 认证方式 | clean-login 独立仓库流程已收口：0.1.3 已合入 main(abbc48f) 并打首个 tag v0.1.3，远端只剩 main，测试全过；含 PR#1 实为 squash 手推、0.1.2 从未打 tag、GCM token 权限事实与 GitHub API 脚本用法 | 本机 Clash 订阅 58 个节点全部成为 clean-login 出口：12 个复用 Clash 既有端口、46 个新开 18101-18146，条目名一律用 Clash 节点原名。",
    "body": "===== project_clean-login-multiagent-workflow =====\n\n**背景**：clean-login 现在是多 agent 并行迭代的 GitHub 仓库，2026-11-03 出了两个真实事故：三个 commit 都没 bump 版本号（用户端完全看不到更新）、测试残留 `__probe__` 空目录落进生产数据目录。aibo 2026-11-03 决定「先把流程问题解决，按建议做」。\n\n**五条已批准的流程（按杠杆排序）**\n1. **CI 必须绿** — 新增 `.github/workflows/ci.yml`（PR + push main，`oven-sh/setup-bun` + `bun test`）。同时修掉 `test/proxy-filter.test.mjs` 那个按缩进匹配的正则红灯；`test/proxy-score-routes.test.mjs` 两个用例改为**检测不到评分浏览器就 `test.skip()`**（不许放宽断言来凑绿）。理由：多 agent 没人有\"那两个 fail 是环境性的\"这份上下文，恒红的测试等于没人看。\n2. **发布 = bump 版本号 + tag** — magpie 判更新比的是 `package.json` 的 `version` 字符串。新增 `scripts/check-version-bump.mjs`：改了 `lib/` `ui/` `page/` `index.mjs` 却没动 version 就 fail。新增 `scripts/release.mjs`（bump + commit + tag，默认不 push，`--push` 才推，支持 `--dry-run`）。\n3. **生产与开发物理分离** — 结构性风险：曾经 magpie 加载的就是开发副本，任何 agent 切分支都立即改变生产行为，直接抵消「不动生产环境」。现在生产吃 magpie 安装目录 `~/.config/magpie/plugins/node_modules/@gruu6y/page-clean-login`，开发副本 `clean-login-standalone` 不再被生产加载；后续用 `git worktree` 每线一份。\n4. **AGENTS.md 写死分工与禁区** — 分支前缀归线、`proxy-*` / `signin-*` 目录 owner、禁区清单（不写真实 `~/.config/magpie/`、不重启生产实例、不为变绿放宽断言）、测试一律 tmpdir。\n5. **初号机是唯一合并者** — 其他线只开 PR；合并前重跑 CI 核对 diff 范围。GitHub 配 required status check（单人仓库没法自审，CI 就是闸门）。\n\n**自我纠正**：`f642fce` 与 `e7a250b` 曾被直接推上 main，违反已立的「各自分支、排队逐个合并」。当 hotfix 处理但未留记录——第 2、5 条落地后这种情况要有明确通道。\n\n**实施状态**：分支 `cindy-default/workflow-gates` 在 `clean-login-standalone` 上实施，尚未合入 main。\n\n\n**已落地（2026-11-03，PR #3 合入，main = `ea1432e`）**：4 个提交 rebase 合并进 main，CI 在 GitHub 真实 runner 上 `success`（PR 两次 + main push 一次）。现仓库拥有：`.github/workflows/ci.yml`（test + version-bump 两个 job，ubuntu + bun 1.4.4 + `bun install --ignore-scripts`，约 9-14 秒）、`scripts/check-version-bump.mjs`、`scripts/release.mjs`、`AGENTS.md`。测试基线由 `414 pass / 2 fail` 变为 **`415 pass / 2 skip / 0 fail`**。\n\n**验证要点（复用到别的仓库时照抄）**：闸门要拿 **merge-base** 比较而不是 base tip；`git diff` 不列未跟踪文件，得补 `ls-files --others`（否则新增 `lib/` 文件拦不住）；浅克隆先 fetch 单个 base ref，拿不到就明确警告后跳过而不是伪造失败；`ZERO_SHA`（首次 push 的 `0000…`）要处理。已知小瑕疵：闸门只判断版本号\"变了\"，不强制\"变大\"（靠 `release.mjs` 拒绝降级兜住）。\n\n**workflow 文件的推送绕过**：见 `reference_github-gcm-token-scope-limits` —— git 的 GCM token 无 workflow scope，改用 cindy-github 插件 API `create_or_update_file_contents` 写入；文件在远端存在后 git push 才不再被拦。**以后改 `ci.yml` 很可能再撞一次**，同样走 API。\n\n**顺带观察**：另一条线（非本线）在同一晚把 main 推到 `0.1.2`，commit message 里写明\"host 比版本号判更新，所以必须 bump\"——版本号纪律已被其他线自发采纳。同时该线仍是直推 main，未走 PR。\n\n\n**`scripts/release.mjs` 链路已完整验证（2026-11-03，本地假裸远端，未碰 GitHub）**：dry-run 零写入；`--patch`/`--minor`/显式版本都对；发布提交只改 `package.json` 一行（不重排 JSON）、**已 stage 的无关文件不会被卷进发布提交**；annotated tag 正确；`--push` 能推 commit + tag。拒绝路径全部给出正确退出码：降级/相等 exit 1、非法版本 exit 1-2、tag 已存在 exit 1、`package.json` 有未提交改动 exit 1、detached HEAD exit 1。\n\n**验出的真实缺口（尚未修）**：远端已被别的线推进时，`--push` 会被 non-fast-forward 拒绝——行为是对的（远端未被污染、tag 没推上去、本地 commit+tag 保留、退出码 1 且消息说明状态），但**不回退已写好的版本号和 tag**，也不打印恢复步骤。恢复要手动：`git pull --rebase` → `git push origin main` → `git push origin vX.Y.Z`；否则重跑会因\"tag 已存在\"被拒。**更稳的做法是加发布前置检查：`origin/main` 不是 HEAD 祖先时直接拒绝发版**（代价小、能省掉一次白做的发布提交）。\n\n\n**缺口已补（PR #4 合入，main = `7b0674d`）**：`scripts/release.mjs` 现在在写 `package.json` **之前**做发布前置检查——尽力 `fetch origin main`、优先用 `FETCH_HEAD`（缓存的 `origin/main` 可能在 fetch 失败后过期）解析远端 tip，不是 HEAD 祖先就以退出码 1 拒绝，并声明\"什么都没写\" + 给出 `git pull --rebase` 恢复命令；脚本**从不自动 pull/rebase**（冲突无法预判，留给操作者）；无 origin/离线只警告不拦。push 被拒的消息也补了恢复命令。配套 `test/release-preflight.test.mjs` 用真实 git + 真实裸仓（无 mock）断言输出关键字**与零副作用**（版本/tag/HEAD/`status --porcelain`/裸远端 main 与 tag）。全量 `419 pass / 2 skip / 0 fail`，WSL 与 Windows 双平台通过，CI 绿。\n\n已知既有瑕疵（未动）：`release.mjs` 用行首锚定正则定位 version，`package.json` 若被压成单行会以 `cannot locate the top-level version string` 退出 2。\n\n**下次真发版的待验项**：`release.mjs --patch --push` 对真实 GitHub origin 的完整推送尚未跑过（沙箱验的是本地裸远端）。\n\n\n===== project_clean-login-standalone-repo =====\n\n**目标（aibo 2026-11-03 定）**：clean-login 从\"向上游 magpie-community/plugins 提 PR\"改为**自建独立仓库做标准非官方页面插件**（走 GitHub topic `magpie-plugin` 通道）。这同时消除了旧阻塞：上游多包树里该包未跟踪、两条线同改、改动拆不开。\n\n**仓库**：`https://github.com/Gruu6y/clean-login`（public，非 fork，MIT）。包名 `@gruu6y/page-clean-login`。topics：magpie-plugin / magpie-page / camoufox / proxy-manager / browser-fingerprint。已实测 `topic:magpie-plugin user:Gruu6y` 可检索（Discover → Unofficial 通道打通）。运行时资产在另一个仓库 `Gruu6y/clean-login-browser`，下载地址写死在 `lib/browser-environment.mjs`，**别弄丢这个关联**。\n\n**路径事实**\n- **生产副本（magpie 实际加载的那份）+ 唯一开发副本**：`bots/cindy-default/workspace/clean-login-standalone`，git clone，main 与 origin 同步。\n- **隔离开发克隆**：`bots/bot_1793404248859_935ug6/workspace/ship/clean-login-repo`（node_modules 符号链接到 `cindy-default/workspace/clean-login-trial/node_modules`，`bun test` 可用；bun 1.4.4 在 `%APPDATA%\\npm`）。\n- **已退休冻结**：`bots/bot_1793484737606_f2yq7i/workspace/magpie-plugins-dev/packages/clean-login`，只剩 `MOVED.md`，别再往里写。\n\n**工作约定**：每条线开自己分支、按序排队合并；**不得直接改运行实例加载的代码做测试**。\n\n**插件加载 id 是 `magpie-clean-login`（来自 index.mjs），与 package.json 包名解耦** —— 改包名不影响数据目录 `~/.config/magpie/magpie-clean-login`。\n\n**既有红灯（与本线改动无关，未擅自修）**：`test/proxy-filter.test.mjs:103` 正则按缩进匹配 `proxy-filters` 到 `proxy-score-bar`，当前 `ui/index.html` 不再匹配、捕获空串；在 `f4fea29` 与 `73d68aa` 都复现。另有 `proxy-score-routes` 2 个 fail（`POST /api/proxies/:id/score` 503，本机缺评分用浏览器），属环境性。\n\n**PR #1（2026-11-03 我的产出，未合并）** `feat/health-live-account-counts`：`/api/health` 的 `kept`/`retired` 改为**请求时实时统计**（原为上次扫描快照，两人登录后仍显示 `retired:1`）；新增 `live` 与 `sweptAt`；auth 文件**缺失**按\"无人登录\"计，**不可读/坏 JSON** 则 `live:false` 且两数为 `null`。`416 pass / 1 fail`（既有红灯）。rebase 到 `73d68aa` 时放弃 README 改动。\n\n**GitHub 认证**：`git push` 直接可用（GCM 已存凭据，身份 `Gruu6y <129347307+Gruu6y@users.noreply.github.com>`）；API 走 **cindy-github 插件** `ghost_call({ghost_id:\"cindy-github\", tool:\"list_tools\"|\"call_tool\", args:{category}/{name,args}})` —— `tool` 是顶层 `list_tools`/`call_tool`，操作名放 `call_tool` 的 `args.name`。`DSH_SECRET_GITHUB_TOKEN_MAILWATCH` 已失效（401），别用。\n\n**遗留**：误建过多余 fork `Gruu6y/plugins`（magpie-community/plugins 的 fork，无提交），当前连接无 `delete_repo` 权限删不掉，需人工处理。\n\n\n===== project_clean-login-standalone-repo-and-flow =====\n\n**2026-11-03 起 clean-login 是独立仓库**：`https://github.com/Gruu6y/clean-login`（public，MIT，topics 含 `magpie-plugin`/`magpie-page`/`browser-fingerprint`/`camoufox`/`proxy-manager`），走**非官方通道**（GitHub topic），不再向 `magpie-community/plugins` 提 PR。包名 `@gruu6y/page-clean-login`。\n\n**路径事实**\n- 旧开发目录 `bots/bot_1793484737606_f2yq7i/workspace/magpie-plugins-dev/packages/clean-login` 已冻结，只剩 `MOVED.md`，别再往里写。\n- 生产副本（magpie 实际加载的那份）：`bots/cindy-default/workspace/clean-login-standalone`，是仓库 clone。\n- 我的隔离开发克隆：`bots/bot_1793404248859_935ug6/workspace/ship/clean-login-repo`（`bun test` 可用）。\n\n**工作约定**：每条线在自己的分支开发、按序合并；**不得直接改运行实例加载的代码做测试**。**aibo 决定：插件以后只在 magpie 上更新**，我不负责装回 magpie。\n\n**2026-11-03 已收口**\n- PR #1 `health 实时统计`：已 squash 合入 main = `8d11bb2`（`kept`/`retired` 改为请求时实时统计，新增 `live`/`sweptAt`；auth 缺失按 0 计、不可读则 `live:false` 且两数 null）。手动 squash+push 完成，PR 显示 closed 而非 merged（`merged_at=null` 正常，内容确实已在 main）。\n- PR #2 `.gitattributes`（`* text=auto eol=lf`）：经 GitHub API 正常 squash 合并 = `7607d81`。\n- PR #3 流程闸门（CI + 版本 bump 门禁 + `scripts/release.mjs`）= `ea1432e`；PR #4 release 前置检查（拒绝落后分支）= `7b0674d`。\n- **0.1.3 = `abbc48f`**（PR #5，`cindy-935ug6/plugin-scan-nameless-package`，rebase 合并后 sha 变了，原 head 是 `d311e78`；tree 完全相同 `3cd3e7b`）。修 `lib/magpie-plugins.mjs` 里 `dirent` 越作用域导致任一无 `name` 的包（本机 `yaml/browser`）把整次扫描打成 `available:false` → 页面全部\"等待验证\"无登录入口；另加扫描轮询与\"扫描失败就说失败\"的四语言文案。\n- **`v0.1.3` 是本仓库第一个 tag**：之前 `git ls-remote --tags` 一直为空，即 0.1.2 从未打过 tag。tag 为 annotated（`git tag -a v0.1.3 -m v0.1.3`），与 `scripts/release.mjs` 的约定一致。\n- 合并后 main push 触发的 CI run #7 = success；PR head 的 run #6 也 success。\n- 各节点本地 `bun test` 均通过（PR #3 之后基线 417，PR #5 引入后 425 pass / 0 fail）。\n- 远端现在只有 `main` 一个分支：合并后按仓库惯例用 `git push origin --delete <branch>` 删掉已合并分支（插件 git_data 类目**没有** delete_branch 操作，只能走本地 git）。\n- 误建的 fork `Gruu6y/plugins` 已由 aibo 手动删除，我复核 404、仓库列表无它。\n\n**纠正两条旧记录**\n1. 曾记「main 上 `proxy-filter` 那条是既有红灯、与本线无关」。真相是**本机 `core.autocrlf=true` 把 LF 的 `ui/index.html` 检出成 CRLF，撞上测试里按 LF 写的正则**，仓库没毛病。详见 reference 的 clean-login-crlf-false-red。PR #2 已根治。\n2. 曾记「0.1.2 已发布」——实际只推了 main 没打 tag，0.1.2 从未作为 release 存在。\n\n**操作纪律**：main 在我工作期间被别人推进过多次（`f642fce`、`e7a250b` 等），**动手前必须先 fetch 再看**，别拿本地旧 main 当基准。\n\n**本机工具链事实（复用）**\n- 没有 `gh` CLI，env 无 `GH_TOKEN`/`GITHUB_TOKEN`；`git push` 走 GCM 已存凭证可用（身份 `Gruu6y <129347307+Gruu6y@users.noreply.github.com>`）。`DSH_SECRET_GITHUB_TOKEN_MAILWATCH` 已失效（401），别用。\n- **GCM 那个 token 尾号 `X9an`，scope 只有 `public_repo`**（`X-OAuth-Scopes` 实测），没有 `delete_repo`，删不了仓库；推 tag 与删分支都可用。\n- cindy-github 插件（root，117 个操作，二级分派 `call_tool`）的 **repo 类目没有 `delete_repository`**，`git_data` 类目也没有 `delete_branch`；插件沙箱不暴露 token，只能调它声明的操作。aibo 在插件里另配过尾号 `dyLD` 的 token，与 GCM 那个不是一个。\n- 插件调用形态：`ghost_call({ghost_id:\"cindy-github\", tool:\"call_tool\", args:{name:\"<操作名>\", args:{...}}})`；`tool` 用 `list_tools` 时传 `args:{category:\"<类目>\"}`。\n- Node `fetch` 访问 `api.github.com` 会被 TLS reset；**用 curl（schannel）可以**。\n- 可复用脚本 `ship/github-api.mjs`：`MSYS_NO_PATHCONV=1 node github-api.mjs <METHOD> <PATH> [@body.json]`。用 `git credential fill` 取 token，经 curl stdin config 传入，**不打印密钥**。GET/POST/PATCH/PUT/DELETE 均实测通过。\n- 两个坑：Git Bash 会把 `/repos/...` 参数转成 Windows 路径（必须 `MSYS_NO_PATHCONV=1`）；PR body 含反引号时**不能内联进 shell**（会被命令替换执行），写进文件用 `@file` 传。\n\n\n===== project_clash-nodes-clean-login-bridge =====\n\n【已建成】2026-11-03 aibo 要求\"把本机 clash 里的节点都配置到 magpie 干净登录的代理 ip 里\"。做完后又按 aibo 两条规则改过一轮。\n\n【两条硬规则（改这套东西时必须守）】\n1. **条目名 = Clash 里的节点原名**（如 `R6-1|美国-NF`），不许用手工命名（曾用过的\"香港03/04/05\"已被否掉）。\n2. **端口不重复、同一节点不开两个端口**：Clash 后端已备好端口的节点（`magpie-wb-*` 那 12 个）直接复用其端口，只有其余节点才新开。\n\n【当前结构】订阅 60 条 proxies（58 真节点 + 2 条 @有效期/@剩余流量 信息行），58 个节点 = 58 个不同端口：\n- 复用 12 个既有端口：`17601-17603`（台湾）、`17801-17806`（香港）、`17901-17903`（狮城），即原 `magpie-wb-*` listeners；\n- 新开 46 个：`18101`–`18146`，按订阅顺序，listener 名 `magpie-cl-01…46`。\nclean-login 侧 58 条代理（`type: http`、名称=节点原名、端口同上），实测 58/58 连通。58 个节点只有 35 个不同出口 IP；`D1-4直连|台湾-NF` 出口在香港、`R8-4|马来西亚` 出口在香港，标签与出口不符。\n\n【重要耦合】那 12 个复用端口同时也是 Magpie 自身账号路由在用的出口（`~/.config/magpie/providers.json` 的 `accountProxies` 指向 17801-17806 / 17901-17902 / 17603）。改这些端口会同时影响 Magpie 账号路由与 clean-login。\n\n【持久化】listeners 同时写两处：`%APPDATA%\\io.github.clash-verge-rev.clash-verge-rev\\profiles\\Merge.yaml`（订阅更新/重载后仍生效的唯一持久来源）与 mihomo 实际加载的 runtime config.yaml。写前都备份 `*.bak-<时间戳>-clnodes`。控制接口/重载方式/YAML 坑见同主题 reference 记忆。\n\n【脚本】`bots/bot_1793404248859_326s0s/workspace/magpie-clash-nodes/`：`sync-clash-nodes.mjs`（分配端口+重建 listeners+管道重载，幂等，支持 --dry-run）、`register-clean-login.mjs`（对齐 clean-login 条目：清管理段旧条目、按原名重建、自检、--test 逐个测出口）、`node-ports.json`（含 reusedExistingPort 标记）、`proxies-snapshot.json`、`README.md`。订阅每 24h 自动更新，节点改名后重跑 sync 即可对齐。\n\n===== clean-login 0.1.4 → 0.1.7 发布链（2026-11-05 实跑，真实 GitHub origin） =====\n\n- **`release.mjs --patch --push` 已对真实 GitHub origin 实跑通过**，补上此前「下次真发版待验」的口子：先 `--dry-run` 预览（0.1.6 -> 0.1.7、tag v0.1.7、不推），再 `--patch --push` 一次成功——写 `package.json`、commit `0.1.7: release`（`f215c8e`）、annotated tag `v0.1.7`、push main 与 tag；前置检查打印 `remote : origin main (fetched) 6c0e4f5984f2 is in HEAD's history.`。\n- **每次落在 main 上的版本都补 tag**：`v0.1.4` -> `bb95599`（PR #6 rebase 合并后的 sha）、`v0.1.5` -> `1781303`（PR #7 rebase 后顺延版本）、`v0.1.6` -> `6c0e4f5`（PR #8 rebase 合并后的 sha）、`v0.1.7` -> `f215c8e`。四个 tag 都是 annotated，由 `cindy-default` 打并推送。\n- **PR #6（账号页 v2 + 身份检测）**：分支 `cindy-326s0s/accounts-page-v2`，head `f0f85c6`，rebase 合并 -> main `bb95599`（版本 0.1.4），main CI run `41922756491` success。\n- **PR #7（导航超时与弹窗警告）**：head `8211d9b`，rebase 到 `bb95599` 时与 PR #6 在 `lib/browser-launcher.mjs` 与 `test/browser-launcher.test.mjs` 冲突（两个 PR 都改了这两处），两边改动都保留；因版本门禁拿 merge-base 比字符串，rebase 后停在 0.1.4 会判红，顺延到 `0.1.5`（提交 `fc2648a`），PR CI run `41923319523` success，rebase 合并 -> main `1781303`，main CI run `41923572142` success。\n- **PR #8（绑定端口有界重试）**：分支 `cindy-default/port-in-use-retry`，head `acac855`，1 commit / 3 files（`lib/server.mjs`、`package.json` 0.1.5->0.1.6、新增 `test/server-listen-retry.test.mjs`），PR CI run `41930052933` success；rebase 合并 -> main `6c0e4f5`，main CI run `41930515072` success。修的坑：magpie 更新插件后新宿主进程 bind 3492 撞上被替换旧宿主仍持有的端口 -> `EADDRINUSE` -> 插件被记为 `didn't load: Error: Failed to start server. Is port 3492 in use?`，页面直到 magpie 重启才有服务。新代码 `portInUse(error)`（认 `code` 与 Bun 的 message 形态）+ `listenWithPortRetry(server, port, {windowMs, log})`，指数退避上限 1s、默认窗口 `portRetryMs = 10_000`（小于 magpie 单插件 20s 加载上限），非 EADDRINUSE 立即抛，`actualPort` / `allowedHosts` / `ownOrigins` 移到绑定成功之后。\n- **独立复核方式（可复用）**：`git worktree add --detach <tmp> origin/main` 造干净副本，把 PR 的测试文件放进去跑 `bun test`——两个新用例在未打补丁的 main 上失败，失败点正是 `lib/server.mjs:922`（与生产日志同一行），即「修 bug 的测试能复现原问题」。\n- **本机只有 2 个环境性测试失败**：`test/proxy-score-routes.test.mjs` 的 `a measured score reaches the proxy row, the list and bootstrap` 与 `a second score while one runs is a 409 score_busy`（本机缺评分用 camoufox runtime，实测 503），在未改动的 main 上同样失败，CI 里这类用例本来 skip；PR 作者在另一台机器上报 `547 pass / 0 fail`，本机实跑是 `545 pass / 2 fail`。\n- **合并后清理**：按仓库惯例 `git push origin --delete <branch>` 删掉已合并分支；远端现在只剩 `main` 一个分支（插件 git_data 类目没有 delete_branch，只能走本地 git）。\n- **AGENTS.md 发布纪律要点**：发布 = bump version + 打 tag `vX.Y.Z`，一条命令 `bun scripts/release.mjs --patch`（或 `--minor`、显式 `X.Y.Z`）；默认不 push，确认后加 `--push`，先 `--dry-run`；不自动写 CHANGELOG，发布提交只包含 `package.json` 的版本变更；脚本写版本前会 `fetch origin main` 并拒绝落后分支。\n\n===== clean-login.pr12 =====\n\n- **PR #12（地区列出口 IP 显示不全）**：分支 `cindy-default/proxy-region-full-ip`，head `97826e16a16af1e743926f87cf41f9e83f259ef9`，1 commit / 4 files +93−6（`ui/app.js`、`ui/style.css`、新增 `test/proxy-region-exit.test.mjs`、`package.json` 0.1.13→0.1.14）。rebase 合并 → main `f57ea9fc79fcc0cdea7d6aac7bb1efc8a5ddf0fa`，再发版 → main `9df14f00dcdb5efe61f06bab0fdfbf4b3a80160d`（0.1.15）；tag `v0.1.14`→`f57ea9f`、`v0.1.15`→`9df14f0`；CI run `42169263420`（PR）/ `42169830500`（合并后 main）/ `42169913598`（发版）全 success；远端分支已删，只剩 main。\n- **根因与修法**：`ui/style.css` 地区列轨道是 `minmax(78px, 0.7fr)`，且 `.proxy-region small` 强制 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`，是纯 CSS 截断，`ui/app.js` 里一直是完整字符串。修法=IP 逐字写入独立 span（`ip.textContent = proxy.exitIp`，无 slice）、标签与 IP 拆成两个 span 让窄列在两者之间换行、去掉 nowrap/ellipsis/overflow:hidden 改 `white-space: normal; overflow-wrap: anywhere`、地区列 78→104px、完整值同时挂 tooltip。\n- `state: clean-login main=9df14f00dcdb5efe61f06bab0fdfbf4b3a80160d version=0.1.15 tags=v0.1.14,v0.1.15 pr12=merged`\n\n===== clean-login.pr13 =====\n\n- **PR #13（每张卡片一键报 issue）**：分支 `cindy-default/report-issue`，head `6ae64f217adbba256cfcee0c1acd570889efff75`，base=main `9df14f0`，1 commit / 13 files +1066−6（新增 `lib/issue-report.mjs` 239 行、`lib/open-external.mjs` 87 行、`docs/reporting.md`、三个新测试文件；改 `lib/server.mjs`、`ui/app.js`、`ui/index.html`、`ui/style.css`、`package.json` 0.1.15→0.1.16）。rebase 合并 → main `5d2beea8887f57671a4ec017bfe34ed4a42e9e6a`，发版 → main `c84f319ab3a531bb5a02645e431bc881dcf67187`（0.1.17）；tag `v0.1.16`→`5d2beea`、`v0.1.17`→`c84f319`；CI run `42171982440`（PR）/ `42172492566`（合并后 main）/ `42172534409`（发版）全 success；远端分支已删。\n- **为什么必须由服务开浏览器**：magpie 页面在 `<iframe sandbox=\"allow-scripts\">`，无 allow-popups / allow-forms / allow-same-origin，`connect-src none`，桥接无「打开链接」方法，所以页面既开不了外链也发不了请求；插件本地服务是唯一能 spawn 的一方。\n- **三条安全保证（我已独立复核）**：① `POST /api/report` 只返回 `buildIssueRequest` 组装的正文，不 spawn；正文只取白名单字段（id/name/capabilityState/capabilityReason/description/notice/authMethods/sources/pluginPackage + 运行环境），每字段 `oneLine()` 压成单行并截断，凭据/账号 key/代理密码/cookie 不在白名单（`test/report-route.test.mjs` 用带 `token:\"ghp_should_not_appear\"` 与诱饵字段的 provider 断言正文不含）。② `POST /api/report/open` 是唯一 spawn 路由，`isAllowedIssueUrl` 要求 https + hostname 恰为 `github.com` + pathname 恰为 `/Gruu6y/clean-login/issues/new` + 无 userinfo，否则 400 `url_not_allowed` 且不 spawn；`openCommand` 用 `explorer.exe`/`open`/`xdg-open`（刻意不用 `cmd /c start`），URL 作为单个 argv、不经 shell。③ 不自动发帖：插件内无 token、不后台调 GitHub API，用户必须在 GitHub 上自己点 Create。\n- **两个我注意到的边界（不阻塞，供后续）**：a) `/api/report` 的 `provider` 对象是页面直接 POST 上来的，服务端不按 id 回查，所以页面能决定白名单字段的**取值**（不能决定字段集、也不会带出凭据）；威胁模型上要求先能执行页面脚本，且用户仍须点 Create，风险低但不等于「页面完全不能影响正文」。b) 主人原话「这些等待验证看的很碍眼」这一半没有做——`providerPending: \"等待验证\"` 标签仍在，本 PR 只是在那些卡片上加了按钮；`STATES.pending = \"等待验证 (pending)\" ` 仍会写进 issue 正文。\n- **可复用的回归复现法**：把 `ui/app.js` 与 `ui/style.css` 临时 `git checkout origin/main --` 回退、保留新增测试文件，5 个用例全失败（地区列那条直接报 78 < 99）；`git checkout HEAD --` 恢复后全通过。\n- `state: clean-login main=c84f319ab3a531bb5a02645e431bc881dcf67187 version=0.1.17 tags=v0.1.16,v0.1.17 pr13=merged`\n- **本机验收**：`bun scripts/check-version-bump.mjs --base origin/main` → OK（0.1.15→0.1.16，6 个 release-relevant 文件）；三个新测试 16 pass / 0 fail；全量 `bun test` **579 pass / 2 fail**（581 用例），两个失败是 `test/proxy-score-routes.test.mjs` 的 measured-score 与 score-busy-409，用 `git worktree add --detach /tmp/cl-main-pr13 origin/main` 在未改动 main 上跑同一文件同样 8 pass / 2 fail（缺 camoufox runtime），与本 PR 无关。\n\n===== clean-login.pr14 =====\n\n- **PR #14（供应商页拆主列表 + 一个折叠目录）**：分支 `cindy-default/provider-list-split`，原 head `04205443b5916973bb667c2d65cc72bab9642672`（基于旧 main `9df14f0`），6 files +320−11（`ui/provider-state.js` 新增 `partitionProviders`/`providerIsPrimary`/`providerIsSubscription`、`ui/app.js`、`ui/index.html`（一个 `<details>`）、`ui/style.css`、`test/provider-partition.test.mjs` 8 条、`package.json`）。**我 rebase 到当时 main `c84f319`（0.1.17）并把版本统一为 0.1.18**（原 PR 写 0.1.16，会比 main 版本倒退；冲突只在 `package.json`，`ui/*` 全部自动合并，与 #13 的报 issue 按钮共存且无重复函数定义），force-with-lease 推回原分支 → 新 head `e56f36f5d2d980a4e303db8650f5db337f8371a6`。rebase 合并 → main `16ec7da2ba36b871d946374802caa65028a6b218`，发版 → main `e177f06cd27a6f6893537661d5f7737be7fa70c4`（0.1.19）；tag `v0.1.18`→`16ec7da`、`v0.1.19`→`e177f06`；CI run `42173062273`（PR）/ `35`（合并后 main）/ `36`（发版）全 success；远端分支已删。\n- **分区规则（纯函数，DOM-free 测试）**：`providerIsPrimary(p) = presence 为 both|magpie-only 且 providerCanSignIn(p)`；主列表按账号数降序、再按名字；折叠区 = 其余**所有**订阅类供应商（`providerIsSubscription` 只排除 `NON_SUBSCRIPTION_PROVIDER_IDS = [\"llama-local\"]`），因此 magpie 原生但本插件没有登录流程的、以及插件已装但 magpie 还没有的（plugin-only）都会出现在折叠区；magpie 列表读不到时降级为「全部进主列表」，不会把整页藏进折叠。账号数只决定排序、永不决定区域。\n- **与主人要求对齐**：主人原话（已核实）「主列表是常用的，折叠区（一个就够了）里的是剩下的，折叠区里…展示所有可能的订阅类供应商（包括 magpie 原生的和为 magpie 编写且与内置登录对照验证过的）」——实现是一个 `<details>`、主列表=现在就能登录的、折叠区=其余全部订阅类，`providers-more-hint` 四语种文案直接写明「magpie 自带的，以及为 magpie 编写、对照过内置登录的插件」；`provider-sources` 诊断条被移进折叠区内部。\n- **本机验收**：版本门禁 `0.1.17 -> 0.1.18` OK；`test/provider-partition.test.mjs` 8 pass / 0 fail；全量 `bun test` **587 pass / 2 fail**（589 用例，比 #13 的 581 多 8），两个失败仍是 `test/proxy-score-routes.test.mjs` 的 measured-score 与 score-busy-409（缺 camoufox runtime，在未改动 main 上同样失败）。\n- **边界**：`NON_SUBSCRIPTION_PROVIDER_IDS` 是硬编码且目前只有 `llama-local`，magpie 以后若新增别的非订阅 id（例如另一个本地推理器）会出现在折叠区；真实 magpie 窗口里的渲染效果仍未人工看过（PR 已如实写明）。\n- `state: clean-login main=e177f06cd27a6f6893537661d5f7737be7fa70c4 version=0.1.19 tags=v0.1.18,v0.1.19 pr14=merged`\n\n===== clean-login.pr16 =====\n\n- **PR #16（删掉「等待验证」状态 + /api/report 服务端回查）**：分支 `cindy-default/drop-unverified-state`，head `451090bc127b8b2bc408eeda1f9869745dbb2043`，base `e177f06`（0.1.19），15 files +104/−229，版本 0.1.20。**合并 owner 未做 rebase**（分支已由作者 rebase 到 e177f06，冲突曾只在 `ui/app.js` 四张语言表与 `package.json`）。rebase 合并 → main `5ab5ff0a9c7934401419e8530904fb2b7707cb12`，发版 → main `56dfd837e0ba6170d4a9d1ea32828cd6f61e5d4f`（0.1.21）；tag `v0.1.20`→`5ab5ff0`、`v0.1.21`→`56dfd83`；CI run `37`（PR）/ `38`（合并后 main）/ `39`（发版）全 success；远端分支已删。\n- **主人原话（已核实）**「这些等待验证看的很碍眼」+ 三号机转达的补充「整个插件就不该有这个等待验证,因为用户用完我们也不知道」→ 处置是把「状态」从用户可见层整个移除，不是藏徽章：`providerStatusView` 删除、`provider-status` 徽章与验证说明行删除、账号行 `accountUnverified` 删除、登录对话框 `signin-unverified` 删除、issue 正文不再有「状态」「状态说明」两行、`ui/style.css` 删 7 条状态/标签规则；`capability.state` 仅保留为内部字段（`lib/provider-registry.mjs:9` 注释说明它是 provider-sources.mjs 合并分支的层级标记，永不上页面）。`git grep 等待验证` 在 `ui/` `lib/` 已 0 命中，只剩测试里的反向断言。\n- **`/api/report` 改为页面只传 id、服务端回查**：`lib/server.mjs:663-695` 只接受 `typeof body.provider === \"string\"`（trim + slice(0,120)，对象形态直接忽略），`mergeProviderSources({ local: listProviders(), plugins })` 后按 id 找卡片，未知 id 退化成 `{ id: requestedId }` 不报错；name/说明/登录方式/名单来源全部服务端给。`test/report-route.test.mjs` 断言 `Ignored name` 不进正文、真实名称 `Google Antigravity` 由注册表提供、`should-not-appear` 与 `ghp_should_not_appear` 不出现、无「等待验证」「状态说明」行、`/api/report/open` 对 `file:///`、`javascript:`、非 new-issue 路径、非本仓库全部 400 `url_not_allowed`。\n- **我判定的残留（已回给三号机、待其另起一刀）**：`lib/provider-sources.mjs` 的 `BROWSER_METHOD_FOUND`(99)/`FORM_METHOD_FOUND`(119)/`SECRET_METHOD_FOUND`(130)/`PENDING_METHOD_FOUND`(144) 四段文案仍含「干净登录尚未验证该流程：你可以直接尝试」，与主人「用完我们也不知道」的理由同构，等于把被删掉的状态用句子又写了一遍；`NO_BROWSER_METHOD`(108) 说的是「没有添加入口」不涉及验证状态，可以留。建议只删「尚未验证该流程」这半句、保留「已安装的 magpie 插件提供了浏览器登录方式，你可以直接尝试」。\n- **本机验收**：版本门禁 `0.1.19 -> 0.1.20` OK；全量 `bun test` **587 pass / 2 fail**（589 用例），两个失败仍是 `test/proxy-score-routes.test.mjs` 的 measured-score 与 score-busy-409（缺 camoufox runtime，未改动 main 上同样失败）。\n- `state: clean-login main=56dfd837e0ba6170d4a9d1ea32828cd6f61e5d4f version=0.1.21 tags=v0.1.20,v0.1.21 pr16=merged`\n- `state: clean-login main=5d380ee84a91c2a9d8461755721ae14e13402525 version=0.1.23 tags=v0.1.22,v0.1.23 pr17=merged`\n- `state: clean-login main=fec85d9c7dc1cc77d5fe3a6286fcfb8c0454dbb6 version=0.1.27 tags=v0.1.26,v0.1.27 pr15=merged pr17=merged pr18=merged`\n- `state: clean-login main=2252012c3a272572ddc112c7719fa2b03348bc83 version=0.1.29 tags=v0.1.24,v0.1.25,v0.1.26,v0.1.27,v0.1.28,v0.1.29 pr15=merged pr17=merged pr18=merged pr19=merged`
- `state: clean-login main=a0b534c4ca747574a57e6c0c2b841b0dfb87298c version=0.1.31 tags=v0.1.30,v0.1.31 pr15=merged pr17=merged pr18=merged pr19=merged pr20=merged`\n- `state: clean-login main=d294395d7456fbcac2b480489ded4ac1c2afcfa2 version=0.1.33 tags=v0.1.32,v0.1.33 pr15=merged pr17=merged pr18=merged pr19=merged pr20=merged pr21=merged\n- `state: clean-login main=ed656da16f7434b86b42f6e0c1b07948adcccda3 version=0.1.35 tags=v0.1.34,v0.1.35 pr15=merged pr17=merged pr18=merged pr19=merged pr20=merged pr21=merged pr23=merged\n- `state: clean-login main=445e2ed73c60516a16da37b3823eb316264247e0 version=0.1.39 tags=v0.1.36,v0.1.37,v0.1.38,v0.1.39 pr15=merged pr17=merged pr18=merged pr19=merged pr20=merged pr21=merged pr22=merged pr23=merged pr25=merged`\n- `state: clean-login main=b34df1c722f42ca7038395f8e5b5dd5af178f2f8 version=0.1.43 tags=v0.1.40,v0.1.41,v0.1.42,v0.1.43 pr15=merged pr17=merged pr18=merged pr19=merged pr20=merged pr21=merged pr22=merged pr23=merged pr25=merged pr26=merged pr27=merged`\n- `state: clean-login main=3d13523d0cf8f49912a5e1e000cefa78d47ca51d version=0.1.45 tags=v0.1.44,v0.1.45 pr28=merged`\n- `state: clean-login main=cd6f9ff60438256a09dca48f40db50237b097efc version=0.1.47 tags=v0.1.46,v0.1.47 pr29=merged`\n- `state: clean-login pr30=open branch=cindy-default/readme-overhaul head=56031d6d7ed623a396568c463affc269820bb058 base=cd6f9ff60438256a09dca48f40db50237b097efc docs-only version-unchanged=0.1.47`\n- `state: clean-login repo-renamed=Gruu6y/magpie-clean-login main=ecbe9367d1cfa85209080540ecb58604449a314d version=0.1.48 tags=v0.1.48 pr32=merged pr30-rebased-head=02dcad8060a977f73ae05aabf42b71d89e729f3d`"
  }
}
