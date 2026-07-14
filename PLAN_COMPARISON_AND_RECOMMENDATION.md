# Shale 计划对比与最终推荐

## 1. 文档目的与结论

本文件比较以下两份计划：

- `COURSE_PROJECT_PLAN.md`：面向课程约束、三人协作、风险登记和验收的执行计划。
- `IMPLEMENTATION_PLAN.md`：面向 Electron 工程实现、安全边界、数据契约、测试和平台验证的详细计划。

### 最终结论

采用“**实施计划为技术主文档，课程计划为范围与协作治理补充**”的组合方案。

具体而言：

1. 以 `IMPLEMENTATION_PLAN.md` 的 Electron 安全基线、SQLite/IPC/网络/Reader/Agent 契约、测试 fixture 和工程里程碑为实现基线。
2. 以 `COURSE_PROJECT_PLAN.md` 的课程功能优先级、三人职责、Issue/PR/Agent 留痕、集中风险登记和降级策略为项目治理基线。
3. 按课程实际约束收敛范围：Windows 11 x64 是完整安装和现场演示平台；macOS/Linux 必须由架构、依赖选择、路径处理和尽可能的 CI build/smoke 支持，但不把 Hyprland 原生 Wayland、公证签名或三平台正式发布作为核心功能的阻塞门槛。
4. Reader 模式、Feed/OPML/Sync、Summary、Translation 是不可降级的 P0；Web/Dual 阅读模式、平台发布硬化、自动更新和高级图表应后置。

本结论避免两个极端：既不为了复用旧 Swift 代码而引入不可控风险，也不为了追求生产级发布矩阵而牺牲八组课程功能。

## 2. 共同基础

两份计划在最重要的架构判断上没有冲突。

| 主题 | 共同结论 | 最终处理 |
|---|---|---|
| 桌面技术栈 | Electron + React + TypeScript，单一 TypeScript 运行时 | 采纳 |
| 进程边界 | Main process 负责副作用；Renderer 只负责 UI | 采纳并细化为 typed IPC |
| 本地优先 | SQLite 为本地事实源；无账号、无项目后端 | 采纳 |
| 隐私 | 不主动采集/上传遥测；日志默认本地且需脱敏 | 采纳，作为安全红线 |
| Reader | Source HTML、Cleaned HTML、Markdown、Rendered Cache 分层 | 采纳，保持可版本化失效规则 |
| AI | OpenAI-compatible Provider、支持 localhost、本地持久化结果、统一任务运行时 | 采纳 |
| 核心优先级 | Feed/Reader/Summary/Translation 先于支持功能 | 采纳为 P0 Gate |
| 协作 | 真实 Issue、commit、PR、review、测试和文档证据 | 采纳 |

## 3. `IMPLEMENTATION_PLAN.md` 的优势

以下内容比 `COURSE_PROJECT_PLAN.md` 更具体，应直接成为实现要求。

### 3.1 Electron 安全模型

实施计划将安全要求落实为可检查项：

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- 严格 Content Security Policy
- 最小 typed preload API 和 runtime schema 校验
- 自定义应用协议，避免无约束 `file://`
- 远程网页放在隔离 `WebContentsView`，不能访问 Node、preload 或应用 IPC
- 拒绝任意 popup、下载、权限和危险导航

这是课程计划中“窄 IPC 边界”的可执行版本。应写入 ADR 和安全测试，而不只是写在架构图中。

### 3.2 数据库、迁移和网络基础

实施计划明确了：唯一 `DatabaseHost`、WAL、busy timeout、migration transaction、migration checksum、foreign key check、故障恢复页、fixture、WAL checkpoint 和关闭/备份语义。

网络层也明确了主进程单一 `HttpClient`、不同业务共享 transport、可注入 fake transport、超时分类、`AbortSignal`、重定向/响应体限制、charset 处理和日志脱敏。

这能避免新项目重新出现“多个 feature 各自建请求客户端、各自持有队列、各自写 SQLite”的架构漂移。

### 3.3 Mercury 行为契约迁移

实施计划 M0 保留了许多对用户体验有实际影响的行为，而课程计划只概述了它们：

