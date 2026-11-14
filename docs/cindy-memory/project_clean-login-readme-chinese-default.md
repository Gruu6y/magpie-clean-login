---
title: 'clean-login README 默认中文、英文可选（PR #47）'
description: >-
  clean-login README 默认简体中文、README.en.md 可选英文（PR #47 已合并，main 387e4ed 仍 0.1.72，含
  5 例语言/链接护栏）
type: project
updatedAt: '2026-11-07T20:04:35.930Z'
---
# clean-login README 默认中文、英文可选（PR #47，2026-11-08 已合并）

## 主人的决定
- 主人原话：「https://github.com/Gruu6y/magpie-clean-login 默认用中文 readme，可选英文为好」，前一轮还说过「我们绝大部分的用户是中文用户」。
- 这是长期口径：**这个仓库的 README 默认简体中文，英文作为可选副本**。

## 落地结构
- `README.md` = 完整简体中文文档（逐节翻译，原先折叠在 `<details>` 里的中文快速开始并入正式「快速开始」一节）。
- `README.en.md` = 原英文正文逐字保留，只把已冗余的中文 `<details>` 换成一行指向 `README.md` 的提示。
- 两份标题都是 `# Magpie Clean Login · 干净登录`，标题正下方各一行语言切换：
  - 中文：`**简体中文** · [English](README.en.md)`
  - 英文：`[简体中文](README.md) · **English**`
- 中文目录用**显式 `<a id="..."></a>` 锚点**（contents/why/requirements/install/quick-start/tabs/features/cli/troubleshooting/privacy/contributing/license），不依赖 GitHub 对 CJK 标题的 slug 规则；英文仍靠 GitHub 自动 ASCII slug。

## 护栏 `test/readme-languages.test.mjs`（5 例 / 86 expect）
钉住会悄悄腐烂的部分：两个语言切换行、共享标题/徽章/三张截图、每条相对链接指向真实文件、每个页内链接落在真实锚点（显式 id 或标题 slug 双支持）、两语言都必须出现的承重数字（Windows x64、1.4.2、170 MB、616 MB、1.02 GB、127.0.0.1:3492、MAGPIE_CLEAN_LOGIN_DATA、MAGPIE_CLEAN_LOGIN_BROWSER_DIR、ip.net.coffee/claude、who.1ms.dog、GET /api/agent、?wait=<ms>）。
- **破坏性验证做过**：分别去掉切换行 / 把链接指向不存在文件 / 重命名一个锚点，每次恰好 1 fail，还原后 5 pass。

## 顺带补齐的行为描述（两份同步）
登录出口下拉的实测延迟与「本供应商未用过优先」、代理测速目标可测到所选供应商 API 主机及其 TLS 握手标注、界面深浅色跟随 magpie 且开着页面切换也立即生效。

## 合并链路
- 分支 `cindy-default/readme-chinese-default`，head `939a01d9d6f1835f739500d159b5bdc34ae53682`，3 files +363/−113。
- PR #47 https://github.com/Gruu6y/magpie-clean-login/pull/47 ，合并点 **`387e4edfc7d1fddc09d34b6f6a971ac543be68fe`**，分支已删。
- head 与合并点 CI 的 `test` + `version-bump` 均 success；全量 `bun test` **817 pass / 0 fail / 5965 expect / 67 files**。
- **不 bump、不发版**：只动 README 与 test/，`check-version-bump` 报 `no release-relevant files changed`，main 版本仍 **0.1.72**。
- GitHub 真实 GFM 渲染器复核（`gh api markdown -X POST --input`，mode=gfm、context=Gruu6y/magpie-clean-login）：切换行渲染成 `<a href="README.en.md">English</a>`，12 个显式锚点全部存活，11 个页内 href 全部命中，3 张截图正常解析。

## 备注
- 本决定取代 PR #30 时「英文正文 + 折叠中文快速开始」的结构；PR #30 的截图流程与事实核对仍然有效。
- 三张截图仍是 PR #30 那三张（未重渲），主人此前明确「停止重新截图，保持现状」。
