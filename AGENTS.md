# Project Standards & Constraints

本文件是项目成员和 Coding Agent 的工程执行规则。开始任何任务前，应先阅读本文件、`INIT.md`、`PLAN.md` 以及当前 GitHub Issue；只读取和修改完成当前任务所需的相关模块。

## 1. Project Goal

交付一个本地优先、以阅读为中心的跨平台桌面 Feed 阅读器，能够获取、清洗和离线阅读文章，并使用用户配置的模型生成和保存摘要与翻译。

产品范围和优先级以 `INIT.md` 为准，里程碑和负责人以 `PLAN.md` 为准，当前工作的具体范围和验收标准以 GitHub Issue 为准。

## 2. Human and Agent Responsibilities

### 人类负责

- 产品目标、约束和优先级；
- 架构、技术选型和重大设计决策；
- 验收标准和用户视角判断；
- GUI 的实际观察与交互反馈；
- Code Review 结论和是否合并；
- 风险发生后的取舍与降级决定。

### Coding Agent 负责

- 搜索并理解当前任务涉及的代码和文档；
- 在明确接口和验收标准下实现代码；
- 编写和运行适当测试；
- 提出实现方案、风险和可能遗漏；
- 根据准确反馈诊断和修复问题；
- 更新与本次改动直接相关的技术文档。

Agent 不得自行扩大产品范围、替团队决定重大架构或因为“顺便优化”修改无关模块。遇到会改变 P0、公共契约、安全边界或跨模块责任的选择时，先说明选项和影响，等待人类决定。

## 3. Architecture

### 进程边界

- `Renderer`：React 页面、交互和界面状态；
- `Preload`：通过 `contextBridge` 暴露最小、受限、typed API；
- `Main`：SQLite、文件、网络、Feed/内容管线、密钥和 AI Provider；
- `Shared`：两端共用的纯 TypeScript 类型、契约和无平台副作用的工具。

### 强制规则

- Renderer 不得直接导入或调用 Node.js、Electron、数据库、文件系统或密钥 API；
- 不得把完整 `ipcRenderer`、任意 channel 调用或其他高权限对象暴露给 Renderer；
- 所有跨进程数据必须有共享 TypeScript 类型；
- IPC Handler 负责校验、调用 Service 和转换结果，不承载复杂业务逻辑；
- Service 负责业务流程，Store 负责持久化；
- 功能模块通过契约协作，不依赖其他模块的内部类、表结构细节或临时状态；
- 涉及异步、流式事件、定时器和进程退出时，必须明确创建、取消/停止和清理路径。

### 目标目录边界

项目脚手架稳定后应保持等价的职责划分：

```text
src/
  main/          Electron Main、services、stores、IPC handlers
  preload/       contextBridge 与受限 API
  renderer/      React 应用与功能页面
  shared/        contracts、types、errors
tests/
  fixtures/      Feed、Cleaned Content、Mock Provider 等固定样例
```

如果实际脚手架采用不同目录名，应保持上述边界，并立即更新本节，禁止让同一职责散落到多个层级。

## 4. Tech Stack

- Electron；
- React；
- TypeScript；
- Vite；
- Electron Forge；
- SQLite；
- Preload + typed IPC；
- Windows 11 与原生 Wayland Linux。

使用 Node.js 24.x LTS 与 npm；唯一锁文件为提交到仓库的 `package-lock.json`，不得混用其他锁文件。首次工程初始化环境为 Node.js 24.11.1；锁文件产生后，其他成员优先使用 `npm ci` 安装依赖。未经 Issue 说明和相关负责人 Review，不得：

- 切换包管理器或删除 lockfile；
- 更换核心框架、SQLite 驱动或构建体系；
- 引入功能重复的大型依赖；
- 用未经验证的库承载数据库、密钥、打包或跨平台关键路径。

核心依赖必须先通过限时原型和最小测试验证，再在真实功能上扩展。

## 5. Key Features and Ownership

