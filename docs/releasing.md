# 发版与合并：一条串行队列

这是**合并和发版的运行手册**，给合并方和各贡献线看。

它解决的是一类真实事故：多条工作线同时向 `main` 提 PR，每条都自己猜下一个版本号，
`main` 一动，在途分支就撞号，于是被迫反复 rebase、反复让号。治本只有一条：
**版本号只在一个地方分配，分配的人是合并方，分配的时刻是合并点。**

## 谁做什么

| 角色 | 做什么 | 不做什么 |
| --- | --- | --- |
| 贡献线 | 改代码、带测试；从最新 `main` 开分支；提 PR | **不改 `package.json` 的 `version`**；不为了绿 CI 去 rebase/让号 |
| 合并方 | 串行合并；在合并点分配版本；合并后打 tag；维护发版广播 | 不跳过 CI；不放宽断言 |

贡献线从此不需要知道别人发到几，也不需要预判下一个版本号。

## 一个 PR 只占一格版本

1. 贡献线的 PR **不动 `version`**。`version-bump` 门禁在 `pull_request` 事件下放行
   这种 PR——代码改了、版本没动，是**预期**的。
2. 合并方在 PR 分支上，把 `version` 设为**当前 `main` 版本 +1**，提交并推送。
3. PR 的 CI 重跑并转绿（此时分支带着新版本，且严格大于 `main`）。
4. 合并方合并。本仓库 `main` 保持**线性历史**。
5. 合并方在新 `main` 尖上打 **annotated tag** `v<该版本>`。

一次改动只占一格版本、只打一个 tag。不再有「合并点一次、发布点再一次」的两次 bump。

`scripts/release.mjs` 仍然保留，用于手工/应急发布，常规发版不再经过它。

## 门禁为什么按事件区分

`scripts/check-version-bump.mjs` 现在按事件决定谁负责版本号：

* **`pull_request`**：分支**不需要** bump。若分支确实写了一个版本，**降级**、以及
  **等于 `main` 已发布号**仍然会被拒绝。
* **`push`（`main`）**：**必须**已经带上版本。合并提交里没有新版本号，就说明这次
  合并丢掉了自己的版本，必须在这里拦下，而不是让用户看到一个其实没有更新的合并。

所以第 2 步（合并前在分支上写版本）是必需的：它让**合并提交自带新版本号**，
第 3 步的 CI 只是复核。不带版本硬合并，`main` 上的门禁会红。

## 串行队列与广播

* 同一时刻只让**一个** PR 进入合并；合并并打 tag 之后再处理下一个。
* 有在途 PR 时，合并方先广播「即将发版 + 目标版本号」，让各方在推送前一次性对齐。
* `main` 漂移造成的**机械冲突**由合并方代为解决，贡献方只需保证自己的代码和测试是对的。
* **CI 不砍、不绕。** 等 CI 是必要成本，不是要优化掉的开销。

## 机械冲突的两个来源（已消除）

* `package.json` 的 `version`：现在只有合并方写。
* 55 个按钮 id：以前 `test/server.test.mjs` 和 `test/accounts-page-ui.test.mjs`
  各自内联一份、顺序还不一样，谁加按钮谁撞尾部。现在统一在
  `test/button-ids.mjs`，两处 import 同一个清单。

## 机械段由脚本代跑

`scripts/merge-release.mjs <PR号>` 把上面清单里**纯机械**的步骤串成一条命令：
索取 PR 状态 → 校验它基于最新 `main` → 独立 worktree 检出 → `bun install` →
把 `version` 设为 `main +1` 并提交 → 在最终 head 上跑一次全量 `bun test` →
推分支 → 等 PR CI 双绿 → rebase 合并 → 在新 `main` 尖打 annotated tag 并推送 →
等 `main` push CI → 同步本地 `main`。

```
node scripts/merge-release.mjs 64 --dry-run    # 只打印计划，零副作用
node scripts/merge-release.mjs 64              # 真跑
node scripts/merge-release.mjs 64 --version 0.2.0 --no-tag
```

`GH` 与 `BUN` 环境变量指向可执行文件（Windows 上两者常不在 PATH）；`CL_REPO`
可覆盖仓库 slug。`--keep-worktree` 留着复核现场，`--timeout <秒>` 控制等 CI 的上限。

**只改文档、测试或工具的 PR 不会凭空多一个版本**：脚本读 PR 的变更文件，若没有
`lib/`、`ui/`、`page/`、`index.mjs`（与 `check-version-bump.mjs` 同一套判定），就跳过
bump、分支推送和 tag，只做复核跑测、等 CI、合并。文件列表读不到时**按需要发版处理**，
宁可多占一格也不漏发。`--release` / `--no-release` 可显式覆盖这个判断。

脚本只代跑机械段，**不代替复核**：读 diff、按风险分级决定是否要额外破坏性验证、
以及判断这次改动是否属于该发版的范畴，仍然是合并方的责任。护栏都在
`test/merge-release.test.mjs` 里，且有真实红过的用例：

* 分支落后于 `main`、PR 不是 OPEN/MERGEABLE、有人在你推版本之后又推了提交 → 停；
* 推送被拒（non fast-forward）→ **打印对方的新提交并停，绝不 `--force`**；
* 全量测试或 `bun install` 失败 → 停在推分支之前；
* 合并点提交不只改了 `package.json` 一行 → 停；
* PR CI 不全绿或超时 → 不合并；
* tag 已存在于远端 → 停在打 tag 之前；
* 任何 git 失败都带它发生在哪个阶段，不静默吞掉。
* 判定「这个 PR 要不要发版」的模式与门禁共用一套字面量，有测试盯着两边不漂移。

## 合并方检查清单

- [ ] PR 的 CI 双绿（`test` + `version-bump`）
- [ ] 分支基于最新 `main`；有冲突由合并方解决
- [ ] 在分支上把 `version` 设为 `main` 当前版本 +1，提交并推送
- [ ] 等 CI 再次转绿
- [ ] 合并到 `main`
- [ ] 在 `main` 尖上打 annotated tag `v<version>`
- [ ] 广播：新 `main` 版本 + tag
