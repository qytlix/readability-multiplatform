# EXP-05：接入多篇导出入口（Renderer）

> 对应 Issue #29 — 第五步
> 预估：1d
> 依赖：EXP-03（ExportService + IPC + Preload 可用）

---

## 目标

在文章列表（EntryList）中增加多选模式，用户可勾选多篇文章，使用 AI 工具栏的导出按钮统一导出。

流程：进入多选模式 → 勾选文章 → 点击导出按钮 → 选项对话框(含清洗) → 取消(保持选中) / 下一步 → 保存对话框 → 写入(自动退出多选)

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 修改 | `src/renderer/features/feeds/EntryList.tsx` |
| 修改 | `src/renderer/App.tsx` |
| 修改 | `src/renderer/features/feeds/EntryDetail.tsx` |

---

## Git Commits

### Commit 5.1：App.tsx 多选状态

**文件：** `src/renderer/App.tsx`

新增状态：
```typescript
const [selectionMode, setSelectionMode] = useState(false);
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
```

传给 EntryList：
```typescript
<EntryList
  ...
  selectionMode={selectionMode}
  selectedIds={selectedIds}
  onSelectionModeChange={(enabled) => {
    if (!enabled) setSelectedIds(new Set());
    setSelectionMode(enabled);
  }}
  onSelectionToggle={(entryId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }}
/>
```

传给 EntryDetail：
```typescript
<EntryDetail
  ...
  selectionMode={selectionMode}
  selectedIds={selectedIds}
  onExportRequest={handleExportRequest}
/>
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 5.2：EntryList 多选 toggle 按钮（单按钮切换）

**文件：** `src/renderer/features/feeds/EntryList.tsx`

**Props 扩展：**
```typescript
interface EntryListProps {
  // ... 现有 props
  selectionMode?: boolean;
  selectedIds?: Set<number>;
  onSelectionModeChange?: (enabled: boolean) => void;
  onSelectionToggle?: (entryId: number) => void;
}
```

**story-list-header 区域与 Filter 并列的 toggle 按钮：**
```tsx
<button
  type="button"
  className={`icon-button ${selectionMode ? 'is-active' : ''}`}
  aria-label={selectionMode ? '退出选择模式' : '选择文章'}
  title={selectionMode ? '退出选择模式' : '选择文章'}
  onClick={() => onSelectionModeChange?.(!selectionMode)}
>
  {/* ☑️ 图标 */}
</button>
```

- 普通模式：点击进入多选模式
- 多选模式：高亮 `.is-active`，点击退出并清空选中

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 5.3：EntryList 多选模式 UI

**文件：** `src/renderer/features/feeds/EntryList.tsx`

当 `selectionMode === true` 时：

1. **每个 story-card 左侧显示 checkbox**
```tsx
{selectionMode && (
  <span className="story-card-checkbox" onClick={(e) => e.stopPropagation()}>
    <input
      type="checkbox"
      checked={selectedIds?.has(entry.id) ?? false}
      onChange={() => onSelectionToggle?.(entry.id)}
    />
  </span>
)}
```

2. **顶部显示选择计数**
```tsx
{selectionMode && (
  <div className="export-selection-bar">
    <span>已选 {selectedIds?.size ?? 0} 篇</span>
  </div>
)}
```
（无独立取消按钮——退出通过 toggle 按钮完成）

3. **选择模式下点击卡片只切换选择，不导航到文章**

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 5.4：EntryDetail 多选模式导出流程

**文件：** `src/renderer/features/feeds/EntryDetail.tsx`

新增 props：
```typescript
interface EntryDetailProps {
  // ... 现有
  selectionMode?: boolean;
  selectedIds?: Set<number>;
  onExportRequest?: () => void;
}
```

导出按钮双模式：
```typescript
const handleExportClick = useCallback(async () => {
  if (selectionMode && selectedIds && selectedIds.size > 0) {
    // 多选模式 → 触发父组件的导出流程
    onExportRequest?.();
  } else if (entry) {
    // 普通模式 → 检查可用性 → 弹出选项对话框
    const result = await checkAvailability([entry.id]);
    if (!result.ok) return;
    setArticleAvailability(result.data.articles[0]);
    setShowExportDialog(true);
  }
}, [entry, selectionMode, selectedIds, onExportRequest]);

// tooltip 切换
const exportTooltip = selectionMode
  ? `导出所选 ${selectedIds?.size ?? 0} 篇文章`
  : '导出为 Markdown';
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 5.5：App.tsx 多选导出流程（ExportOptionsDialog 多篇模式）

