---
title: magpie 插件 provider 扫描的两种导出形状与「卡片显示未安装」根因
description: >-
  magpie/cl 插件 provider 扫描认两种导出形状（具名工厂 / 宿主 {id,server}），工厂优先 + 按 id 去重；含
  agy-cli 真机根因
type: project
updatedAt: '2026-11-10T01:45:15.883Z'
---
# clean-login / magpie 插件 provider 扫描的两种导出形状（PR #76，0.1.100 / 491ead6）

## 两种形状（magpie / OpenCode 都认）
1. **具名工厂**：`export const XxxAuthPlugin = async (input) => ({ auth: { provider, methods } })`。
2. **宿主形状**：`export default { id, server }`，其中 `server` 是插件函数，返回值携带同样的 `auth` 钩子。

`lib/magpie-plugins.mjs` 在**子进程**里（硬超时、失败降级）按 `package.json` 的 **`main`**（不是 `exports` map）导入入口，遍历导出：函数收进 `factories`，`{server: fn}` 收进 `hostServers`，然后 **先工厂、后宿主形状**（显式顺序，不依赖导出顺序）。父进程 `normalizeScan(raw)` 用 `seen: Set` **按 provider id 去重、保留先到的**，所以两种形状都带的包最终报自己工厂声明的 provider。

## 真机画像（2026-11-10 本机只读核对）
- 装着的插件包：11 个 `@magpie-community/opencode-*` + `@magpie-community/page-agent-office` + `@roadkid/opencode-loomy-auth`（`page-agent-office` 无 `main`/`index.mjs`，被跳过是正确的：页面插件、不声明 provider）。
- 多数包的 `main: ./opencode.mjs` 是**只 re-export 具名工厂**的 shim（如 cursor 的 `export { CursorAuthPlugin } from "./index.mjs"`）。
- **agy-cli 的 shim 只 re-export `default`**（`export { default } from "./index.mjs"`，index.mjs 里只有 `export default {id, server}`）→ 修前扫描贡献 0 个 provider。
- devin / loomy 的 `main` 直接是 `index.mjs`，**两种形状都带**（具名工厂 + `export default {… server …}`）。

## 症状与定位
症状＝**插件已装在磁盘、卡片却显示「未安装」且没有登录入口**（卡片掉到市场层判定）。定位三步：①读 `plugin-providers.json` 行数（本机 17）；②读该包 `main` 指向的文件，看它 re-export 的是具名函数还是只有 `default`；③确认 `default` 是 `{id, server}` 形状而不是函数。

## 采集人数基线
修前 16 条 → 修后 **17 条**，与 magpie 自己 `plugin-providers.json` 的 17 行逐条一致。市场层声明 67 个 provider，其余 50 个确实未安装（非缺陷）。

## 未做（有意）
`lib/provider-sources.mjs` 的层级规则未动；也未按 `plugin-providers.json` 另立一套「已安装」判据——那属产品语义变更，不在该 bug 范围。

---

## 追加（2026-11-10，PR #81 / v0.1.104）：插件自述失败必须原样透出

agy-cli 的 `authorize()` 在前置条件不满足时返回 `{ type: "failed", error: "agy CLI not found. Install Antigravity CLI first: https://antigravity.google/docs/cli" }`。流程原来一路落到 `if (typeof auth?.callback !== "function")`，抛 `no_callback · The "agy-cli" sign-in has no completion callback.` —— **把「没装 agy CLI」错报成「插件形状不对」**。

现在 `lib/signin-flow.mjs` 在 authorize 返回之后、`classifyAuthorizedFlow` 之前先认 `auth?.type === "failed"`，抛 `signin_failed`/502 并**逐字带上插件的 error**；无 message 时退回 `The "<provider>" sign-in could not start.`。测试 2 例在 `test/signin-flow.test.mjs`；破坏性验证把分支改 `if (false)` → 2 fail，还原 40/0。

