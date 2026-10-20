# Changelog

## 0.1.4

- **长记录按逻辑拆文件**：工作原则要求每个线索/问题一个 `topics/<slug>.md`，决策进 `decisions.md`、步骤进 `runbook.md`、在办清单进 `ledger.md`，并用 `README.md` 说明每个文件是什么；同一类内容先并进已有文件。
- 机械提醒：单条 `note` 超过 400 字 → "细节写进主题文件"；记录超过 8 条而 workspace 不到 3 个文件 → "按线索拆成 `topics/<slug>.md` + `README.md`"。
- README：补一个典型 workspace 布局示例。


## 0.1.3

- **TASK.md 当索引**：工作原则新增一条，要求把台账、长结论、日志拆到 workspace 的独立文件；`longtask note` 超过 400 字会提示"细节该进文件"。
- **`brief` 动作改名 `handoff`**（`brief` 保留为别名）：原来动作名与"核心思想"字段撞名，模型会把整篇交接简报写进核心思想。
- **「打开目录」改为插件宿主直接调系统文件管理器**（macOS `open` / Windows `explorer` / Linux `xdg-open`），不再依赖 DSH 的 `openWorkspacePath` 桌面能力；只允许打开花名册目录内的路径；仅失败时写 `open.log`。
- 文档：修正过期的 `tasks/<id>/` 路径与 `brief` 命令名。


## 0.1.2

- 每行新增「打开目录」：调用 Host 的 `openWorkspacePath` 在系统文件管理器里打开该任务的 workspace；
  浏览器环境无桌面能力时退化为复制路径。展开视图里的路径同样可点。


## 0.1.1

- 界面中英双语：文案走 `ctx.locale` 词典，跟随 DSH 语言设置。
- 面板新增「新建」：直接建一条任务（未绑定会话），到目标会话用 `/longtask bind <id>` 补绑定。
- `longtask update` 新增 `bind: true`，把这个任务绑到调用它的会话。
- README 增加 npm 版本 / 下载量徽章、新建与英文界面截图。


## 0.1.0

首个版本。

- **一个任务 = 一个目录**：`<id>/TASK.md` 存档案，同目录下的其余文件是该任务自由组织的 workspace。
- **brief 与 workspace 分离**：brief 只写稳定的核心思想；workspace 结构由任务自己决定，插件不解析、不规定格式。
- `longtask` 工具：create / list / show / update / note / brief / archive / delete；`show` 返回 TASK.md 原文。
- `/longtask` 命令：list / new / show / brief / note / active / waiting / done / archive。
- 系统提示注入：新会话开工即见花名册（★ 本会话归属、workspace 路径、久未更新警示）。
- 左侧栏看板：按状态分组、核心思想、下一步、会话活跃时间、展开看记录与 workspace 文件。
- 数据安全：原子写、frontmatter 与小节级改写（agent 自己加的小节不被冲掉）、旧格式自动迁移。
- 兼容性门禁：`peerDependencies` 声明 `@deepseek-ai/dsh >=0.2.1-0 <0.3.0`。