- Entry tombstone 与派生数据清理。
- 轻量 `EntryListItem` 与详情按需加载。
- 搜索只覆盖标题和摘要的基线。
- 持久化结果优先投影，再评估是否启动 Agent。
- in-flight Agent 不因切换文章自动取消。
- latest-only waiting replacement。
- Reader-bound Agent 消息面和 Batch Tagging 独立消息面。

这些应形成 parity matrix，逐项落到 Issue、测试和验收证据。

### 3.4 Reader 安全、保真和测试 corpus

实施计划要求二次 sanitize、危险 HTML fixture、稳定 Canonical Markdown、层级缓存、每 Entry build lock、图片/表格/代码/列表/链接 fixture，以及 Golden output diff。

这些要求应保留。Reader 是四项核心功能中的第二项，不能只验证“页面能显示文本”。

### 3.5 Agent 与 Provider 的失败矩阵

实施计划将 401、429、5xx、断流、missing usage、zero usage、primary/fallback、四种 timeout、checkpoint 和局部翻译失败纳入测试。这比“可调用一个模型”更能证明 Provider 中立和 Agent Runtime 正确。

### 3.6 Agent 的行为红线

实施计划的 Agent 工作规则应直接并入贡献规范：

- 不绕过 typed IPC。
- 不降低 Electron sandbox、CSP 或 `webSecurity`。
- 不把 API Key 写入 SQLite。
- 不修改已发布 migration。
- 不以 sleep-based 测试掩盖竞态。
- 不在一个 PR 同时进行大重构和大功能新增。

## 4. `COURSE_PROJECT_PLAN.md` 的优势

以下内容应保留为最终项目治理要求。

### 4.1 更贴合课程范围

课程计划明确八组功能都在范围内，且前四组是不可让步的 mandatory core：

1. Feed / OPML / Sync / 内容呈现。
2. Cleaned HTML / Cleaned Markdown / Reader 样式。
3. Summary Agent / LLM Providers。
4. Translation Agent。

支持功能不能在核心闭环完成前吞噬关键路径。

### 4.2 三人角色与真实代码所有权

课程计划中的 Project Lead / Product Owner、Architect / Tech Lead、Development Lead / Feature Owner 更适合课程协作证明。它要求产品负责人拥有真实模块，技术负责人不承担全部实现，功能负责人也参与可验证的 PR 和测试。

### 4.3 协作留痕和人类验收

课程计划明确 Issue、PR、ADR、commit、review、Definition of Done 和 Coding Agent record 应记录：

- 人类给出的目标与约束。
- Agent 查看的资料、提出的方案、实际修改和验证。
- 人类检查了什么，以及最终为什么接受、要求修改或拒绝。

这比单纯保存聊天记录更有价值，也更符合“持久化、有价值的工作过程文档”。

### 4.4 集中风险登记与降级顺序

课程计划将风险列出概率、影响、预警信号、缓解措施和最晚解决阶段；同时明确先降级自动更新、高级图表、特化 Reader pipeline、本地 NLP 和视觉装饰，而不是削减四项核心功能。

## 5. 关键差异与逐项判断

