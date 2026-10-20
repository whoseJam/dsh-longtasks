# Changelog

## 0.1.0

首个版本。

- 长线任务档案：名称、目标、状态、下一步、绑定会话与工作目录、交接日志。
- `longtask` 工具（create / list / show / update / note / brief / archive / delete）。
- `/longtask` 命令（list / new / show / brief / note / active / waiting / done / archive）。
- 系统提示注入：新会话开工即见花名册，含 ★ 当前会话归属与「已 N 天未更新」提示。
- 左侧栏「长线任务」看板：按状态分组、下一步、会话活跃时间、交互日志展开、悬停动作。
- 数据安全：原子写、损坏文件备份（`.corrupt-<ts>`）、跨进程写入合并。
- 兼容性门禁：`peerDependencies` 声明 `@deepseek-ai/dsh >=0.2.1-0 <0.3.0`。
