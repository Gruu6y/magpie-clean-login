---
title: 'clean-login 供应商页 magpie 品牌标（PR #48 + #50 已上线，main 0.1.78）'
description: 'clean-login PR #48/#50 均已合并发版，main 0.1.78；含 embed 表提取正解、NOTICES 措辞与双向复验结论'
type: project
updatedAt: '2026-11-07T20:52:14.497Z'
---
# clean-login 供应商页 magpie 品牌标（#48 + #50 均已上线，main 0.1.78）

## 来源
主人原话：「现在供应商页面,没有给供应商安排logo啊,直接从magpie里拿就行」；后续「为什么有漏拿的,看看还有没有同类问题」（附 magpie 自己的 Loomy 卡片截图）。三号机实现，初号机合并发版。

## 机制
- `lib/provider-icons.mjs`：`ICON_URL_BASE="assets/icons/"`、`USER_ICON_URL_BASE="provider-icon/"`、`USER_ICON_NAME=/^[0-9a-f]{16}\.(?:png|jpg|jpeg|webp|svg)$/`；`loadIconManifest`/`resetIconManifest`/`readIconRefs`（按 size+mtime 重读 `<cache>/magpie/providers-state.json`，presets→plugins→providers→agents 最近优先，跳过 `generic`）/`slugId`/`iconNameCandidates`（丢后缀须 ≥4 字符，防借别人的标）/`userIcon`（realpath 不等于自身即拒符号链接）/`providerLogo`/`userIconType`。下载图标目录是 **config** 侧 `join(magpieConfigDir(env),"icons")`（`lib/provider-icons.mjs:176`），**不是 cache 侧**。
- `lib/server.mjs`：`withLogos(providers)` 注入 `/api/state`、`/api/providers`、`/api/provider-sources`（三处必须一致，否则 `test/server.test.mjs:141` 的 toEqual 会红）；`/provider-icon/<hash>.<ext>` 路由在 **token 门之前、allowedHosts 门之后**（`<img>` 带不了 header），只认 hash 名 + nosniff + no-referrer + max-age=86400。
- `ui/app.js`：`providerLogoElement(logo,{onError})` —— picture 用 `<img>`，mark 用 mask + currentColor；加载失败回退字母块，绝不空块。`ui/style.css`：`.provider-mark.has-logo`、`.provider-logo`、`.provider-logo.glyph`。
- `scripts/build-icons.mjs`：`PNG_ICONS` 13 项；`logoKind(name, body)` = `-color` 或 pngIcons 或 body 无 `currentColor` → picture，否则 mark；`readBinary` 读 Go build info 的 `vcs.revision`/`vcs.time` 并要求二进制含每个 `assets/icons/<file>` 全名；`--reclassify` 就地重算 kind 与 source；`NOTICES` 已 export 供测试比对。

## 出处核对法（别再写没核对的路径）
- 本机无 magpie 源码树。`magpie.exe`（`C:/Users/Administrator/AppData/Local/Programs/magpie/magpie.exe`，83,864,064 B）里 `internal/gui/assets/icons` 与 `internal/gui/assets` **absent**，`assets/icons/` 命中 **197 次** → source.path 只能写 `assets/icons`。
- 真值：`vcs.revision=710f0290cced5354fb8b673d2bbe5b40b7e7d863`、`vcs.time=2026-11-07T15:27:42Z`、FileVersion/ProductVersion=`0.1.3260`。我曾编造 `08d7bfa` 与 Go 包路径，已删改；初号机独立复核认同。

## 漏拿 2 个的真根因与正解（#50）
- 二进制里 **195** 个图标名，#48 只 vendor 193，漏 `liveagent-color.svg`（svg 包 base64 PNG，6928 B）与 `openmausbot.svg`（clipPath tile，7169 B）。根因＝按内容猜边界（扫 `<svg…</svg>`/PNG 签名）静默丢弃、零报错。
- 正解：解析 PE（`0x3c`→PE、`pe+6` 节数、`pe+20` 可选头、magic 0x20b 时 imageBase 在 `opt+24`），按 Go `embed.FS` 记录 `[namePtr][nameLen][dataPtr][dataLen]` 取字节。`readEmbeddedIcons(path, folder)`（名字有记录读不出即抛错）+ `extract({binary,out,path,version})`（写盘数量≠读取数量即抛错），CLI `--extract`。195/195 成功，193 个老文件逐字节复现，货架 593,989 B。
- 死路别再试：blob 类型序列对齐名字序列（0 候选）、用邻居文件字节夹间隙（负数，数据区乱序）、按 sha 找缺失 blob（46 假阳性，blob 检测丢了尾部 `\n`）。
- **index.json 的 icons 键是不带扩展名的名字**（`liveagent-color`、`openmausbot`），用带 `.svg` 的键去查会误判「文件没上线」。