| 主题 | `COURSE_PROJECT_PLAN.md` | `IMPLEMENTATION_PLAN.md` | 判断与最终处理 |
|---|---|---|---|
| 验收平台 | Windows 完整演示；macOS/Linux 设计支持 | Windows、macOS、Linux 都要求构建/启动，Hyprland 原生 Wayland 为硬门禁 | 以课程约束为准：Windows 为 A 级完整验收；macOS/Linux 为 B 级设计兼容和尽可能 CI smoke；Hyprland 仅 C 级加分项。 |
| 平台发布 | 不把三平台发布视为核心门禁 | 要求 Windows、Hyprland、macOS 发布硬化、公证、Gatekeeper 等 | Windows 安装包 P0；macOS 公证、Linux distro 包、SBOM、完整 release 流程 P2。 |
| Reader 模式 | Reader 是核心，但未要求 Web/Dual | Reader、Web、Dual 都列入 P0 | Reader P0；Web/Dual 移到 P1。远程网页隔离技术仍在 M1 做安全探针，但不阻塞 Feed/Reader/AI 核心。 |
| Electron 版本/构建工具 | 不绑定具体版本 | Electron 40+、Vite、Forge、`better-sqlite3` | 使用该组合，但 M1 后必须在 lockfile/ADR 固定精确版本，不以 `40+` 作为可复现基线。 |
| SQLite 方案 | SQLite 与迁移，驱动先验证 | `better-sqlite3`，主进程 `DatabaseHost` | 采纳 `better-sqlite3` probe；若 packaged Windows 验证失败，立即更换 driver，不等待后续 feature。 |
| 密钥存储 | 仅 OS credential store | Electron `safeStorage`，Linux basic_text 可告警 | 需收紧：若 Linux 无安全后端，默认不持久化 Key；仅允许 session-only，或要求用户配置 Secret Service。不能只警告后落明文。 |
| Task 生命周期 | Agent 子状态较细，强调 waiting/persisting | 通用 Task Runtime 有 `interrupted`，强调 restart/reload | 合并：全局 TaskRuntime 管 `queued/running/interrupted/terminal`；AgentRuntime 管 waiting/requesting/generating/persisting。禁止两套独立 scheduler。 |
| 支持功能安排 | 分为独立阶段 | M8 集中 Notes、Tags、Usage、Logs | M8 应拆成 M8A Notes/Digest、M8B Tags、M8C Usage/Logs/i18n，分别验收。 |
| 团队分工 | 角色责任与模块所有权 | A 平台数据、B UI Reader、C Agent 质量 | 使用混合模式：保留角色名称和产品责任，同时采用 A/B/C 技术切片分配日常代码。 |
| 风险管理 | 有集中风险表 | 风险和门禁散在 milestone 中 | 保留集中 risk register，并把 Windows SQLite、WebContentsView、平台适配、secret storage 纳入其中。 |
| Coding Agent | 重点记录人类审查和决策 | 重点限制 Agent 不破坏架构/安全 | 两者合并：记录过程，同时实施安全红线。 |

## 6. 需要避免的范围膨胀

下列内容有工程价值，但不应成为课程 P0：

1. Hyprland 必须是原生 Wayland client、不得使用 XWayland。
2. macOS Developer ID、notarization、staple、Gatekeeper 全链路。
3. 三平台从同一 commit 的正式 release artifact。
4. Reader/Web/Dual 三种模式全部完成。
5. Windows 所有 DPI、多显示器、sleep/resume、GPU/IME 组合的完整矩阵。
6. 自动更新、SBOM、prerelease 发布流程。
7. Windows ARM64、macOS Universal/Intel 包。

这些工作应作为 P2 或可选质量提升。它们不能抢占 Feed、Reader、Summary、Translation 的人力。

## 7. 推荐的最终里程碑

### G0 / M0 — 需求、契约与 Go/No-Go

- 课程 Requirement → Milestone → Issue → Test → Evidence 追踪表。
- Electron 安全、SQLite 所有权、Reader trust boundary、Agent lifecycle、隐私/日志 ADR。
- Windows packaged SQLite、typed preload、安全远程 Web 探针。
- 固定 Feed/Reader/LLM fixture corpus。

**硬门禁**：Windows 包可启动并加载 SQLite；Renderer 和远程页面均不能访问 Node、数据库、密钥或 IPC。

### G1 / M1 — 运行时基础

- Main/preload/renderer 结构。
- Typed IPC、runtime schema、DatabaseHost、迁移、TaskRuntime、HttpClient。
- 本地日志和脱敏 canary。
- i18n 基础与 Windows 打包。

### G2 / M2 — 核心功能 1：Feed / OPML / Sync

- Feed、Entry、OPML、parser adapter、ETag/304/429、同步 UI。
- 打包 Windows 应用完成“添加 Feed → Sync → 重启仍在”的垂直切片。

### G3 / M3 — 核心功能 2：Reader

- 分层 Reader pipeline、清洗、Canonical Markdown、受控 React Reader、样式和缓存。
- 恶意 HTML 与内容保真 corpus。

### G4 / M4 — 核心功能 3：Provider / Summary

- Credential adapter、Provider/Model、fake LLM、Summary 结果槽、用量事件。
- 至少一个 localhost 和一个远程 OpenAI-compatible Provider 验证。