### 组长 / 产品与 Reader

- 产品范围、交互、计划、验收与集成协调；
- Electron 应用外壳、导航和通用界面规范；
- SQLite 初始化、迁移机制、核心数据模型和 Store 规范；
- 公共 IPC 规则和最小示例；
- Reader、阅读状态和离线读取。

### Feed / 内容管线负责人

- Feed 添加、解析、去重和持久化；
- OPML、手动 Sync 和定时 Sync；
- 网页获取、正文提取、清洗与 Cleaned Content；
- 本模块的表、迁移、Store、IPC、错误处理、页面和测试。

### AI 功能负责人

- Provider、模型配置和 API Key 安全存储；
- AI 流式任务运行时；
- Summary、Translation 和基础 Usage；
- 本模块的表、迁移、Store、IPC、错误处理、页面和测试。

公共基础负责人只提供规则、底座和示例，不代写所有功能接口。每位负责人必须完成自己模块从数据到页面和验证的必要部分。

## 6. Shared Contracts

### IPC

- channel/API 按领域命名，例如 `feed:*`、`content:*`、`reader:*`、`provider:*`、`summary:*`、`translation:*`；
- Renderer 只调用 Preload 暴露的领域 API，不直接拼写底层 channel；
- 请求和响应使用可序列化数据，不传递类实例、函数或平台对象；
- 错误至少包含稳定 `code`、可理解 `message` 和必要的 `retryable` 信息；
- 流式事件必须包含 `runId` 和资源身份，接收方必须清理监听器并忽略不属于当前任务的事件；
- 公共契约的破坏性变更必须在 Issue 中说明生产者、消费者和迁移方式。

### Cleaned Content

- Feed / 内容管线是契约生产者；
- Reader 与 AI 是消费者并共同 Review；
- 契约至少提供文章身份、来源、Cleaned HTML、Cleaned Markdown、版本/时间和清洗状态；
- Translation 所需的 segment ID、顺序和文本可以作为契约字段，但不得让 Reader 或 AI 依赖清洗器内部节点结构；
- Fixture 与真实内容管线输出必须通过同一份契约校验。

### Database

- 组长维护连接、迁移机制、核心实体关系和 Store 规范；
- 功能负责人维护自己的表、迁移和 Store；
- Schema 只能通过迁移演进，不在运行时临时修改表；
- 迁移、Store 和关键查询必须有自动化验证；
- 不在 Renderer 中出现 SQL；
- 删除或重建用户数据必须是显式开发操作，不作为修复迁移问题的默认办法。

## 7. Coding Conventions

### TypeScript

- 启用并保持严格类型检查；
- 避免 `any`、非空断言和 `@ts-ignore`；确需使用时在代码中说明不可替代的原因；
- 公共函数、IPC、Store 和 Service 边界必须具有明确输入输出类型；
- 优先使用可区分联合表达状态和结果，不使用含义不明的布尔值组合；
- 命名表达领域含义，避免 `data`、`result2`、`handleThing` 等模糊名称。

### 模块与函数

- 一个模块保持单一主要职责；
- 避免巨型组件、巨型 Service 和包含多个无关行为的 IPC Handler；
- 不为了“未来可能需要”提前建立复杂抽象；
- 出现重复坏模式、中心模块持续膨胀或边界泄漏时，在功能之间安排小规模重构；
- 功能 PR 不夹带无关的大范围格式化、重命名或重构。

### React 与界面状态

- 区分持久化业务状态、任务状态和纯界面状态；
- 组件卸载或文章切换时清理订阅、监听器和定时器；
- Loading、Empty、Error 和 Success 状态必须可区分；
- 不以视觉占位掩盖后端状态缺失；
- GUI 行为必须由人类实际观察，截图或 Agent 判断只能作为辅助。

### 错误与日志

