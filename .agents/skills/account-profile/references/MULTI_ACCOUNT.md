# 账号与画像

## 账号操作

工作台通过顶部下拉框切换账号。使用 API 时，先用 `GET /api/accounts` 获取账号列表，按用户指定的账号确认目标 `id`。仍有歧义时请用户确认。操作单个账号的请求都要带 `x-everyone-content-account: <账号 ID>`。

| 操作 | 工作台 | 本地 API |
|---|---|---|
| 创建账号 | 顶部下拉框旁的「＋ 新账号」，首次打开可直接创建 | `POST /api/accounts`，提交 `{"name":"账号名称"}`。从响应取得新账号的 `id`。 |
| 归档或恢复账号 | 设置 → 账号资料 → 归档账号或恢复账号 | `PUT /api/accounts/:id`，请求体传 `{"status":"archived"}` 或 `{"status":"active"}`。路径和请求头的账号 ID 一致。 |
| 恢复历史画像 | 设置 → 账号画像 → 版本历史 → 恢复此版本 | 从 `GET /api/strategy` 的 `history` 选出目标版本。调用 `POST /api/strategy/rollback`，请求体的 `sha` 填目标版本，`base_sha` 填读取时的当前生效版本 `sha`。 |
| 登记已发布作品 | 已发布 → 填写作品链接和实际发布时间 → 登记作品 | `POST /api/contents`，请求体传 `published_url` 和带时区的 `published_at`，如 `2025-01-10T10:00:00+08:00`。 |

- 归档后可查历史，定时采集停止。恢复账号后可继续编辑和采集。
- 「保存草稿」仅保留编辑内容，「保存并生效」更新当前画像。恢复历史画像会生成新的生效版本并保留版本历史。
- 登记仅保存作品链接和时间。作品被当前账号的抖音指数采集收录后，才会显示来源提供的指标。
- 单个账号的画像、采集配置不作为其他账号的默认设置。

## 备份

完整备份包括 SQLite 数据库、画像 Git 历史和 `runtime/` 资料。用 SQLite 的备份命令或 `VACUUM INTO` 复制数据库，在项目根目录运行以下命令导出画像历史：

```sh
git bundle create profiles.bundle '--glob=refs/everyone-content/profiles/*'
```

恢复时使用同一套备份中的数据库、画像历史和 `runtime/` 资料。
