# everyone-content 架构

## 项目结构

```text
everyone-content/
├── frontend/                 React 工作台，使用 Vite 构建
│   ├── src/                   应用入口、账号管理、API 请求与全局样式
│   │   ├── pages/             数据、指数、博主、采集、帐号五个页面
│   │   └── components/        画像编辑、采集设置、页面缓存和共用组件
│   ├── public/                品牌与静态资源
│   └── dist/                  构建生成的前端产物
├── server/                   Node.js 本地服务，提供 API 和前端产物
├── bin/                      采集命令启动入口
├── collector/                采集程序
│   ├── core/                  任务规划、执行、存储和结果整理
│   └── sources/
│       ├── douyin-index/      抖音指数协议、客户端和授权读取
│       └── platform/          抖音、小红书和 B 站创作后台的会话读取与快照采集
├── lib/                      账号、画像版本、数据库连接、作品与定时调度
├── db/                       SQLite 表结构和迁移
├── skills/                   Agent 执行的业务流程
├── .agents/
│   └── skills/                供 Agent 发现的同步副本
├── prompts/                  账号画像模板
├── runtime/                  本机授权、采集文件、画像草稿与快照
├── docs/                     文档
└── tests/                    API、采集与前端回归测试
```

## 采集数据流

```text
工作台手动采集 / 本地定时调度 / CLI
  → 采集程序
  → planner：按账号配置和授权生成任务
  → runner：领取任务、检查每日采集次数上限并向对应来源发起请求
  → store：保存请求记录、原始响应和解析数据
  → 读取层：按账号生成指数发现结果、博主数据和创作后台指标
  → 本地 API → 工作台
```

工作台手动采集和定时采集共用子进程入口与全局互斥锁。手动采集可按范围独立执行：指数拆为话题域与达友域，平台快照按来源独立，范围在 runner 层统一过滤。服务每 30 秒检查定时任务，在 `collection_schedule_runs` 中按账号、来源和时点记录已启动的任务，避免重复执行。[定时调度](../lib/collection-scheduler.ts)

原始响应与解析数据压缩保存于 `runtime/collection/objects/`，SQLite 记录文件路径和 SHA256，并保存作品、作者、话题及指标观测。采集时间、来源有效日期和统计窗口分别记录。未知指标保留 `null`，平台 ID 以字符串保存。数据库时间以 UTC 空格格式存储，界面按北京时间显示。

发现结果由各关键词搜索的视频合并生成，话题、视频与达人按指数排榜展示：达人取入选视频作者的近30天指数求和为总体，总体÷视频数为平均。博主走达友域（`author_*` 任务）单独采集：昵称搜索定位后每天采集作品榜，日增曲线与资料页按每博主开关追加；作品按抖音 itemId 与关键词域合并为同一作品，官方标记与精确发布时间跨域共享。[结果生成](../collector/core/discovery.ts) · [博主链路](../collector/core/bloggers.ts) · [采集配置](../skills/collection/SKILL.md)

工作台提醒由 `GET /api/notices` 从运行态计算。已连接平台的登录失效会触发顶部横幅和「采集」红点，来源暂停、任务禁用与最近一轮采集失败也计入红点明细。前端用近 30 天入库的博主作品计算未读数，浏览器按账号保存每位博主的已读水位。打开博主详情会将该博主的水位更新到最新一条。[提醒数据](../lib/notices.ts) · [已读状态](../frontend/src/components/Notices.tsx)

## 账号隔离与画像版本

服务从请求头确定当前账号，按 `account_id` 核对对象归属。采集任务使用 `account:<编号>` 区分授权范围。

画像正文通过 Git 引用 `refs/everyone-content/profiles/<account_id>` 版本化，SQLite 保存生效版本指针和审计记录。草稿位于 `runtime/drafts/<account_id>/`，生效快照位于 `runtime/releases/<sha>/`。[画像版本实现](../lib/strategies.ts)

`account_initialization` 缓存画像完整性，绑定生效版本和章节规则版本。`GET /api/context` 的 `initialized` 对应所请求画像版本的完整性。`GET /api/initialization` 为每个账号返回 `initialized`、`missing_sections` 和 `index_auth_configured`，并根据账号是否活动、已生效画像是否完整、抖音指数授权是否登记以及有无有效关键词推导 `setup.complete` 与 `setup.missing`。采集验证使用采集记录和登录状态。[状态实现](../lib/initialization.ts)

账号操作和备份见[账号与画像](../skills/account-profile/references/MULTI_ACCOUNT.md)。
