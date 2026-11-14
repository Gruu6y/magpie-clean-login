---
title: project.clean-login-update-reload-port-race
description: p=cindy.memory.v1;t=project;kc=17;c=5;v=44;o=0;raw=1
type: project
updatedAt: '2026-11-05T01:49:36.555Z'
---

{
  "protocol": "cindy.memory.v1",
  "id": "project_clean-login-update-reload-port-race",
  "type": "project",
  "keys": [
    "clean",
    "login",
    "update",
    "reload",
    "port",
    "race",
    "lib/server.mjs",
    "index.mjs:16",
    "magpie-bun.exe",
    "listen",
    "loadwait",
    "window.magpie.options",
    "cindy-default/port-in-use-retry",
    "portretryms",
    "test/server-listen-retry.test.mjs",
    "proxy-score-routes",
    "netstat"
  ],
  "claims": [
    {
      "k": "c001",
      "v": "关键事实：Bun 1.4.4 的 EADDRINUSE 错误为 `code: \"EADDRINUSE\"`、`message: \"Failed to start server. Is port <port> in use?\"`（消息来自 Bun，仓库里 grep 不到）；listen 失败后在同一个 server 对象上再次 `listen` 可以成功；magpie 单插件加载上限 20s（`plugin-host/host-*.js` 的 `loadWait`），且不调用插件返回的 close；页面端口来自 `window.magpie.options`（默认 3492）且无备用端口，所以插件侧只能等端口。",
      "kind": "rule"
    },
    {
      "k": "c002",
      "v": "已修复（2026-11-05）：PR #8（分支 `cindy-default/port-in-use-retry`，head acac855）rebase 合入 main，main 版本 0.1.7（release commit f215c8e，tag v0.1.7；0.1.6 也补了 tag → 6c0e4f5）。`lib/server.mjs` 的绑定改为有界重试：新选项 `portRetryMs` 默认 10_000（小于 magpie 20s 上限），只对 EADDRINUSE 重试，其它错误立即抛出，每次重试打 `[clean-login] port <n> is in use; retrying in <ms>ms (attempt <k>)`；新增 `test/server-listen-retry.test.mjs`（窗口内释放端口→绑定成功；全程占用→窗口内有界失败）。回退 lib/server.mjs 到 0.1.5 时这两个用例失败在 server.mjs:922，与生产日志同一行（回归有效性已验证）。",
      "kind": "rule"
    },
    {
      "k": "c003",
      "v": "环境差异（复核时留意）：本机克隆 `bun test` 为 547 pass / 0 fail；初号机在另一克隆/环境跑是 545 pass / 2 fail（`proxy-score-routes` 的 measured-score 与 score-busy-409），原因是那台环境缺评分用的 camoufox runtime，在未改动的 main 上同样失败，CI（ubuntu）里本来就 skip。因此看到这两条失败不要当成回归。",
      "kind": "rule"
    },
    {
      "k": "c004",
      "v": "portRetryMs 从 10000 改为 18000",
      "kind": "decision"
    },
    {
      "k": "c005",
      "v": "旧宿主的关闭时间没有上界",
      "kind": "constraint"
    }
  ],
  "values": {
    "paths": [
      "/clean-login",
      "/server.mjs",
      "/port-in-use-retry",
      "/server-listen-retry.test.mjs",
      "p://127.0.0.1"
    ],
    "hashes": [
      "acac855",
      "f215c8e",
      "6c0e4f5"
    ],
    "versions": [
      "0.1.5",
      "0.1.3",
      "127.0.0.1",
      "1.4.4",
      "0.1.7",
      "v0.1.7",
      "0.1.6"
    ],
    "urls": [
      "http://127.0.0.1:3492/",
      "http://127.0.0.1:3492"
    ],
    "refs": [
      "PR #8"
    ],
    "ports": [
      "127.0.0.1:3492"
    ],
    "envs": [
      "EADDRINUSE",
      "LISTENING"
    ],
    "literals": [
      "plugin github:Gruu6y/clean-login didn't load: Error: Failed to start server. Is port 3492 in use?",
      "lib/server.mjs",
      "index.mjs:16",
      "magpie-bun.exe",
      "code: \"EADDRINUSE\"",
      "message: \"Failed to start server. Is port <port> in use?\"",
      "listen",
      "plugin-host/host-*.js",
      "loadWait",
      "window.magpie.options",
      "cindy-default/port-in-use-retry",
      "portRetryMs",
      "[clean-login] port <n> is in use; retrying in <ms>ms (attempt <k>)",
      "test/server-listen-retry.test.mjs",
      "bun test",
      "proxy-score-routes",
      "didn't load: ... Is port <n> in use?",
      "didn't load",
      "netstat",
      "127.0.0.1:3492 LISTENING",
      "curl http://127.0.0.1:3492/",
      "plugin: [clean-login] listening on http://127.0.0.1:3492",
      "accounts: N kept, ..."
    ]
  },
  "state": {
    "active": true,
    "claim_count": 5,
    "open_count": 0,
    "source_bytes": 3298,
    "format": "cindy.memory.v1",
    "operative_layer": "machine",
    "archive_contains_verbatim_prose": true
  },
  "open": [],
  "source": {
    "updatedAt": "2026-11-05T01:49:36.555Z",
    "migratedAt": "2026-11-05T01:49:36.555Z",
    "directive": "m01170"
  },
  "raw": {
    "title": "clean-login 更新热重载的 3492 端口竞态（EADDRINUSE 加载失败）——已在 0.1.7 修复",
    "description": "区分插件页「拒绝连接」（重载空档，刷新即可）与日志「didn't load」（加载失败）；判活看 netstat 3492 LISTENING + curl 200",
    "body": "现象：magpie 更新 clean-login 后日志出现 `plugin github:Gruu6y/clean-login didn't load: Error: Failed to start server. Is port 3492 in use?`，堆栈落在 `lib/server.mjs` 的 listen（0.1.5 为 server.mjs:922）与 `index.mjs:16`。\n\n根因（2026-11-05 实测）：magpie.exe 在 06:32 下载 0.1.5 并新起子进程 `magpie-bun.exe`（PID 29496，创建时间正好 06:32:27）重载插件；旧插件宿主子进程（自 01:55 起跑着 0.1.3 的服务）当时仍绑定 127.0.0.1:3492，新进程 bind 失败。magpie 同一次加载不重试，把插件记为失败；旧子进程随后退出、端口空出，但插件仍停在失败态。规律：app.log 里同一报错在 2026-11-04 10:49、14:54、23:55 与 11-05 06:32 各出现一次，每次都紧跟一次插件更新，之后都靠下一次整机启动才成功。\n\n关键事实：Bun 1.4.4 的 EADDRINUSE 错误为 `code: \"EADDRINUSE\"`、`message: \"Failed to start server. Is port <port> in use?\"`（消息来自 Bun，仓库里 grep 不到）；listen 失败后在同一个 server 对象上再次 `listen` 可以成功；magpie 单插件加载上限 20s（`plugin-host/host-*.js` 的 `loadWait`），且不调用插件返回的 close；页面端口来自 `window.magpie.options`（默认 3492）且无备用端口，所以插件侧只能等端口。\n\n已修复（2026-11-05）：PR #8（分支 `cindy-default/port-in-use-retry`，head acac855）rebase 合入 main，main 版本 0.1.7（release commit f215c8e，tag v0.1.7；0.1.6 也补了 tag → 6c0e4f5）。`lib/server.mjs` 的绑定改为有界重试：新选项 `portRetryMs` 默认 10_000（小于 magpie 20s 上限），只对 EADDRINUSE 重试，其它错误立即抛出，每次重试打 `[clean-login] port <n> is in use; retrying in <ms>ms (attempt <k>)`；新增 `test/server-listen-retry.test.mjs`（窗口内释放端口→绑定成功；全程占用→窗口内有界失败）。回退 lib/server.mjs 到 0.1.5 时这两个用例失败在 server.mjs:922，与生产日志同一行（回归有效性已验证）。\n\n环境差异（复核时留意）：本机克隆 `bun test` 为 547 pass / 0 fail；初号机在另一克隆/环境跑是 545 pass / 2 fail（`proxy-score-routes` 的 measured-score 与 score-busy-409），原因是那台环境缺评分用的 camoufox runtime，在未改动的 main 上同样失败，CI（ubuntu）里本来就 skip。因此看到这两条失败不要当成回归。\n\n两种症状要分清（2026-11-05 实测补充）：\n- 插件页显示「127.0.0.1 拒绝连接」= 那一刻 3492 没人监听。更新插件时 magpie 换宿主进程（旧进程退出 → 新进程绑定）中间有几秒空档，正好在窗口里打开页面就会看到这个；刷新/重开页面即可，不是故障。\n- 日志出现 `didn't load: ... Is port <n> in use?` = 插件加载失败（0.1.5 及更早的端口竞态）。0.1.7 起这种情况会先打 `[clean-login] port <n> is in use; retrying in <ms>ms (attempt <k>)` 再自己绑上，正常情况下日志里根本不会出现 `didn't load`。\n- 判活只看两样：`netstat` 里 `127.0.0.1:3492 LISTENING`，以及 `curl http://127.0.0.1:3492/` 返回 200；日志里对应行是 `plugin: [clean-login] listening on http://127.0.0.1:3492` 紧跟 `accounts: N kept, ...`。\n===== clean-login.port-retry-window.0.1.11 =====\n实机更新 0.1.9 时旧宿主进程约 11 秒才释放 3492，portRetryMs=10000（0.1.7 起）重试 13 次后在\n\n第 10 秒放弃，差 1 秒触发 didn't load: Is port 3492 in use?；magpie 宿主单插件加载预算是 20 秒（internal/plugin/host.go:1093 pluginLoadWait = 20 * time.Second）。\nPR #10 把 lib/server.mjs 的 portRetryMs 从 10000 改为 18000（分支提交 bade17f3b62460f33a6da7f0d1f2f12499841b5e，rebase 合并后 main 1890b3ccfe1d01973d2267c9a7bb16ccfc566c16），tag v0.1.10 打在合并提交、v0.1.11 打在发版提交 03c9b240ec4f629b980025782e4062fd3828233a，当前 main 版本 0.1.11。\n独立复核：版本门禁 pass（0.1.9→0.1.10），test/server-listen-retry.test.mjs 2 pass / 0 fail，本机全量 553 pass / 2 fail（两个失败是缺 camoufox runtime 的评分用例，在未改动的 main 上同样失败），三次 CI（PR 41950689956、合并后 main 41950894100、发版 41950928906）全 success。\n已知残留：18000ms 只给进程启动与握手留 2000ms 预算，且旧宿主的关闭时间没有上界，更久的关闭仍可能越过窗口；热重载行为未在本机验证以避免写生产配置。\n"
  }
}
