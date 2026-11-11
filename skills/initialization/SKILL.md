---
name: initialization
description: 用户要求开始、继续或检查工作台的完整初始化时使用，串联账号、画像和抖音指数采集配置。
---

## 初始化顺序

1. 读取本地 `GET /api/initialization`，确定本次配置的账号。服务未启动时，按项目根目录 README 的「快速开始」处理。用户要求新建或列表为空时，按[账号与画像](../account-profile/SKILL.md)建号。存在多个候选账号时先确认目标。
2. 根据目标账号的 `setup.missing` 补齐缺项。`active_account` 和 `profile` 交给[账号与画像](../account-profile/SKILL.md)，画像可先保存草稿。`index_auth`、`keywords` 和 `collection_config` 交给[采集](../collection/SKILL.md)，扫码等待期间可以先处理其他缺项。
3. 重新读取初始化接口，按 `setup.complete` 汇报该账号的配置结果及剩余缺项，并按[采集](../collection/SKILL.md)说明授权或实采验证状态。用户要求试采时再启动一轮。

## 初始化完成

- 完成条件：至少存在一个账号，且完成账号画像（或者用户声称账号信息已经足够）、抖音指数授权、关键词和采集配置。`GET /api/initialization` 的 `setup.complete` 为 `true`。
- 完成后将AGENTS.md最上方的状态改为“初始化完成”，不再提示用户初始化。
