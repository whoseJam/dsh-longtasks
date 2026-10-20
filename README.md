# dsh-longtasks

[![ci](https://github.com/whoseJam/dsh-longtasks/actions/workflows/ci.yml/badge.svg)](https://github.com/whoseJam/dsh-longtasks/actions/workflows/ci.yml)

长线任务花名册 —— 让跨天、跨会话的长期任务在 DSH 里有一个固定身份，而不是每天早上重新解释一遍。

## 它解决什么

一个长线任务往往持续若干天：它有自己的目标、进展、卡点、下一步，还有一个「负责它的会话」。
但会话列表是按时间排的，隔天重开电脑以后：

- 找不到那个会话了 → 只能开新会话、让新 AI 重新熟悉任务；
- 也说不清每个 agent 到底在负责什么。

这个插件把这类任务固定成一条**档案**：

| 字段 | 作用 |
| --- | --- |
| `name` / `goal` | 这件事是什么、要做到哪一步 |
| `status` | 进行中 / 等待中 / 已完成 / 已归档 |
| `next` | 下次接手的第一动作 |
| `sessionId` / `cwd` | 负责它的常驻会话与工作目录（点一下就能回到现场） |
| `notes` | 交接日志：做了什么、卡在哪、下次从哪继续 |

同时给模型两件事：

1. **`longtask` 工具** —— 它自己维护档案（`create` / `note` / `update` / `brief`），不需要你手动记笔记；
2. **系统提示注入** —— 每个新会话开工时，系统提示里就带着当前花名册（标 ★ 的是本会话负责的条目），
   于是「重新熟悉任务」不再靠人复述。

浏览器侧是左侧栏一个「长线任务」整页看板：状态、目标、下一步、最近日志、会话标题与活跃时间一屏看完，
一键**打开会话**或**复制交接简报**；超过 3 天没动的条目会挂一个「N 天未动」标记。

人也可以不经过模型直接操作：

```
/longtask                       列出全部
/longtask note <id> <进展>      记一条交接日志
/longtask done <id>             改状态（active / waiting / done / archive）
/longtask brief <id>            取交接简报
/longtask new <名字>            以当前会话新建一条
```

## 界面

按 DSH 一方页面（插件管理 / 设置）的排版复刻：居中 960 栏、20px 标题、行式列表
（48px 图标格 + 标题行 + 描述 + meta），圆角、字号、状态胶囊都取 `--dsw-*` token，
因此浅色/深色主题自动跟随。行悬停才浮出动作（日志 / 复制简报 / 完成 / 归档），
点任务名直接回到负责它的会话。

![浅色](docs/preview-light.jpg)

![悬停与展开日志](docs/preview-hover.jpg)

![深色](docs/preview-dark.jpg)

## 安装

包本身零依赖、零构建（宿主半侧是 ESM，浏览器半侧是 `window.__ModuleLoader__` 的 classic 脚本）。

`dsh plugin add` 会走 pnpm 重新解析整个 profile，profile 里若有需要私有 registry 的依赖（例如
`@max-null/*`），registry 凭据过期时它会一并失败。此时用下面的手动安装：

```bash
# 1. 放进 profile 的 node_modules
cp -R ~/Desktop/dsh-longtasks ~/.dsh/profiles/desktop/node_modules/dsh-longtasks

# 2. profile 声明依赖与 bundle 层
#    package.json -> dependencies 增加 "dsh-longtasks": "file:../../Desktop/dsh-longtasks"
#    package.json -> dsh.profile.bundles 追加 "dsh-longtasks"

# 3. 重启 DSH（宿主半侧只在启动时加载）
```

重启后左侧栏出现「长线任务」；对着 AI 说「把这件事建成长线任务」就会生成第一条档案。

## 发布

```bash
npm test              # 13 个用例：档案增删、mtime 重读、合并写入、损坏备份、命令、提示注入
npm pack --dry-run    # 先看打进去的文件（9 个，约 168 kB）
npm publish --access public
```

别人装：

```bash
dsh plugin --profile desktop add dsh-longtasks
# 或在 Web 的 Plugins 页搜索包名安装
```

**兼容性门禁走 `peerDependencies`，不是 `engines.dsh`。** 启动与安装都会把声明的 DSH peer 范围
和当前 runtime 版本（`getDshRuntimeVersion()`）比对，不匹配就拒载/拒装。本包声明
`"@deepseek-ai/dsh": ">=0.2.1-0 <0.3.0"`：0.2.1 的预发布版本必须用 `-0` 下界，
`>=0.2.0-0` 是匹配不到 `0.2.1-rc.2` 的（semver 预发布规则）。DSH 升到 0.3 之后本包会被拒载，
届时发新版，或让用户临时放行并接受风险：

```bash
dsh plugin --profile desktop allow-version dsh-longtasks@0.1.0 --dsh-version <runtime> --accept-risk
```

分发渠道：npm（上面）、GitHub 直装（`dsh plugin add github:<user>/dsh-longtasks`，本包零构建，
不需要 `prepare` 脚本，因此不会被 pnpm 拦），以及本地 tarball / 路径。
社区目录可投 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)、
[dshbase](https://dshbase.com/plugins/)、[dsh-plugin-market](https://github.com/chnjames/dsh-plugin-market)。

## 注意

- 宿主半侧在 DSH 进程内运行，**不受工作区沙箱约束**——这对所有 DSH 插件成立，装别人的插件等于信任其代码。
- 面板数据面是 `/api/longtasks/*`，只监听本机 loopback，与 DSH 自身的 Web 服务同源，不对外暴露。
- 档案是纯 JSON，插件卸载不会删数据；跨设备不同步。

## 开发

```bash
npm test          # node --test，无需依赖安装
npm pack --dry-run
```

两个半侧的加载方式不同，改完要分开验证：

- `index.mjs`（宿主）：只在 DSH **启动时**加载，改完必须重启 App；
- `client/client.js`（浏览器）：宿主把它当 classic 脚本注入模块图，`apply` 重跑即可生效；
  样式表在每次 `apply` 时整表替换（否则热重载会把新 DOM 留在旧样式上）。

本地联调可以直接看 profile 里的安装副本：

```bash
cp index.mjs client/client.js ~/.dsh/profiles/desktop/node_modules/dsh-longtasks/...
```

数据安全做了三件事：写入用临时文件 + `rename` 原子替换；文件解析失败时先备份成
`roster.json.corrupt-<时间戳>` 再继续；写入前发现盘上已被别的进程改过，就按 id 合并
（`updatedAt` 新的胜出，本实例删掉的 id 不复活），避免两个 host 进程互相吞条目。

## 卸载

```bash
# profile/package.json 里删掉 dependencies 与 dsh.profile.bundles 中的 dsh-longtasks
rm -rf ~/.dsh/profiles/desktop/node_modules/dsh-longtasks
```

档案数据在 `~/.dsh/longtasks/roster.json`，卸载插件不会删除它。

## 数据与接口

- `~/.dsh/longtasks/roster.json`：全部档案（原子写 + mtime 变了就重读，手改文件也会被看到）。
- `GET  /api/longtasks/roster`：面板数据面（附带每条的 `brief` 简报）。
- `POST /api/longtasks/action`：面板动作（`update` / `note` / `archive` / `delete`）。
- `POST /api/longtasks/ping`：浏览器半侧存活探针，落盘到 `~/.dsh/longtasks/client-ping.json`。

## 结构

```
index.mjs                    宿主半侧：Roster 存储、longtask 工具、/longtask 命令、系统提示段、JSON 路由
client/client.js             浏览器半侧：左侧栏入口 + 整页看板（React 来自宿主平台模块）
cordis.patch.yml             bundle 层：insert 一行把 index.mjs 挂进 profile
test/roster.test.mjs         13 个 node --test 用例（不随包发布）
.github/workflows/           ci.yml（测试 + 打包形状）、publish.yml（tag 触发 npm 发布 + provenance）
docs/                        README 截图
```

`longtask` 工具刻意手写成裸 `ToolDefinition`（参数即 JSON Schema），因此插件除 `tools` / `systemPrompt`
两个公开服务外不依赖任何平台包，跨 DSH 小版本的存活率更高。