- 对网络、Feed、内容提取、数据库和模型错误使用稳定错误码；
- 用户提示说明发生了什么和可采取的下一步，不直接暴露堆栈；
- 日志保留诊断上下文，但不得记录 API Key、Authorization Header、完整敏感配置或不必要的全文内容；
- 不吞掉异常；若选择降级或忽略，必须有明确理由和可观察记录。

### 安全

- 保持 `contextIsolation`，禁止为方便开发向 Renderer 开放完整 Node 权限；
- 所有来自 Renderer、Feed、网页、OPML 和模型的外部输入均视为不可信；
- HTML 展示必须经过适当清洗，禁止执行文章脚本；
- API Key 不进入普通配置文件、Git、测试 Fixture、日志和错误信息；
- 修改 Preload 暴露面、密钥存储、HTML 渲染和文件操作时视为敏感改动，必须人工 Review。

## 8. Testing and Verification

验证是任务定义的一部分，不能在实现完成后临时补写。

### 最低要求

- 纯转换、去重、契约校验和状态机优先使用单元测试；
- Store、迁移、IPC Handler 与 Service 边界使用集成测试；
- Feed 使用固定 RSS/Atom/边缘 Fixture，避免测试只依赖实时网站；
- AI 默认使用 Mock Provider 验证 chunk 顺序、任务隔离、成功和失败；
- 真实 Provider 测试必须由人明确触发，不在 CI 或普通测试中消耗 Key；
- Reader 使用固定 Cleaned Content Fixture，并在集成时验证真实输出；
- 每个里程碑在 Windows 11 与原生 Wayland 完成冒烟；
- GUI、打包、系统密钥和平台行为需要人类执行或观察。

### 修复规则

- 修复 Bug 前先获得可重复步骤、日志或失败测试；
- 能自动化复现时，先添加失败测试再修复；
- 不用捕获所有异常、增加任意延时或无条件重试掩盖根因；
- 修复后验证原问题、相邻路径和退出/重启行为。

## 9. Issue Workflow

老师要求每个 Task 明确 `Overall Goal`、`Task Detail`、`Affected Files`、`Key Design` 和 `Verification`。GitHub Issue 是这些信息在开发阶段的承载位置。

每个 Issue 至少包含：

- **Overall Goal**：任务完成后用户或系统得到什么；
- **Task Detail**：范围内、范围外和建议实现路径；
- **Affected Areas / Files**：预计影响的模块和文件，允许实现中校正；
- **Key Design**：数据结构、契约、核心算法或关键取舍；
- **Dependencies**：依赖谁、会阻塞谁，需要的 Fixture、接口或环境；
- **Verification**：自动化测试和人工验证步骤；
- **Owner / Reviewer**：负责人及涉及公共契约时的 Review 人。

### 粒度与状态

- 普通 Issue 以 0.5～2 个理想开发日为宜；
- 超过 2 天或包含多个独立验收结果时继续拆分；
- 当前里程碑细化，后续里程碑保持工作包级并滚动拆分；
- 状态采用 `Backlog → Ready → In Progress → Review → Done`；阻塞时标记 `Blocked` 并写明原因；
- 每人同时只保留一个主要实现 Issue 处于 `In Progress`。

## 10. Pull Request and Commit Workflow

课件没有强制规定分支模型或 PR 模板。本项目采用以下最小规则：

- 一个 PR 原则上对应一个 Issue 和一个可验证目标；
- PR 描述链接 Issue，并说明改动、关键设计、接口/Schema 变化、测试结果和已知限制；
- 公共契约或 Schema 变化应尽早开 Draft PR，让受影响成员在大量实现前确认；
- 作者完成自查、测试和必要人工验证后再请求 Review；
- PR 不混入无关重构、依赖升级或大范围格式化；
- 每个 commit 尽量保持可运行、可验证且目的单一；
- 合并方式由仓库统一设置决定，不在单个 PR 中临时改变历史策略；
- PR 合入不自动代表里程碑验收完成，跨模块功能仍需通过对应集成流程。

## 11. Release Workflow

发布流程详见 `RELEASE.md`。每次发布前按以下步骤操作：

