# everyone-content 架构

## 项目结构

```text
everyone-content/
├── frontend/                 React 工作台，使用 Vite 构建
│   ├── src/                   应用入口、账号切换、API 请求与全局样式
│   │   ├── pages/             数据监控、指数采集、设置三个页面
│   │   └── components/        画像编辑、采集设置、页面缓存和共用组件
│   ├── public/                品牌与静态资源
│   └── dist/                  构建生成的前端产物
├── server/                   Node.js 本地服务，提供 API 和前端产物
├── bin/                      采集命令启动入口
├── collector/                采集程序
│   ├── core/                  任务规划、执行、存储和结果整理
│   └── sources/
│       └── douyin-index/      抖音指数协议、客户端和授权读取
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
  → runner：领取任务、检查每日采集次数上限并请求抖音指数
  → store：保存请求记录、原始响应和解析数据
  → projection：根据本账号的采集记录生成发现结果及指标
  → 本地 API → 工作台
```

工作台手动采集和定时采集共用子进程入口与全局互斥锁。服务每 30 秒检查定时任务，在 `collection_schedule_runs` 中按账号、来源和时点记录已启动的任务，避免重复执行。[定时调度](../lib/collection-scheduler.ts)

原始响应与解析数据压缩保存于 `runtime/collection/objects/`，SQLite 记录文件路径和 SHA256，并保存作品、作者、话题及指标观测。采集时间、来源有效日期和统计窗口分别记录。未知指标保留 `null`，平台 ID 以字符串保存。数据库时间以 UTC 空格格式存储，界面按北京时间显示。

发现结果由各关键词搜索的视频合并生成。达人指数按入选视频作者的近7天指数归类统计。[结果生成](../collector/core/discovery.ts) · [采集配置和筛选](../skills/collection/references/COLLECTION.md)

## 账号隔离与画像版本

服务从请求头确定当前账号，按 `account_id` 核对对象归属。采集任务使用 `account:<编号>` 区分授权范围。

画像正文通过 Git 引用 `refs/everyone-content/profiles/<account_id>` 版本化，SQLite 保存生效版本指针和审计记录。草稿位于 `runtime/drafts/<account_id>/`，生效快照位于 `runtime/releases/<sha>/`。[画像版本实现](../lib/strategies.ts)

`account_initialization` 缓存画像完整性，绑定生效版本和章节规则版本。`GET /api/context` 的 `initialized` 对应所请求画像版本的完整性。`GET /api/initialization` 为每个账号保留 `initialized`、`missing_sections` 和 `index_auth_configured`，并从 SQLite 中的账号、画像、授权登记、有效关键词和已保存的筛选规则推导 `setup.complete` 与 `setup.missing`。采集验证使用采集记录和登录状态。[状态实现](../lib/initialization.ts)

账号操作和备份见[账号与画像](../skills/account-profile/references/MULTI_ACCOUNT.md)。
