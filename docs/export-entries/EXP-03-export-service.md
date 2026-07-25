# EXP-03：ExportService + IPC Handler + Preload

> 对应 Issue #29 — 第三步
> 预估：1d
> 依赖：EXP-01、EXP-02

---

## 目标

实现 Main 进程的 ExportService（数据聚合 + 文件写入）、IPC handler 注册，以及 Preload 层的 `shaleAPI.export.*` 暴露。

相比初始版本，新增了：
- `export:check-availability` — 检查文章清洗状态和数据可用性
- `export:clean-single` — 按需清洗单篇文章（带进度事件）
- `export:single` / `export:multiple` — 接收 `PerArticleOptions`，每篇文章独立控制

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `src/main/export/ExportService.ts` |
| 新建 | `src/main/ipc/export.handler.ts` |
| 修改 | `src/main/ipc.ts` |
| 修改 | `src/main/services.ts` |
| 修改 | `src/preload/preload.ts` |

---

## Git Commits

### Commit 3.1：ExportService — 数据聚合 + 文件写入

**文件：** `src/main/export/ExportService.ts`

**构造函数接收：**
- `entryStore: EntryStore`
- `contentStore: ContentStore`
- `contentService: ContentService`（用于按需清洗）
- `summaryStore?: SummaryStore`（可选）
- `translationStore?: TranslationStore`（可选）
- `annotationStore?: AnnotationStore`（可选，P1 预留）

**方法：**
```typescript
class ExportService {
  // 检查可用性：清洗状态、总结/翻译/笔记是否存在
  async checkAvailability(
    entryIds: number[],
  ): Promise<{ articles: ArticleAvailability[]; unwashedIds: number[] }>;

  // 清洗单篇文章（用于选项对话框的「现在清洗」）
  async cleanSingle(entryId: number): Promise<void>;

  // 聚合单篇文章数据（按选项过滤）
  async prepareArticleData(
    entryId: number,
    options: PerArticleOptions,
  ): Promise<ExportableArticle>;

  // 聚合多篇文章数据（每篇按自己的选项过滤）
  async prepareMultipleArticleData(
    entries: Array<{ entryId: number; options: PerArticleOptions }>,
  ): Promise<ExportableArticle[]>;

  // 写入文件
  async writeFile(filePath: string, markdown: string): Promise<void>;
}
```

**checkAvailability 逻辑：**
1. 对每篇文章查询 `pipelineStatus`
2. 检查 summary/translation 是否存在（SELECT COUNT 轻量查询）
3. 返回 `ArticleAvailability[]` + `unwashedIds`

**prepareArticleData 逻辑：**
1. `entryStore.getById()` → 获取元数据
2. `contentStore.getCleanedContent()` → 获取 cleanedMarkdown
3. `summaryStore?.get()` → 按 options.includeSummary 决定是否读取
4. `translationStore?.get()` → 按 options.includeTranslation 决定是否读取
5. `annotationStore?.list()` → 按 options.includeNotes 决定是否读取
6. 组装 ExportableArticle 返回

**文件写入逻辑：**
1. `fs.writeFileSync(filePath, markdown, 'utf-8')`
2. 写入失败时抛 ShaleError

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 3.2：IPC Handler — export.handler.ts

**文件：** `src/main/ipc/export.handler.ts`

```typescript
export function registerExportIpcHandlers(
  getMainWindow: GetMainWindow,
  exportService: ExportService,
): void;
```

| Channel | 逻辑 |
|---------|------|
| `export:check-availability` | 调用 exportService.checkAvailability(entryIds) → 返回 |
| `export:clean-single` | 调用 exportService.cleanSingle(entryId)，通过 webContents.send 发送进度事件 |
| `export:single` | 1. exportService.prepareArticleData(entryId, options) 2. MarkdownSerializer.serializeSingle() 3. dialog.showSaveDialog() 4. fs.writeFileSync() 5. 返回结果 |
| `export:multiple` | 同上，但循环 prepare + serializeMultiple() |

**对话框选项：**
```typescript
import { app } from 'electron';

dialog.showSaveDialog(mainWindow, {
  title: '导出文章为 Markdown',
  defaultPath: path.join(
    app.getPath('documents'),
    safeFilename(title) + '.md',
  ),
  filters: [{ name: 'Markdown', extensions: ['md'] }],
});
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 3.3：注册 Export Handler 到 ipc.ts

**文件：** `src/main/ipc.ts`

```typescript
import { registerExportIpcHandlers } from './ipc/export.handler';
import { ExportService } from './export/ExportService';
import { getFeedServices } from './services';

// 在 feed/external/summary/translation/annotation 注册之后：
const feedSvcs = getFeedServices();
const summarySvcs = getSummaryServices();
const translationSvcs = getTranslationServices();
const annotationSvcs = getAnnotationServices();
if (feedSvcs) {
  const exportService = new ExportService(
    feedSvcs.entryStore,
    feedSvcs.contentStore,
    feedSvcs.contentService,
    summarySvcs?.summaryStore,
    translationSvcs?.translationStore,
    annotationSvcs?.annotationService,
  );
  registerExportIpcHandlers(getMainWindow, exportService);
}
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 3.4：Preload 暴露 export API

**文件：** `src/preload/preload.ts`

```typescript
import { EXPORT_IPC_CHANNELS } from '../shared/contracts/export.ipc';
import type {
  CleanProgressEvent,
  PerArticleOptions,
} from '../shared/contracts/export.types';

const exportAPI = {
  checkAvailability: (entryIds: number[]) =>
    ipcRenderer.invoke(EXPORT_IPC_CHANNELS.checkAvailability, { entryIds }),
  cleanSingle: (
    entryId: number,
    onProgress?: (event: CleanProgressEvent) => void,
  ) => {
    if (onProgress) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: CleanProgressEvent,
      ) => onProgress(progress);
      ipcRenderer.on(EXPORT_IPC_CHANNELS.cleanSingleProgress, handler);
    }
    const promise = ipcRenderer.invoke(EXPORT_IPC_CHANNELS.cleanSingle, {
      entryId,
    });
    if (onProgress) {
      promise.finally(() => {
        ipcRenderer.removeAllListeners(EXPORT_IPC_CHANNELS.cleanSingleProgress);
      });
    }
    return promise;
  },
  single: (entryId: number, options: PerArticleOptions) =>
    ipcRenderer.invoke(EXPORT_IPC_CHANNELS.exportSingle, {
      entryId,
      options,
    }),
  multiple: (
    entries: Array<{ entryId: number; options: PerArticleOptions }>,
  ) => ipcRenderer.invoke(EXPORT_IPC_CHANNELS.exportMultiple, { entries }),
};

const shaleAPI: ShaleAPI = {
  // ... 现有字段
  export: exportAPI,
};
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

## 完成后验证

```bash
npx tsc --noEmit --pretty
```

## 错误码清单

| code | 触发条件 |
|------|---------|
| `EXPORT_ENTRY_NOT_FOUND` | entryStore.getById() 返回 null |
| `EXPORT_CONTENT_NOT_FOUND` | contentStore.getCleanedContent() 返回 null |
| `EXPORT_WRITE_FAILED` | fs.writeFileSync 抛出异常 |
| `EXPORT_SAVE_CANCELED` | dialog.showSaveDialog 返回 canceled: true |
| `EXPORT_TOO_MANY_ARTICLES` | 批量导出 > 100 篇（警告，不强制阻止） |
| `EXPORT_CLEAN_FAILED` | 清洗单篇文章失败 |

## 回退方案

如果 ExportService 过于复杂，可简化为在 handler 内联实现逻辑，不抽取 Service 类。