**真机核实（只读）**：本机 PATH 与 `%LOCALAPPDATA%agyin`、`%LOCALAPPDATA%ProgramsAntigravityin`、`~/.local/bin`、`~/.geminiin` **都没有 agy**；装的是 Antigravity **桌面版**（Electron，无 CLI）。所以 agy-cli 这条供应商要能用，得先装 agy CLI（插件给的入口 https://antigravity.google/docs/cli）。agy-cli 的 Google 方法是 `method: "code"`（粘贴授权码），不是本地回调。

**流程教训**：`merge-release.mjs` 在 push 阶段报「the push was rejected -- the branch moved while this ran」**可能是瞬时网络错误**，本次 `git ls-remote` 显示远端分支并没有新提交，手工 `git push` 一次就成功（`1fb038d..95cd384`），再跑脚本走「the PR head already carries 0.1.104; reusing it」幂等分支完成合并。**先核实远端再判断，不要当成别人推了提交。**

---

## 追加（2026-11-10，PR #82 / v0.1.105）：本机已有登录态 = 直接登记账号，不是错误

**第三个（也是最后一个已知）agy-cli 登录缺口**：插件在「本机已有登录态」时返回 `{ url: "", instructions: "", method: "auto", callback: async () => ({ type: "success", key: "agy" }) }`（agy-cli `index.mjs` 约 4195 行：`if ((await probeSignedIn(agy)).ok) return {…}`）。`classifyAuthorizedFlow()` 本就把「无 URL、无声明式 prompts」读作 `category: "local"`（文件头规则 6：「Anything else is a local-session reuse, which is what the real plugins return.」），但 `startSignIn()` 当时只特判 `method === "code"` 与需要 URL 的浏览器路径 → 落到 `throw no_url`，于是**本机明明已登录，用户看到的是「插件没返回 URL」**。

**修法（`lib/signin-flow.mjs`）**：在 code 分支之后、`no_url` 护栏之前加 `if (authorized.category === "local")` → 置 `url = ""`、`state = "waiting-login"`、`throwIfCancelled`，**不开任何窗口**，直接 `startCallback(current)` 并按浏览器路径同形状返回 `{flowId, key, url, instructions}`。callback 拿不到凭据时仍如实以 `callback_failed` 失败。

**不变式（别改回去）**：①silent（后台续期）路径**仍然**以 `not_hostable`/409 拒绝非 browser 类别 —— 已用新用例 `a silent sign-in refuses a local-session method with not_hostable` 锁死顺序（该分支在该检查之后）；②`no_url` 护栏保留，`form`/`secret`（带声明式 prompts）仍走它；③**不存在「无 URL 无 prompts 但该报 no_url」的形状** —— 那个类别按定义就是 local，真坏了会以 `callback_failed` 现身。原先那条 `a plugin that returns no url and no code method is still an honest error` 用例与新规则冲突（它的 fixture 其实带一个**可用** callback），已改写成 `a url-less local-session method registers the account without opening a browser`，断言 `started.url === ""`、`state.launched === null`（一个窗口都不许开）、settle 后 `flow.state === "done"` 且 callback 恰调用一次。

**验证**：单文件 41 pass / 0 fail / 165 expect；全量 1126 pass / 0 fail / 11297 expect / 84 files；破坏性验证 = 分支改 `if (false && …)` → 恰 1 条红（新用例），`not_hostable` 那条仍绿（证明两者挡在不同位置）。

**真机前置事实**：agy 装在 `C:UsersAdministratorAppDataLocalagyinagy.exe`（**不在 PATH**，但正是 `agyCandidates()` 的候选目录，`findAgy()` 用 `fs.accessSync(X_OK)` 能找到）；`agy --version` = 1.5.3（`MIN_AGY_VERSION` = 1.4.12）；`agy models` 正常列出模型 → 已登录。agy-cli 的 Google 方法 `method: "code"`（粘贴授权码），不是本地回调。
