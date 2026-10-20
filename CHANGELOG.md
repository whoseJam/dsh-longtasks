# Changelog

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
