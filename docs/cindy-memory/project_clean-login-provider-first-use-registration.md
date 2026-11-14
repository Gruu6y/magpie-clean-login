---
title: 'clean-login 供应商首次使用注册与主动移除恢复（PR #63）'
description: 'PR #63 已合并发版 0.1.91（main dbdb7ca，978/0），补充 ensure inline await 的非阻塞观察'
type: project
updatedAt: '2026-11-08T16:39:34.889Z'
---
# clean-login 供应商首次使用注册与主动移除恢复（PR #63，2026-11-09）

- **背景**：在 clean-login 里首次登录的供应商（如 qoder 国际版），凭据正常但 `~/.config/magpie/providers.json` 里只有 `hidden:true` 空壳（无 models/pickedFrom）甚至完全无记录，导致 magpie 主程序/前端将其判定为「未提供 / 已移除」，模型列表和卡片看不到。
- **主人定夺（2026-11-09）**：
  1. 「主动移除过」的在 cl 登录时也一并加回（不再阻断，明确 cl 登录就是使用意图）。
  2. 「完全没有记录」的与「从未完成首次使用」本质相同，只要当前已安装插件扫描能确认该 provider id 存在，同样补 `magpie provider add <id>`。
  3. 仅 `off:true`（显式关停）保持不动。
- **技术实现**：
  - 新增 `lib/provider-registration.mjs`：状态判定（`offered` / `never_offered` / `removed` / `missing` / `switched_off` / `invalid`）；调用 `magpie provider add <id>`（带超时、windowsHide、best-effort、永不抛错）。
  - 登录完成时（`lib/server.mjs:signIn.syncAccountProxy`）：串联 `providerRegistration.ensure(provider)`，结果脱敏后写入 `flow.proxySync.registration`。
  - 启动回填（`lib/server.mjs:runRegistrationBackfill`）：遍历已有账本的 provider，并发逐一补全。
- **发版规矩验证**：
  - 首个完全执行 PR #62（`5ba2bf5`）新规的 PR：PR 分支不改 `package.json` 的 `version`（维持 0.1.90），由初号机在合并点统一分配。
  - PR #63（commit `5e6438c`）：全量 978 pass / 0 fail / 77 files，CI 双绿。


## 2026-11-09 合并发版闭环（初号机回执）
- PR #63 已 rebase 合并：main=`dbdb7ca`；我的功能提交 `5e6438c` 重基为 `93c5c6b`，其上为初号机版本提交 `56b0dc0 → dbdb7ca`。
- 版本由初号机在合并点分配 0.1.90→**0.1.91**，annotated tag `v0.1.91` 打在 main 尖 `dbdb7ca`；分支已删，open PR=0。PR head 与 main CI 均双绿。
- 初号机独立复跑：978 pass / 0 fail / 9963 expect / 77 files / 46.10s；并审阅 id 白名单、execFile 无 shell、best-effort、switched_off、missing 必须有插件证明等边界。
- 非阻塞观察：登录接缝里 `ensure()` inline await，最坏 CLI 30s timeout 会延后 flow settled（不失败，只慢）；未来若主人要求可改异步。生产需 magpie 将插件更新至 0.1.91。
- 初号机自行探针曾致 18 fail/10 errors，已完全还原，与 PR 无关，不作回归记录。