## 终态（两条都已上线）
- **#48**：merge `e0e1adb5af9b3a39c633d4ba051c979da1c5f368` tag **v0.1.73** → 发布 `83446b677d0900749b8ce64f1710a61ecd469db1` tag **v0.1.74**；203 files；193 图标。初号机因中途合 #47（README 中英分离）遇真冲突，rebase 到 `387e4ed` 后把我的 bullet 译成中文放「日常使用」、英文补进 `README.en.md`，head `7cfec35`；图标字节一字未动。
- **#50**：merge **`011374c1a3705ece360bd66ba1884313e86b03c8`** tag **v0.1.77** → 发布 **`c314b9e19ae38c26a3730225884d76e6b6825c63`**「0.1.78: release」tag **v0.1.78**，**main = 0.1.78**。中间提交 `cbdc408`（icon-embed，标题 v0.1.77）。分支 `cindy-xh2xyp/icon-embed-table` 已删。三号机独立复验：main 版本 0.1.78、两个 tag 解引用正确、PR state=MERGED（mergedAt 2026-11-07T20:45:43Z）、发布提交 CI test+version-bump 双 success、货架 count=195/195 键、两个漏拿文件都在 main、全量 **864 pass / 0 fail / 8127 expect / 71 files**（与初号机两次跑同数）。
- **NOTICES 措辞**：主人拍板改 `Displaying a mark must stay inside the terms…`（只表达要求，不声称已合规）。同步改生成常量并加断言「含 must stay / 不含旧写法 / 文件与常量逐字相等」；破坏性验证改回旧写法即 1 fail。提交 `1e00514`。初号机复核认同，认为比它的建议更稳。
- 初号机额外做的破坏性验证：移走 `openmausbot.svg` → 2 fail；把真 magpie.exe 副本里该条 embed 记录的 data 长度写 0 → `readEmbeddedIcons` 抛 `1 of 195 icon(s) have no readable embed record: openmausbot.svg`。护栏在真二进制上也拦得住。
- 初号机采纳我的 bump 理由：门禁 RELEASE_PATTERNS 只看 lib/ui/page/index.mjs，assets 是覆盖盲区，但不 bump 新图标到不了已安装插件。它没让我改门禁。

## 预览与真实覆盖
`workspace/tmp/preview-provider-logos.mjs`：真 startServer + playwright-core 驱动本机 Chrome，用 magpie launcher 的 `#providers=<urlencode({v:1,ok:true,value:[ids]})>`；`here` 用 `fileURLToPath(new URL(".",import.meta.url))`（`import.meta.dir` 是 Bun-only）。**曾把 MAGPIE_CONFIG_DIR 指向空临时目录，导致 Loomy 落回字母并被我误报成产品缺陷**；已改为只读复制真实 `~/.config/magpie/icons`（279 文件）。修后 17 卡 / 16 有标 / 0 加载失败；真实环境 91 refs **91/91 全部解析**。剩 `yeta`（magpie 标 generic）与 `llama-local`（magpie 没给 icon）保持字母块＝与 magpie 一致。

## 教训
- **push 完立刻读 PR head 会读到旧 sha**：轮询 `GET /pulls/N` 直到 head.sha 等于本地 head 再断言。
- 报测试数前必须 `bun install`；「既有红灯」这个说法我错了三次（详见 reference_clean-login-test-baseline）。
- gh 要整体引号 `GH="/c/Program Files/GitHub CLI/gh.exe"`；`node -e` 顶层 await 要 `--input-type=module`；sed 改含 markdown 表格的 body 会因 `|` 冲突失败，改用 edit 工具。
- 连发 2 条 `send_to_agent` 后第三条会被宿主 `WAIT_FOR_PEER` 拦下，不要换工具重试。

## 后续（不归我）
初号机自己的 PR #51「feat(ui): a fourth tab that teaches the plugin to a first-time user」（`cindy-default/user-guide-tab`，head `83db923`，11 files +894/−9）申报 0.1.78 已被占用，会撞版本门禁 order===0，它自己 rebase 到 `c314b9e` 后 bump 0.1.79。我不用管。
