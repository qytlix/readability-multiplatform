# EXP-04：接入单篇导出入口（Renderer）

> 对应 Issue #29 — 第四步
> 预估：0.5d
> 依赖：EXP-03（ExportService + IPC + Preload 可用）

---

## 目标

在 Reader 页面（EntryDetail）的 AI 工具栏添加"导出为 Markdown"按钮。

流程：点击导出按钮 → 弹出选项对话框(单篇) → 用户选择内容 → 下一步 → 系统保存对话框 → 写入。

**清洗检查前置：** 文章未清洗时按钮直接 disabled，不进入后续流程。

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 修改 | `src/renderer/features/feeds/EntryDetail.tsx` |
| 新建 | `src/renderer/features/feeds/ExportOptionsDialog.tsx` |
| 新建 | `src/renderer/features/feeds/entryExport.ts` |

---

## Git Commits

### Commit 4.1：entryExport — Renderer 侧导出工具函数

**文件：** `src/renderer/features/feeds/entryExport.ts`

```typescript
import type { IPCResult } from '../../../shared/contracts/feed.ipc';
import type {
  CheckAvailabilityResponse,
  CleanProgressEvent,
  ExportSingleResult,
  PerArticleOptions,
} from '../../../shared/contracts/export.ipc';

declare global {
  interface Window {
    shaleAPI: import('../../../shared/ipc').ShaleAPI;
  }
}

export async function checkAvailability(
  entryIds: number[],
): Promise<IPCResult<CheckAvailabilityResponse>> {
  return window.shaleAPI.export.checkAvailability(entryIds);
}

export async function cleanSingle(
  entryId: number,
  onProgress?: (event: CleanProgressEvent) => void,
): Promise<IPCResult<void>> {
  return window.shaleAPI.export.cleanSingle(entryId, onProgress);
}

export async function exportSingleEntry(
  entryId: number,
  options: PerArticleOptions,
): Promise<IPCResult<ExportSingleResult>> {
  return window.shaleAPI.export.single(entryId, options);
}
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 4.2：ExportOptionsDialog 组件

**文件：** `src/renderer/features/feeds/ExportOptionsDialog.tsx`

**Props：**
```typescript
interface ExportOptionsDialogProps {
  open: boolean;
  articles: ArticleAvailability[];
  onConfirm: (
    perArticleOptions: Map<number, PerArticleOptions>,
  ) => void;
  onCancel: () => void;
}
```

**UI 布局（单篇时只有一行的简化版）：**

```
┌──────────────────────────────────────────────┐
│  📄 导出文件                                 │
│                                              │
│  标题：当前文章标题                           │
│                                              │
│  ☑ 包含总结     ☑ 包含翻译     ☐ 包含笔记     │
│  (灰显不可用)   (灰显不可用)   (灰显不可用)    │
│                                              │
│              [  取消  ] [  下一步  ]          │
└──────────────────────────────────────────────┘
```

**规则：**
- 单篇文章时：只有一行，三个 checkbox
- 数据不存在 → 对应 checkbox 灰显 disabled，不可勾选
- 默认值：存在的字段全部勾选
- 点击「取消」→ onCancel()，不退出当前阅读
- 点击「下一步」→ onConfirm(perArticleOptions)

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 4.3：EntryDetail 导出按钮 + 流程串联

**文件：** `src/renderer/features/feeds/EntryDetail.tsx`

**改动位置：** AI 工具栏，按钮排列：

```
summary | translate | （竖线）| 批注 | 已读 | 书签 | 打开原文 | 字体 | ⬇️导出 | ...更多
```

**导出按钮状态：**
- 文章未清洗（`pipelineStatus !== 'success'`）→ disabled，tooltip `"文章尚未完成内容清洗"`
- 已清洗 → 可点击，tooltip `"导出为 Markdown"`

**点击导出按钮的流程：**

```typescript
const [showExportDialog, setShowExportDialog] = useState(false);
const [articleAvailability, setArticleAvailability] =
  useState<ArticleAvailability | null>(null);

const handleExportClick = useCallback(async () => {
  if (!entry) return;
  // 检查可用性
  const result = await checkAvailability([entry.id]);
  if (!result.ok) return; // 显示错误
  setArticleAvailability(result.data.articles[0]);
  setShowExportDialog(true);
}, [entry]);

const handleExportConfirm = useCallback(
  async (perArticleOptions: Map<number, PerArticleOptions>) => {
    setShowExportDialog(false);
    const options = perArticleOptions.get(entry!.id);
    if (!options) return;
    const result = await exportSingleEntry(entry!.id, options);
    // 处理结果：成功 → 提示 / 取消 → 不处理 / 失败 → 错误
  },
  [entry],
);
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 4.4：导出图标组件

**文件：** `src/renderer/features/reader/ReaderIcons.tsx`

```tsx
export const ExportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1L8 10M8 10L5 7M8 10L11 7"
      stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M2 11L2 13C2 14.1046 2.89543 15 4 15L12 15C13.1046 15 14 14.1046 14 13L14 11"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
);
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

## 完成后验证

```bash
npx tsc --noEmit --pretty

npm start
# 1. 打开一篇文章
# 2. 确认已清洗 → 导出按钮可点击
# 3. 点击 → 弹出选项对话框
# 4. 勾选/取消勾选 → 点击下一步 → 保存对话框
# 5. 保存 → 确认 .md 文件正确
# 6. 取消保存 → 无空文件
# 7. 打开未清洗的文章 → 导出按钮 disabled
```

## 回退方案

如果 ExportOptionsDialog 开发周期长，可先简化为固定选项（全部包含），跳过选项对话框直接进入保存对话框。选项对话框作为单独 PR 补充。