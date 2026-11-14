---
title: clean-login 加载第三方插件的两处代码位置与「导出形状」类缺陷
description: >-
  clean-login 只有 magpie-plugins.mjs（扫描）与
  signin-flow.mjs（登录加载）两处加载第三方插件代码；改插件导出形状必须同时覆盖两处
type: reference
updatedAt: '2026-11-10T01:15:51.085Z'
---
clean-login 里**只有两处**会动态加载第三方 magpie 插件模块（已 grep 复核 `lib/*.mjs`：只有这两处调 `pluginRootDir(env)` 的返回值去 import 插件）：
1. `lib/magpie-plugins.mjs`——扫描/枚举（`pluginRootDir` :248，加载 :423，子进程 `CHILD_SOURCE`），供 provider 列表与卡片用。
2. `lib/signin-flow.mjs`——登录时加载 hooks（:254），传真实 `{client, magpie}`。
`server.mjs:36`、`provider-sources.mjs:24` 只是 import 这两者的**辅助函数**，不直接加载插件代码。

因此：**凡改动「如何读插件导出」，必须同时覆盖这两处**。两者对导出形状的要求必须一致——既要支持具名函数工厂，也要支持宿主形状 `export default { id, server }`，且显式让具名工厂优先（父进程按 id 去重时保留第一条，顺序与去重是联合生效的）。

代价已两次踩到：PR #76 只修了扫描器，agy-cli 卡片能列出来了，但点登录仍报 `plugin_load_failed · The "agy-cli" plugin exposes no sign-in method.`；补的第二处是初号机的 PR #80（0.1.103，合并 `9a8e1cb`），测试落 `test/signin-plugin-shapes.test.mjs`。

另一个通用教训：这类「同一个假设散落在多处」的缺陷，修完要全仓搜一遍同一判据（如 `typeof … === "function"`）再收工，别只修报障那一条路径。
