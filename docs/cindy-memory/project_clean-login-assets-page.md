---
title: 'clean-login 资产页（PR #72 → #75，0.1.96 → 0.1.99）'
description: clean-login 第 5 个 tab 资产页（PR #72，0.1.96→0.1.99）：只登记账号与备注不采凭据；账号上限 254 单一来源（PR #75）
type: project
updatedAt: '2026-11-09T23:42:46.975Z'
---
# clean-login 资产页（PR #72，0.1.96；PR #74/#75 补上限，0.1.98/0.1.99）

## 需求与定版
- User said（四号机逐字转达主人原话）：「干净登录增加一个新的页面:资产页」「暂时的功能是让用户自己登记(谷歌邮件服务,微软邮件服务,境内手机号,苹果账号)」。
- 已上线为**第 5 个平级 tab**（Providers / Proxy IPs / Accounts / Assets / Guide）。**只登记账号本体与备注，不采集任何密码、密钥或 token**——这是本页的红线。

## 实现位置
- 后端：`lib/asset-registry.mjs`（新，`assets.json` 存储 + 校验 + 原子写）、`lib/server.mjs`（`GET|POST /api/assets`、`GET|PATCH|DELETE /api/assets/:id`）。
- 前端：`ui/asset-view.js`（新，纯逻辑：`ASSET_TYPES`/`normalizeAssetAccount`/`validateAssetForm`/`filterAssets`/`formatAssetTime`）、`ui/index.html`（tab/panel/表格/两个 dialog）、`ui/style.css`（`/* --- assets page --- */`，复用 `.tbl`/`.dialog`，≤940px 走 `data-label` 卡片回退）、`app.js`（四语言 messages + 接线）。
- 测试：`test/assets-routes.test.mjs`(16)、`test/asset-view.test.mjs`、`test/assets-page-ui.test.mjs`；同步 `test/button-ids.mjs`(+9)、`test/ui-editorial-design.test.mjs` 附录 A、`test/server.test.mjs` 静态模块白名单、`test/brand-mark.test.mjs` 空态标记 3→4。

## 不变式（改动此页必须保持）
- 存储字段只有 `{id,type,account,note,createdAt,updatedAt}`；`publicAsset` 只回这些；响应与落盘文件都不得出现临时目录路径或任何凭据字段。
- `ASSET_TYPES = ["google-mail","microsoft-mail","cn-phone","apple-id"]`；邮箱 `^[^\s@]+@[^\s@]+\.[^\s@]+$`；手机号去空格/连字符后 `^1[3-9]\d{9}$` 并存 11 位裸号。
- PATCH 同时改 type 与 account 时，服务端必须用合并后的 `finalType` 重跑 `normalizeAssetAccount`（换类型必重验）。
- 读入用 `validateCreate` 复验，非法条目丢弃而非整表失败。
- 全部走 `textContent`，无 `innerHTML`、无远程资源；页面仍只有 1 个 `<details>`。

## 账号上限对齐（PR #74，0.1.98 / e36f669）
- 原不一致已修：`#asset-account` 的 `maxlength` 由 320 改为 **254**，`ui/asset-view.js` 与 `lib/asset-registry.mjs` 各导出 `ASSET_ACCOUNT_MAX = 254`，页面校验在归一化后拦超长。
- 破坏性验证：去掉页面那条长度拦截 → `test/asset-view.test.mjs` 变红（1 fail）；恢复后 17 pass。
- 遗留加固点（**PR #75 / 0.1.99 已修**）：`lib/asset-registry.mjs` 的 `LIMITS.account` 原先还是字面量 254，改它不会被测试发现；现已改成 `account: ASSET_ACCOUNT_MAX`，并给 `test/assets-routes.test.mjs` 加了一条用字面量 254 的线上边界测试（254→201、255→400 `invalid_account`）。破坏性验证：把 `ASSET_ACCOUNT_MAX` 单独改成 300 → 线上边界用例与 `the add/edit dialog…ship every control` 同时变红，还原后 34/0。
- **单一来源三点**（0.1.99 起）：`ASSET_ACCOUNT_MAX = 254`（`lib/asset-registry.mjs` 导出，`LIMITS.account` 引用它）；`ui/index.html` 的 `#asset-account` `maxlength="254"`；`ui/asset-view.js` 的 `ASSET_ACCOUNT_MAX`。改上限只应改 `lib/asset-registry.mjs` 一处再同步页面两处，测试会拦住漂移。

## 发版记录
- 0.1.96：PR #72 合并点，合并提交 `0b318a1`，tag `v0.1.96`；main 全量 1108/0/11208/83。
- 0.1.98：PR #74（账号上限对齐 254）合并点，合并提交 `e36f669`，tag `v0.1.98`；main 全量 1112/0/11236/83。
- 0.1.99：PR #75（上限单一来源 `LIMITS.account → ASSET_ACCOUNT_MAX` + 线上边界测试）合并点，合并提交 `981d649`，tag `v0.1.99`；main 全量 1113/0/11244/83。