### G5 / M5 — 核心功能 4：Translation

- `p`/`ul`/`ol` 分段、source hash、checkpoint、双语投影、局部重试和恢复。

### M6A — Notes / Digest

- Markdown note、单篇和多篇文摘、模板、原子导出。

### M6B — Tags

- 手动标签、筛选、别名/合并、Tag Agent、批量标签审查。

### M6C — Usage / Logs / Localization

- 中英文、本地调试、用户主动导出诊断包、Provider/Model/Agent 用量表。

### M7 — Windows RC 与课程证据

- Windows 11 安装与现场演练。
- 文档、PR/Issue/ADR/Agent records、演示脚本、已知限制。
- macOS/Linux build/smoke 证据；若环境不可用，明确记录为待验证，而不是宣称已支持。

## 8. 最终团队分工

| 课程角色 | 技术切片 | 主要可验证交付 |
|---|---|---|
| Project Lead / Product Owner | 产品范围、验收、Notes/Digest、i18n、Logs/Usage、课程文档 | Issue/验收标准、Digest、隐私文档、演示与证据索引 |
| Architect / Tech Lead | Electron 安全、IPC、SQLite、迁移、Task/Agent Runtime、Reader 数据契约 | ADR、安全审查、DatabaseHost、Reader pipeline、平台探针 |
| Development Lead / Feature Owner | Feed/OPML/Sync、Provider、Summary、Translation、Tags 交付 | 垂直功能 PR、fixture、feature integration tests |

共同规则：数据库 migration、preload/IPC、credential、TaskRuntime 和 Reader canonical contract 必须经过 Tech Lead review；范围和演示声明必须经过 Project Lead review；每位成员都必须有连续的真实实现提交和 review 记录。

## 9. 最终安全与隐私红线

1. Renderer 不访问 Node、SQLite、文件系统、密钥或通用网络能力。
2. 远程网页不访问 preload、Node 或应用 IPC。
3. API Key 不进入 SQLite、日志、诊断包、截图、测试 fixture 或 Renderer state。
4. 日志不记录文章正文、Prompt、Response、Note、Authorization 或原始请求头。
5. 不集成 analytics、crash-report upload 或项目控制的遥测服务。
6. 日志/诊断包只能由用户主动导出或发送。
7. 所有外部链接、下载、popup、权限和非 HTTP(S) scheme 都使用显式 allowlist 策略。

## 10. 文档治理建议

避免长期维护两个会漂移的总计划。建议：

- 保留 `IMPLEMENTATION_PLAN.md`，但按本文件的范围调整更新其 P0/P1/P2 与平台门禁。
- 保留 `COURSE_PROJECT_PLAN.md` 作为课程范围、协作与风险治理的参考，或将其中独有内容迁入 `IMPLEMENTATION_PLAN.md` 后标记为 superseded。
- 本文件作为合并决策记录。在后续 ADR 中引用它，而不是重复复制两份计划。
- 新建 `docs/requirements-traceability.md`，维护 Requirement → Milestone → Issue → Test → Evidence 映射。

## 11. 首批必须创建的 Issues

1. `docs: establish requirements traceability and parity matrix`
2. `docs: record Electron security and process-boundary ADR`
3. `build: scaffold Electron React TypeScript Forge application`
4. `security: enforce BrowserWindow sandbox CSP and context isolation`
5. `ipc: create typed preload bridge with runtime validation`
6. `database: prove better-sqlite3 in packaged Windows application`
7. `platform: validate isolated remote WebContentsView on Windows DPI`
8. `ci: add Windows primary build matrix and macOS/Linux compatibility builds`
9. `database: implement migration runner and database fixtures`
10. `tasking: implement shared task state machine and cancellation ownership`
11. `network: implement injectable HTTP client and timeout policies`
12. `feed: create RSS Atom JSON Feed fixture corpus`
13. `reader: establish malicious HTML and content-fidelity corpus`

完成前 8 项后召开 Go/No-Go review。通过标准是 Windows packaged application、SQLite native module、typed IPC 和隔离远程 Web 边界均可验证，而不是 Hyprland 或 macOS 发布流程已完成。
