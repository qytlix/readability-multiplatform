# Changelog

All notable changes to Shale will be documented in this file.

## [0.3.1] - 2026-07-29

### Added

- 标签 Tag 系统：全链路实现，包括数据库迁移、Store/Service/IPC Handler、
  Preload API、Tag Badge/Input/FloatingWindow 组件、标签筛选与导航、
  AI 自动标签（AutoTagService + Provider + Panel）、标签颜色主题感知、
  实时筛选候选标签。
- 搜索增强：结构化筛选语法（`+tag:`, `-tag:`, `field:`），模糊/精确
  匹配模式，覆盖层搜索界面，动画过渡，中间面板联动折叠。
- 结构化日志导出：ExportService 全链路带自定义脚注、批注、安全文件名。

### Changed

- 标签筛选语法统一：`tag=`（精确匹配）、`tag:`（模糊 LIKE），
  移除旧兼容路径。

### Fixed

- Arch Linux CI 包版本改为从 package.json 动态读取，不再硬编码。
- Arch Linux 构建产物现在正确包含应用图标。
- 标签按钮在侧边栏高亮、导航状态同步、刷新 entry list 等交互问题。
- 搜索覆盖层退出逻辑、网格布局联动、过滤边界情况。
- 修复 tag 路由集成导致的 CI 测试失败。

### Docs

- 搜索设计文档与实现计划。
- Tag 系统设计文档。

## [0.3.0] - 2026-07-27

### Added

- Advanced Translation：支持 `auto + 8` 语言、OpenAI/DeepSeek/OpenRouter/
  Anthropic/Gemini Provider、智能全文上下文、29 个离线 AI 专家、34 个离线
  术语库、用户 YAML/CSV 导入，以及结构化单词/短语/句子划词翻译。
- 文章导出功能：支持单篇和多篇 Markdown 导出，含自定义脚注、批注和
  安全文件名生成；ExportService、IPC Handler、Preload API、导出对话框
  和选择模式批量导出入口全链路实现。
- Token 用量统计与图表：Provider 调用按模型记录 token 消费，用量统计
  界面以图表展示。
- 结构化本地日志系统：带保留策略的本地日志文件、Instrument feed/OPML/
  Provider/Summary/Content Pipeline 各生命周期。
- 文章批注笔记（Annotation Notes）：可锁定、持久化、对齐高亮的文本批注，
  支持翻页后重新定位。
- Feed 去重统一：FeedIdentity URL 规范化、`dedupKey` 列、跨 FeedService
  和 OPMLImportService 的统一去重逻辑。
- OPML 导入页面优化。
- 新的 UI 风格与阅读体验：版面布局刷新、翻页动画、阅读进度跟踪与暂停页面。
- 文章多选模式（选择模式下的批量操作）。
- GPT-5.6 模型选项。
- 旧数据库从迁移 011 连续升级到 015、重启恢复、超长文章全文代表采样和
  Translation 敏感日志哨兵的集成回归。
- 设置界面优化。

### Changed

- 超过 48,000 字符的智能上下文由"只分析开头"改为固定预算下覆盖文章开头、
  中间区域和结尾的确定性采样；上下文缓存版本升级为
  `translation-context-v2`。
- 交互逻辑优化：页面交互、工具栏整理、翻译流程改进。

### Fixed

- 安装和启动时按 Electron ABI 加载验证 `better-sqlite3`，发现错误原生模块时自动重建，避免依赖更新或 Node 测试后因遗留 Forge 元数据启动失败。
- 中文翻译结果统一为所选语言变体（简体中文/香港繁体），并升级提示词缓存版本。
- 简体和繁体交错翻译问题。
- 翻译时语言混合的问题。
- 部分文章无法 fetch 的问题。
- 重新翻译逻辑。
- 按钮颜色问题。
- 相对 URL 无法识别的问题。
- 删除菜单栏。
- 再次点击文章关闭文章的行为。
- 减少翻译日志输出，保留 Reader 工具栏。

### Security

- 生产依赖审计为 0 漏洞；新增自动化断言，确保 Translation 诊断不包含 API
  Key、Authorization/Bearer 信息或文章正文。

### Docs

- 导出文章详细计划与笔记导出格式更新。
- 复选框适配经验汇总。

## [0.2.4] - 2026-07-21

### Added

