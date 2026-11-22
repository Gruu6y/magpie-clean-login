---
title: clean-login 本线测试环境基线与依赖坑
description: >-
  clean-login 测试基线：main 0.1.106(85cd490)=1129/0/11309/84files；proxy-score 本机噪音单跑 2
  fail、全量并发可增至 8 fail（先看单跑+CI）；含 CLI 自判新规
type: reference
updatedAt: '2026-11-10T01:45:15.883Z'
---
# clean-login 本线测试环境基线与依赖坑（2026-11-10 更新）

## 当前权威基线（main v0.1.106 / 85cd490）
- **版本号**：`0.1.106`（annotated tag `v0.1.106`；PR #83 = magpie 名单不可读时，内置 browser-oauth 供应商（antigravity/codex）保留 native 登录入口；远端 PR 队列已清空）
- **全量测试**：**1129 pass / 0 fail / 11309 expect / 84 files**（初号机本机全量也 0 fail，proxy-score 这次全绿 → 再次证明那批红是环境不稳定）。CI 同 head 全绿。
- **本机 proxy-score 噪音判据（重要）**：`test/proxy-score-routes.test.mjs` 在本机会失败（503，本地 scoring browser 预检问题）。
  - 单跑该文件固定 **2 fail**：`a measured score reaches the proxy row, the list and bootstrap`、`a second score while one runs is a 409 score_busy`。
  - **全量并发下失败条数会变多（见过 8 fail），属端口/共享状态并发问题，不是新引入 bug**。
  - 判据：先单跑该文件对比，再对照同 head 的 CI；CI 全绿即可认定与本线改动无关。已在独立 worktree 用 `941634a` 基线复现过。

## 版本演进
- `85cd490` (0.1.106)：PR #83（native door 不再依赖 providers:list 读取）
- `a39fa0a` (0.1.104)：PR #81（插件自述失败原样透出，code signin_failed）
- `9a8e1cb` (0.1.103)：PR #80（登录加载认宿主导出形状）
- `6fd51cd` (0.1.102)：PR #79（资产 CLI `assets/add/get/update/delete`）
- `3aeb042` (0.1.101)：中间合并点
- `491ead6` (0.1.100)：基线
- `981d649` (0.1.99)：PR #75（资产账号上限单一来源 + 字面量边界测试）
- `e36f669` (0.1.98)：PR #74（账号输入上限 320→254）
- `cb557da` (0.1.97)：PR #73（三号机 CLI 就绪）
- `0b318a1` (0.1.96)：PR #72（资产页）

## 新规矩（2026-11-10 主人，逐字）
「关于插件cli的问题,每个pr都要自己判断需不需要更新cli,不单单针对你,针对所有cindy」
→ 每条 PR 必须自判 CLI 是否要同步（`lib/agent-cli.mjs`，必要时 README CLI 段），结论写进 PR 描述；新增/改动 `/api/*` 路由且能纯命令行完成的动作就该有子命令。详见记忆 `feedback_clean-login-cli-parity-rule.md`。

## 按钮名册与护栏
- `test/button-ids.mjs`：67 项（字母序）。新增 `<button id>` 必须与 `ui/index.html` 1:1 存在且 app.js 绑定事件；同步登记 `test/button-ids.mjs` 与 `test/ui-editorial-design.test.mjs` 附录 A。
- 合并点统一发版（PR #62 / 5ba2bf5）：贡献分支**不改 version**，由初号机在合并点分配；**各线不要自己 rebase**，留给初号机。
- 空态标记：`test/brand-mark.test.mjs` 断言 `class="empty-mark"` 数量 = 4。
- 资产账号上限单一来源：`ASSET_ACCOUNT_MAX = 254`（`lib/asset-registry.mjs` 第 11 行声明，`LIMITS.account` 引用）；`test/assets-page-ui.test.mjs` 断言 markup === 页面常量 === 服务常量；`test/assets-routes.test.mjs` 用字面量 254 在线上边界钉死（改单一来源即变红）。

## 账号出口与账本镜像不变式
- **凭据不出 HTTP 边界**：`displayUrl` 和 `providerProxy` 只能 `scheme://host:port`，绝不能带 `user:pass@`。
- 账本 exit 字段：`lib/account-records.mjs withExit`；`accountRow` 显示 `view.exit ?? view.lastLogin`。
- 托管续期优先级：`lib/renew-hosting.mjs resolveExit` 优先 `meta.exit`。

## npm 下载量口径（2026-11-22 查证）
- `@gruu6y/page-clean-login` 首次发布 2026-11-20（0.0.0-stage / 0.2.2 当日；0.2.4~0.2.6 于 11-22）。
- npm `last-week` 下载数 = tarball HTTP 200 计数，含镜像同步/CI/Docker/爬虫；**发版日尖峰属镜像拉取脉冲，不等于真实用户**。本包 446 次里 386 次落在发布次日。
- 统计 UTC 零点后每日结算，当日 0 = 未结算非无人装；查各版本分布：`https://api.npmjs.org/versions/<pkg>/last-week`。

## Devin 云会话使用事实（2026-11-20 查证）
- **swe-2 的“免费”仅限 Devin Desktop/CLI 本地促销（到 2026-11-30），不含 Devin Cloud 云会话；swe-2-flash 官方文档明确云会话不可用（Desktop/CLI 免费到 12-04 18:00 UTC）。云会话照常扣套餐额度→on-demand credits（自助）或 ACU（企业）。** Teams Free(powered by SWE-2) 模式才有每人 2 个免费云会话。
- 用户订阅上限：**最多同时 2 个 Linux 云会话**；Mac 云会话仅 Apple Silicon arm64（Intel 只能 Rosetta 冒烟）。
- 计费按 Devin 动作+VM 时间，不只 token；核对 Session Insights / Settings>Usage & limits，别只看 CLI `--model` 参数。
- Devin 独立会话**不会自动 send_to_session 回传**——固定规则（已记入项目记忆）：新任务 brief 必须要求其收尾用 send_to_session 通知调度会话。
- 云会话是「修复工人」，别一口气修完整张表：拆工单分批、每批一个 PR、PR 不绿不合、云里只提交分支不碰 main；真机/窗口类验收回本地做。

## 测试与工具坑
- `merge-release.mjs` 幂等，可安全重跑。
- rebase-merge 后入库 SHA 变正常，核验要比文件树。
- 仓库不跟踪 `bun.lock`；提交明确列文件，别用 `git add -A`。
- `gh pr view` 可能短时间报旧 head，用 `git ls-remote` 或 `gh api repos/.../pulls/<n> --jq '.head.sha'` 复核。
- 本机 git 身份：`git config --local user.name/user.email` = `Gruu6y` / `129347307+Gruu6y@users.noreply.github.com`。
- 分支命名 `cindy-default/<topic>`；PR 归属可用 `git fetch origin refs/pull/<n>/head` 后看提交作者邮箱确认是哪条线。
- main 上 `check-version-bump.mjs --event push` 对纯文档/无发布相关改动输出 `no release-relevant files changed`、exit 0。
- `startServer({port:0})` 返回对象用 `.port`（不是 `.address()`）；测试里要配 `pluginScanner: { get: () => ({available:false,...}), warm: ()=>{} }`，dataDir/config/cache 全走 tmpdir，禁止读写真实 `~/.config/magpie/`。
- 在 bun 里 `spawnSync(process.execPath, ["bin/clean-login.mjs", ...])` 子进程会挂住（实测 180s 无输出超时）；CLI 端到端验证改成进程内 `import { runCli } from "./lib/agent-cli.mjs"` + 真实 HTTP 服务 + 注入 `write/writeError`，可靠且快。
