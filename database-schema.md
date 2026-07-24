# Database Schema

> 来自 Mercury 的数据库设计，做了一些调整

---

## 目录

1. [文章内容](#1-文章内容)
2. [LLM](#2-llm)
3. [Tag](#3-tag)

---

## 1. 文章内容

### feed — 订阅源

存储 RSS/Atom 订阅源的元信息。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `title` | TEXT | — | 订阅源标题 |
| `feedURL` | TEXT | NOT NULL, UNIQUE | Feed URL |
| `siteURL` | TEXT | — | 网站 URL |
| `feedParserVersion` | INTEGER | — | 解析器版本号，用于内容刷新检测 |
| `lastFetchedAt` | DATETIME | — | 最后一次拉取时间 |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |

**索引：**
- `idx_feed_feedURL` — `feedURL`（唯一）

---

### entry — 文章条目

订阅源中的单篇文章。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `feedId` | INTEGER | NOT NULL → feed(id) CASCADE | 所属订阅源 |
| `guid` | TEXT | — | 全局唯一 ID（来自 Feed） |
| `url` | TEXT | — | 文章 URL |
| `title` | TEXT | — | 文章标题 |
| `author` | TEXT | — | 作者 |
| `publishedAt` | DATETIME | — | 发布时间 |
| `summary` | TEXT | — | 摘要 |
| `isRead` | BOOLEAN | NOT NULL, 默认 `false` | 已读状态 |
| `isStarred` | BOOLEAN | NOT NULL, 默认 `false` | 星标状态 |
| `isDeleted` | BOOLEAN | NOT NULL, 默认 `false` | 软删除标记 |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |

**唯一约束：** `(feedId, guid)`、`(feedId, url)`

**索引：**
- `idx_entry_feed_guid` — `(feedId, guid)` 唯一
- `idx_entry_feed_url` — `(feedId, url)` 唯一
- `idx_entry_published_created` — `(publishedAt, createdAt)` — 按时间排序
- `idx_entry_feed_published_created` — `(feedId, publishedAt, createdAt)` — 按订阅源+时间筛选
- `idx_entry_isRead_published_created` — `(isRead, publishedAt, createdAt)` — 已读/未读筛选
- `idx_entry_starred_published_created` — 部分索引 `(publishedAt DESC, createdAt DESC) WHERE isStarred = 1` — 星标列表

**关联：**
- `entry` N : 1 `feed`
- `entry` 1 : 1 `content`（文章正文）
- `entry` 1 : N `content_html_cache`（渲染缓存，每种主题一条）
- `entry` 1 : N `entry_annotation`（任意文本范围的高亮批注，当前已实现）
- `entry` 1 : 1 `entry_note`（全文笔记）
- `entry` 1 : N `entry_note_anchor`（段锚定笔记）
- `entry` M : N `tag`（通过 `entry_tag`）

---

### content — 文章正文（一对一）

由 Readability 提取/清洗后的文章内容。一个 entry 最多对应一条 content。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `entryId` | INTEGER | NOT NULL → entry(id) CASCADE, UNIQUE | 关联文章 |
| `html` | TEXT | — | 从原文 URL 抓取的原始 HTML |
| `cleanedHtml` | TEXT | — | Readability 提取清洗后的 HTML |
| `readabilityTitle` | TEXT | — | Readability 在清洗时提取的标题 |
| `readabilityByline` | TEXT | — | Readability 在清洗时提取的作者行 |
| `readabilityVersion` | INTEGER | — | Readability 提取规则版本号（`nil` = 0） |
| `markdown` | TEXT | — | 由 `cleanedHtml` 转换得到的 Markdown |
| `markdownVersion` | INTEGER | — | Markdown 转换器版本号（`nil` = 0） |
| `displayMode` | TEXT | NOT NULL | 显示模式：`"web"` 或 `"cleaned"` |
| `documentBaseURL` | TEXT | — | 文档基准 URL，用于解析 `html` 中的相对资源 |
| `pipelineType` | TEXT | NOT NULL | 阅读器管道类型：`"default"` 或 `"obsidian"` |
| `resolvedIntermediateContent` | TEXT | — | 管道类型特定的中间状态，由 `pipelineType` 解释 |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |

**索引：** `idx_content_entry` — `entryId`（唯一）

---

### content_html_cache — 渲染 HTML 缓存

按主题缓存的 reader 渲染产物。key 为 `(themeId, entryId)`。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `entryId` | INTEGER | → entry(id) CASCADE | 关联文章 |
| `themeId` | TEXT | NOT NULL | 主题 ID |
| `html` | TEXT | NOT NULL | 渲染后的 HTML |
| `readerRenderVersion` | INTEGER | — | 渲染器版本号（`nil` = 0），用于缓存失效 |
| `updatedAt` | DATETIME | NOT NULL | 更新时间 |

**主键：** `(themeId, entryId)`

---

### entry_annotation — 文本范围高亮批注（一对多，当前实现）

用户在清洗后的 Reader 正文中选择任意文本范围并添加高亮与可选便签。
批注独立于 `entry_content` 保存，不把 `<mark>` 写回清洗 HTML。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 批注身份 |
| `entryId` | INTEGER | NOT NULL → entry(id) CASCADE | 所属文章 |
| `startOffset` / `endOffset` | INTEGER | NOT NULL | 基于 Reader `textContent` 的 UTF-16 半开区间 |
| `selectedText` | TEXT | NOT NULL | 创建批注时的精确选中文本 |
| `prefixText` / `suffixText` | TEXT | NOT NULL | 锚点前后文，用于正文偏移变化后的恢复 |
| `color` | TEXT | NOT NULL | `yellow` / `green` / `blue` / `pink` |
| `noteText` | TEXT | NOT NULL | 便签纯文本，可为空 |
| `createdAt` / `updatedAt` | TEXT | NOT NULL | 创建与最近更新时间 |

**唯一约束：** `(entryId, startOffset, endOffset)`

**索引：** `idx_entry_annotation_entry` — `(entryId, startOffset, endOffset)`

当前实现不允许范围重叠。删除批注时，高亮与便签作为一个实体同时删除。
详细锚点恢复与验证方式见 `docs/annotations.md`。

---

### entry_note — 全文笔记（一对一）

用户为整篇文章添加的笔记，不锚定具体段落。与 `entry_note_anchor` 共存，前者对应全文，后者对应段落。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `entryId` | INTEGER | PK → entry(id) CASCADE | 关联文章（一对一的 key） |
| `markdownText` | TEXT | NOT NULL | Markdown 格式笔记内容 |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |
| `updatedAt` | DATETIME | NOT NULL | 更新时间 |

---

### entry_note_anchor — 段锚定笔记（一对多）

锚定到文章具体段落的笔记。`segmentId` 的生成算法与翻译分段系统相同，确保同一段内容在不同次提取间 ID 稳定。

一段一文只能有一条笔记，但一篇可包含多条不同段的笔记。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `entryId` | INTEGER | NOT NULL → entry(id) CASCADE | 关联文章 |
| `segmentId` | TEXT | NOT NULL | 段 ID，基于内容哈希的稳定标识符 |
| `noteText` | TEXT | NOT NULL | Markdown 格式笔记内容 |
| `sourceTextSnapshot` | TEXT | — | 记笔记时该段的文本快照，用于原文变更后对照 |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |
| `updatedAt` | DATETIME | NOT NULL | 更新时间 |

**唯一约束：** `(entryId, segmentId)` — 一段一文只允许一条笔记

**索引：**
- `idx_note_anchor_entry` — `entryId` — 按文章查询所有段笔记
- `idx_note_anchor_segment` — `segmentId` — 按段 ID 查询

**段 ID 生成算法（跨平台）：**

段 ID 的格式为 `seg_{orderIndex}_{sha256Hex}`，计算过程不依赖任何特定语言或框架：

1. **提取分段**：在已清洗、已消毒的 Reader HTML 中按深度优先遍历
   - 只取 `<p>`、`<ul>`、`<ol>` 三种元素为可分段
   - 嵌套在 `<li>` 内部的 `<p>` 跳过（避免重复分块）

2. **为每段生成 ID**：
   ```
   input = segmentType + "\n" +
           orderIndex.toString() + "\n" +
           normalize(sourceHTML) + "\n" +
           normalize(sourceText)

   segmentId = "seg_" + orderIndex + "_" + SHA256(input).prefix(12)
   ```
   - `segmentType`：`"p"` / `"ul"` / `"ol"`
   - `orderIndex`：从 0 开始递增的整数
   - `normalize(s)`：将连续空白替换为单个空格，trim 首尾
   - `SHA256`：标准 SHA-256 十六进制编码，取前 12 位

3. **计算全文源哈希**（用于翻译缓存失效）：
   ```
   payload = segments
     .sorted(by orderIndex)
     .map { s => s.segmentType + "\n" + s.orderIndex + "\n" + normalize(s.sourceHTML) + "\n" + normalize(s.sourceText) }
     .join("\n---\n")

   sourceContentHash = SHA256(payload)
   ```

   `segmenterVersion` 用于标记分段算法版本（当前 `"v1"`），当算法变更时旧缓存自动失效。

**段 ID 示例：**

```
  seg_3_f9e2d1c0b8a7
  ─┬─ ┬─ ────┬────
   │  │       └─ SHA256 前缀 12 位
   │  └───────── orderIndex
   └──────────── 固定前缀
```

**与 content 内容变更的关系：**

| 场景 | 段 ID | 笔记 |
|---|---|---|
| 内容未变 | `seg_3_f9...` 不变 | 笔记有效 |
| 某段文字修改 | `seg_3_f9...` → `seg_3_ab...` | 旧笔记变为孤儿 |
| 新增一段 | `seg_4_xx...` 首次出现 | 无影响 |
| 删除一段 | `seg_4_xx...` 消失 | 笔记变为孤儿 |

孤儿笔记保留在数据库中。UI 可通过 `sourceTextSnapshot` 展示原文对比，或标记 "（内容已变更）"。

---

### EntryListItem — 列表投影（非持久化）

用于文章列表展示的轻量视图结构，非持久化模型。

```swift
struct EntryListItem: Identifiable, Hashable {
    var id: Int64
    var feedId: Int64
    var title: String?
    var publishedAt: Date?
    var createdAt: Date
    var isRead: Bool
    var isStarred: Bool
    var feedSourceTitle: String?
}
```

---

## 2. LLM

> **当前 P0 Summary 实现（迁移 006/007）**：下方 Mercury 参考模型仍保留给后续多 Provider / Translation 设计。当前运行代码使用更小的 `ai_provider_profile`、`agent_task_run` 和 `summary_result` 三表，不直接实现参考模型中的 `agent_model_profile`、`agent_profile` 或 Usage 表。

### ai_provider_profile — 当前 Summary Provider

| 列 | 说明 |
|---|---|
| `providerKind` | 当前固定为 `openai-compatible` |
| `baseUrl` / `model` | 用户配置的 Chat Completions 端点和模型 |
| `apiKeyRef` | 不透明密钥引用；SQLite 中不存储明文或密文 Key |
| `isActive` | P0 只允许一条活动配置 |

Key 位于 Electron `userData/ai-secrets.json`。系统 `safeStorage` 可用时会加密；按当前产品决定，Linux `basic_text`、未知后端或无安全存储时改为持久化明文，并在界面明确警告用户。

### P0 Summary run 与结果

`agent_task_run` 记录 `summary` 任务的 `running` / `succeeded` / `failed` 状态、文章、语言、详略、输入 Markdown 哈希和脱敏错误。`summary_result` 对 `(entryId, targetLanguage, detailLevel)` 唯一，保存最终文本、Prompt 版本和精确 Markdown SHA-256。输入哈希变化后结果必须视为 stale，不能伪装为当前文章的 Summary。

### agent_provider_profile — LLM 提供商

存储 LLM API 提供商的连接配置。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `name` | TEXT | NOT NULL, UNIQUE | 显示名称 |
| `baseURL` | TEXT | NOT NULL | API 基础 URL |
| `apiKeyRef` | TEXT | NOT NULL | API Key 引用（非明文存储） |
| `testModel` | TEXT | NOT NULL, 默认 `"qwen3"` | 测试用模型名 |
| `isDefault` | BOOLEAN | NOT NULL, 默认 `false` | 是否为默认提供商 |
| `isEnabled` | BOOLEAN | NOT NULL, 默认 `true` | 是否启用 |
| `isArchived` | BOOLEAN | NOT NULL, 默认 `false` | 是否归档 |
| `archivedAt` | DATETIME | — | 归档时间 |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |
| `updatedAt` | DATETIME | NOT NULL | 更新时间 |

**索引：** `idx_agent_provider_name` — `name`（唯一）

---

### agent_model_profile — LLM 模型

提供商下的具体模型配置。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `providerProfileId` | INTEGER | NOT NULL → provider(id) CASCADE | 所属提供商 |
| `name` | TEXT | NOT NULL, UNIQUE | 显示名称 |
| `modelName` | TEXT | NOT NULL | API 中使用的模型标识名 |
| `temperature` | DOUBLE | — | 采样温度 |
| `topP` | DOUBLE | — | 核采样参数 |
| `maxTokens` | INTEGER | — | 最大输出 Token 数 |
| `isStreaming` | BOOLEAN | NOT NULL, 默认 `true` | 是否支持流式输出 |
| `supportsTagging` | BOOLEAN | NOT NULL, 默认 `false` | 支持标签任务 |
| `supportsSummary` | BOOLEAN | NOT NULL, 默认 `false` | 支持摘要任务 |
| `supportsTranslation` | BOOLEAN | NOT NULL, 默认 `false` | 支持翻译任务 |
| `isDefault` | BOOLEAN | NOT NULL, 默认 `false` | 是否默认模型 |
| `isEnabled` | BOOLEAN | NOT NULL, 默认 `true` | 是否启用 |
| `isArchived` | BOOLEAN | NOT NULL, 默认 `false` | 是否归档 |
| `archivedAt` | DATETIME | — | 归档时间 |
| `lastTestedAt` | DATETIME | — | 最后连通性测试时间 |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |
| `updatedAt` | DATETIME | NOT NULL | 更新时间 |

**索引：**
- `idx_agent_model_provider` — `providerProfileId`
- `idx_agent_model_name` — `name`（唯一）

---

### agent_profile — Agent 任务路由

将 Agent 任务类型（摘要/翻译/标签）映射到具体模型配置。每种任务类型只有一条路由记录。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `agentType` | TEXT | NOT NULL, UNIQUE | Agent 类型：`"tagging"` / `"summary"` / `"translation"` |
| `primaryModelProfileId` | INTEGER | → agent_model_profile(id) SET NULL | 首选模型 |
| `fallbackModelProfileId` | INTEGER | → agent_model_profile(id) SET NULL | 备用模型 |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |
| `updatedAt` | DATETIME | NOT NULL | 更新时间 |

**索引：** `idx_agent_profile_agent_type_unique` — `agentType`（唯一）

---

### agent_task_run — 任务运行

每次 Agent 任务（摘要/翻译/标签）的执行记录。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `entryId` | INTEGER | NOT NULL → entry(id) CASCADE | 目标文章 |
| `taskType` | TEXT | NOT NULL | 任务类型 |
| `status` | TEXT | NOT NULL | 状态：`queued` / `running` / `succeeded` / `failed` / `timedOut` / `cancelled` |
| `agentProfileId` | INTEGER | → agent_profile(id) SET NULL | 使用的路由配置 |
| `providerProfileId` | INTEGER | → provider(id) SET NULL | 实际使用的提供商 |
| `modelProfileId` | INTEGER | → model(id) SET NULL | 实际使用的模型 |
| `promptVersion` | TEXT | — | Prompt 版本 |
| `targetLanguage` | TEXT | — | 目标语言（仅翻译任务） |
| `templateId` | TEXT | — | Prompt 模板 ID |
| `templateVersion` | TEXT | — | 模板版本 |
| `runtimeParameterSnapshot` | TEXT | — | 运行时参数 JSON 快照 |
| `durationMs` | INTEGER | — | 执行耗时（毫秒） |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |
| `updatedAt` | DATETIME | NOT NULL | 更新时间 |

**索引：**
- `idx_agent_task_run_entry` — `entryId`
- `idx_agent_task_run_task` — `taskType`
- `idx_agent_task_run_status` — `status`
- `idx_agent_task_run_updated` — `updatedAt`

---

### llm_usage_event — LLM 调用记录

每次 LLM API 调用的计费/用量记录，包含请求时刻的快照信息以确保即使配置变更后数据仍然可追溯。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `taskRunId` | INTEGER | → agent_task_run(id) SET NULL | 所属任务运行 |
| `entryId` | INTEGER | → entry(id) SET NULL | 目标文章 |
| `taskType` | TEXT | NOT NULL | 任务类型 |
| `providerProfileId` | INTEGER | → provider(id) SET NULL | 使用时提供商 ID |
| `modelProfileId` | INTEGER | → model(id) SET NULL | 使用时模型 ID |
| `providerBaseURLSnapshot` | TEXT | NOT NULL | 快照：提供商基 URL |
| `providerResolvedURLSnapshot` | TEXT | — | 快照：实际请求完整 URL |
| `providerResolvedHostSnapshot` | TEXT | — | 快照：请求 Host |
| `providerResolvedPathSnapshot` | TEXT | — | 快照：请求路径 |
| `providerNameSnapshot` | TEXT | — | 快照：提供商名称 |
| `modelNameSnapshot` | TEXT | NOT NULL | 快照：模型名称 |
| `requestPhase` | TEXT | NOT NULL | 阶段：`normal` / `repair` / `retry` |
| `requestStatus` | TEXT | NOT NULL | 状态：`succeeded` / `failed` / `cancelled` / `timedOut` |
| `promptTokens` | INTEGER | — | 输入 Token 数 |
| `completionTokens` | INTEGER | — | 输出 Token 数 |
| `totalTokens` | INTEGER | — | 总 Token 数 |
| `usageAvailability` | TEXT | NOT NULL | 用量数据可用性：`actual` / `missing` |
| `startedAt` | DATETIME | — | 请求开始时间 |
| `finishedAt` | DATETIME | — | 请求结束时间 |
| `createdAt` | DATETIME | NOT NULL | 记录创建时间 |

**索引：**
- `idx_llm_usage_created` — `createdAt`
- `idx_llm_usage_task_created` — `(taskType, createdAt)`
- `idx_llm_usage_provider_created` — `(providerProfileId, createdAt)`
- `idx_llm_usage_model_created` — `(modelProfileId, createdAt)`
- `idx_llm_usage_status_created` — `(requestStatus, createdAt)`
- `idx_llm_usage_task_run` — `taskRunId`

---

### summary_result — 摘要结果

摘要任务的输出结果。按 `(entryId, targetLanguage, detailLevel)` 唯一约束，确保同一文章同语言同粒度的结果只保留一条。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `taskRunId` | INTEGER | PK → agent_task_run(id) CASCADE | 关联任务运行 |
| `entryId` | INTEGER | NOT NULL → entry(id) CASCADE | 目标文章 |
| `targetLanguage` | TEXT | NOT NULL | 目标语言 |
| `detailLevel` | TEXT | NOT NULL | 详细级别：`short` / `medium` / `detailed` |
| `outputLanguage` | TEXT | NOT NULL | 实际输出语言 |
| `text` | TEXT | NOT NULL | 摘要文本 |
| `createdAt` | DATETIME | NOT NULL | 创建时间 |
| `updatedAt` | DATETIME | NOT NULL | 更新时间 |

**索引：**
- `idx_summary_slot` — `(entryId, targetLanguage, detailLevel)` 唯一
- `idx_summary_updated` — `updatedAt`

---

### translation_result — 翻译结果

**当前 P0 实现（迁移 008）**：翻译使用独立运行记录，而非尚为 Summary 专用的 `agent_task_run`。按 `(entryId, targetLanguage, sourceContentHash, segmenterVersion)` 唯一约束，确保源内容未变时不重复翻译。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK，自增 | Translation run 身份 |
| `entryId` | INTEGER | NOT NULL → entry(id) CASCADE | 目标文章 |
| `providerProfileId` | INTEGER | NOT NULL → ai_provider_profile(id) | 使用的脱敏 Provider 配置 |
| `targetLanguage` | TEXT | NOT NULL | 目标语言（P0：`zh-CN` / `en`） |
| `sourceContentHash` | TEXT | NOT NULL | 稳定分段 SHA-256，用于检测内容变更 |
| `segmenterVersion` | TEXT | NOT NULL | 分段算法版本 |
| `promptVersion` | TEXT | NOT NULL | Prompt 版本 |
| `status` | TEXT | NOT NULL | `running` / `succeeded` / `failed` |
| `errorCode` / `errorMessage` / `errorRetryable` | TEXT / TEXT / BOOLEAN | — | 脱敏失败信息 |
| `createdAt` / `completedAt` / `updatedAt` | DATETIME | NOT NULL / — / NOT NULL | 生命周期时间 |

**索引：**
- 唯一槽位：`(entryId, targetLanguage, sourceContentHash, segmenterVersion)`
- `idx_translation_result_entry_language` — `(entryId, targetLanguage, updatedAt)`

---

### translation_segment — 翻译分段

翻译结果的双语对照段落。一个翻译结果包含多个分段（`p`、`ul`、`ol`），按顺序排列；P0 每完成一个 segment 就持久化最终文本。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `translationResultId` | INTEGER | NOT NULL → translation_result(id) CASCADE | 关联翻译结果 |
| `sourceSegmentId` | TEXT | NOT NULL | 源段 ID |
| `orderIndex` | INTEGER | NOT NULL | 段落序号 |
| `sourceText` | TEXT | NOT NULL | 源文本快照 |
| `translatedText` | TEXT | — | 翻译文本；完成前可为空 |
| `status` | TEXT | NOT NULL | `pending` / `succeeded` / `failed` |
| `errorCode` / `errorMessage` | TEXT / TEXT | — | 单段失败信息 |
| `createdAt` / `updatedAt` | DATETIME | NOT NULL | 生命周期时间 |

**索引：**
- `idx_translation_segment_order` — `(translationResultId, orderIndex)`
- 唯一槽位：`(translationResultId, sourceSegmentId)`

---

## 3. Tag

### tag — 标签

标签定义。`normalizedName` 是唯一标识，用于去重和匹配（例如大小写归一化后）。`isProvisional` 在标签使用次数 < 2 时为 `true`，标识为临时标签。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `name` | TEXT | NOT NULL | 显示名称 |
| `normalizedName` | TEXT | NOT NULL, UNIQUE | 归一化名称（唯一标识） |
| `isProvisional` | BOOLEAN | NOT NULL, 默认 `true` | 是否为临时标签（`usageCount < 2` 时自动设为 `true`） |
| `usageCount` | INTEGER | NOT NULL, 默认 `0` | 使用次数 |

**索引：** `idx_tag_normalized_name` — `normalizedName`（唯一）

---

### tag_alias — 标签别名

标签的别名映射，用于不同来源的标签名称匹配。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PK, 自增 | 主键 |
| `tagId` | INTEGER | NOT NULL → tag(id) CASCADE | 所属标签 |
| `alias` | TEXT | NOT NULL | 别名 |
| `normalizedAlias` | TEXT | NOT NULL, UNIQUE | 归一化别名 |

**关联：** `tag_alias` N : 1 `tag`

---

### entry_tag — 文章-标签关联（多对多）

记录标签在文章上的分配。`source` 区分标签来源（如 RSS 导入的标签、LLM Agent 自动标注等），`confidence` 记录自动标注的置信度。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `entryId` | INTEGER | NOT NULL → entry(id) CASCADE | 关联文章 |
| `tagId` | INTEGER | NOT NULL → tag(id) CASCADE | 关联标签 |
| `source` | TEXT | NOT NULL | 来源标识（如 `"rss"`、`"agent"`） |
| `confidence` | DOUBLE | — | LLM 标注置信度（0.0 ~ 1.0） |

**主键：** `(entryId, tagId)`
**索引：** `idx_entry_tag_tag_entry` — `(tagId, entryId)`

---

### batch tag — 批量标签

批量标签功能提供了一组临时表用于编排大规模标签操作。涉及的数据库表：

| 表 | 说明 |
|---|---|
| `tag_batch_run` | 批量运行主记录，跟踪状态（configure → running → ready_next → review → applying → done）及统计数据 |
| `tag_batch_entry` | 批量运行中每篇文章的处理状态（never_started → running → staged_ready/applied/failed） |
| `tag_batch_assignment_staging` | LLM 输出的标签暂存区，匹配已有标签或建议新建标签 |
| `tag_batch_new_tag_review` | 新建标签的审核队列，记录每个新标签的出现频次和审核决策（pending/keep/discard） |
| `tag_batch_apply_checkpoint` | 应用阶段的进度检查点，支持断点续应用 |

**生命周期：** `configure` → `running` → `ready_next` → `review` → `applying` → `done`

在 `running` / `ready_next` / `review` / `applying` 状态下会锁定标签变更，防止并发冲突。
