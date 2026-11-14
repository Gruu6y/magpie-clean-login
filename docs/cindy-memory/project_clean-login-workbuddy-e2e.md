---
title: project.clean-login-workbuddy-e2e
description: p=cindy.memory.v1;t=project;kc=32;c=11;v=93;o=0;raw=1
type: project
updatedAt: '2026-11-04T21:42:52.272Z'
---

{
  "protocol": "cindy.memory.v1",
  "id": "project_clean-login-workbuddy-e2e",
  "type": "project",
  "keys": [
    "clean",
    "login",
    "workbuddy",
    "e2e",
    "success.md",
    "magpie-probe-client",
    "hooks.auth.methods",
    "plugin-auth.json",
    "plugin-providers.json",
    "accountproxies",
    "idfor",
    "shellexecute",
    "callback",
    "flow",
    "clampscreentodisplay",
    "versionlessua",
    "cursor",
    "zcode",
    "provider",
    "f/k/u",
    "freshkey",
    "provider.suffixmode",
    "setsuffixmode",
    "plainnames",
    "plainownnames",
    "off",
    "own",
    "two",
    "accounts",
    "isolation.md",
    "accounts/",
    "proxies.json"
  ],
  "claims": [
    {
      "k": "c001",
      "v": "3. **我们的隔离浏览器**打开该 url（`launch.mjs --url … --profile … --pin-file identity.json`，代理+geoip 自动生效）",
      "kind": "state"
    },
    {
      "k": "c002",
      "v": "**验证结果**：`plugin-auth.json` 24 → 25 键；新条目字段与 magpie 自己生成的账号**逐字段一致**（`type, refresh, access, expires, accountId, uid, domain, refreshExpiresAt, tokenType`）；magpie 自己的 `plugin-providers.json` 已认：`signedIn:true, authType:oauth, accountId:\"秦昊麟ོོ\"`。**没有造成重复**——原有 5 个 `workbuddy#xxxxx` 是别的账号（静静的外婆/白云/美尚/姜红文/沈端华），秦昊麟ོོ 原先只在 `accountProxies` 里、没有 auth 条目。",
      "kind": "state"
    },
    {
      "k": "c003",
      "v": "**结论**：aibo 定的「登录在我们这边跑、凭据回填 magpie」**成立**；`idFor`/账号键后缀**不需要我们知道**。magpie 开登录页用的是 `ShellExecute`（系统默认浏览器），没有可配置浏览器入口，所以\"让 magpie 用我们的浏览器\"这条不存在，只能自跑流程再回填。",
      "kind": "rule"
    },
    {
      "k": "c004",
      "v": "**跑通时暴露的两个必须修的问题**",
      "kind": "rule"
    },
    {
      "k": "c005",
      "v": "1. **宿主进程重载会丢掉 `authorize()` 的闭包**（`callback` 是闭包，无法序列化）。第一次跑就撞上了：magpie 没重启，但插件被重新加载，`flow` 变 null，`/finish` 报「还没有 authorize()」。→ 产品化时 **authorize → 浏览器 → callback 必须落在同一个宿主生命周期内**，不能跨请求依赖内存。",
      "kind": "rule"
    },
    {
      "k": "c006",
      "v": "2. **pin 的屏幕会被宿主显示器裁剪**：pin 里写 2560×1440，有窗口模式下实际报 1440×1440（`clampScreenToDisplay`）。这直接违反「同一凭据固定单一指纹」的不变量——同一份 pin 在不同显示器状态下会产出不同的屏幕值。UA 那处不算问题（上游 `versionlessUa` 故意不带引擎版本号）。",
      "kind": "state"
    },
    {
      "k": "c007",
      "v": "**纠两处我自己先前的错判**（都已用源码推翻）：",
      "kind": "state"
    },
    {
      "k": "c008",
      "v": "2. 我曾猜 `provider.SuffixMode` / `SetSuffixMode` 是账号键后缀的开关——**错**。读源码后确认 `suffixMode()` 是**界面命名**设置（`plainNames` / `plainOwnNames` → `off`/`own`/`on`，用于 Routing 分组与 Agent 名字显示），与 auth 键无关。",
      "kind": "decision"
    },
    {
      "k": "c009",
      "v": "**对 clean-login 最重要的推论**：我们端到端时是直接 `client.auth.set({path:{id:\"workbuddy\"}})` 写裸键，**绕过了 `freshKey`**。这意味着**同一供应商写第二个账号会覆盖第一个**——而\"一供应商多账号（每账号独立 profile+pin）\"正是核心场景。修法只有一个：**照 `freshKey` 同构实现**（裸键空闲则用裸键，否则 `provider#`+6 位随机 base36 且不撞已有键）。这不再是\"猜私有算法\"，而是复刻 magpie 自己的五行函数。",
      "kind": "rule"
    },
    {
      "k": "c010",
      "v": "**其他有用的**：`accountKey()` 决定请求用哪个账号（未指定 → 该供应商的**第一个**）；`whoOf(a)=accountId??metadata.email??email`；`uidOf(a)=a.uid`，magpie 靠 uid 区分同名账号（上游 #413）；`secretOf(a)` oauth 取 `refresh??access`。",
      "kind": "decision"
    },
    {
      "k": "c011",
      "v": "- **这两个 pin 必须逐字节冻结**（`ensureIdentity` 只写一次、之后不再重写）",
      "kind": "rule"
    }
  ],
  "values": {
    "paths": [
      "/opencode-workbuddy-auth",
      "s://www.workbuddy.cn/login",
      "/sha1/sha256/sha512",
      "C:\\Users\\Administrator\\.config\\magpie\\magpie-clean-login",
      "/workbuddy/workbuddy/",
      "/workbuddy/workbuddy",
      "/en-US/en",
      "/Los_Angeles",
      "/platformInfo/os/client/memory/network",
      "/default/https",
      "/ls/data.sqlite",
      "/idb/418062119B3eVa_cCoAn2_K0HNDOHD.sqlite",
      "p://127.0.0.1"
    ],
    "hashes": [
      "29a86643526fb4fd",
      "933a8959052db9e0",
      "3ce63568",
      "e7167ee946e9",
      "57c94741",
      "a33790411fed"
    ],
    "versions": [
      "127.0.0.1",
      "119.237.242.136",
      "58.152.58.159"
    ],
    "urls": [
      "https://www.workbuddy.cn/login?platform=workbuddy&state=",
      "http://127.0.0.1:17801",
      "http://127.0.0.1:17806"
    ],
    "refs": [
      "#8",
      "#413",
      "#41"
    ],
    "ports": [
      "127.0.0.1:17801",
      "127.0.0.1:17806"
    ],
    "envs": [
      "NVIDIA"
    ],
    "literals": [
      "magpie-probe-client",
      "@magpie-community/opencode-workbuddy-auth",
      "WorkBuddyAuthPlugin({client, magpie})",
      "hooks.auth.methods",
      "(browser)",
      "authorize()",
      "{url, instructions, method:\"auto\", callback}",
      "https://www.workbuddy.cn/login?platform=workbuddy&state=<uuid>&version=&loginSessionId=",
      "launch.mjs --url … --profile … --pin-file identity.json",
      "callback()",
      "{type:\"success\", access, refresh, expires, accountId, uid, domain, refreshExpiresAt, tokenType}",
      "client.auth.set({path:{id:\"workbuddy\"}, body:{...successBody, type:\"oauth\"}})",
      "plugin-auth.json",
      "type, refresh, access, expires, accountId, uid, domain, refreshExpiresAt, tokenType",
      "plugin-providers.json",
      "signedIn:true, authType:oauth, accountId:\"秦昊麟ོོ\"",
      "workbuddy#xxxxx",
      "accountProxies",
      "idFor",
      "ShellExecute",
      "callback",
      "flow",
      "/finish",
      "clampScreenToDisplay",
      "versionlessUa",
      "workbuddy",
      "cursor",
      "zcode",
      "workbuddy#8ll16x",
      "provider",
      "provider#",
      "Math.random().toString(36).slice(2,8)",
      "C:\\Users\\Administrator\\.config\\magpie\\magpie-clean-login",
      "pluginDataDir()",
      "accounts/",
      "proxies.json",
      "accounts/<provider>/<safeSegment(key)>/",
      "identity.json",
      "profile/",
      "accounts/workbuddy/workbuddy/",
      "29a86643526fb4fd",
      "workbuddy#mbg4c2",
      "accounts/workbuddy/workbuddy%23mbg4c2/",
      "safeSegment",
      "%23",
      "933a8959052db9e0",
      "ensureIdentity",
      "3ce63568-28a2-4fde-b053-e7167ee946e9",
      "workbuddy/",
      "57c94741-0dbd-486c-837f-a33790411fed",
      "workbuddy%23mbg4c2/",
      "storage/default/https+++www.workbuddy.cn/ls/data.sqlite",
      ".../idb/418062119B3eVa_cCoAn2_K0HNDOHD.sqlite",
      "providers.json",
      "providers[0].accountProxies",
      "http://127.0.0.1:17801",
      "R1-1|香港-NF|HKT家宽",
      "http://127.0.0.1:17806",
      "R2-2|香港-NF|HKT家宽",
      "startSignIn({proxy})",
      "#41orj5",
      "#ap28rp"
    ]
  },
  "state": {
    "active": true,
    "claim_count": 11,
    "open_count": 0,
    "member_count": 2,
    "merged_from": [
      "project_clean-login-workbuddy-e2e-success",
      "project_clean-login-workbuddy-two-accounts-isolation"
    ],
    "merged_at": "2026-11-04T21:42:52.272Z",
    "directive": "m01320",
    "format": "cindy.memory.v1",
    "operative_layer": "machine",
    "archive_contains_verbatim_prose": true
  },
  "open": [],
  "source": {
    "updatedAt": "2026-11-04T21:42:52.272Z",
    "migratedAt": "2026-11-04T21:42:52.272Z",
    "directive": "m01320"
  },
  "raw": {
    "title": "clean-login 首个端到端：workbuddy 登录并回填 magpie（已跑通） | clean-login 已通过插件登录的两个 workbuddy 账号：profile/pin/出口隔离实测",
    "description": "账号键后缀=magpie 的 freshKey()：裸键占位否则 provider#+6位随机base36；并纠正 idFor 与 SuffixMode 两处错判 | 秦昊麟(裸键workbuddy)与静静的外婆(workbuddy#mbg4c2)各占独立目录+独立 pin+不同香港出口，已用 uid 交叉验证",
    "body": "===== project_clean-login-workbuddy-e2e-success =====\n\n**2026-11-03 端到端跑通（第一个供应商：workbuddy）。** 用的是临时探针插件 `magpie-probe-client`（在 magpie 插件宿主进程内跑，所以回填是真的）。\n\n**完整链条（全部实测，不是推断）**\n1. 在宿主进程里 import `@magpie-community/opencode-workbuddy-auth`，调 `WorkBuddyAuthPlugin({client, magpie})` → `hooks.auth.methods` 里 `(browser)` 那条的 `authorize()`\n2. `authorize()` 返回 `{url, instructions, method:\"auto\", callback}`，url 形如 `https://www.workbuddy.cn/login?platform=workbuddy&state=<uuid>&version=&loginSessionId=`\n3. **我们的隔离浏览器**打开该 url（`launch.mjs --url … --profile … --pin-file identity.json`，代理+geoip 自动生效）\n4. 用户登录后调 **同一个闭包的** `callback()` → 返回 `{type:\"success\", access, refresh, expires, accountId, uid, domain, refreshExpiresAt, tokenType}`\n5. 回填：`client.auth.set({path:{id:\"workbuddy\"}, body:{...successBody, type:\"oauth\"}})`\n\n**验证结果**：`plugin-auth.json` 24 → 25 键；新条目字段与 magpie 自己生成的账号**逐字段一致**（`type, refresh, access, expires, accountId, uid, domain, refreshExpiresAt, tokenType`）；magpie 自己的 `plugin-providers.json` 已认：`signedIn:true, authType:oauth, accountId:\"秦昊麟ོོ\"`。**没有造成重复**——原有 5 个 `workbuddy#xxxxx` 是别的账号（静静的外婆/白云/美尚/姜红文/沈端华），秦昊麟ོོ 原先只在 `accountProxies` 里、没有 auth 条目。\n\n**结论**：aibo 定的「登录在我们这边跑、凭据回填 magpie」**成立**；`idFor`/账号键后缀**不需要我们知道**。magpie 开登录页用的是 `ShellExecute`（系统默认浏览器），没有可配置浏览器入口，所以\"让 magpie 用我们的浏览器\"这条不存在，只能自跑流程再回填。\n\n**跑通时暴露的两个必须修的问题**\n1. **宿主进程重载会丢掉 `authorize()` 的闭包**（`callback` 是闭包，无法序列化）。第一次跑就撞上了：magpie 没重启，但插件被重新加载，`flow` 变 null，`/finish` 报「还没有 authorize()」。→ 产品化时 **authorize → 浏览器 → callback 必须落在同一个宿主生命周期内**，不能跨请求依赖内存。\n2. **pin 的屏幕会被宿主显示器裁剪**：pin 里写 2560×1440，有窗口模式下实际报 1440×1440（`clampScreenToDisplay`）。这直接违反「同一凭据固定单一指纹」的不变量——同一份 pin 在不同显示器状态下会产出不同的屏幕值。UA 那处不算问题（上游 `versionlessUa` 故意不带引擎版本号）。\n\n**未跟进**：我们写的是**裸键** `workbuddy`，而 magpie 自己生成的账号是 `workbuddy#xxxxx`。magpie 接受了裸键，但两者是否都被当成独立账号还没观察。临时探针与试跑目录可随时清理。\n\n**问题**：`plugin-auth.json` 里为什么有的是裸键（`cursor`、`zcode`），有的是 `workbuddy#8ll16x` 这种带后缀的键？后缀怎么算的？\n\n**答案：magpie 二进制里嵌着这段源码原文，是它自己的函数（不是各家插件算的）。**\n\n```js\n// freshKey is where a new sign-in to provider goes: its own id while that\n// is free.\nfunction freshKey(provider) {\n  const all = readAuth()\n  if (!(provider in all)) return provider\n  for (;;) {\n    const k = provider + \"#\" + Math.random().toString(36).slice(2, 8)\n    if (!(k in all)) return k\n  }\n}\n\n// accountKey is the account a request names, the provider's first when it names none.\nfunction accountKey(provider, account) {\n  if (account && providerOf(account) === provider) return account\n  return accountsOf(readAuth(), provider)[0] ?? provider\n}\n```\n\n即：**第一个账号用裸 `provider`；之后每个新登录用 `provider#` + 6 位随机 base36**（`Math.random().toString(36).slice(2,8)`）。后缀是**纯随机**，与账号数据无关——这解释了 13 个样本的字符集恰好只缺 `f/k/u`，也解释了所有哈希候选（md5/sha1/sha256/sha512 × 多种输入编码）零命中。\n\n**纠两处我自己先前的错判**（都已用源码推翻）：\n1. 我曾以为后缀来自各家插件私有的 `idFor`——**错**。`idFor`（`sha256(SALT|kind|key).slice(0,32)`）是插件内部用的，与账号键无关。账号键是 magpie 的五行的 `freshKey`，稳定可读可测。\n2. 我曾猜 `provider.SuffixMode` / `SetSuffixMode` 是账号键后缀的开关——**错**。读源码后确认 `suffixMode()` 是**界面命名**设置（`plainNames` / `plainOwnNames` → `off`/`own`/`on`，用于 Routing 分组与 Agent 名字显示），与 auth 键无关。\n\n**对 clean-login 最重要的推论**：我们端到端时是直接 `client.auth.set({path:{id:\"workbuddy\"}})` 写裸键，**绕过了 `freshKey`**。这意味着**同一供应商写第二个账号会覆盖第一个**——而\"一供应商多账号（每账号独立 profile+pin）\"正是核心场景。修法只有一个：**照 `freshKey` 同构实现**（裸键空闲则用裸键，否则 `provider#`+6 位随机 base36 且不撞已有键）。这不再是\"猜私有算法\"，而是复刻 magpie 自己的五行函数。\n\n**其他有用的**：`accountKey()` 决定请求用哪个账号（未指定 → 该供应商的**第一个**）；`whoOf(a)=accountId??metadata.email??email`；`uidOf(a)=a.uid`，magpie 靠 uid 区分同名账号（上游 #413）；`secretOf(a)` oauth 取 `refresh??access`。\n\n\n===== project_clean-login-workbuddy-two-accounts-isolation =====\n\n**2026-11-03 核实（aibo 问\"这两个账号的凭据是不是在不同指纹浏览器里\"）。结论：是，各自独立的 profile 与固定 pin，出口也不同。**\n\n**插件数据根**：`C:\\Users\\Administrator\\.config\\magpie\\magpie-clean-login`（= `pluginDataDir()`，只有 clean-login 会写这里；内含 `accounts/` 与插件自己的 `proxies.json` 58 条）。\n\n**两个账号目录（`accounts/<provider>/<safeSegment(key)>/`，每目录 = `identity.json` + `profile/`）**\n| 账号 | magpie 账号键 | 目录 | pin sha256(前16) | profile 体积 |\n|---|---|---|---|---|\n| 秦昊麟ོོ | 裸键 `workbuddy` | `accounts/workbuddy/workbuddy/` | `29a86643526fb4fd` | 55M |\n| 静静的外婆 | `workbuddy#mbg4c2` | `accounts/workbuddy/workbuddy%23mbg4c2/`（`safeSegment` 把 `#`→`%23`） | `933a8959052db9e0` | 57M |\n\n**pin 确实不同**：38 个区块中 19 个不同 —— navigator、screen、matchMedia、window、location、intl、languages、headers、voices、gpu、webgl、webgl2、gpuInfo、devices、mimeTypes、systemStyles、allFonts、defaultCS。实测差异：\n- screen 1920×1080 vs 1920×1200；hardwareConcurrency 2 vs 8\n- GPU Intel HD Graphics 400 vs NVIDIA GeForce GTX 980\n- 语言 de/en-US/en vs en-US/en；时区 Europe/Berlin vs America/Los_Angeles；字体 279 vs 270\n- 相同区块（browser/platformInfo/os/client/memory/network 等 23 个）是宿主同类导致：两边同为 Firefox 146 / Windows 10\n- **这两个 pin 必须逐字节冻结**（`ensureIdentity` 只写一次、之后不再重写）\n\n**profile 各自持有自己账号的会话（交叉验证 uid，各命中 4 个文件）**：秦昊麟 uid `3ce63568-28a2-4fde-b053-e7167ee946e9` 只在 `workbuddy/`；静静的外婆 uid `57c94741-0dbd-486c-837f-a33790411fed` 只在 `workbuddy%23mbg4c2/`。命中文件为 `storage/default/https+++www.workbuddy.cn/ls/data.sqlite`、`.../idb/418062119B3eVa_cCoAn2_K0HNDOHD.sqlite` 与 2 个 cache2 条目。两边各自有独立 cookies.sqlite（含 workbuddy.cn）与 sessionstore。\n\n**出口也不同（magpie `providers.json` → `providers[0].accountProxies`，workbuddy）**\n- 秦昊麟ོོ → `http://127.0.0.1:17801` = `R1-1|香港-NF|HKT家宽` / 出口 IP 119.237.242.136\n- 静静的外婆 → `http://127.0.0.1:17806` = `R2-2|香港-NF|HKT家宽` / 出口 IP 58.152.58.159\n（插件自己**不持久化**账号↔代理绑定，`startSignIn({proxy})` 只是传参；绑定事实只存在 magpie 的 `accountProxies`。）\n\n**旁证\"只有这两个走了我们的插件\"**：workbuddy 在 magpie 里共 6 个账号，另 4 个（白云 `#41orj5`、美尚 `#ap28rp`、姜红文 `#lpmyd5`、沈端华 `#vm34sg`）在插件数据根下**没有**目录 —— 它们是 magpie 自己的登录页登的。\n\n**与不变量的关系**：这条满足「一个凭据固定一个指纹、pin 与 profile 同生同死」；两个账号出口同属香港 HKT 家宽但出口 IP 不同，不冲突（出口可共享/轮换）。\n"
  }
}
