---
title: Google app 订阅归属判定（苹果组 vs 谷歌管理）：判据与实测进展
description: >-
  aibo 在查 Google app 订阅菜单是苹果组内订阅还是谷歌管理：判据=能否看到 see all plans；实测三个月 lite 仍看不到；用
  libimobiledevice 实测，暂停待备机
type: project
updatedAt: '2026-11-12T19:47:09.337Z'
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