- 项目目录架构重构：#24 大规模重构完成
  - `src/main/feed/` 拆分为 `fetcher/`、`parser/`、`services/`、`stores/` 子目录
  - `src/main/ai/` 拆分为 `provider/`、`services/`、`stores/` 子目录
  - `tests/unit/` 拆分为按模块组织的子目录
- 新增 `src/main/services.ts` 统一服务初始化
- 新增 `src/shared/domain-api.ts` 分离领域 API 类型
- `src/main/feed/services/index.ts` 和 `src/main/feed/stores/index.ts` barrel export
- Pane Layout 领域模块提取：模型、几何、序列化、存储、过渡、CSS 变量、焦点恢复等独立模块

### Changed

- Pane Layout 重构：`usePaneLayout` 从 469 行单体拆分为 9 个独立 hooks/modules
- 整合相关单个 Feed/Service barrel 导出

### Fixed

- 受限布局下 pane 偏好保存与恢复
- 折叠状态下 pane 宽度保持

### Docs

- 新增 `docs/refactor/refactor-issues-summary-24-23.md`
- 新增 `docs/refactor/refactor-plan-24.md`
- 新增 `docs/refactor/refactor-result-24.md`

## [0.2.3] - 2026-07-17

### Fixed

- 构建文件恢复（#19 误删、#20 恢复后又误删的残留文件）
- 文档恢复（#19 误删的文档文件）

## [0.2.2] - 2026-07-16

### Added

- Summary 功能模块：GPT 模型选择、API Key 持久化（plaintext + keyring 双通道）

### Fixed

- macOS 代码签名（ad-hoc signing）
- Windows 高 DPI 缩放问题
- Windows & Wayland 跨平台构建修复

### Docs

- plaintext key fallback 工作机制说明

## [0.2.1] - 2026-07-16

### Fixed

- Reader 文章内链接点击修复
- 清理测试 IPC 调试代码

### Changed

- 文件夹折叠状态调整

## [0.2.0] - 2026-07-16

### Added

- Feed 模块 Windows 平台适配
- ContentFetcher 三级自动降级：Simple → Enhanced → BrowserFetch
- BrowserFetchStrategy Cloudflare Challenge 检测与等待
- 文件夹折叠与调整功能
- Feed 列表单条刷新按钮
- OPML 导入对话框样式适配
- 无 Feed 时的空状态提示

### Changed

- 按钮样式整体迁移至 M2.2 规范
- Reader 状态管理与动画效果
- 图标资源配置合并
- 配色与布局比例调整

### Fixed

- 删除/编辑 Feed 后仅本地 DB 重载，不再触发全量网络同步
- 底部 Sync 状态显示修复
- Feed 列表渲染修复
- App.tsx 中缺失的 useRef 导入
- 按钮高度适配父容器

### Docs

- M2.1 ContentFetcher 三级降级方案 (#65e6e94)
- M2.1 Cloudflare Challenge 实际测试记录
- M2/M3 前置条件更新
- cherry-pick 记录

## [0.1.1] - 2026-07-15

### Fixed

- macOS ad-hoc code signing 配置，修复 Gatekeeper "damaged" 错误

## [0.1.0] - 2026-07-15

### Added

- 工程脚手架：Electron Forge + React + TypeScript 工程底座
- typed IPC bridge（Preload + contextBridge）
- SQLite 数据库集成（better-sqlite3）与迁移机制
- Feed 模块 M0：FeedParserAdapter + Readability 正文提取原型
- Feed 模块 M1：Store / Service / IPC Handler / UI 全链路（98 项测试）
- CI/CD：GitHub Actions 多平台构建（Windows / macOS / Linux / Arch Linux）
- Wayland 原生支持

### Changed

- 项目命名与初始化配置

### Fixed

- better-sqlite3 原生模块打包后不可用的问题
- npm test/start 原生模块版本统一（添加 pretest 自动 rebuild）
- CI 多平台构建失败（Windows MSVC、macOS、Arch Linux 容器）
- lockfile 重新生成，补充 encoding 可选依赖
- vitest.config.ts eslint import/no-unresolved 报错
- 构建产物 .desktop 文件忽略

### Docs

- 架构设计、数据库设计、INIT/PLAN 基线
- 开发环境搭建指南（Linux / nvm / Wayland）
- IPC 契约文档
- M1 修复总结
- NODE_MODULE_VERSION 完整工作流