**文件：** `src/renderer/App.tsx`

```typescript
const [showExportDialog, setShowExportDialog] = useState(false);
const [exportArticles, setExportArticles] = useState<ArticleAvailability[]>([]);

const handleExportRequest = useCallback(async () => {
  const ids = Array.from(selectedIds);
  if (ids.length === 0) return;

  const result = await checkAvailability(ids);
  if (!result.ok) return;
  setExportArticles(result.data.articles);
  setShowExportDialog(true);
}, [selectedIds]);

// 单篇和多篇共用同一个 ExportOptionsDialog
<ExportOptionsDialog
  open={showExportDialog}
  articles={exportArticles}
  onCancel={() => {
    setShowExportDialog(false);
    // 不清空 selectedIds，不清除 selectionMode
  }}
  onConfirm={async (perArticleOptions) => {
    setShowExportDialog(false);
    // 多篇 → 组装每篇的 entryId + options
    const entries = Array.from(perArticleOptions.entries()).map(
      ([entryId, options]) => ({ entryId, options }),
    );
    const result = await exportMultipleEntries(entries);
    if (result.ok) {
      // 导出成功 → 退出多选
      setSelectionMode(false);
      setSelectedIds(new Set());
    }
    // 取消保存 → 保持多选
  }}
/>
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 5.6：ExportOptionsDialog 多篇模式 UI（扩展）

**文件：** `src/renderer/features/feeds/ExportOptionsDialog.tsx`

当 `articles.length > 1` 时，对话框切换到多篇布局：

```
┌──────────────────────────────────────────────────────┐
│  📄 导出文件                                         │
│                                                      │
│  [全选总结]   [全选翻译]   [全选笔记]   ← 列级按钮   │
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

**每篇文章行的渲染逻辑：**
- `pipelineStatus === 'success'` → 显示 ✅ 图标 + checkbox 可选
- `pipelineStatus` 非 success → 显示 ⏳ 图标 + "🧹未清洗" 标签 + `[现在清洗]` 按钮
- 清洗失败 → 显示 ❌ 图标 + "清洗失败" 标签，该行不可导出
- checkbox 状态根据 PerArticleOptions 控制

**列级按钮逻辑：**
```typescript
const handleSelectAllSummary = () => {
  setPerArticleOptions((prev) => {
    const next = new Map(prev);
    // 对所有已清洗的文章 toggle「总结」
    for (const article of cleanedArticles) {
      const current = next.get(article.entryId) ?? DEFAULT_PER_ARTICLE_OPTIONS;
      next.set(article.entryId, {
        ...current,
        includeSummary: !allSummarySelected,
      });
    }
    return next;
  });
};
```

**「现在清洗」按钮逻辑：**
```typescript
const handleCleanSingle = async (entryId: number) => {
  setCleaningIds((prev) => new Set(prev).add(entryId));
  await cleanSingle(entryId, (event) => {
    if (event.status === 'success') {
      // 更新该行的 ArticleAvailability → pipelineStatus = 'success'
    }
  });
  setCleaningIds((prev) => {
    const next = new Set(prev);
    next.delete(entryId);
    return next;
  });
};
```

**按钮状态：**
- 「下一步」：`cleaningIds.size > 0 || 无任何已清洗文章可选` → disabled
- 「取消」：始终可点击

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 5.7：entryExport 添加多篇导出函数

**文件：** `src/renderer/features/feeds/entryExport.ts`

```typescript
export async function exportMultipleEntries(
  entries: Array<{ entryId: number; options: PerArticleOptions }>,
): Promise<IPCResult<ExportMultipleResult>> {
  return window.shaleAPI.export.multiple(entries);
}
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
# 1. 点击「选择」按钮 → 进入多选，按钮高亮
# 2. 勾选 2~3 篇文章，翻页勾选第 2 页 → 保持选中
# 3. 点击导出按钮 → tooltip 显示「导出所选 N 篇」
# 4. 弹出选项对话框 → 部分未清洗 → 点击「现在清洗」
# 5. 清洗中「下一步」disabled，「取消」可点击
# 6. 清洗完成 → checkbox 可用
# 7. 点击「下一步」→ 保存 → 写入 → 自动退出多选
# 8. 重新进入多选 → 勾选 → 导出 → 取消 → 回到多选，选中保持
# 9. 切换 Filter → 自动退出多选
```

## 回退方案

如果多选模式的清洗功能复杂度超出预期，可以先：
1. 不实现「现在清洗」功能，未清洗文章在对话框内显示为不可选
2. 不实现列级全选按钮，用户逐篇勾选