---
title: project.clean-login-account-proxy-sync
description: p=cindy.memory.v1;t=project;k=clean,login,account,proxy,sync,accountproxies,accountproxypicker,client;kc=26;c=6;v=52;o=2;raw=1
type: project
updatedAt: '2026-11-05T01:10:14.889Z'
---

{
  "protocol": "cindy.memory.v1",
  "id": "project_clean-login-account-proxy-sync",
  "type": "project",
  "keys": [
    "clean",
    "login",
    "account",
    "proxy",
    "sync",
    "accountproxies",
    "accountproxypicker",
    "client",
    "auth.set/remove",
    "tui.showtoast",
    "app.log",
    "config.get",
    "providers.json",
    "llama-local.name",
    "magpie_label",
    "bytes_identical",
    "lib/account-proxies.mjs",
    "constructor",
    "prototype",
    "lib/signin-flow.mjs",
    "runcallback",
    "syncaccountproxy",
    "createsigninflow",
    "lib/server.mjs",
    "backfillaccountproxies",
    "test/account-proxies.test.mjs"
  ],
  "claims": [
    {
      "k": "c001",
      "v": "现象与根因（2026-11-05，magpie 0.1.3001）：插件登录时浏览器确实走选定出口，但登录后 magpie 的常规流量（quota/API）回退到供应商级 `providers.json.providers[].proxy`，因为 minimax-code 没有 `accountProxies`。clash 内核日志（`C:/ProgramData/clash-verge-service/users/ddbbbe49.../logs/service_latest.log`）每行 `[TCP] 127.0.0.1:<port> --> <host>:443 using <节点>` 可验证：登录时用 R2-5/D1-3，之后全部 `using R1-1`。",
      "kind": "decision"
    },
    {
      "k": "c002",
      "v": "- 插件宿主 `client` 只暴露 `auth.set/remove`、`tui.showToast`、`app.log`、`config.get`，没有写 provider 配置的 API；插件页面被 frame 沙箱隔离，不能 POST `/api/provider/save`；magpie 网关 3425 只暴露 `/v1/*` 与 `/mcp/*`。**所以只有直接改 providers.json 一条路。**",
      "kind": "rule"
    },
    {
      "k": "c003",
      "v": "热重载（已实测，不是推测）：magpie 用 filememo/fsnotify 按文件 stat 失效缓存，外部原子替换 `providers.json` 后**不需要重启**。零网络可逆探针：临时改 `groups[].name` 或 `llama-local.name` → `curl http://127.0.0.1:3425/v1/models` 的 `magpie_label` 立即变 → 恢复原字节并确认 `BYTES_IDENTICAL`。",
      "kind": "rule"
    },
    {
      "k": "c004",
      "v": "- 登录成功（`lib/signin-flow.mjs` 的 `runCallback`，写完凭据和台账之后）调 `syncAccountProxy` 覆盖该账号自己的 key；`createSignInFlow` 的 `syncAccountProxy` **默认是空操作**（防止只覆盖部分 env 的测试去解析真实配置目录），真实实现在 `lib/server.mjs` 里注入。",
      "kind": "rule"
    },
    {
      "k": "c005",
      "v": "- 启动时 `lib/server.mjs` 跑 `backfillAccountProxies`（只补缺失 key，不覆盖手工设置），修好以前登录的账号；返回的 service 有 `.backfill()` 供测试等待。",
      "kind": "open"
    },
    {
      "k": "c006",
      "v": "未决/已知限制：Windows rename 覆盖偶发 EPERM 时先 rm 再 rename（短暂空档）；providers.json 还有别的写者（magpie 自身、DSH）理论上可交错；插件不写 magpie 其它配置。",
      "kind": "open"
    }
  ],
  "values": {
    "paths": [
      "C:/ProgramData/clash-verge-service/users/ddbbbe49.../logs/service_latest.log",
      "/.config/magpie/providers.json",
      "/api/provider/save",
      "/fsnotify",
      "p://127.0.0.1",
      "/v1/models",
      "/account-proxies.mjs",
      "/providers.json",
      "/signin-flow.mjs",
      "/server.mjs",
      "/account-proxies.test.mjs"
    ],
    "hashes": [
      "ddbbbe49"
    ],
    "versions": [
      "0.1.3001",
      "127.0.0.1",
      "0.1.9"
    ],
    "urls": [
      "http://127.0.0.1:3425/v1/models",
      "http://[user:pass@]host:port"
    ],
    "refs": [
      "PR #9"
    ],
    "ports": [
      "127.0.0.1:3425"
    ],
    "envs": [
      "BYTES_IDENTICAL"
    ],
    "literals": [
      "providers.json.providers[].proxy",
      "accountProxies",
      "C:/ProgramData/clash-verge-service/users/ddbbbe49.../logs/service_latest.log",
      "[TCP] 127.0.0.1:<port> --> <host>:443 using <节点>",
      "using R1-1",
      "~/.config/magpie/providers.json",
      "providers[].accountProxies",
      "{ \"<账号user名的小写>\": \"<url>\" | \"direct\" }",
      "accountProxyPicker",
      "l.user.toLowerCase()",
      "accountProxiesOfDraft()",
      "client",
      "auth.set/remove",
      "tui.showToast",
      "app.log",
      "config.get",
      "/api/provider/save",
      "/v1/*",
      "/mcp/*",
      "providers.json",
      "groups[].name",
      "llama-local.name",
      "curl http://127.0.0.1:3425/v1/models",
      "magpie_label",
      "BYTES_IDENTICAL",
      "lib/account-proxies.mjs",
      "accountProxyKey(user)",
      "proxyUrlFor(record)",
      "{type,host,port,username,password}",
      "{url}",
      "http://[user:pass@]host:port",
      "__proto__"
    ]
  },
  "state": {
    "active": true,
    "claim_count": 6,
    "open_count": 2,
    "source_bytes": 2872,
    "format": "cindy.memory.v1",
    "operative_layer": "machine",
    "archive_contains_verbatim_prose": true
  },
  "open": [
    "- 启动时 `lib/server.mjs` 跑 `backfillAccountProxies`（只补缺失 key，不覆盖手工设置），修好以前登录的账号；返回的 service 有 `.backfill()` 供测试等待。",
    "未决/已知限制：Windows rename 覆盖偶发 EPERM 时先 rm 再 rename（短暂空档）；providers.json 还有别的写者（magpie 自身、DSH）理论上可交错；插件不写 magpie 其它配置。"
  ],
  "source": {
    "updatedAt": "2026-11-05T01:08:57.704Z",
    "migratedAt": "2026-11-05T01:10:14.889Z",
    "directive": "m01170"
  },
  "raw": {
    "title": "clean-login 账号代理同步：magpie accountProxies 怎么写、以及 providers.json 会热重载（0.1.9）",
    "description": "clean-login 把登录出口写进 magpie 的 accountProxies（0.1.9, PR #9）：providers.json 格式与 key 规则、client 无可写 API、magpie 按 stat 热重载（探针可验证）",
    "body": "现象与根因（2026-11-05，magpie 0.1.3001）：插件登录时浏览器确实走选定出口，但登录后 magpie 的常规流量（quota/API）回退到供应商级 `providers.json.providers[].proxy`，因为 minimax-code 没有 `accountProxies`。clash 内核日志（`C:/ProgramData/clash-verge-service/users/ddbbbe49.../logs/service_latest.log`）每行 `[TCP] 127.0.0.1:<port> --> <host>:443 using <节点>` 可验证：登录时用 R2-5/D1-3，之后全部 `using R1-1`。\n\nmagpie 的账号代理机制（二进制内嵌 UI JS 原文）：\n- 持久化在 `~/.config/magpie/providers.json` 的 `providers[].accountProxies`，格式 `{ \"<账号user名的小写>\": \"<url>\" | \"direct\" }`（`accountProxyPicker` 用 `l.user.toLowerCase()`，`accountProxiesOfDraft()` 写 URL 文本）。\n- 插件宿主 `client` 只暴露 `auth.set/remove`、`tui.showToast`、`app.log`、`config.get`，没有写 provider 配置的 API；插件页面被 frame 沙箱隔离，不能 POST `/api/provider/save`；magpie 网关 3425 只暴露 `/v1/*` 与 `/mcp/*`。**所以只有直接改 providers.json 一条路。**\n\n热重载（已实测，不是推测）：magpie 用 filememo/fsnotify 按文件 stat 失效缓存，外部原子替换 `providers.json` 后**不需要重启**。零网络可逆探针：临时改 `groups[].name` 或 `llama-local.name` → `curl http://127.0.0.1:3425/v1/models` 的 `magpie_label` 立即变 → 恢复原字节并确认 `BYTES_IDENTICAL`。\n\n实现（clean-login main 0.1.9，PR #9）：新增 `lib/account-proxies.mjs`\n- `accountProxyKey(user)` = 小写 user 名；`proxyUrlFor(record)` 由 `{type,host,port,username,password}` 或 `{url}` 拼 `http://[user:pass@]host:port`（凭据 encodeURIComponent，IPv6 加方括号）；拒绝 `__proto__`/`constructor`/`prototype`。\n- `writeAccountProxies({env, entries, onlyMissing})`：读 `magpieConfigDir(env)/providers.json`、原子写（temp `wx` 0o600 + rename）、保留其它 provider 与手工项；文件缺失/非法 JSON 只返回 `{ok:false,reason}`，绝不\"修复\"。\n- 登录成功（`lib/signin-flow.mjs` 的 `runCallback`，写完凭据和台账之后）调 `syncAccountProxy` 覆盖该账号自己的 key；`createSignInFlow` 的 `syncAccountProxy` **默认是空操作**（防止只覆盖部分 env 的测试去解析真实配置目录），真实实现在 `lib/server.mjs` 里注入。\n- 启动时 `lib/server.mjs` 跑 `backfillAccountProxies`（只补缺失 key，不覆盖手工设置），修好以前登录的账号；返回的 service 有 `.backfill()` 供测试等待。\n- 测试 `test/account-proxies.test.mjs`（8 个）+ 全量 `bun test` 555 pass/0 fail。\n\n未决/已知限制：Windows rename 覆盖偶发 EPERM 时先 rm 再 rename（短暂空档）；providers.json 还有别的写者（magpie 自身、DSH）理论上可交错；插件不写 magpie 其它配置。\n"
  }
}