1. 确认所有变更已合入 `main`；
2. 更新 `package.json` 版本号并运行 `npm install` 同步 lockfile；
3. 更新 `CHANGELOG.md`，从 `git log` 总结变更；
4. 提交并打 tag；
5. 推送并验证 CI 构建。

版本号遵循 SemVer，tag 名称与 `package.json` 的 `version` 一致（加 `v` 前缀）。

## 12. Code Review

AI Review 可以辅助发现问题，但不能替代人工责任。作者也不能仅以“代码由 Agent 生成”为理由跳过理解和验证。

### Review 重点

1. Issue 验收标准是否真正满足；
2. 核心、敏感和中心化模块是否保持正确边界；
3. IPC、Schema、Cleaned Content 和任务状态是否与契约一致；
4. 是否引入安全问题、密钥泄漏、资源残留或错误吞噬；
5. 测试是否覆盖关键路径和失败路径；
6. 是否复制了坏模式、制造不必要耦合或让中心模块继续膨胀；
7. 文档和 Fixture 是否需要同步更新。

### Review 分配

- 共享架构、SQLite 基础、Preload/IPC、安全、内容契约和 AI 任务运行时至少需要一名受影响模块成员人工 Review；
- 模块内部 PR 采用轮换 Review，不固定由某一位技术成员审核全部代码；
- Review 意见应指出具体位置、预期行为和原因；
- 发现重复坏味道时，不只修当前一行，应建立重构 Issue 检查同类位置。

## 12. Definition of Done

Issue 只有同时满足以下条件才能进入 `Done`：

- 验收标准满足；
- 相关自动化测试通过；
- 必要人工验证完成并记录；
- 无敏感信息进入代码、配置、日志或 Fixture；
- 公共类型、Schema、IPC、行为或关键决策已更新相应文档；
- PR 完成必要 Review 并合入；
- 影响端到端流程时，已在当前里程碑集成环境验证。

## 13. Documentation Maintenance

遵循课件的文档驱动方式：

- 项目启动：由 `INIT.md` 派生并维护 `AGENTS.md` 与 `PLAN.md`；
- 每个里程碑前：细化当前 Phase/Issues，讨论、Review 并确认；
- 每个里程碑后：更新 `PLAN.md` 的状态、`AGENTS.md` 的 Current Status / Recent Notes / Known Issues；
- 关键协议和重大变更：单独编写契约文档或 ADR，不把全部细节塞入 `AGENTS.md`；
- 记录关键决策、当前状态和可复用经验，不记录冗长会话过程；
- 文档与实现冲突时停止扩展，先确认真实状态并同步文档。

## 14. Current Status

- 产品目标、原则、P0/P1/P2 和最低演示流程已确认；
- 三人分工、主要依赖、成本等级和风险已经团队确认；
- `PLAN.md` Baseline v1 已完成；
- 当前处于 M0 开始前，正式功能实现尚未形成稳定集成版本；
- 下一步是统一工程空壳、验证 SQLite/IPC、确认 Cleaned Content v0，并完成 Feed/清洗、AI 流式/Key、双平台风险原型。

本节必须在每个里程碑结束后更新，不得长期保留已经失真的状态。

## 15. Design Decisions

已确认的关键决策：

1. 使用 Electron Main / Preload / Renderer 分层，Renderer 不直接获得系统权限；
2. 使用 typed IPC 作为 Renderer 与 Main 的边界；
3. 使用 SQLite 实现本地持久化，具体驱动先通过 M0 原型验证；
4. 公共基础与功能模块分开负责，功能负责人实现本模块完整必要链路；
5. Feed/内容管线输出 Cleaned Content 契约，Reader 和 AI 只依赖契约；
6. Reader 使用 Fixture、AI 使用 Cleaned Markdown + Mock Provider 解除前期依赖；
7. Provider 采用可替换抽象，具体模型配置由用户控制；
8. 采用滚动计划，只详细拆当前和下一个里程碑；
9. 功能里程碑之间穿插 Review 和小规模重构，防止 AI 生成代码坏模式扩散；
10. 最终截止前 5 天冻结功能，只处理测试、Bug、构建、文档和演示。

