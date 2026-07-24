# Changelog

All notable changes to Shale will be documented in this file.

## [Unreleased]

### Added

- Advanced Translation：支持 `auto + 8` 语言、OpenAI/DeepSeek/OpenRouter/
  Anthropic/Gemini Provider、智能全文上下文、29 个离线 AI 专家、34 个离线
  术语库、用户 YAML/CSV 导入，以及结构化单词/短语/句子划词翻译。
- 增加旧数据库从迁移 011 连续升级到 015、重启恢复、超长文章全文代表采样和
  Translation 敏感日志哨兵的集成回归。

### Changed

- 超过 48,000 字符的智能上下文由“只分析开头”改为固定预算下覆盖文章开头、
  中间区域和结尾的确定性采样；上下文缓存版本升级为
  `translation-context-v2`。

### Fixed

- 安装和启动时按 Electron ABI 加载验证 `better-sqlite3`，发现错误原生模块时自动重建，避免依赖更新或 Node 测试后因遗留 Forge 元数据启动失败。

### Security

- 生产依赖审计为 0 漏洞；新增自动化断言，确保 Translation 诊断不包含 API
  Key、Authorization/Bearer 信息或文章正文。

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
