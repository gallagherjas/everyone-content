---
name: account-profile
description: 创建或管理账号，填写、更新或恢复账号画像。也用于登记已发布作品和备份账号资料。
---

# 账号与画像

## 确定账号

按[账号操作](references/MULTI_ACCOUNT.md#账号操作)确认目标账号和 API 请求头。管理账号、恢复版本或登记作品时按其中对应步骤操作。用户要求备份时读[备份](references/MULTI_ACCOUNT.md#备份)。

用户要新建账号时，按[账号操作](references/MULTI_ACCOUNT.md#账号操作)建号，记下返回的 `id`。用户同时要填写画像时，在同一轮按下文展示所需模板。账号名称尚未提供时一并询问。拿到名称即可建号，画像可随后补齐。

## 填写与修改画像

已有账号时，用 `GET /api/strategy` 读取生效画像 `published`、草稿 `draft` 和当前生效版本 `sha`。结合生效画像、草稿和本轮用户提供的信息判断缺项。接口返回的 `missing_sections` 只反映生效画像。

需要收集或修改画像时，读取项目根目录的 `prompts/account-profile.md`，在同一条回复中直接展示模板原文：

- 七个栏目都缺失时，逐字展示整份模板。
- 仅部分栏目缺失时，按模板顺序逐字展示每个缺失栏目。保留栏目标题和下面的完整提示，包括「填写」和「用途」。
- 当用户更新画像信息时，直接按用户表述更新画像对应内容，并告诉用户改了什么。

保持模板原有的 Markdown 格式和措辞。草稿或本轮已填的栏目无需重问。

只记录用户提供或确认的信息，含糊或互相矛盾时继续澄清。账号定位和目标人群须具体，其他部分不适用时由用户明确说明。暂未确定的内容可先保存草稿。

## 保存与完成

将整理后的画像交给用户核对，按用户授权保存。以下请求的 `base_sha` 取读取时的生效版本 `sha`：

- `PUT /api/strategy/draft` 提交 `docs: {"account-profile.md":"完整画像正文"}` 和 `base_sha`。
- `POST /api/strategy/publish` 提交 `base_sha` 和非空的改动说明 `note`，使草稿生效。

遇到 `409` 时重新读取画像版本，核对变更后再保存。发布后检查 `initialization.initialized`，仍有缺项时根据 `initialization.missing_sections` 按上面的规则展示模板栏目。用户希望稍后补充时，说明已保存的版本和待补项。
