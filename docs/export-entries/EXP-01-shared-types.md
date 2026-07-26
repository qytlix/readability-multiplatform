# EXP-01：定义 shared types

> 对应 Issue #29 — 第一步
> 预估：0.5d
> 依赖：无

---

## 目标

定义 Markdown 导出功能所需的共享类型和 IPC 契约，包括导出选项、文章可用性查询、聚合数据结构、IPC channel 常量、请求/响应类型，以及 `ShaleAPI` 的 export 命名空间扩展。

这些类型是整个导出模块的**数据结构基础**，所有后续步骤都依赖它们。

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `src/shared/contracts/export.types.ts` |
| 新建 | `src/shared/contracts/export.ipc.ts` |
| 修改 | `src/shared/domain-api.ts` |
| 修改 | `src/shared/ipc.ts` |

---

## Git Commits

### Commit 1.1：导出选项和文章可用性类型

**文件：** `src/shared/contracts/export.types.ts`（新建）

```typescript
/** 用户为单篇文章选择的导出选项 */
export interface PerArticleOptions {
  includeSummary: boolean;
  includeTranslation: boolean;
  includeNotes: boolean;
}

/** 默认值：全部包含 */
export const DEFAULT_PER_ARTICLE_OPTIONS: PerArticleOptions = {
  includeSummary: true,
  includeTranslation: true,
  includeNotes: true,
};

/** 单篇文章的可用数据状态（供选项对话框渲染使用） */
export interface ArticleAvailability {
  entryId: number;
  title: string;
  pipelineStatus: 'success' | 'pending' | 'fetching' | 'cleaning' | 'converting' | 'failed';
  hasSummary: boolean;
  hasTranslation: boolean;
  hasNotes: boolean;
}

/** 单篇文章的导出数据聚合 */
export interface ExportableArticle {
  entryId: number;

  /** 元信息 */
  feedTitle?: string;
  url?: string;
  title?: string;
  author?: string;
  publishedAt?: string;  // ISO-8601

  /** 正文 */
  cleanedMarkdown: string;

  /** 可选 AI 内容（不存在时省略） */
  summary?: string;
  translation?: string;

  /** 可选用户笔记（P1，预留） */
  notes?: string;

  /** 用户选择的选项（序列化时根据此决定输出哪些字段） */
  exportOptions?: PerArticleOptions;
}
```

**验证：**
```bash
npx tsc --noEmit --pretty
```
确认类型编译通过，无未引用类型警告。

---

### Commit 1.2：定义 IPC 常量、请求/响应类型

**文件：** `src/shared/contracts/export.ipc.ts`（新建）

```typescript
import type { IPCResult, ShaleError } from './feed.ipc';
import type {
  ArticleAvailability,
  ExportableArticle,
  PerArticleOptions,
} from './export.types';

// ── 清洗状态检查 ──

export interface CheckAvailabilityRequest {
  entryIds: number[];
}

export interface CheckAvailabilityResponse {
  articles: ArticleAvailability[];
  /** 未清洗完成的 entryId 列表 */
  unwashedIds: number[];
}

// ── 单篇清洗触发 ──

export interface CleanSingleRequest {
  entryId: number;
}

export interface CleanProgressEvent {
  entryId: number;
  status: 'cleaning' | 'success' | 'failed';
  error?: string;
}

// ── 单篇导出 ──

export interface ExportSingleRequest {
  entryId: number;
  options: PerArticleOptions;
}

export interface ExportSingleResult {
  filePath: string;
}

// ── 多篇导出（已确认选项后） ──

export interface ExportMultipleRequest {
  entries: Array<{
    entryId: number;
    options: PerArticleOptions;
  }>;
}

export interface ExportMultipleResult {
  filePath: string;
}

// ── 错误码 ──

export const EXPORT_ERROR_CODES = {
  EXPORT_ENTRY_NOT_FOUND: 'EXPORT_ENTRY_NOT_FOUND',
  EXPORT_CONTENT_NOT_FOUND: 'EXPORT_CONTENT_NOT_FOUND',
  EXPORT_WRITE_FAILED: 'EXPORT_WRITE_FAILED',
  EXPORT_SAVE_CANCELED: 'EXPORT_SAVE_CANCELED',
  EXPORT_TOO_MANY_ARTICLES: 'EXPORT_TOO_MANY_ARTICLES',
  EXPORT_CLEAN_FAILED: 'EXPORT_CLEAN_FAILED',
} as const;

// ── Channel 常量 ──

export const EXPORT_IPC_CHANNELS = {
  checkAvailability: 'export:check-availability',
  cleanSingle: 'export:clean-single',
  cleanSingleProgress: 'export:clean-single-progress',
  exportSingle: 'export:single',
  exportMultiple: 'export:multiple',
} as const;
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 1.3：扩展 domain-api 添加 ExportAPI 接口

**文件：** `src/shared/domain-api.ts`

```typescript
import type {
  ArticleAvailability,
  CleanProgressEvent,
  ExportMultipleResult,
  ExportSingleResult,
  PerArticleOptions,
} from './contracts/export.ipc';
import type { IPCResult } from './contracts/feed.ipc';

export interface ExportAPI {
  checkAvailability: (
    entryIds: number[],
  ) => Promise<IPCResult<{
    articles: ArticleAvailability[];
    unwashedIds: number[];
  }>>;
  cleanSingle: (
    entryId: number,
    onProgress?: (event: CleanProgressEvent) => void,
  ) => Promise<IPCResult<void>>;
  single: (
    entryId: number,
    options: PerArticleOptions,
  ) => Promise<IPCResult<ExportSingleResult>>;
  multiple: (
    entries: Array<{ entryId: number; options: PerArticleOptions }>,
  ) => Promise<IPCResult<ExportMultipleResult>>;
}
```

**验证：** `npx tsc --noEmit --pretty`

---

### Commit 1.4：扩展 ShaleAPI 加入 export 命名空间

**文件：** `src/shared/ipc.ts`

```typescript
import type { ExportAPI } from './contracts/export.ipc';

export interface ShaleAPI {
  // ... 现有字段
  export: ExportAPI;
}
```

**验证：** `npx tsc --noEmit --pretty`

---

## 完成后验证

```bash
npx tsc --noEmit --pretty
```

必须无类型错误。后续步骤将在 Preload、Main、Renderer 中使用这些类型。

## 回退方案

如果发现类型设计不合理（如 ExportableArticle 缺少字段），优先修改 shared types，再同步更新使用方。