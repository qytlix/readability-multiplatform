# EXP-06：预留并接入可选笔记字段

> 对应 Issue #29 — 第六步（P1，等待笔记模块接口就绪）
> 预估：0.5d
> 依赖：笔记模块（AnnotationService）接口稳定

---

## 目标

在导出模块中接入用户笔记。利用已有的 `AnnotationService.list(entryId)` 读取文章的笔记，将非空的 `noteText` 写入导出的 Markdown 文件。

**控制方式：** 笔记的输出受 `PerArticleOptions.includeNotes` 控制。用户在选项对话框中勾选或取消勾选"包含笔记"。

**注意事项：** 在笔记模块完成前，所有类型定义和 ExportService 中已预留 `notes?: string` 字段，此步骤只做"填坑"。

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 修改 | `src/main/export/ExportService.ts` |

---

## Git Commits

### Commit 6.1：ExportService 读取笔记

**文件：** `src/main/export/ExportService.ts`

在 `prepareArticleData()` 方法中，根据 `options.includeNotes` 决定是否读取：

```typescript
let notes: string | undefined;
if (options.includeNotes && this.annotationService) {
  const annotations = this.annotationService.list(entryId);
  const noteTexts = annotations
    .map((a) => a.noteText.trim())
    .filter((t) => t.length > 0);
  if (noteTexts.length > 0) {
    notes = noteTexts.join('\n\n');
  }
}
```

**逻辑：**
1. 仅在 `options.includeNotes === true` 时才查询
2. 调用 `annotationService.list(entryId)` 获取文章所有标注
3. 只取 `noteText` 非空的标注（filter + trim）
4. 多条笔记用空行（`\n\n`）分隔
5. 如果所有笔记都无文字内容，`notes` 保持 `undefined`

**接口说明：**
- `AnnotationService.list(entryId: number): EntryAnnotation[]`
- `EntryAnnotation.noteText: string` — 笔记文字，可能为空字符串 `''`

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 6.2：MarkdownSerializer 输出笔记

**文件：** `src/main/export/MarkdownSerializer.ts`

笔记的输出规则已在 EXP-02 中实现：

```typescript
if (options.includeNotes && notes) {
  result += '\n\n---\n\n> **笔记：**\n>\n';
  const lines = notes.split('\n\n');
  for (const line of lines) {
    result += `> - ${line}\n`;
  }
}
```

**输出规则：**
- 多条笔记以无序列表 `> - ` 输出
- 单条笔记同上（保持一致性）
- 无笔记或 `includeNotes === false` 时整个段落省略

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

## 完成后验证

```bash
npx tsc --noEmit --pretty

# 人工验证
# 1. 为文章添加带文字内容的笔记
# 2. 导出 → 选项对话框中勾选「包含笔记」
# 3. 确认笔记出现在导出文件尾部
# 4. 再次导出但不勾选「包含笔记」→ 笔记段落不出现
# 5. 删除笔记后导出 → 笔记段落消失
```

## 相关文件

- `src/main/annotations/AnnotationService.ts` — `list(entryId)` 方法
- `src/shared/contracts/annotation.types.ts` — `EntryAnnotation` 类型
- `src/shared/contracts/export.types.ts` — `PerArticleOptions.includeNotes`
- `src/main/services.ts` — `annotationService` 已在服务初始化中创建