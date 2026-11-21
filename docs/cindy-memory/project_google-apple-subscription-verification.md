---
title: Google app 订阅归属判定（苹果组 vs 谷歌管理）：判据与实测进展
description: >-
  aibo 在查 Google app 订阅菜单是苹果组内订阅还是谷歌管理：判据=能否看到 see all plans；实测三个月 lite 仍看不到；用
  libimobiledevice 实测，暂停待备机
type: project
updatedAt: '2026-11-21T20:00:00.000Z'
---
## 目标（aibo，2026-11-11 提出）
判断 Google app / Google One 下发的订阅菜单里，某项订阅是「苹果 App Store 组内订阅」还是「谷歌管理的订阅」。

## 判据（aibo 给的）
- 页面能看到 **see all plans** → 苹果组内订阅（可在 App Store 里改计划）。
- 看不到 see all plans → 谷歌管理的订阅（无法在 App Store 调整计划）。

## aibo 的模型
Google 会看账号权重：权重高→允许直接下苹果组内订阅（页面是谷歌原生页，不用按两下侧边按钮）；权重低→分配一个谷歌管理的订阅。到原生订阅页前会过一遍后端，决定前端展示的套餐归属。

## 实测（2026-11-11）
- aibo 自己的 Google 账号订到了「三个月 lite」，但**仍看不到 see all plans** → 三个月 lite 不是关键因素。
- 用 libimobiledevice 连机实测到订阅确认页（图2），该账号无 see all plan；点了「获取折扣」；随后 aibo 决定先不抓包。

## 状态与下一步
- 暂停于 2026-11-11 05:31。aibo 明确**不用巨魔商店**；准备一台设备后用 libimobiledevice 实测。
- 抓包/数据线工具在初号机工作区。运行中逆向看不到归属结论，需静态或抓包。

## 土区 ₺2,949.99 20x bug 价（2026-11-21 查证，已死）
- 同一 Google AI Ultra 30TB（20x）SKU 在土耳其区 App Store 曾同时挂 ₺2,949.99 与 ₺8,999.99 两档；iOS 内购命中低价档，不越狱、不改机。美区同档 $199.99/月。
- 教程路径：土区 Apple ID（新号"养"约 3 天防风控）→ 礼品卡充值 → iOS Google App 设置里先订一档低价 Google One → iPhone 设置→Apple 账号→订阅→See All Plans 才刷出 ₺2,949.99 20x。首发教程 2026-11-04（x.com/lengs4189）。
- **2026-11-15 已拉闸**，X 上多方确认旧价已撤。窗口已过，勿再按教程冲。
- 关联国家漂移坑另见 `project_google-antigravity-tos-ban-and-recovery.md`：买土区订阅救不了被改判中国的 Antigravity 账号（eligibility 看永久关联国家，不看商店区）。

## 云 iOS 机（快云游 kyy-web-desk）能力边界（2026-11-21 实测）
- 用户拿到一台越狱云 iPhone（iOS 16），桌面**没有 Sileo/Cydia**，只有「爱思极速版」。
- 爱思极速版 deb 下载要审核，不能当安装通道；App Store/TestFlight 只能装签名 App，装不了 deb/frida-server/NewTerm；iSH/a-Shell 无 root 无跨进程；Stream 类抓包对 StoreKit 证书固定无效。
- **结论：快云游云机仅暴露界面（无 SSH/端口映射/越狱镜像自定义），无注入通道**。要 Frida 必须服务商提供 SSH 或换平台；桌面无 Cydia 的快云游默认镜像可视为不可注入。
- 用户删了 kyy-web-desk 后排查：快云游本体进程/服务/自启/计划任务全清，无后门残留；唯一残留是自动更新器下的 installer.exe（未签名 81MB，建议删）。
