# dsh-longtasks

[![ci](https://github.com/whoseJam/dsh-longtasks/actions/workflows/ci.yml/badge.svg)](https://github.com/whoseJam/dsh-longtasks/actions/workflows/ci.yml)

长线任务花名册 —— 让跨天、跨会话的长期任务在 DSH 里有一个固定身份，而不是每天早上重新解释一遍。

## 它解决什么

一个长线任务往往持续若干天：它有自己的目标、进展、卡点、下一步，还有一个「负责它的会话」。
但会话列表是按时间排的，隔天重开电脑以后：找不到那个会话了，只能开新会话让新 AI 重新熟悉任务；
也说不清每个 agent 到底在负责什么。

这个插件把这类任务固定成**一个目录**：

```
~/.dsh/longtasks/tasks/<id>/
├── TASK.md          # 档案：核心思想 + 下一步 + 工作记录（插件维护这几节）
├── issue-ledger.md  # ↓ 以下全部由这个任务自己决定
├── queries/*.sql
└── notes/…
```

两层要分清：

- **brief（核心思想）**：稳定、短。这个任务是什么、为什么做、硬约束是什么。写在 `TASK.md` 里。
- **workspace**：活的工作区。修 bug 的放台账和验证查询，PR 审查的放队列和结论，调研的放假设和实验。
  插件**不解析**这里的内容，也不规定结构——agent 用普通文件工具自己组织。

## 给模型什么

1. **`longtask` 工具**：`create` / `list` / `show` / `update` / `note` / `brief` / `archive` / `delete`。
   `create` 会分配任务目录并返回 workspace 路径；`show` 直接返回 `TASK.md` 原文，
   于是 agent 想怎么改档案结构都行（插件只重写 frontmatter 和「核心思想 / 工作记录」两节）。
2. **系统提示注入**：每个新会话开工时，提示里就带着花名册——状态、核心思想的下一步、workspace 路径，
   标 ★ 的是本会话负责的条目，超 3 天没动的会挂 `⚠️ 已 N 天未更新`。
3. **`/longtask` 命令**：不经过模型也能查和改。

```
/longtask                       列出全部
/longtask note <id> <一行结论>   记一条阶段性结论
/longtask done|waiting|active|archive <id>
/longtask brief <id>            取交接简报（含 workspace 文件清单）
/longtask show <id>             打印 TASK.md 原文
/longtask new <名字>            以当前会话新建
```

## 界面

按 DSH 一方页面（插件管理 / 设置）的排版复刻：居中 960 栏、20px 标题、行式列表，
圆角、字号、状态胶囊全部取 `--dsw-*` token，浅色/深色主题自动跟随。
行悬停才浮出动作；点任务名回到负责它的会话；展开可以看到核心思想、最近记录和 workspace 文件。

![浅色](docs/preview-light.jpg)

![悬停与展开](docs/preview-hover.jpg)

![深色](docs/preview-dark.jpg)

## 安装

```bash
dsh plugin --profile desktop add dsh-longtasks
# 或在 Web 的 Plugins 页搜索包名
```

包本身零依赖、零构建（宿主半侧是 ESM，浏览器半侧是 `window.__ModuleLoader__` 的 classic 脚本）。

手动安装（`dsh plugin add` 会重新解析整个 profile，profile 里若有私有 registry 依赖且凭据过期，它会一并失败）：

```bash
cp -R ~/Desktop/dsh-longtasks ~/.dsh/profiles/desktop/node_modules/dsh-longtasks
# profile/package.json：dependencies 加 "dsh-longtasks": "file:../../Desktop/dsh-longtasks"
#                     dsh.profile.bundles 追加 "dsh-longtasks"
# 然后重启 DSH（宿主半侧只在启动时加载）
```

## 数据与接口

- `~/.dsh/longtasks/tasks/<id>/TASK.md`：档案（frontmatter + 核心思想 + 工作记录），原子写。
- `~/.dsh/longtasks/tasks/<id>/…`：workspace，插件只读不写。
- `~/.dsh/longtasks/INDEX.md`：人读索引，每次写入后重新生成。
- `~/.dsh/longtasks/roster.json`：旧版单文件格式，启动时自动迁移成任务目录并留档。
- `GET /api/longtasks/roster`：面板数据（附带 workspace 文件清单）。
- `POST /api/longtasks/action`：面板动作（`update` / `note` / `archive` / `delete`）。
- `POST /api/longtasks/ping`：浏览器半侧存活探针。

## 开发

```bash
npm test          # node --test：档案读写、自由结构保留、迁移、workspace、命令、工具、提示注入
npm pack --dry-run
```

两个半侧的加载方式不同：

- `index.mjs`（宿主）只在 DSH **启动时**加载，改完必须重启；
- `client/client.js`（浏览器）由宿主注入模块图，`apply` 重跑即生效；样式表每次 `apply` 整表替换
  （否则热重载会把新 DOM 留在旧样式上）。

本地联调：把两个文件复制进 profile 的安装副本即可。

## 发布

```bash
npm test && npm pack --dry-run
npm publish --access public        # 或打 tag 让 .github/workflows/publish.yml 发（带 provenance）
```

**兼容性门禁走 `peerDependencies`，不是 `engines.dsh`。** 本包声明
`"@deepseek-ai/dsh": ">=0.2.1-0 <0.3.0"`：0.2.1 的预发布必须用 `-0` 下界，
`>=0.2.0-0` 匹配不到 `0.2.1-rc.2`。DSH 升到 0.3 后会被拒载，届时发新版或让用户
`dsh plugin allow-version … --accept-risk`。

## 注意

- 宿主半侧在 DSH 进程内运行，**不受工作区沙箱约束**——这对所有 DSH 插件成立。
- 面板数据面只监听本机 loopback，与 DSH 自身的 Web 服务同源。
- 任务目录是纯文件，卸载插件不会删除；没有跨设备同步。

## 卸载

删掉 profile 里 `dependencies` 与 `dsh.profile.bundles` 中的 `dsh-longtasks`，
再删 `~/.dsh/profiles/desktop/node_modules/dsh-longtasks`。任务数据保留在 `~/.dsh/longtasks/`。
