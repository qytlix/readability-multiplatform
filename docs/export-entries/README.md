# 文章 Markdown 导出模块规划

> 负责人：qytlix（本文件的编写者）
> 状态：规划阶段
> 对应 Issue：#29
> 最后更新：2026-07-26

---

## 目录

1. [模块范围](#1-模块范围)
2. [目录结构](#2-目录结构)
3. [数据模型与类型契约](#3-数据模型与类型契约)
4. [Markdown 输出格式](#4-markdown-输出格式)
5. [IPC 层](#5-ipc-层)
6. [Preload API](#6-preload-api)
7. [Main 服务层](#7-main-服务层)
8. [Renderer 集成](#8-renderer-集成)
9. [安全与错误处理](#9-安全与错误处理)
10. [Issue 拆分](#10-issue-拆分)
11. [测试策略](#11-测试策略)
12. [风险与依赖](#12-风险与依赖)

---

## 1. 模块范围

### 1.1 范围内

| 功能 | P0/P1 | 说明 |
|---|---|---|
| 单篇文章导出为 `.md` | P0 | Reader 页面提供导出入口，调用系统保存对话框 |
| 多篇文章导出为单份 `.md` 文摘 | P0 | 文章列表支持多选，按列表顺序合并输出 |
| Electron 系统保存对话框 | P0 | 使用 `dialog.showSaveDialog()` 选择保存位置 |
| UTF-8 编码写入 | P0 | Markdown 文件以 UTF-8 写入 |
| 基于已持久化数据工作 | P0 | 纯离线，只读 Store，不发起新 AI 请求 |
| 安全文件名生成 | P0 | 过滤 `\ / : * ? " < > \|` 等非法字符合 |
| Summary 可选包含 | P0 | 已存在的 Summary 结果写入导出文件 |
| Translation 可选包含 | P0 | 已存在的 Translation 结果写入导出文件 |
| 笔记可选包含 | P1 | 已存在的用户笔记写入导出文件（预留字段等待笔记接口就绪） |
| 用户高亮保留 | P1 | 高亮属于正文，始终以 `<mark>` 内嵌 HTML 保留位置与颜色；笔记选项只控制脚注文字 |

### 1.2 范围外

| 功能 | 原因 |
|---|---|
| PDF、DOCX、HTML 等其他导出格式 | P0 只覆盖 Markdown |
| 富文本导出模板编辑器 | 复杂度高，非最小必要 |
| 自定义 Markdown 模板 | 超出最小闭环范畴 |
| 自动或定时导出 | 非 P0 要求 |
| 云端同步 | 超出本地优先范围 |
| 笔记的创建、编辑、删除 | 由 cyj 的笔记模块负责 |
| 发起新的 Summary/Translation 请求 | 本模块只读已有结果 |
| 标签及 Tag Agent | 范围外 |
| 原始 HTML 或脚本打包 | 安全与复杂度考量 |

---

## 2. 目录结构

```
src/
  main/
    export/
      ExportService.ts          # 聚合数据 + 文件写入
      MarkdownSerializer.ts     # 纯函数：聚合数据 → Markdown 字符串
      safeFilename.ts           # 纯函数：过滤非法文件名字符
    ipc/
      export.handler.ts         # IPC handler 注册
  shared/
    contracts/
      export.ipc.ts             # Channel 常量、请求/响应类型
      export.types.ts           # ExportableArticle 等导出用聚合数据结构
  preload/
    preload.ts                  # 新增 shaleAPI.export.* 暴露
  renderer/
    features/
      feeds/
        ExportDialog.tsx        # 多选导出确认对话框（可选）
        EntryDetail.tsx         # 修改：阅读器头部加入导出按钮
        EntryList.tsx           # 修改：支持多选 + 导出所选入口
        entryExport.ts          # Renderer 侧导出逻辑（调用 preload API）

tests/
  unit/
    export/
      markdown-serializer.test.ts
      safeFilename.test.ts
  integration/
    export-service.test.ts
  fixtures/
    export/
      expected-single.md         # 单篇导出预期结果
      expected-multi.md          # 多篇导出预期结果
```

---

## 3. 数据模型与类型契约

### 3.1 `ExportOptions` — 导出选项

`src/shared/contracts/export.types.ts`

```typescript
/** 用户选择的导出内容选项 */
export interface ExportOptions {
  includeSummary: boolean;
  includeTranslation: boolean;
  includeNotes: boolean;
}

/** 默认值：全部包含 */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeSummary: true,
  includeTranslation: true,
  includeNotes: true,
};
```

### 3.2 `ExportableArticle` — 导出用聚合数据结构

`src/shared/contracts/export.types.ts`

```typescript
/** 单篇文章的导出数据聚合（从多个 Store 读取后组装） */
export interface ExportableArticle {
  entryId: number;
  feedTitle?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedAt?: string;   // ISO-8601
  cleanedMarkdown: string;
  cleanedHtml?: string;   // Reader HTML 骨架
  summary?: string;       // 已存在的 Summary（可选）
  translation?: string;   // 旧版全文 Translation fallback（可选）
  translationSegments?: ExportTranslationSegment[]; // Reader 逐段翻译快照
  notes?: string;         // 已存在的用户笔记文本聚合（可选，P1）
}
```
```

### 3.3 IPC 类型

`src/shared/contracts/export.ipc.ts`

```typescript
import type { IPCResult } from './feed.ipc';
import type { ExportableArticle } from './export.types';

// ── 单篇导出 ──

export interface ExportSingleRequest {
  entryId: number;
  options: ExportOptions;
}

export interface ExportSingleResult {
  /** 实际写入的文件路径 */
  filePath: string;
}

// ── 多篇导出 ──

export interface ExportMultipleRequest {
  entryIds: number[];
  options: ExportOptions;
}

export interface ExportMultipleResult {
  /** 实际写入的文件路径 */
  filePath: string;
}

// ── Channel 常量 ──

export const EXPORT_IPC_CHANNELS = {
  /** 单篇导出：Main 弹保存对话框 → 写入文件 */
  exportSingle: 'export:single',
  /** 多篇导出：Main 弹保存对话框 → 写入文件 */
  exportMultiple: 'export:multiple',
  /** 获取单篇导出数据（用于预览或传给 Main） */
  prepareArticleData: 'export:prepare-article',
  /** 获取多篇导出数据 */
  prepareMultipleArticleData: 'export:prepare-multiple',
} as const;
```

### 3.3 `ShaleAPI` 扩展

`src/shared/ipc.ts` 新增：

```typescript
export interface ExportAPI {
  /** 单篇导出：Renderer 传入数据，Main 打开保存对话框并写入 */
  single: (data: ExportableArticle, defaultFileName: string) =>
    Promise<IPCResult<ExportSingleResult>>;
  /** 多篇导出 */
  multiple: (articles: ExportableArticle[], defaultFileName: string) =>
    Promise<IPCResult<ExportMultipleResult>>;
  /** 获取单篇聚合数据（Renderer 可直接调用） */
  prepareArticleData: (entryId: number) =>
    Promise<IPCResult<ExportableArticle>>;
}
```

**设计说明**：有两种设计方案——

**方案 A（推荐）**：Renderer 调用 `prepareArticleData` 拿到数据后，由 UI 决定调用 `single` 传给 Main 写入文件。优点是清晰分离"数据准备"和"文件写入"两个职责，数据可以预览。

**方案 B**：一次性 IPC，Main 内部读取 Store 并写入。优点是减少一次 IPC 来回。缺点是 Renderer 无法预览数据，且 Main 需要依赖所有 Store。

**最终采用方案 A**，原因是：
- 数据预览功能可以零成本加入
- Main 不新增 Store 依赖（数据由 Renderer 侧通过已有 API 获取，或通过统一的 prepareArticleData handler 获取）
- 如果选择由 Main 一次性完成，需将 prepareArticleData handler 作为内部方法

### 3.4 实现方案细化

实际实现时采用**合并方案**——`export:single` handler 在 Main 侧完成所有工作：
1. Handler 内部调用 `ExportService.prepareArticleData(entryId)` 读取各 Store 并组装 `ExportableArticle`
2. 调用 `MarkdownSerializer.single(article)` 生成 Markdown 字符串
3. 调用 `dialog.showSaveDialog()` 获取保存路径
4. 通过 `fs.writeFileSync()` 写入文件
5. 返回结果给 Renderer

这样 Renderer 只需调用 `shaleAPI.export.single(entryId)` 一个方法，无需关心数据组装细节。

---

## 4. Markdown 输出格式

### 4.1 单篇

当用户选择不包含某些可选内容时，对应字段在序列化时被忽略。序列化函数接收 `ExportOptions` 参数：

```typescript
export function serializeSingle(
  article: ExportableArticle,
  options: ExportOptions,
): string;
```

```markdown
# 文章标题

**来源：** Feed 名称  
**作者：** 作者名  
**发布时间：** 2024-01-01T12:00:00.000Z  
**原文链接：** https://example.com/article

---

(cleaned markdown 正文)

---

> **AI 摘要：**
> 
> 摘要内容...

---

> **翻译（zh-CN）：**
> 
> 翻译内容...

---

> **笔记：**
> 
> - 这是一条笔记
> - 这是另一条笔记
```

**规则：**
- 缺失的可选字段（作者、来源、日期、链接）**直接省略**，不显示 `undefined` 或空占位符
- Summary/Translation/Notes 根据用户选择的 `ExportOptions` 决定是否输出
- 用户选择不包含 → 即使数据存在也直接省略
- Summary 紧跟文章标题/元信息，输出 `AI SUMMARY` 小节，内容使用引用块显示左侧竖线
- Translation 使用 Reader 的清洗 HTML 和逐段翻译快照恢复双语顺序；每段译文紧跟对应原文，并使用引用块显示左侧竖线
- 旧数据只有全文 `translation` 时，保留末尾全文引用块作为兼容降级
- 用户高亮使用 `<mark data-shale-highlight="颜色" style="background-color: ...">` 写回正文；这是因为 CommonMark 没有标准高亮语法。关闭“包含笔记”时仍保留高亮，只省略脚注和笔记文字
- 笔记输出 `> **笔记：**` + 无序列表
- 字段之间用 `---` 分隔

### 4.2 多篇

```markdown
# 文摘 — 2026-07-26

> 共 3 篇文章
> 导出时间：2026-07-26T15:30:00.000Z

---

## 1. 第一篇标题

**来源：** Feed 名称
**作者：** 作者名
**发布时间：** 2024-01-01
**原文链接：** https://...

(cleaned markdown)

---

## 2. 第二篇标题

...
```

**规则：**
- 文件顶部为文摘元信息（标题、篇数、导出时间）
- 每篇文章使用 `## N. 标题` 格式的二级标题
- 序号按传入数组的索引（1-based）
- 每篇文章内部格式与单篇一致
- 文章之间用 `---` 分隔

### 4.3 安全文件名生成

`src/main/export/safeFilename.ts`

```typescript
/**
 * 从文章标题生成安全文件名。
 *
 * 过滤规则：
 * 1. 替换 `\ / : * ? " < > |` 为空格
 * 2. 合并连续空格
 * 3. 去除首尾空格和点号
 * 4. 截断到 200 字符
 * 5. 如果结果为空，返回 "untitled"
 */
export function safeFilename(title: string): string;
```

---

## 5. IPC 层

### 5.1 Handler 注册

`src/main/ipc/export.handler.ts`

```typescript
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { EXPORT_IPC_CHANNELS } from '../../shared/contracts/export.ipc';
import { ExportService } from '../export/ExportService';
import type { EntryStore, ContentStore } from '../feed/stores';
// ... 其他 Store 类型

export function registerExportIpcHandlers(
  getMainWindow: GetMainWindow,
  stores: {
    entryStore: EntryStore;
    contentStore: ContentStore;
    // summaryStore, translationStore, annotationStore 可选
  },
): void {
  ipcMain.handle(
    EXPORT_IPC_CHANNELS.exportSingle,
    async (event, { entryId, ... }) => { ... }
  );
  ipcMain.handle(
    EXPORT_IPC_CHANNELS.exportMultiple,
    async (event, { entryIds, ... }) => { ... }
  );
}
```

### 5.2 流程

```
Renderer                          Main
   │                                │
   ├── 点击导出按钮 ──────────────→ │
   │                                ├── (多选时) 检查所选文章的清洗/数据状态
   │                                ├── 返回 ArticleAvailability[]
   │←──────────────────────────────┤
   │                                │
   ├── 弹出导出选项对话框 ──────────┤
   │  - 列级全选/全不选             │
   │  - 每篇文章独立勾选            │
   │  - 未清洗文章显示「现在清洗」  │
   │  - 清洗中「下一步」disabled    │
   │  - 「取消」始终可点击          │
   │                                │
   ├── 用户点击某篇「现在清洗」 →   │
   │        或「清洗全部未清洗」    │
   │                                │
   ├── export:cleanSingle(entryId)→ │
   │        或 export:cleanMultiple  │
   │←────── 清洗进度 ──────────────┤
   │                                │
   ├── 用户点击「下一步」───────→   │
   │        携带每篇文章的选项       │
   │                                │
   ├── export.single(entryId, opts) │
   │        或                      │
   ├── export.multiple(entries,opts)│
   │                                │
   │                                ├── 读取各 Store 聚合 ExportableArticle[]
   │                                ├── MarkdownSerializer.serialize(articles, opts)
   │                                ├── dialog.showSaveDialog()
   │                                ├── fs.writeFileSync(path, markdown, 'utf-8')
   │                                ├── ✅ { ok: true, data: { filePath } }
   │                                └── ❌ { ok: false, error: { code, message } }
   │←──────────────────────────────┤
```

---

## 6. Preload API

`src/preload/preload.ts` 新增：

```typescript
const exportAPI = {
  single: (entryId: number, options?: ExportOptions) =>
    ipcRenderer.invoke(EXPORT_IPC_CHANNELS.exportSingle, {
      entryId,
      options: options ?? DEFAULT_EXPORT_OPTIONS,
    }),
  multiple: (entryIds: number[], options?: ExportOptions) =>
    ipcRenderer.invoke(EXPORT_IPC_CHANNELS.exportMultiple, {
      entryIds,
      options: options ?? DEFAULT_EXPORT_OPTIONS,
    }),
};
```

---

## 7. Main 服务层

### 7.1 `ExportService`

```typescript
export class ExportService {
  constructor(
    private entryStore: EntryStore,
    private contentStore: ContentStore,
    private summaryStore?: SummaryStore,
    private translationStore?: TranslationStore,
    private annotationStore?: AnnotationStore,
  ) {}

  // 聚合单篇文章数据
  async prepareArticleData(entryId: number): Promise<ExportableArticle>;

  // 聚合多篇文章数据
  async prepareMultipleArticleData(entryIds: number[]): Promise<ExportableArticle[]>;

  // 写入文件（内部调用 MarkdownSerializer + fs）
  async writeSingle(
    article: ExportableArticle,
    filePath: string,
  ): Promise<void>;

  // 批量写入
  async writeMultiple(
    articles: ExportableArticle[],
    filePath: string,
  ): Promise<void>;
}
```

### 7.2 `MarkdownSerializer`

纯函数，无副作用，易于单元测试。接收 `ExportOptions` 控制哪些可选字段输出：

```typescript
export const MarkdownSerializer = {
  single(article: ExportableArticle, options?: ExportOptions): string;
  multiple(articles: ExportableArticle[], options?: ExportOptions): string;
};
```

### 7.3 与现有 Service 的关系

ExportService **不新增任何数据库表或迁移**。它直接读取已有 Store：
- `entryStore.getById()` → 文章元数据
- `contentStore.getCleanedContent()` → Cleaned Markdown
- `summaryStore.get()` → Summary 结果
- `translationStore.get()` → Translation 结果
- `annotationStore.list()` → 笔记列表（P1）

---

## 8. Renderer 集成

### 8.1 导出选项对话框 — ExportOptionsDialog.tsx

单篇和多篇共用一个对话框组件，根据传入文章数量决定 UI 布局。

**组件 Props：**
```typescript
interface ExportOptionsDialogProps {
  open: boolean;
  /** 单篇：1 篇；多选：N 篇 */
  articles: ArticleAvailability[];
  onConfirm: (perArticleOptions: Map<number, PerArticleOptions>) => void;
  onCancel: () => void;
}
```

**对话框 UI：**
```
┌──────────────────────────────────────────────────────┐
│  📄 导出文件                                         │
│                                                      │
│  [全选总结]   [全选翻译]   [全选笔记]   ← 多选时有  │
│  ─────────────────────────────                       │
│  ✅ 文章 A        ☑ 总结  ☑ 翻译  ☐ 笔记             │
│  ⏳ 文章 B        🧹未清洗  [现在清洗]                │
│  ✅ 文章 C        ☑ 总结  ☐ 翻译  ☑ 笔记             │
│  ⏳ 文章 D        🧹未清洗  [现在清洗]                │
│  ─────────────────────────────                       │
│  [🧹 清洗全部未清洗（2篇）]                           │
│                    [  取消  ] [  下一步  ]            │
└──────────────────────────────────────────────────────┘
```

**按钮规则：**
- 「下一步」：无已清洗文章可选时 disabled；正在清洗时 disabled
- 「取消」：始终可点击，关闭对话框不做任何操作

### 8.2 单篇导出入口 — EntryDetail.tsx

在 AI 工具栏（`字体` 与 `...更多` 之间）添加导出按钮：

- **普通模式**：tooltip "导出为 Markdown"，点击 → 弹出选项对话框（单篇文章）→ 保存对话框 → 写入
- **多选模式**：tooltip "导出所选 N 篇文章"，点击 → 弹出选项对话框（多篇文章）→ 保存对话框 → 写入
- 导出按钮在文章未清洗时 disabled，tooltip "文章尚未完成内容清洗"

### 8.3 多选入口 — EntryList.tsx

文章列表增加多选模式：

```
实现方案：
- 新增"选择模式"切换按钮（与筛选按钮并列）
- 进入选择模式后，每篇文章卡片出现复选框
- 顶部显示"已选 N 篇"计数 + "取消"按钮
- 导出操作由 AI 工具栏导出按钮统一承担（见 §8.1）
- 导出后保持文章原有已读/收藏状态不变
```

**已确认的交互规则：**

| 场景 | 规则 | 原因 |
|------|------|------|
| 点击文章卡片 | **只切换选择，不导航**到阅读视图 | 选择模式是"批量导出专用模式"，简单明确 |
| 切换 Filter | **退出选择模式，清空选中** | 列表内容变了，选中状态无意义 |
| 翻页/加载更多 | **保持选中状态** | 允许跨页批量导出 |
| 导出保存成功后 | **自动退出选择模式**，清空选中 | 导出是完整操作，做完就结束 |
| 导出选项对话框取消 | **不清空选中**，回到多选模式 | 用户可能只是想调整选项 |
| 保存对话框取消 | **不清空选中**，回到多选模式 | 用户可能改变保存位置 |
| 退出多选模式 | **再次点击 toggle 按钮退出**，清空选中 | 单按钮控制入口/出口 |
| 未清洗文章 | **在对话框内显示「现在清洗」** | 清洗检查融入选项对话框，非独立弹窗 |
| 导出按钮 | **使用 AI 工具栏的导出按钮**（双模式） | 避免两个导出按钮造成困惑 |

### 8.4 状态管理

- 多选状态：`useState<Set<number>>`
- 导出对话框状态：`useState<'closed' | 'options' | 'cleaning' | 'saving'>`
- 清洗进度状态：`useState<{ total: number; completed: number; failed: number }>`
- 导出操作不修改全局状态（不触发 feed/entry 重载）

---

## 9. 安全与错误处理

### 9.1 错误码

| code | 含义 | retryable |
|------|------|-----------|
| `EXPORT_ENTRY_NOT_FOUND` | 文章不存在 | false |
| `EXPORT_CONTENT_NOT_FOUND` | Cleaned Content 不存在 | false |
| `EXPORT_WRITE_FAILED` | 文件写入失败 | true |
| `EXPORT_SAVE_CANCELED` | 用户取消保存 | false |
| `EXPORT_TOO_MANY_ARTICLES` | 批量导出文章数过多（> 100） | false |
| `EXPORT_CLEAN_FAILED` | 清洗未完成的文章失败 | true |

### 9.2 安全约束

- Renderer 不直接访问 `fs` 或 `dialog`
- 通过 typed IPC + Preload 暴露最小接口
- 文件写入只发生在 `showSaveDialog` 用户确认之后
- 写入路径由系统对话框返回，不接受 Renderer 传入路径
- HTTP(S) 图片在导出时使用文章 URL 作为受限 Referer 下载到同目录
  `<Markdown 文件名>.assets/`，Markdown 只写入相对资源路径；单图限制 20 MB，
  单次最多处理 100 个唯一图片 URL、合计 200 MB，并限制为 4 个并发请求
- 图片响应必须是受支持的栅格格式；下载失败时保留原始远程 URL，并通过 typed
  导出结果返回成功/失败计数
- API Key 等信息绝不进入导出内容
- 笔记内容经过 Store 已有的清洗逻辑再写入
- 用户选择在导出时控制是否包含 Summary / Translation / 笔记

### 9.3 清理

- 有远程图片时会产生与 Markdown 同名的 `.assets` 资源目录；重复导出只覆盖
  相同 URL 对应的 hash 文件，不删除目录中的其他文件
- 写入失败时确保不产生空文件（写入完成后再 rename，或捕获异常后删除空文件）
- 导出操作**不修改**数据库中的任何数据

---

## 10. Issue 拆分

| ID | 标题 | 预估 | 依赖 |
|----|------|------|------|
| EXP-01 | 定义 shared types（export.ipc.ts、export.types.ts） | 0.5d | 无 |
| EXP-02 | 实现 MarkdownSerializer + safeFilename（纯函数） | 0.5d | EXP-01 |
| EXP-03 | 实现 ExportService + IPC handler + Preload | 1d | EXP-01, EXP-02 |
| EXP-04 | 接入单篇导出入口（EntryDetail） | 0.5d | EXP-03 |
| EXP-05 | 接入多篇导出入口（EntryList 多选 + 导出） | 1d | EXP-03 |
| EXP-06 | 预留并接入可选笔记字段 | 0.5d | 笔记模块接口就绪 |
| EXP-07 | 单元测试 + 集成测试 | 1d | EXP-02, EXP-03 |
| EXP-08 | 导出选项对话框（ExportOptionsDialog） | 1d | EXP-03 |
| EXP-09 | macOS / Windows / Linux 平台冒烟 | 0.5d | EXP-04, EXP-05, EXP-08 |

**执行顺序：** EXP-01 → EXP-02 → EXP-03 → EXP-04 + EXP-05 并行 → EXP-08 → EXP-07 → EXP-09

---

## 11. 测试策略

### 11.1 单元测试

| 测试 | 覆盖内容 |
|------|---------|
| `markdown-serializer.test.ts` | 各种字段组合的序列化输出 |
| `image-localizer.test.ts` | Referer、防盗链图片下载、相对路径改写、失败降级 |
| `safeFilename.test.ts` | 中英文、特殊字符、Emoji、空标题、超长标题 |

**MarkdownSerializer 测试用例：**

1. 只有标题和正文 → 输出简洁 Markdown
2. 包含中文、Emoji、特殊字符 → 正确输出
3. 包含全部字段（标题+来源+作者+日期+链接+Summary+Translation）→ 完整结构
4. 缺少作者、日期、来源、链接 → 对应字段省略
5. Summary 缺失 → 不输出 AI 摘要块
6. Translation 缺失 → 不输出翻译块
7. Cleaned Markdown 为空 → 输出空正文或错误标记
8. 多篇导出顺序稳定 → 按输入顺序输出
9. 重复文章 ID → 不重复导出

**safeFilename 测试用例：**
1. `"Hello World"` → `"Hello World"`
2. `"file:name?bad"` → `"file name bad"` (过滤 `: ?`)
3. `"  leading/trailing  "` → `"leading trailing"` (首尾空格)
4. `""` → `"untitled"`
5. 长度超过 200 的标题 → 截断到 200 字符

### 11.2 集成测试

| 测试 | 覆盖内容 |
|------|---------|
| `export-service.test.ts` | 真实 Store → ExportService → 文件写入 → 验证文件内容 |

1. 单篇导出到临时目录，验证文件内容和编码
2. 多篇导出，验证结构正确
3. 缺少必要数据时导出失败
4. 文件写入失败时的错误返回
5. 防盗链图片携带文章 Referer 下载到 `.assets`，导出 Markdown 使用相对路径

### 11.3 人工验证（平台冒烟）

1. 启动应用，打开一篇文章 → 导出 → 用文本编辑器/Markdown 预览打开验证
2. 多选文章 → 导出文摘 → 验证结构和内容
3. 取消保存对话框 → 无空文件产生
4. 导出含防盗链图片的文章，断网后确认 Markdown 仍可从同目录 `.assets` 显示图片
5. 断网后导出已持久化文章 → 正常工作
6. 导出后验证数据库文章状态没有改变

---

## 12. 确认的设计决策

以下是 Issue #29 实现过程中与负责人确认的关键决策：

| # | 决策 | 选项 | 确认人 | 日期 |
|---|------|------|--------|------|
| 1 | ExportService **直接读取 Store 实例**，不通过 IPC 调用 | 方案 A（vs 方案 B：通过 IPC 复用现有 API） | qytlix | 2026-07-26 |
| 2 | 单篇导出默认路径：**用户文档目录**（`app.getPath('documents')`） | 选项 b（vs a：上次目录 / c：桌面 / d：不持久化） | qytlix | 2026-07-26 |
| 3 | 多篇导出数量上限：**100 篇后显示警告，不强制阻止** | 选项 b（vs a：100 篇硬上限 / c：50 篇 / d：不限） | qytlix | 2026-07-26 |
| 4 | 多选模式：**点击只切换选择不导航** / Filter 切换时退出 / 翻页保持选中 / 导出后自动退出 | (a)+(a)+(a)+(a) | qytlix | 2026-07-26 |
| 5 | 一次性完成所有步骤再提交单个 PR | vs 按步骤逐个 PR | qytlix | 2026-07-26 |
| 6 | 导出按钮位置和作用：AI 工具栏 `字体` 与 `...更多` 之间；**双模式**——普通模式导当前文章，多选模式导所选文章 | qytlix | 2026-07-26 |
| 7 | 单篇导出时文章未清洗：**阻止导出**，按钮 disabled 提示"文章尚未完成内容清洗" | qytlix | 2026-07-26 |
| 8 | 多篇导出时部分文章未清洗：弹出对话框提供 3 个选项——**停止** / **跳过未清洗的 N 篇** / **现在开始清洗选中的 N 篇**（可中途取消） | qytlix | 2026-07-26 |
| 9 | 多选模式切换：**单个 toggle 按钮**——"选择"点击切换，高亮表示多选模式 | qytlix | 2026-07-26 |
| 10 | 导出前弹出选项对话框：让用户选择 **是否包含总结/翻译/笔记**，每篇文章独立勾选 | qytlix | 2026-07-26 |
| 11 | 导出选项对话框「取消」：**不清空多选选中**，回到多选模式继续操作 | qytlix | 2026-07-26 |
| 12 | 清洗检查融入选项对话框：未清洗文章在对话框内显示「现在清洗」按钮 + 「清洗全部未清洗」总按钮 | qytlix | 2026-07-26 |
| 13 | 清洗中「下一步」disabled，「取消」始终可点击 | qytlix | 2026-07-26 |

---

## 13. 风险与依赖

| 风险 | 影响 | 应对 |
|------|------|------|
| 笔记模块接口尚未就绪 | 笔记字段需预留但无法验证 | 先完成不含笔记的导出，笔记字段标记为 P1 |
| Summary/Translation 数据结构变更 | 导出内容可能过时或缺失字段 | IPC 类型从 shared contract 读取，编译期检查不匹配 |
| Electron 对话框在不同平台行为差异 | 用户体验不一致 | 使用 `dialog.showSaveDialog()` 标准 API，平台自适应 |
| 多选模式下大量文章导出性能 | 界面卡顿或文件过大 | 限制单次导出上限为 100 篇；导出期间显示 loading 状态 |
| 文件编码问题 | 中文/Emoji 显示异常 | 统一 UTF-8 with BOM（可选）或 UTF-8；在 Windows 记事本上验证 |
| 写入期间应用退出 | 文件不完整 | 写入后再重命名，或捕获异常后清理临时文件 |
