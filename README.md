<div align="center">

# everyone-content

<img src="frontend/public/brand/mascot.png" alt="everyone-content的小电视角色" width="96" />

**本地优先的多账号内容运营工作台**：用抖音指数发现选题素材，用账号画像约束决策，更快速、更高质量完成「采集 → 选题 → 评估 → 写作」的全过程。

[![License: AGPL v3](https://img.shields.io/badge/license-AGPLv3-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-green)
![Local-first](https://img.shields.io/badge/data-local--first-orange)
[![CI](https://github.com/gallagherjas/everyone-content/actions/workflows/ci.yml/badge.svg)](https://github.com/gallagherjas/everyone-content/actions/workflows/ci.yml)

简体中文 | [English](README_EN.md)

</div>


## 它解决什么问题

做多账号内容的人通常面对三件散落的事：选题靠刷推荐流碰运气、账号定位和目标人群停留在脑子里、选题依据和数据对不上号。everyone-content 把它们收进一个本地系统：

- **采集有事实**：按账号配置关键词和筛选规则，从抖音指数取得话题、关键词视频与达人榜，以真实数据驱动选题，避免选题全靠猜、灵感全靠想。
- **决策有画像**：每个账号维护七部分画像（定位、人设、人群、转化、策略、形式、边界），评估选题时逐项对照，让选题更符合帐号定位与目标。
- **写作依你的风格**：需要先至少收集3篇、至少300字你自己写的稿子，并依据你的写作喜好来生成文本，还能不断通过你写的文稿持续更新。强制是为了更好的稿子，让文风越来越像你，避免充满ai味。

tips：不让agent选题的原因是它太注重历史数据并且缺乏创意，所以本项目不进行选题，仅进行评估。我们也希望你成为一个富有创造力的人，而有些创意可以是受他人启发的，但坚决不要只相信ai！！

## 快速开始

需要 **Node.js 24+**、**Git** 和一个能读取项目指令与本地Skill的Agent（Codex、Claude Code 等）。支持 macOS、Linux 与 Windows（CI 在两个平台运行）；指数扫码登录需要本机图形桌面。

```sh
git clone https://github.com/gallagherjas/everyone-content.git
cd everyone-content
npm ci
npm --prefix frontend ci
npm run build:web
npm run web
```

打开 http://127.0.0.1:8788，可以在工作台输入名称创建账号。端口被占用时用 `WEB_PORT=8789 npm run web`。

在项目目录打开 Agent 对话，可以这样提问。

- 帮我启动项目并介绍一下怎么用。

## 核心流程

1. **初始化**。创建或选择账号，完善并生效画像，连接抖音指数，再保存关键词和筛选规则。
2. **采集**。在「采集 → 发现结果」运行一轮，也可以让 Agent 为指定账号执行采集，或在采集设置中开启定时采集。
3. **自行选题**。在「采集 → 入选视频」浏览结果，打开原平台观看后自行决定选题。
4. **Agent 评估**。画像完整并生效后，在对话中提交**标题、目标群体、主要价值（一句话）**，检查账号匹配、信息一致性和表达是否具体，可附参考作品。
5. **按需写作**。写稿、改稿前必须提供本人 3 篇视频原稿，正文合计至少 300 字。

## 多账号

项目可同时维护多个账号，每个账号的画像、采集规则等按账号分别维护，新账号从空白开始。

## 隐私与数据边界

- 所有数据保存在本机：SQLite数据库、运行资料、画像Git仓库，不连接任何第三方服务。
- `.env`、登录会话与授权文件属于密钥材料，权限0600，不提交Git、不回显到前端。
- 写作偏好与原稿按账号保存在本机`runtime/writing/`（0600），设篇数与字数上限。
- 评估与稿件在对话中交付，工作台没有登记入口。
- 界面时间按北京时间解释，数据库时间使用UTC。

**使用边界**：本项目仅用于数据收集和灵感获取，拒绝抄袭、模仿行为。采集到的话题、视频与达人数据只作为选题的事实参考，创作请保持独立与原创。

**免责声明**：本项目通过官方登录窗口连接抖音指数，仅供个人对自有账号的内容研究使用。使用者应自行遵守平台服务条款与当地法律；内置的每日限额和限速应保持启用。作者不对使用方式承担责任。

## 参与贡献

改动后运行与范围相称的验证：`npm test`（回归）、`npm run typecheck`、`npm run build:web`（前端）。Skill正文唯一维护在`skills/`，`.agents/skills/`为同步副本（测试校验一致）。数据库时间UTC、界面时间北京时间，新增字段保持「未知即null」。提交PR前请保持测试全绿。

## 许可证

[AGPL-3.0](LICENSE)。基于本项目提供服务或修改分发需按许可证开源。
