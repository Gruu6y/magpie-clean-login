# AGENTS.md — 本仓库的工作约定

适用于所有在本仓库工作的 agent 与自动化。规则短，但要执行。

## 任务拆解与子代理委派

- 本文件只管**仓库级**协作约定（分支与合并、目录 ownership、禁区、测试纪律、发布纪律），
  不定义任务怎么拆、子代理怎么派。
- 任务拆解与子代理委派一律以各工作线 `system_prompt.md` 的「默认拆解军规」为唯一规范：
  原子粒度（单文件／单函数／单问题／单测试面）、能并行就并行、预计超过 3–5 分钟就再拆、
  单层扁平（子代理不得再派子代理）、主会话只做拆解／定契约／排依赖／验收组装、
  细拆后超过单次 8 个上限就按侦察波→实现波→验证波分波次，不为省事合并变粗。
- 下面的「目录 ownership」只是**文件归属**建议，不构成第二套拆解规范；
  凡与军规方向相左的表述，以军规为准。

## 分支与合并

- 任何改动都从最新 `main` 开分支，名字用 `cindy-default/<topic>`；一个分支只做一件事。
- 禁止 agent 直接 commit/push 到 `main`。改动一律提 PR。
- PR 合并由初号机执行；合并后必须重跑 CI，绿了才算完成。
- 提交前跑完整 `bun test`；不要只跑改到的文件就宣布通过。

## 目录 ownership（建议，不是硬门禁）

- `proxy-*` 归“代理线”：`lib/proxy-*.mjs`、`ui/proxy-*`、`test/proxy-*`、页面里的代理区块。
- `signin-*` 归“登录线”：`lib/signin-*.mjs`、`ui/signin-*`、`test/signin-*`、登录对话框。
- 目的是减少并行子代理撞同一个文件；这是文件归属约定，不定义任务粒度（见上节）。
  跨线改动先在 PR 里说明，不要顺手重排无关文件。

## 禁区

- 不读写真实 `~/.config/magpie/`（生产数据）；不碰用户已安装的插件数据。
- 所有测试必须用 tmpdir，并通过 `MAGPIE_CONFIG_DIR`、`MAGPIE_CLEAN_LOGIN_DATA` 等环境变量指到临时目录。
- 不重启、不杀掉生产 magpie 实例。
- 不为了让 CI 变绿而删断言、放宽断言、改成永远 skip，或用 `|| true` 掩盖失败。
  skip 只允许用于明确、可解释的环境缺失，并在测试名/输出里写明原因。

## 测试纪律

- 新功能、修 bug 必须带测试；修 bug 的测试要能复现原问题。
- 测试不写仓库、不写用户目录，运行完自行清理临时目录。
- 改动 `lib/`、`ui/`、`page/` 或 `index.mjs` 时，**不要**自己改 `package.json` 的 `version`：
  版本号由合并方在合并点统一分配，`pull_request` 事件下 `scripts/check-version-bump.mjs` 不再要求 bump。
  本地想复核可以跑：`bun scripts/check-version-bump.mjs --base origin/main --event pull_request`。
  若你确实写了一个版本，门禁仍会拒绝降级、以及等于 `main` 已发布号。

## 发布纪律

- magpie 判断插件有没有新版本，比的是 `package.json` 的 `version` 字符串；不 bump 版本，用户端就看不到这次更新。
- 版本号只有一处分配：**合并方在合并点**。贡献线的 PR 不改 `version`；合并方在合并前把它设为「当前 `main` 版本 +1」，让合并提交自带新版本号，合并后在 `main` 尖上打 annotated tag `vX.Y.Z`。
- **一个 PR 只占一格版本、只打一个 tag。** 完整流程与检查清单见 [docs/releasing.md](docs/releasing.md)。
- 合并方的机械步骤可用 `node scripts/merge-release.mjs <PR号> --dry-run` 预览、去掉 `--dry-run` 执行；它不代替读 diff 与风险分级。
- `scripts/release.mjs` 仍可用于手工/应急发布（默认不 push，先 `--dry-run` 预览），常规发版不再经过它。
- 不要自动写 CHANGELOG；发布提交只包含 `package.json` 的版本变更。
