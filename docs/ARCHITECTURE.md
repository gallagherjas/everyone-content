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

工作台手动采集、定时采集和日志重试共用子进程入口与全局互斥锁。采集入口按账号和来源检查本地凭证及来源运行状态，runner 按可用来源和采集范围领取任务。话题榜、视频榜和博主追踪共用指数授权和请求额度。服务每 30 秒检查定时任务，在 `collection_schedule_runs` 中按账号、采集范围和时点去重。旧版 `index` 定时按原范围和额度继续执行，新增范围各自默认关闭。[来源检查](../collector/core/availability.ts) · [定时调度](../lib/collection-scheduler.ts)

轮次结果由 runner 汇总各账号的完成、缓存、失败与延后任务，进度接口按轮次编号返回结果状态。创作后台适配器先判定平台返回的授权与业务错误，再提取指标。重新登记凭据清除对应任务的成功标记，由下一次实际请求验证新会话，同日已有快照可继续查看。[轮次结果](../collector/core/status.ts) · [登录状态](../lib/platform-login.ts)

扫码窗口打开登录页前读取浏览器标识，扫码后从浏览器上下文读取会话，兼容平台登录成功后的页面跳转。抖音指数从同一登录上下文读取帐号昵称和抖音号。B 站沿用官方登录页，按创作中心总览请求的 URL 读取会话。总览快照读取粉丝、点赞和视频播放累计值，平台表示未登录时暂停该账号的 B 站任务。[登录窗口](../lib/platform-login.ts) · [快照适配](../collector/sources/platform/snapshot.ts)

任务常规执行窗口、快照版本、趋势分日与每日额度使用同一采集日边界。博主任务按采集日去重，话题和视频按上游有效期去重。日期任务发现新版即重新排队。有效期落后时，同一采集日可额外复查一次，队列继续显示当日成功状态。失败退避与最小请求间隔独立控制请求重试。[采集日](../lib/time.ts) · [执行](../collector/core/runner.ts)

原始响应与解析数据压缩保存于 `runtime/collection/objects/`，SQLite 记录文件路径和 SHA256，并保存作品、作者、话题及指标观测。采集时间、来源有效日期和统计窗口分别记录。未知指标保留 `null`，平台 ID 以字符串保存。数据库时间以 UTC 空格格式存储，界面按北京时间显示。

话题榜和视频榜分别读取满足当前关键词的最新完整有效期。达人由同一期入选视频按作者汇总，近 30 天指数之和为总体，总体除以视频数为平均。博主走达友域（`author_*` 任务），作品按抖音 itemId 与关键词域合并为同一作品，官方标记与精确发布时间跨域共享。服务从博主登记和任务状态推导待处理项，在登记、连接恢复、采集结束和周期检查时继续派发。[有效期投影](../collector/core/projection.ts) · [结果生成](../collector/core/discovery.ts) · [博主链路](../collector/core/bloggers.ts)

工作台提醒由 `GET /api/notices` 按账号从运行态计算。顶栏铃铛在鼠标悬停、触屏点击或键盘激活时展开，显示登录失效、来源暂停、任务停用和最近一轮失败或部分失败，轮询及采集状态刷新时更新。前端用近 30 天入库的博主作品计算未读数，浏览器按账号保存每位博主的已读水位。打开博主详情会将该博主的水位更新到最新一条。[提醒数据](../lib/notices.ts) · [提醒面板与已读状态](../frontend/src/components/Notices.tsx)

## 账号隔离与画像版本

服务从请求头确定当前账号，按 `account_id` 核对对象归属。采集任务和请求缓存使用 `account:<编号>` 区分授权范围。采集凭证根据本次运行的参与账号、来源和授权范围选取。指数榜单和博主历史按 `collection_run_accounts` 中的账号关联读取。

抖音指数复用会话时，多个帐号的凭证绑定引用同一个私有文件，任务范围仍各自独立。会话文件放在独立目录，解除最后一条绑定后清理。共享会话的登录失效和凭证更新同步到引用它的帐号。[指数会话](../lib/index-sessions.ts)

画像正文通过 Git 引用 `refs/everyone-content/profiles/<account_id>` 版本化，SQLite 保存生效版本指针和审计记录。草稿位于 `runtime/drafts/<account_id>/`，生效快照位于 `runtime/releases/<sha>/`。[画像版本实现](../lib/strategies.ts)

`account_initialization` 缓存画像完整性，绑定生效版本和章节规则版本。`GET /api/context` 的 `initialized` 对应所请求画像版本的完整性。`GET /api/initialization` 为每个账号返回 `initialized`、`missing_sections` 和 `index_auth_configured`，并根据账号是否活动、已生效画像是否完整、抖音指数授权是否登记以及有无有效关键词推导 `setup.complete` 与 `setup.missing`。采集验证使用采集记录和登录状态。[状态实现](../lib/initialization.ts)

账号操作和备份见[账号与画像](../skills/account-profile/references/MULTI_ACCOUNT.md)。
