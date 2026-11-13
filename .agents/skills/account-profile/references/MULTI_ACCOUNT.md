# 账号与画像

## 账号操作

工作台在「帐号 → 帐号管理」切换账号，品牌文字下方常显当前账号名。使用 API 时，先用 `GET /api/accounts` 获取账号列表，按用户指定的账号确认目标 `id`。仍有歧义时请用户确认。操作单个账号的请求都要带 `x-everyone-content-account: <账号 ID>`。

| 操作 | 工作台 | 本地 API |
|---|---|---|
| 创建账号 | 帐号 → 帐号管理 → 新建账号；无账号时在中央引导面板创建 | `POST /api/accounts`，提交 `{"name":"账号名称"}`。从响应取得新账号的 `id`。 |
| 归档或恢复账号 | 帐号 → 帐号管理 → 归档账号或恢复账号 | `PUT /api/accounts/:id`，请求体传 `{"status":"archived"}` 或 `{"status":"active"}`。路径和请求头的账号 ID 一致。 |
| 删除账号 | 帐号 → 帐号管理 → 删除 | `DELETE /api/accounts/:id`。级联删除该账号的画像版本、授权、采集源与本地资料。 |
| 恢复历史画像 | 帐号 → 账号画像 → 版本历史 → 恢复此版本 | 从 `GET /api/strategy` 的 `history` 选出目标版本。调用 `POST /api/strategy/rollback`，请求体的 `sha` 填目标版本，`base_sha` 填读取时的当前生效版本 `sha`。 |

- 归档后可查历史，定时采集停止。恢复账号后可继续编辑和采集。
- 「保存草稿」仅保留编辑内容，「保存并生效」更新当前画像。恢复历史画像会生成新的生效版本并保留版本历史。
- 单个账号的画像、采集配置不作为其他账号的默认设置。

## 备份

完整备份包括 SQLite 数据库、画像 Git 历史和 `runtime/` 资料。用 SQLite 的备份命令或 `VACUUM INTO` 复制数据库，在项目根目录运行以下命令导出画像历史：

```sh
git bundle create profiles.bundle '--glob=refs/everyone-content/profiles/*'
```

恢复时使用同一套备份中的数据库、画像历史和 `runtime/` 资料。
