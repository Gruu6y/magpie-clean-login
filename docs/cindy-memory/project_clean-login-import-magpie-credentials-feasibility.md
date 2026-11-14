---
title: cl 导入 magpie 既有凭据并逐一重登刷新指纹：可行性与实现路径
description: cl「导入 magpie 既有凭据 + 逐一重登刷新指纹」功能可行性：可行，核心是导入时抽 pin + claim 重登绕开 reconcile 吞指纹
type: project
updatedAt: '2026-11-07T20:25:17.197Z'
---
主人设想的新功能（2026-11-08 提出，尚未授权实现）：用户在装 clean-login 之前已用 magpie 原生功能登录很多凭据，这些登录都在用户自己的浏览器完成 ⇒ 全部账号最后登录指纹一致。希望「一键把 magpie 已保管的凭据导进 cl 账号页，再逐一点击重登刷新出各自独立的新指纹」。

## 结论：可行，且导入名单无需读任何凭据值
现成只读函数已够：`lib/account-keys.mjs:74-96 readAuthKeysResult`（只取 Object.keys，四态 ok/auth_missing/auth_unreadable/auth_invalid）+ `lib/signin-writeback.mjs:133-158 readAuthEntries`（只取 accountId/uid/type/email）。写回侧 `writeBack` 的 `opts.forceKey` 已支持精确落既有 key 含 `#后缀`。**绝不读 access/refresh/key/metadata 值**是注释+测试固化的硬契约（account-keys.mjs:44-46、signin-writeback.mjs:120-131、test/account-keys.test.mjs:114、test/signin-writeback.test.mjs:317/394）。

## 本机实测规模（2026-11-08，cl v0.1.72 / magpie 0.1.3260）
plugin-auth.json 33 条（oauth 30 / api 3）；已有 cl ledger 9 条（含 pin）；**magpie-only 24 条全部无指纹 pin**，23 条有可填 ledger 的身份字段，仅 opencode-zen-free 无；其中 3 条是 api key（opencode-zen-free / devin / commandcode-plan）不能靠重登换指纹 ⇒ **可浏览器重登的 OAuth magpie-only 实为 21 条**。logins.json 37 行 = 33 条 `agent:"plugin:<id>"` 索引行（`home` 字段＝accountKey）+ 4 条原生行（antigravity/codex/grok）。

## 决定性坑：新指纹会被静默吞掉
`lib/account-identity.mjs:333 reconcileAccountDir(env,provider,fromKey,toKey)`：目标目录已存在时 `await access(to); await rm(from,{recursive:true,force:true})` ⇒ **删掉刚抽的新指纹目录**。调用点 `lib/signin-flow.mjs:588-593` `if (finalKey && finalKey !== current.key)`。走「新账号登录」重登同一 uid 时 `chooseAccountKey` 的 sameAccount 返回旧 key ⇒ 触发该分支 ⇒ 新指纹白抽、继续用旧指纹。

## 绕开路径（方案核心）
**导入时就建目录 + ensureIdentity 抽新指纹 + 写 ledger（不含凭据），重登走 claim 该 key。** `lib/signin-flow.mjs:678-698` claimKey 只校验 ledger 存在且 meta.provider 匹配（**不要求已登出**），`:741-744` `key = claimKey ?? signInKey(...)` ⇒ finalKey===current.key ⇒ reconcile 整段跳过。孤儿清扫也安全：`lib/account-prune.mjs:28-29` key 在 plugin-auth.json 里的目录 "always kept, in every circumstance"，带 ledger 属 RETIRED 永不移除。

## 重登能力分三条路
cl 内置 registry 仅 3 条（provider-registry.mjs:53/71/89 = antigravity/codex/claude）；已装带 magpie 字段的 npm 包仅 5 个（cl 自身、@magpie-community/opencode-devin-auth、opencode-zcode-auth、page-agent-office、@roadkid/opencode-loomy-auth）⇒ workbuddy/qoder-cn/minimax-code/qwenwork 等是 **magpie 内置 provider**，重登门是 `lib/native-signin.mjs:1-19` 描述的 CLI 驱动（`magpie accounts add <agent>`，依赖 Settings›Privacy›Sign-in pages 关闭＝SignInLinkOnly；页面 frame connect-src 'none' + noFramedAPI 堵死其他路）。npm 插件 provider 走进程内 authorize()；**api-key 类型两条路都不适用**。

## 指纹机制与验证
一账号一 profile 一指纹永久绑定；`ensureIdentity`（account-identity.mjs:298）只在首次抽取、**永不重生成**；`buildLaunchInput`（browser-launcher.mjs:110-135）传 `fingerprint: identity`、`canvas_noise:false`、`persistent_context:true`。cookie/storage 登录后保留不清理；**magpie 后续刷 token 完全不用浏览器 profile ⇒ 指纹只在浏览器登录那一刻起作用**，持续起作用的只有 accountProxies 出口。验证换没换：本地 `account-summary.mjs:14-38` fingerprint.id＝identity.json 全文 sha256 前 12 hex；远程 `identity-check.mjs` 跑 who.1ms.dog 取 fingerprintId，双重证明。

## 代理注意
`ui/signin-state.js:49-68 orderSignInProxies` 把本供应商已用过的出口排最后、**不自动预选上次代理** ⇒ 批量重登若不管会给账号换出口。建议导入时读 magpie `providers.json.accountProxies` 的既有出口做默认预选；**该 map 的键是账号显示名小写 trim**（`Temp/proxy.go:108-110 accountKey(user)`，与 cl 的 accountKey 同名不同物），三文件链：plugin-auth[key] ↔ logins{agent:"plugin:id",home:key,user:显示名} ↔ accountProxies[显示名小写]。

## 分期建议（已向主人提出，待拍板）
P0 只读导入列表（卡片标「未接管/无指纹」，零风险）→ P1 导入即建目录抽 pin 写 ledger + claim 重登（先在 cl 已知登录路的 provider 跑通）→ P2 覆盖内置 provider 的 CLI 驱动重登与 api-key 的明确「不可重登」态。风控方向上是从「全部同一指纹」迁到「一账号一指纹」，变安全；仍建议逐个慢速、沿用既有出口。

## 状态
2026-11-08 已交付可行性判断，**未改任何代码/配置、未启动浏览器、未发起登录、未读凭据值**。只读脚本留在 `workspace/tmp/cl-import-scan.mjs`、`cl-import-cap.mjs`。下一步「写 PR 级实施方案」等主人点头。
