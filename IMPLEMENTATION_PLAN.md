# Mercury 跨平台实现计划

| 项目 | 内容 |
|---|---|
| 状态 | Accepted |
| 架构基线 | [PORTING.md](PORTING.md) |
| 主要验收平台 | Windows 11 x64 |
| 其他支持平台 | macOS、Linux 原生 Wayland（Hyprland） |
| 桌面框架 | Electron 40+、React、TypeScript、Vite、Electron Forge |
| 数据存储 | SQLite、`better-sqlite3` |
| 首版原则 | 单一 TypeScript 应用运行时，不引入 Rust 后端或 Swift sidecar |

## 1. 计划目标

本计划用于将课程要求和 [Mercury](https://github.com/neolee/mercury) 的产品行为，逐步实现为一个真正的平台中立 RSS 阅读器。

项目不是逐文件翻译 Swift 代码，而是迁移已经验证过的产品语义：

- SQLite 是本地真相源。
- Feed、Entry、Reader 内容和 Agent 结果具有明确的数据生命周期。
- Reader 使用分层、可版本化的内容流水线。
- Markdown 是阅读、AI 输入和导出的规范内容。
- Renderer 只负责界面，不直接访问数据库、文件系统、网络或密钥。
- Main process 是任务、网络副作用和本地资源的权威所有者。
- 远程网页、清洗后的文章内容和应用 UI 使用不同的安全边界。
- Windows、macOS 和 Linux 由同一套工程构建。
- Windows 11 x64 是课程主验收平台。
- Hyprland 必须验证为原生 Wayland，不能用 XWayland 冒充。

## 2. 交付优先级

### P0：必须交付

- Feed 添加、删除和同步。
- RSS、Atom、JSON Feed 解析。
- OPML 导入和导出。
- Cleaned HTML。
- Cleaned Markdown。
- 自定义 Reader 样式。
- Reader、Web、Dual 三种阅读模式。
- OpenAI-compatible Provider 和 Model 配置。
- Summary Agent，可指定语言和详细程度。
- Translation Agent，支持全文翻译和双语展示。
- Windows 11 x64 完整安装和运行。
- macOS、Linux 工程可构建和启动。
- Hyprland 原生 Wayland 可用。
- 本地优先，无需账号，不主动上传遥测。

### P1：额外交付

- 已读、未读、星标和搜索。
- 中英文界面。
- 本地日志和调试工具。
- Token 用量统计。
- Markdown 笔记。
- 单篇和多篇文摘导出。
- 手动标签、标签筛选和标签管理。
- Tag Agent 和批量标签。

### P2：首版后再实施

- 自动更新。
- Windows ARM64。
- macOS Intel 或 Universal 包。
- 云同步、登录和账号系统。
- 自定义无边框、透明、模糊或异形窗口。
- Rust/Swift 原生后端。
- 未经性能分析证明必要的 native addon。

## 3. 总体依赖顺序

```text
需求与行为契约
    -> Electron 安全壳和平台探针
    -> Typed IPC、SQLite、Task Runtime、HttpClient
    -> Feed/OPML/Sync 垂直切片
    -> Reader 内容清洗与版本化缓存
    -> Reader/Web/Dual 和完整桌面 UI
    -> Provider、Agent Runtime、Summary
    -> Translation
    -> Notes、Tags、Usage、Logs
    -> Windows/Wayland/macOS 发布硬化
```

不得颠倒的关键依赖：

- `better-sqlite3` 必须在扩展 schema 前完成 Windows 原生打包验证。
- `WebContentsView` 必须在正式 Reader UI 前完成 Windows 和 Hyprland 技术探针。
- Translation 必须等待 Reader 分段结构和 Agent Runtime 稳定。
- Summary、Translation 和 Tagging 必须共用 Task/Agent Runtime，不能各自创建队列。
- 自动更新必须等待数据库关闭、备份、升级和安装失败策略稳定。

## 4. 建议目录结构

```text
src/
  main/
    bootstrap/
    database/
      migrations/
      repositories/
    feed/
    reader/
    agents/
    tasking/
    network/
    ipc/
    security/
  preload/
  renderer/
    app/
    components/
    features/
      feeds/
      entries/
      reader/
      summary/
      translation/
      tags/
      notes/
      settings/
    styles/
  shared/
    contracts/
    schemas/
    errors/
    events/

resources/
  prompts/
  themes/
  starter.opml

tests/
  fixtures/
    feeds/
    opml/
    articles/
    llm/
    databases/
  unit/
  integration/
  e2e/

docs/
  adr/
  platform/
  development/
```

目录约束：

- `shared/` 只能包含可序列化 DTO、命令、查询、事件、错误码和 runtime schema。
- `shared/` 不得依赖 Electron、React、SQLite 或 Node-only API。
- Renderer 不得导入 `main/` 中的实现。
- Repository 负责 SQL，Service 不直接拼接 SQL。
- IPC 不暴露任意 channel、SQL、文件路径、HTTP 或 shell 能力。

## 5. 里程碑总览

| 里程碑 | 主要成果 | 参考工作量 | 硬门禁 |
|---|---|---:|---|
| M0 | 需求、ADR、行为契约和 Issue 体系 | 2～3 人日 | 每项 P0 都有验收映射 |
| M1 | Electron 安全壳、SQLite/WebContentsView 平台探针 | 3～5 人日 | Windows 包和原生 Wayland 均可启动 |
| M2 | IPC、数据库、迁移、Task Runtime、HttpClient | 5～7 人日 | 迁移、重启、取消和安全测试通过 |
| M3 | Feed、OPML、Sync 垂直切片 | 6～8 人日 | 打包后的 Windows 应用完成完整 Feed 流程 |
| M4 | Reader 清洗、Markdown、缓存与安全 | 6～8 人日 | Reader corpus 和恶意 HTML 测试通过 |
| M5 | 三栏 UI、Reader/Web/Dual、搜索与阅读状态 | 6～8 人日 | Windows 和 Hyprland 三模式可用 |
| M6 | Provider、Agent Runtime、Summary | 5～7 人日 | Fake LLM 错误矩阵和真实 Provider 认证通过 |
| M7 | Translation 和双语 Reader | 6～9 人日 | checkpoint、局部失败、恢复和重试通过 |
| M8 | Notes、Tags、Usage、Logs、辅助功能 | 10～15 人日 | 所有 P1 功能完成验收 |
| M9 | 跨平台硬化、安装包、RC、文档 | 7～10 人日 | Windows 11、Hyprland、macOS 发布检查通过 |

工作量是风险和拆分参考，不是日历承诺。阶段结束由质量门决定，而不是由日期决定。

## 6. M0：冻结需求与行为契约

### 前置条件

- 已接受 [PORTING.md](PORTING.md) 中的框架决策。

### 任务

- [ ] 将课程要求整理为 `docs/requirements.md`。
- [ ] 建立 Requirement → Issue → Module → Test → Evidence 追踪表。
- [ ] 建立 Swift Mercury 与 Electron 版本的 parity matrix。
- [ ] 明确 P0、P1 和 P2，避免实现过程中持续扩大范围。
- [ ] 编写 main/preload/renderer 进程边界 ADR。
- [ ] 编写 SQLite 所有权和迁移 ADR。
- [ ] 编写 Reader/Web 安全边界 ADR。
- [ ] 编写 Agent Task 生命周期 ADR。
- [ ] 编写 Windows、Wayland、macOS 支持等级 ADR。
- [ ] 建立 `risk-register.md`，记录风险、owner、触发条件和缓解措施。
- [ ] 建立 GitHub Milestones、Issue 模板、PR 模板和标签。
- [ ] 定义统一 Definition of Done。

### 必须迁移的 Mercury 行为

- SQLite 是本地真相源。
- Entry 删除使用 tombstone；派生内容可硬删除。
- 所有用户可见查询统一排除 deleted Entry。
- 列表使用轻量 `EntryListItem`，详情单独加载完整 Entry。
- 搜索基础范围为标题和摘要。
- Reader 内容按 Source HTML、Cleaned HTML、Markdown、Rendered Cache 分层。
- Reader 每层有版本号，可按层失效和重建。
- Agent 运行不会因切换文章自动取消。
- Agent waiting 使用 latest-only replacement。
- 激活文章时先投影持久结果，再判断是否启动新任务。
- Summary、Translation 和单篇 Tagging 使用 Reader 消息面。
- Batch Tagging 使用自己的 sheet-local 消息面。

### 不应照搬的代码形态

- 巨型 Swift `AppModel`。
- SwiftUI、GRDB Record、Combine 和 Swift actor 的具体实现。
- 通过无类型全局计数器刷新 UI。
- 多套不一致的网络客户端和超时策略。
- 把用户可见文案直接持久化为 task title/error。
- 直接共享旧 Swift 生产数据库。

### 退出条件

- [ ] 每项 P0 需求都有唯一 owner。
- [ ] 每项 P0 需求都有自动或人工验收方法。
- [ ] 没有未决定的数据库和 trust-boundary 问题。
- [ ] 明确哪些状态持久化，哪些状态仅存在于内存。
- [ ] 明确 crash、restart、cancel 和 interrupted 的语义。

## 7. M1：Electron 安全壳和平台探针

这是整个项目的第一个硬门禁。

### 任务

- [ ] 初始化 Electron 40+、React、TypeScript、Vite 和 Electron Forge。
- [ ] 精确锁定 Electron、Node package 和 package manager 版本。
- [ ] 启用 TypeScript strict、ESLint、格式检查和 Vitest。
- [ ] 建立安全 `BrowserWindow`。
- [ ] 设置 `nodeIntegration: false`。
- [ ] 设置 `contextIsolation: true`。
- [ ] 设置 `sandbox: true`。
- [ ] 设置 `webSecurity: true`。
- [ ] 设置严格 Content Security Policy。
- [ ] 建立最小 typed preload API。
- [ ] 为 IPC 加入 runtime schema 校验。
- [ ] 创建自定义应用协议，避免直接依赖不受控的 `file://`。
- [ ] 集成 `better-sqlite3` 和 Electron rebuild。
- [ ] 打包后执行一次数据库 create/write/close/reopen smoke。
- [ ] 创建一个独立 session 的最小 `WebContentsView`。
- [ ] 禁止远程页面访问 Node、应用 preload 和 IPC。
- [ ] 拒绝远程页面 popup、任意下载和敏感权限。
- [ ] 在 Windows 11 测试 100%、125%、150% 缩放。
- [ ] 在 Hyprland 测试原生 Wayland 和 XWayland fallback。
- [ ] 生成 Windows、Linux 和 macOS 最小包。
- [ ] 建立最早版本的三平台 CI build matrix。

### 退出条件

- [ ] Windows 安装包能够安装、启动、退出和再次启动。
- [ ] 打包后的 Windows 应用可以加载 `better-sqlite3`。
- [ ] macOS 和 Linux 原生构建成功。
- [ ] Hyprland 下有证据证明应用是原生 Wayland client。
- [ ] `WebContentsView` 在 Windows DPI 和 Wayland fractional scaling 下没有明显错位。
- [ ] Renderer 不能访问 Node、SQLite、文件系统和任意网络能力。
- [ ] 远程网页不能访问应用 IPC。

如果本阶段失败，不得开始大规模业务功能开发。

## 8. M2：IPC、数据库、Task Runtime 和网络基础

### 8.1 Typed IPC

- [ ] 定义 Command、Query 和 Event 三类接口。
- [ ] 为所有 payload 建立 runtime schema。
- [ ] 建立统一 structured result 和 error code。
- [ ] 验证 IPC sender、window 和 session。
- [ ] 支持 event subscription 的显式 unsubscribe。
- [ ] 为 preload API 加入 contract test。
- [ ] 拒绝未知 channel 和未知字段。

不得暴露：

- raw `ipcRenderer`
- 任意 SQL
- 任意文件路径
- 任意 URL fetch
- 任意 shell 或 process execution

### 8.2 SQLite 和迁移

第一批 schema：

- `schema_migration`
- `feed`
- `entry`
- `content`
- `content_html_cache`
- `settings`
- `task_run`

任务：

- [ ] 数据库放在 `app.getPath('userData')/data/mercury.sqlite`。
- [ ] 建立唯一 `DatabaseHost`。
- [ ] 启用 foreign keys、WAL 和 busy timeout。
- [ ] migration 使用独立事务。
- [ ] migration 保存 ID、checksum 和 applied time。
- [ ] 已发布 migration 只能追加，禁止修改。
- [ ] 迁移后执行 foreign key check。
- [ ] 迁移失败时显示恢复页，禁止半迁移启动主 UI。
- [ ] 建立 in-memory 和 on-disk database fixtures。
- [ ] 测试空库、历史版本、重复启动和故障回滚。
- [ ] 定义数据库关闭、WAL checkpoint 和备份流程。

初期由 main-side `DatabaseHost` 访问 SQLite。只有性能分析证明 main event loop 被阻塞时，才将数据库 host 移到 utility process。

### 8.3 统一网络层

- [ ] 建立 main-only `HttpClient`。
- [ ] 支持 request、resource、first-token 和 stream-idle 超时。
- [ ] 支持统一 `AbortSignal`。
- [ ] 限制重定向次数和响应体大小。
- [ ] 显式验证 HTTP status。
- [ ] 根据 Header 和 HTML meta 处理 charset。
- [ ] Feed、Reader 和 Agent 使用不同策略配置，但共用 transport。
- [ ] 支持 fake transport，CI 不访问互联网。
- [ ] 日志过滤 Authorization、API Key、正文、Prompt 和 Response。

### 8.4 Task Runtime

统一状态：

```text
queued -> running -> succeeded | failed | timed_out | cancelled | interrupted
```

- [ ] Task Runtime 是唯一后台任务 owner。
- [ ] `AbortController` 由 runtime 创建和持有。
- [ ] 支持全局并发和 per-kind 并发限制。
- [ ] 取消只来自用户明确操作或硬安全规则。
- [ ] Renderer reload 不取消主进程任务。
- [ ] 启动时把遗留 `running` 转为 `interrupted`。
- [ ] 使用 task/run UUID 关联日志、数据库和 IPC event。
- [ ] 低层错误保存结构化 code/context，Renderer 负责本地化。

### 退出条件

- [ ] migration 和 repository 测试全部通过。
- [ ] 中文用户名、空格和长路径下数据库正常。
- [ ] 非法 IPC payload 和 sender 被拒绝。
- [ ] 网络取消、超时、重定向和错误状态可确定复现。
- [ ] Renderer reload 后后台任务仍能查询和投影。
- [ ] 日志脱敏 canary 测试通过。

## 9. M3：Feed、OPML 和同步垂直切片

### 9.1 领域和 repository

- [ ] 实现 `Feed`、`Entry`、`EntryListItem` 和 `EntryQuery`。
- [ ] Feed URL 全局唯一。
- [ ] `(feedId, guid)` 和 `(feedId, url)` 建立唯一语义。
- [ ] RSS 优先使用 `<guid>`，再回退 URL。
- [ ] Atom 使用 `atom:id`。
- [ ] JSON Feed 使用 `id`。
- [ ] 远端 metadata 更新时保留已读、星标状态。
- [ ] tombstone Entry 永不因同步复活。
- [ ] 建立 published/created/id keyset pagination。

### 9.2 Feed Parser Adapter

- [ ] 把第三方解析库封装在 `FeedParserAdapter` 后面。
- [ ] 输出统一的 normalized feed model。
- [ ] 禁止 XML 外部实体。
- [ ] 正确解析相对 URL。
- [ ] 保留 Atom alternate HTML link 的选择优先级。
- [ ] 建立 RSS、Atom 和 JSON Feed golden fixtures。
- [ ] 加入 CDATA、中文编码、缺字段、重复 ID、异常日期和大 Feed fixtures。

### 9.3 同步协调器

- [ ] 单 Feed 同步。
- [ ] 全量同步。
- [ ] 默认并发上限 6，可配置 `2...10`。
- [ ] 同一个 Feed 不允许重复并发抓取。
- [ ] 单 Feed 失败不阻断其他 Feed。
- [ ] 支持 ETag、Last-Modified 和 304。
- [ ] 429 优先遵循 `Retry-After`。
- [ ] 持久化 per-host backoff。
- [ ] 分别记录每个 Feed 的成功、失败和重试时间。
- [ ] 事务提交后发出 typed invalidation event。

### 9.4 OPML

- [ ] 支持嵌套 outline。
- [ ] 支持 merge 导入。
- [ ] 支持 replace 导入。
- [ ] 支持导出和 XML escape。
- [ ] 支持去重和非法项报告。
- [ ] 缺失标题探测使用有界并发。
- [ ] replace 先写 staging，再以单事务切换。
- [ ] 导出通过临时文件和 atomic rename 完成。
- [ ] starter OPML bootstrap 必须幂等。

### 9.5 最小 UI

- [ ] Sidebar 显示 Feed。
- [ ] Entry List 显示轻量列表。
- [ ] Detail 显示基础 Entry 信息。
- [ ] 添加和删除 Feed。
- [ ] OPML 导入和导出。
- [ ] 手动同步。
- [ ] 同步进度、失败和重试提示。

### 退出条件

在打包后的 Windows 应用完成：

```text
添加 Feed
  -> 同步
  -> 显示文章列表
  -> 打开文章
  -> 关闭应用
  -> 再次启动
  -> 数据仍然存在
```

同时满足：

- [ ] 重复同步不产生重复 Entry。
- [ ] 远端 metadata 更新不覆盖本地阅读状态。
- [ ] tombstone 不复活。
- [ ] 304、429、超时、取消和部分失败有确定测试。
- [ ] OPML replace 失败时旧数据保持完整。
- [ ] 并发抓取不超过配置上限。

## 10. M4：Reader 内容流水线

### 10.1 流水线

```text
Source HTML
  -> Mozilla Readability
  -> Cleaned HTML
  -> Sanitized HTML
  -> Canonical GFM Markdown
  -> ReaderDocument
  -> React Reader
```

- [ ] 保存 Source HTML 和最终 response URL。
- [ ] 保存 document base URL。
- [ ] 运行 Mozilla Readability。
- [ ] 对 Readability 输出再次 sanitize。
- [ ] 生成稳定 Canonical GFM Markdown。
- [ ] Markdown 解析为受控 Reader component tree。
- [ ] 保存 readability、markdown 和 renderer version。
- [ ] 保存 source hash。
- [ ] 建立每 Entry build lock，避免重复并发构建。

### 10.2 版本化缓存

构建决策：

1. Render cache 与版本匹配：直接返回。
2. Markdown 有效但 render 过期：只重渲染。
3. Cleaned HTML 有效但 Markdown 过期：重建 Markdown。
4. Source HTML 有效但 Readability 过期：重跑清洗。
5. 上游数据缺失：重新联网。

- [ ] cache key 包含 entry、theme identity 和 render version。
- [ ] URL 修复时清理错误来源的 Reader 派生内容。
- [ ] 缓存重启后仍可使用。
- [ ] 提供开发构建的 pipeline 重跑和调试入口。

### 10.3 安全和内容保真

- [ ] Source HTML 永不直接注入 Renderer。
- [ ] 禁止 script、事件属性、iframe 和 `javascript:` URL。
- [ ] 外链通过受控 main API 打开。
- [ ] 相对链接和图片根据 base URL 解析。
- [ ] 只接受成功 HTTP status。
- [ ] 限制网页大小。
- [ ] 正确处理非 UTF-8 页面。
- [ ] 覆盖标题、作者、列表、表格、图片、引用和代码块。

### 10.4 Fixture Corpus

至少准备 15～20 篇文章 fixture：

- 中文和英文文章。
- 图片、表格、嵌套列表、代码块、figure/caption。
- malformed HTML。
- 非 UTF-8。
- 重定向、404 和超大页面。
- script、事件属性、iframe、SVG/CSS 注入和危险 URL。

### 退出条件

- [ ] Cleaned HTML 和 Markdown 可查看和调试。
- [ ] 相同输入产生稳定 Markdown 和 segment identity。
- [ ] 仅 renderer 版本变化时不联网、不重跑 Readability。
- [ ] 并发打开同一 Entry 只执行一次上游构建。
- [ ] 恶意 fixture 无脚本进入 Renderer。
- [ ] Golden output diff 经过审查。

## 11. M5：完整桌面 UI 和三种阅读模式

UI 工作可以从 M2 开始使用 fixture 与数据层并行开发，但只能在 M4 后完成集成。

### 11.1 设计系统

- [ ] 分离 App UI token 和 Reader theme token。
- [ ] 建立颜色、字号、间距、圆角、焦点环和状态色。
- [ ] 实现 Button、Menu、Popover、Sheet、Banner 和 SplitPane。
- [ ] 支持 Light、Dark、高对比和 reduced motion。
- [ ] 从第一条用户文案开始使用本地化 key。
- [ ] 支持英文和简体中文长文本。
- [ ] 所有图标按钮具有 accessible name。

### 11.2 三栏工作区

```text
Sidebar | Entry List | Detail
```

- [ ] 可拖动并持久化栏宽。
- [ ] loading、empty、error 和 recovery 状态。
- [ ] 小窗口降级策略。
- [ ] 键盘导航和焦点顺序。
- [ ] 虚拟列表和 keyset pagination。
- [ ] Feed、未读、星标和标签筛选。
- [ ] 搜索 300ms debounce。
- [ ] 搜索基础范围只包括标题和摘要。
- [ ] 旧查询响应不能覆盖新筛选结果。
- [ ] 自动选中的文章不自动标已读。
- [ ] 用户主动选择并停留 3 秒后标已读。

### 11.3 Reader、Web 和 Dual

- [ ] Reader 使用受控 React component tree。
- [ ] Web 使用 main process 管理的隔离 `WebContentsView`。
- [ ] Dual 将 Reader 和 Web 并列。
- [ ] Renderer 通过 `ResizeObserver` 报告 Web host bounds。
- [ ] Main 使用 Electron DIP 坐标设置 bounds。
- [ ] modal、sheet 或 inspector 打开时正确处理 native view 层级。
- [ ] 拒绝摄像头、麦克风、定位、通知和剪贴板写入权限。
- [ ] popup、下载、外部导航和非 HTTP(S) scheme 使用显式策略。
- [ ] TLS 错误不得静默忽略。

### 退出条件

- [ ] 三种模式反复切换不残留旧网页。
- [ ] Dual 分隔条拖动不重新加载网页。
- [ ] 远程网页不能覆盖工具栏或接收工具栏区域点击。
- [ ] Windows 100%、125%、150%、200% DPI 正常。
- [ ] Hyprland fractional scaling、多显示器、IME 和焦点正常。
- [ ] 1024×700 下可完成主要工作流。
- [ ] 基础 RSS 阅读器可以独立演示。

## 12. M6：Provider、Agent Runtime 和 Summary

### 12.1 数据和密钥

新增：

- `agent_provider`
- `agent_model`
- `agent_route`
- `agent_run`
- `llm_usage_event`
- `summary_result`

- [ ] API Key 只保存到 Electron `safeStorage`。
- [ ] SQLite 只保存 `credential_ref`。
- [ ] Renderer 保存后不能重新读取明文 Key。
- [ ] Windows 验证 DPAPI-backed safeStorage。
- [ ] macOS 验证 Keychain-backed safeStorage。
- [ ] Linux 检测 selected storage backend。
- [ ] Linux 为弱 `basic_text` backend 提供明确告警。

### 12.2 Provider Adapter

- [ ] 定义 `validateProvider`、`complete`、`stream` 和 `cancel`。
- [ ] 支持自定义名称、Base URL、API Key 和 Model ID。
- [ ] 保留 Base URL 中已有 provider path。
- [ ] 支持本地 loopback HTTP。
- [ ] 支持 OpenAI-compatible SSE。
- [ ] 支持 primary/fallback route。
- [ ] 保存实际 provider、model、endpoint 和参数快照。
- [ ] 正确区分 missing usage 和 zero usage。
- [ ] 日志中不出现 Key、Authorization、完整 Prompt 和 Response。

### 12.3 Agent Runtime

- [ ] 复用通用 Task Runtime。
- [ ] 建立纯状态机和 runtime store。
- [ ] Summary 每类 active 1、waiting 1。
- [ ] waiting 使用 latest-only replacement。
- [ ] entry 切换只清除旧 waiting，不取消 in-flight。
- [ ] persisted-first 激活。
- [ ] stale run token 不能写入新 owner/slot。
- [ ] Prompt 默认模板放在 `resources/prompts/`。
- [ ] 首次自定义复制模板，不能覆盖现有文件。

### 12.4 Summary

结果槽：

```text
entryId + targetLanguage + detailLevel
```

- [ ] 语言和详细程度选择。
- [ ] 流式输出。
- [ ] Cancel、Copy 和 Clear。
- [ ] Auto Summary 首次费用确认。
- [ ] Auto Summary 使用 1 秒 debounce、串行、失败不自动重试。
- [ ] owner-scoped streaming projection。
- [ ] 用户向上滚动后不强制拉回底部。

### 退出条件

- [ ] Fake LLM 覆盖正常流、断流、401、429、5xx 和各类超时。
- [ ] 有持久化结果时不重复请求。
- [ ] 切文章不取消 in-flight Summary。
- [ ] 旧 run 不能污染新文章或新 slot。
- [ ] DeepSeek、chatECNU 和一个本地服务各完成人工认证。
- [ ] 数据库、日志和诊断包不包含明文 API Key。

## 13. M7：Translation Agent

Translation 必须等待 Reader segment 和 Agent Runtime 稳定。

### 数据契约

兼容键：

```text
entryId + targetLanguage + sourceHash + segmenterVersion
```

支持的 segment：

- `p`
- `ul`
- `ol`
- 可选的 title/author synthetic segment

### 任务

- [ ] 新增 `translation_result` 和 `translation_segment`。
- [ ] Reader source document 保持 immutable。
- [ ] 双语内容由 translation projection 派生。
- [ ] 分段并发可配置 `1...5`，默认 `3`。
- [ ] 每段完成后持久化 checkpoint。
- [ ] 支持 pending、translated 和 failed segment。
- [ ] 支持单段重试。
- [ ] 支持全部失败段重试。
- [ ] 支持 Cancel 和 Resume。
- [ ] 取消、失败和超时保持不同语义。
- [ ] 合并流式 UI 更新，避免每 Token 重渲染全文。
- [ ] Translation 只在 Reader 模式可用。
- [ ] 切换 Web/Dual 时恢复原文。
- [ ] Reader pipeline 重建时禁止启动新 Translation。

### 退出条件

- [ ] 有兼容结果时直接显示，不产生请求。
- [ ] Source hash 改变后不展示旧翻译。
- [ ] 单段失败不丢失其他成功段。
- [ ] 单段重试只更新目标 segment。
- [ ] 中途退出和重启后可以恢复 checkpoint。
- [ ] 切换文章不发生跨文章状态污染。
- [ ] 取消后已持久化成功段仍可投影。
- [ ] 长文章翻译时滚动位置和 UI 响应可接受。

## 14. M8：附加功能

本阶段可以拆成多个并行工作流。

### 14.1 Notes 和 Digest

- [ ] 每 Entry 一份 Markdown Note。
- [ ] debounce 自动保存。
- [ ] 切文章、关面板、窗口失焦和导出前 flush。
- [ ] 保存失败时保留本地 draft。
- [ ] 单篇 Markdown Digest。
- [ ] 当前查询范围内的多篇 Digest。
- [ ] 使用临时文件和 atomic rename 导出。
- [ ] 导出文件名支持中文、空格和非法字符处理。

### 14.2 Tags

- [ ] 手动标签和统一 normalize。
- [ ] `Tag`、`TagAlias`、`EntryTag`。
- [ ] Sidebar 标签筛选。
- [ ] Any/All 筛选和最多选择数量。
- [ ] 标签管理、rename、merge 和 alias。
- [ ] Tag Agent 只生成建议，不自动写库。
- [ ] 用户点击建议后才应用。
- [ ] panel-scoped 请求在关闭时取消。
- [ ] 批量标签运行、checkpoint 和新标签审查。
- [ ] Batch sheet 使用独立消息面。
- [ ] 活跃批量任务期间保护破坏性 tag mutation。

### 14.3 Usage

- [ ] Provider、Model 和 Agent 维度统计。
- [ ] 输入、输出和总 Token。
- [ ] missing usage 与 zero usage 分开。
- [ ] 成功、失败、取消和超时均记录 request status。
- [ ] Entry 删除后保留 usage 历史，Entry 外键置空。

### 14.4 Localization、Logs 和 Debugging

- [ ] 补齐英文和简体中文。
- [ ] 检查失效和缺失 localization key。
- [ ] 日志本地保存并轮转。
- [ ] 默认不上传遥测和 crash report。
- [ ] 日志禁止记录正文、Prompt、Response、Note 和 Key。
- [ ] 用户主动导出脱敏诊断包。
- [ ] 提供 Reader pipeline 和 task trace 调试信息。
- [ ] 诊断包只包含版本、schema、非敏感设置摘要和脱敏日志。

### 退出条件

- [ ] 所有 P1 功能有自动化或人工验收。
- [ ] 保存失败和中途退出不会丢失用户输入。
- [ ] Batch Tagging 能从持久化状态恢复。
- [ ] Usage 聚合结果与 request events 一致。
- [ ] 日志 canary 测试证明无正文和密钥泄漏。

## 15. M9：测试、跨平台硬化与发布

### 15.1 测试层级

每个 PR：

- TypeScript strict typecheck。
- ESLint 和格式检查。
- 单元测试。
- React 组件测试。
- SQLite migration 和 repository 测试。
- IPC schema 和 sender 安全测试。
- Reader 恶意 HTML corpus。
- 无 GUI 集成测试。
- 生产 renderer/main build。

Nightly：

- 三平台原生打包。
- Windows packaged E2E。
- 受保护 Hyprland runner 的原生 Wayland smoke。
- macOS package launch smoke。
- 大数据库、长文章和重复 Agent 生命周期测试。
- 保存脱敏日志、JUnit、coverage 和 Playwright trace。

Release Candidate：

- 三平台从同一 commit 原生构建。
- 生成 SBOM、dependency manifest 和 SHA-256 checksum。
- 在受保护 job 中签名和公证。
- 在干净环境安装、启动和执行数据库 smoke。
- 发布 prerelease。
- 完成人工验收后再发布 stable。
- RC 问题必须使用新 commit 和新 artifact 修复，不能替换旧产物。

### 15.2 Windows 11 x64 主验收

- [ ] 标准非管理员用户安装。
- [ ] 首次启动、退出和重启。
- [ ] 从上一版本升级并保留数据库。
- [ ] 卸载行为符合文档。
- [ ] 中文用户名、空格和长路径。
- [ ] 100%、125%、150%、200% 缩放。
- [ ] 多显示器和 scale change。
- [ ] 中文 IME、剪贴板、drag/drop 和文件对话框。
- [ ] Reader、Web、Dual。
- [ ] localhost LLM、离线和网络切换。
- [ ] sleep/resume 和窗口恢复。
- [ ] 安装目录无数据库副本、明文 Key 或敏感日志。

首版使用 Electron Forge + Squirrel.Windows `Setup.exe`。只有明确需求时才增加 MSI。

### 15.3 Hyprland 原生 Wayland 验收

- [ ] 记录 `XDG_SESSION_TYPE` 和 Chromium Ozone backend。
- [ ] 证明窗口不是 XWayland client。
- [ ] XWayland fallback 单独记录。
- [ ] fractional scaling 和文本锐度。
- [ ] 中文 IME、clipboard 和 drag/drop。
- [ ] `xdg-desktop-portal-hyprland` 文件对话框。
- [ ] safeStorage secret-service backend。
- [ ] Reader/Web/Dual resize 和焦点。
- [ ] 多显示器、不同 scale 和热插拔。
- [ ] suspend/resume 和窗口恢复。
- [ ] Intel、AMD、NVIDIA 中可以获得的硬件测试。

不得为所有用户全局发布 `--disable-gpu`。GPU switch 只能作为已确认驱动问题的诊断或定向 fallback。

### 15.4 macOS 验收

- [ ] Apple Silicon 原生包。
- [ ] native module 测试。
- [ ] Keychain-backed safeStorage。
- [ ] Retina、多显示器和 sleep/resume。
- [ ] 文件对话框、菜单、快捷键和外部链接。
- [ ] Developer ID、hardened runtime 和 entitlements。
- [ ] notarization、staple 和 Gatekeeper 首次启动。
- [ ] 与 SwiftUI Mercury 使用不同 bundle ID 和 userData 目录。

### 15.5 发布产物

- Windows：`Setup.exe`。
- Linux：portable archive 和一个明确支持的 distro package。
- macOS：DMG 或 ZIP。
- 每个平台附 git SHA、App/Electron/Node 版本、schema version、SBOM、checksum 和已知问题。

首版暂不启用自动更新。Updater 必须作为独立 ADR 和里程碑处理。

### 最终退出条件

- [ ] Windows 11 全量验收通过。
- [ ] Hyprland 原生 Wayland 有可复核证据。
- [ ] macOS 包通过 Gatekeeper 路径。
- [ ] 三个平台从同一 commit 原生构建。
- [ ] 无未处理 P0/P1 缺陷。
- [ ] 无未处理 Critical/High 安全问题。
- [ ] Reader 不能执行文章脚本。
- [ ] Remote Web 无 Node、preload 和应用 IPC 权限。
- [ ] API Key 不进入 SQLite、日志和诊断包。
- [ ] 崩溃、重启和安装升级不会损坏数据库。
- [ ] 用户文档、开发文档、隐私说明和演示脚本完成。

## 16. 测试 Fixture 治理

### Feed Fixtures

- RSS 2.0、Atom、JSON Feed。
- 缺字段、重复 GUID、异常日期和 CDATA。
- 不同编码和相对 URL。
- redirect、404、429、5xx、timeout 和连接中断。
- 大 Feed、重复 Entry 和分页排序边界。

### Reader Fixtures

- 标题、作者、base URL、图片和链接图片。
- Table、nested list、figure、caption 和 code block。
- GFM table、strikethrough 和 raw HTML。
- malformed HTML 和特殊站点页面。
- script、event handler、iframe、SVG/CSS 注入和危险 URL。

### Database Fixtures

- 空库和已填充库。
- 每一个正式发布 schema 的脱敏 snapshot。
- WAL、锁、只读、损坏和 migration 中断样本。
- 中文用户名、空格和长目录名。

### LLM Fixtures

- 确定性 non-stream 和 SSE stream。
- usage 存在、缺失和零值。
- malformed chunk、断流和迟到 event。
- 401、429、5xx 和四类 timeout。
- primary/fallback route。
- Translation 部分 segment 成功和 checkpoint resume。

### 治理规则

- [ ] 每个 fixture 记录来源、用途、许可和预期结果。
- [ ] 禁止提交私人 Feed、真实 Key、用户数据库和受限文章全文。
- [ ] Golden output 更新必须在 PR 中显示 diff。
- [ ] Swift 和 Electron 使用同一 corpus 做差分测试。
- [ ] 差异必须记录为明确产品决策。

## 17. 团队分工和并行策略

三人团队建议：

| 角色 | 主要职责 |
|---|---|
| A：平台与数据 | Electron main、SQLite、IPC、Feed、OPML、Sync |
| B：UI 与 Reader | React、设计系统、Reader/Web/Dual、Notes |
| C：Agent 与质量 | Provider、Summary、Translation、Tags、测试、CI/CD |

共同负责：

- ADR 和跨模块代码审查。
- 数据库、安全和 release workflow 变更。
- Windows 和 Wayland 实机验收。
- parity matrix 和最终演示。

可并行工作：

- M2 数据层与 M5 设计系统可以通过 fixture 并行。
- M3 Feed 与 M4 Reader fixture corpus 可以并行准备。
- M8 Notes、Tags、Usage 可以在 Agent Runtime 稳定后并行。
- 平台打包和 CI 必须从 M1 持续维护，不能留到最后。

不可并行或必须等待：

- Translation 等待 Reader segment 和 Agent Runtime。
- Batch Tagging 等待 Tag schema、Task Runtime 和 review contract。
- 自动更新等待数据库 shutdown、backup 和 installer contract。

## 18. 参考时间表

以下是三人、AI 辅助开发的参考节奏：

| 周次 | 目标 |
|---|---|
| 第 1 周 | M0～M1：契约、脚手架、Windows/Wayland 探针 |
| 第 2 周 | M2：SQLite、IPC、Task Runtime、HttpClient |
| 第 3 周 | M3：Feed、OPML、Sync 垂直切片 |
| 第 4 周 | M4～M5：Reader 流水线和三种模式 |
| 第 5 周 | M6：Provider、Agent Runtime、Summary |
| 第 6 周 | M7：Translation |
| 第 7 周 | M8：Notes、Tags、Usage、Logs |
| 第 8 周 | M9：跨平台硬化、RC 和演示 |

如果只有一个人，应按里程碑串行推进，不应同时展开多个功能面。实际完成条件以质量门为准，不以日期为准。

## 19. AI 生成代码的工作规则

每个 Issue 应控制在 1～2 天内可完成，并要求 Coding Agent：

1. 先阅读 `PORTING.md`、本计划、相关 ADR 和接口契约。
2. 一次只修改一个子系统。
3. 同时生成或更新测试。
4. 不绕过 typed IPC。
5. 不关闭 sandbox、CSP 或 `webSecurity`。
6. 不把 API Key 存入 SQLite。
7. 不在 Renderer 中直接调用 Node、SQLite 或文件系统。
8. 不修改已经发布 migration 的内容和 checksum。
9. 不用 sleep-based 测试掩盖竞态。
10. 不根据第三方英文错误文本片段决定核心状态。
11. 不在一个 PR 中同时重构架构和新增大功能。
12. PR 必须附带验收证据、平台影响和文档更新。

推荐流程：

```text
Issue
  -> ADR（需要时）
  -> Contract/Test
  -> Implementation
  -> PR
  -> CI/Evidence
  -> Documentation
  -> Merge
```

## 20. 第一批 GitHub Issues

建议项目启动时先建立以下 Issues：

1. `docs: establish requirements traceability and parity matrix`
2. `docs: record Electron process and security boundary ADR`
3. `build: scaffold Electron React TypeScript Forge application`
4. `security: enforce BrowserWindow CSP sandbox and context isolation`
5. `ipc: create typed preload bridge with runtime validation`
6. `database: prove better-sqlite3 in packaged Windows application`
7. `platform: validate WebContentsView on Windows DPI settings`
8. `platform: validate native Wayland WebContentsView on Hyprland`
9. `ci: add native Windows Linux and macOS build matrix`
10. `database: implement migration runner and database fixtures`
11. `tasking: implement task state machine and cancellation ownership`
12. `network: implement injectable HTTP client and timeout policies`
13. `feed: create RSS Atom and JSON Feed fixture corpus`
14. `feed: implement parser adapter and normalized feed model`
15. `feed: implement repositories deduplication and tombstones`
16. `sync: implement bounded feed synchronization coordinator`
17. `opml: implement transactional import and atomic export`
18. `ui: build fixture-driven three-column application shell`
19. `reader: establish malicious HTML and content fidelity corpus`
20. `reader: implement layered Readability to Markdown pipeline`

完成前 9 个 Issue 后，应先召开一次 go/no-go review。只有 Windows 安装包、SQLite native module 和 Hyprland 原生 Wayland 探针均通过，才进入 Feed 业务开发。

## 21. 全局 Definition of Done

任何 Issue 或里程碑只有同时满足以下条件才算完成：

- [ ] 行为和非目标清晰。
- [ ] 自动化测试或明确人工验收已完成。
- [ ] TypeScript、lint、format 和测试全部通过。
- [ ] 没有降低 Electron 安全基线。
- [ ] 没有绕过 IPC 或状态所有权。
- [ ] 数据变更具有 migration 和升级测试。
- [ ] 用户可见文案已经本地化。
- [ ] 日志和诊断信息经过脱敏。
- [ ] Windows 影响已评估。
- [ ] Wayland 和 macOS 影响已评估。
- [ ] 相关 ADR、文档、parity matrix 和风险登记已更新。
- [ ] PR 包含测试结果、截图或其他可复核证据。
- [ ] 没有遗留测试进程、临时数据库或敏感 artifact。

项目的第一项实际开发工作应是 M0 和 M1，而不是直接实现 Feed 或 AI。只有“安全空应用 + packaged SQLite + isolated WebContentsView”同时在 Windows 11 和 Hyprland 原生 Wayland 上通过，项目才进入正式功能开发阶段。
