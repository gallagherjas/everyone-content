# everyone-content

<img src="frontend/public/brand/mascot.png" alt="everyone-content的小电视角色" width="96" />

面向多账号的本地内容运营工具。通过抖音指数发现相关话题、视频和达人，将账号画像、关键词、参考博主及采集资料分别管理。

**使用流程：初始化账号 → 配置指数采集 → 浏览视频并自行选题 → Agent评估 → 提供个人写作资料后按需协助写作。**

工作台负责配置和数据展示；初始化、评估及写作在打开本项目的Agent对话中进行。

## 安装与启动

需要Node.js 24以上和Git。用Git克隆项目；如果下载ZIP，解压后先在项目根目录执行`git init`。账号画像使用本地Git保存版本。

在项目根目录运行：

```sh
node --version
npm --prefix frontend ci
npm run build:web
npm run web
```

打开 http://127.0.0.1:8788，确认页面名称为`everyone-content`，使用期间保持服务运行。端口被占用时，可使用`WEB_PORT=8789 npm run web`启动到另一个端口。

项目包含源码、品牌资源、空白资料模板及合成测试用例。首次启动自动创建一个空白「默认账号」；订阅、授权、画像内容、采集结果和发布记录均为空。

## 第一次使用

在Codex中打开本项目根目录，开始对话，例如「我第一次使用，带我设置一下」。Agent会先检查服务和账号，再引导你确认：

- 账号怎么称呼。
- 主要做什么内容。
- 内容主要给谁看。

确认过的画像保存并生效后，才能进入选题评估或写作。也可在「设置 → 账号画像」填写后点击「保存并生效」；「保存草稿」只保留编辑内容。这里的账号是本地内容运营空间，不代表已登录抖音。

三个业务Skill通过`.agents/skills/`发现，正文在`skills/`；项目`AGENTS.md`规定首次初始化和任务路由，用户无需每次点名Skill。其他Agent需要能读取项目指令、本地Skill并访问本机API。首次使用要求由Agent指令约束，页面没有强制初始化向导。

## 配置抖音指数

1. 在「设置 → 博主与关键词」添加想持续关注的关键词。博主关注用于整理指数已经收录的相关作品，不单独请求博主新作。
2. 准备本人的指数登录授权文件，存放在仓库外的私有目录，并将权限设为仅本人可读写。
3. 按明确账号编号登记授权，例如：

```sh
chmod 600 /你的私有目录/指数授权.json
npm run collection:plan -- --account=1 --auth=/你的私有目录/指数授权.json
```

示例中的账号编号和文件路径需要替换成自己的值。授权文件格式见[采集说明](docs/COLLECTION.md)。项目不包含登录凭据，也不会自动导出浏览器登录状态。

4. 在「设置 → 采集设置」配置排除词、指数门槛和保留数量，随后在「采集 → 发现结果」点击「手动采集」。

每日请求上限由各账号共享，每轮最多10次。批次可能分多轮完成，页面会列出未采齐的查询。定时采集默认关闭，可自行设置每日北京时间和单轮请求上限；运行定时任务需要保持本地服务在线。

## 选题与写作

在「采集 → 入选视频」查看结果，打开原平台作品观看后自行选题。在Agent对话中提交**标题、目标群体、主要价值（一句话）**，即可检查账号匹配、信息一致性和表达是否具体，也可附参考作品。

写作前须提供本人的实质写作偏好或原文，任一种即可。模板见[写作偏好](skills/personal-writing/assets/writing-preferences.md)和[用户原文](skills/personal-writing/assets/user-original.md)。写作Skill只按个人资料及本轮要求工作，不内置通用写作套路。

当前评估和稿件在对话中交付，工作台没有评估记录、稿件或个人原文的登记入口；偏好修订不能据此宣称已跨会话保存。

## 已发布作品与参考博主

「已发布」可登记实际发布链接和北京时间。若该作品随后被本账号的指数采集收录，页面展示指数提供的指标；未收录时保持未知，不单独抓取互动数据。

「博主」只展示本账号已关注博主、且身份明确对应的指数入库作品，不保证完整作品列表。未知指标显示为未知，话题指数不代表单条视频播放量。

## 常用命令

```sh
npm run collect -- --account=1
npm run collection:plan -- --account=1
npm run collect -- --account=1 --limit=3
npm test
npm run build:web
```

`collection:plan`只规划本地任务，不请求指数。完整说明见[采集](docs/COLLECTION.md)、[账号与画像](docs/MULTI_ACCOUNT.md)、[架构](docs/ARCHITECTURE.md)和[产品约束](docs/decisions.md)。

数据库默认位于`db/everyone-content.db`，运行资料位于`runtime/`。可通过`EVERYONE_CONTENT_DB_PATH`、`EVERYONE_CONTENT_DATA_DIR`和`EVERYONE_CONTENT_GIT_ROOT`分别配置数据库、资料和画像Git仓库。`.env`、数据库及运行资料均不提交Git。
