# 抖音指数采集

## 首次配置

1. 在工作台选定账号，进入「设置 → 采集设置」，点击「扫码连接抖音指数」。在专用浏览器窗口扫码并完成页面验证，工作台会保存该账号的登录会话。
2. 在「设置 → 关键词」添加要采集的词，再到「设置 → 采集设置」保存筛选规则。
3. 进入「采集 → 发现结果」，点击「手动采集」并查看结果。

## 命令行

以下命令以账号 `42` 为例，运行时换成目标账号编号。第一条运行采集，第二条将本轮限制为最多 3 次请求，第三条只在本地规划任务。

```sh
npm run collect -- --account=42
npm run collect -- --account=42 --limit=3
npm run collection:plan -- --account=42
```

省略 `--account` 会选中所有活动账号。使用 `--scheduled` 时，才会按账号的定时开关进一步筛选。

### 私有文件导入

如已持有本人的 Cookie JSON 或 Playwright storageState，可登记已有的私有授权文件。Cookie JSON 使用 `cookie`，可选填 `userAgent`。用实际账号编号和文件路径替换示例，文件权限设为 `0600`，凭据留在私有目录。

```sh
npm run collection:plan -- --account=42 --auth="/你的私有目录/指数授权.json"
```

## 筛选与排查

筛选初值为 30 天话题指数至少 10000、最多 3 个话题、视频至少 100 赞、最多 40 条视频和 5 个达人候选。最多可设 5 个话题，点赞门槛最低为 100。关键词视频和话题关联视频按作品合并，标题或标签命中排除词、点赞数未知的作品不入选。各查询的指数分别排序。仅有昵称的达人候选标为「主页身份待核实」。

- **缺少授权或登录失效。** 在目标账号的「采集设置」中扫码连接或重新登录。保存会话后，访问权限以实际采集结果为准。
- **数据尚未采齐。** 在「发现结果」查看待采集项。额度允许时再次点击「手动采集」，或等下一次定时任务。
- **采齐后没有入选结果。** 核对关键词、排除词和筛选门槛。在「最近采集记录」打开「查看记录」，可检查实际入库数据。
- **采集任务暂停。** 在「采集任务」查看原因。处理登录、限流或连接问题后，可用「恢复」解除暂停。

## 请求上限与定时

指数的每日请求额度由所有账号共享，默认每天 30 次，北京时间 08:00 重置。失败请求也计入额度。请求间隔至少 2 秒，每轮最多 10 次。

在「设置 → 采集设置」开启定时采集，填写 1–24 个北京时间时点，每轮设为 1–10 次请求。定时默认关闭。保持本地服务运行，重启或唤醒时只检查当天最近一个到期时点。

## 本地 API

按[账号与画像](MULTI_ACCOUNT.md#账号操作)确认目标账号。下列请求都带 `x-everyone-content-account: <账号 ID>`。

| 请求 | 用途和参数 |
|---|---|
| `GET /api/index-auth` | 读取当前账号的登录状态。 |
| `POST /api/index-auth/start` 或 `POST /api/index-auth/cancel` | 打开或取消专用登录窗口。请求体留空。 |
| `POST /api/keywords` | 添加关键词，提交 `{"keyword":"要采集的词"}`。 |
| `GET /api/collection/config` 或 `PUT /api/collection/config` | 从 GET 返回的 `config` 读取当前设置。编辑 `config.index.discovery` 或 `config.schedules.index` 后，PUT 请求体的顶层字段用 `index` 或 `schedules`，值为修改后的完整对象。 |
| `POST /api/run/collect` | 手动运行到期任务，请求体留空。 |
| `GET /api/collection` 或 `GET /api/collection/progress` | 读取采集状态及结果，或查询当轮进度。 |
| `GET /api/collection/records/:id` 或 `GET /api/collection/records/:id/raw` | 用采集记录编号读取本次入库数据或原始响应。 |
| `POST /api/collection/resume` | 解除本账号指数任务的暂停，提交 `{"provider":"index"}`。 |

连接失败时，检查本机能否访问抖音指数以及代理设置。程序对 `localhost`、`127.0.0.1` 和 `::1` 使用直连。