改变以上决策必须创建或更新对应 Issue/ADR，说明原因、影响范围、迁移方式和验证方案。

## 16. Recent Notes

- Cleaned Content 契约必须在内容管线正式扩展前完成三方 Review；
- AI 对 segment ID、段落顺序和文本字段的需求由 AI 负责人提出，Feed 负责人负责生产者可实现性；
- 数据库公共负责人不代写全部功能表和 Store；
- 公共 IPC 负责人不代写全部功能 IPC；
- Reader 和 AI 不等待真实内容管线全部完成，分别使用契约一致的 Fixture 开发；
- P0 中 OPML、定时 Sync、Reader/Web/Dual 均已提升为必须完成；
- 完整取消、复杂重试、并发治理和高级 Translation 降为 P1/P2。

## 17. Roadmap

- **M0：范围、契约与风险消减**——工程空壳、SQLite/IPC、Cleaned Content、关键技术原型；
- **M1：最小阅读闭环**——Feed → Sync → 清洗 → 持久化 → Reader，AI 基础独立可测；
- **M2：核心功能稳定化**——Feed/Reader 完整 P0 基础、Summary、OPML、定时 Sync、三种阅读模式；
- **M3：完整 P0 与功能冻结**——Translation、剩余 P0、端到端回归；
- **M4：发布加固**——Bug、测试、跨平台构建、文档和演示。

详细时间、负责人、验收门和滚动拆分规则见 `PLAN.md`。

## 18. Known Issues and Risks

| 风险 | 当前处理方式 |
|---|---|
| Electron + SQLite 原生依赖可能在打包后不可用 | M0 立即验证写入、重启恢复和两平台构建 |
| Windows 与原生 Wayland 行为不同 | 每个里程碑双平台冒烟，不把验证推到最后 |
| 不同网站正文结构差异大 | 使用代表性 Fixture 和真实站点；失败时允许 Web/原文回退 |
| Feed 格式、编码和去重标识不统一 | 建立 RSS/Atom/边缘样例和去重测试，明确首版支持边界 |
| AI 流式事件串线、退出残留或并发复杂 | 使用 `runId`、Mock Provider 和清理测试；P0 限制复杂并发 |
| API Key 跨平台安全存储能力不同 | M0 验证；禁止无提示明文落盘 |
| Translation 分段与局部失败复杂 | P0 先做短文章串行基础版，高级能力降级 |
| 多人同时修改公共文件产生冲突 | 公共变更先写 Issue，指定 Review 人，小 PR 合入 |
| AI 代码坏味道复制和中心模块膨胀 | 里程碑 Review，功能之间安排小规模重构 |
| 辅助功能挤压核心交付 | P0 有风险时不启动 P1/P2，最后 5 天功能冻结 |

风险出现新事实、临时解决方案或降级决定时，应立即更新本节和相关 Issue。

## 19. Agent Task Procedure

处理具体 Issue 时按以下顺序执行：

1. 阅读本文件、`INIT.md`、`PLAN.md` 当前里程碑和 Issue；
2. 搜索相关契约、模块、Store、IPC 和测试，不无目的扫描或改写整个仓库；
3. 在修改前确认当前数据流、预计影响文件、公共接口变化和验证方法；
4. 若发现需求、架构或安全决策缺失，停止实现并请求人类决定；
5. 只实现 Issue 范围，补充必要测试并运行相关验证；
6. 检查 diff，移除调试代码、无关修改和敏感信息；
7. 汇报完成内容、验证结果、剩余风险和文档变化；
8. 里程碑结束时协助更新 Current Status、Recent Notes、Known Issues 和计划状态。

任何自动生成的代码、测试、文档或 Review 结论，都必须由对应的人类负责人承担最终责任。