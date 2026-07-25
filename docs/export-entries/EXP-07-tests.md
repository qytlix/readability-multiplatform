# EXP-07：单元测试 + 集成测试

> 对应 Issue #29 — 第七步
> 预估：1d
> 依赖：EXP-02（纯函数）、EXP-03（ExportService）、EXP-04/05（选项对话框）

---

## 目标

为导出模块编写完整的自动化测试，覆盖纯函数（序列化、文件名）、选项对话框逻辑和集成场景。

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `tests/unit/export/markdown-serializer.test.ts` |
| 新建 | `tests/unit/export/safeFilename.test.ts` |
| 新建 | `tests/unit/export/article-availability.test.ts` |
| 新建 | `tests/fixtures/export/export-test-articles.ts` |
| 新建 | `tests/unit/export/export-options-dialog.test.tsx`（可选） |

---

## Git Commits

### Commit 7.1：safeFilename 单元测试

**文件：** `tests/unit/export/safeFilename.test.ts`

| # | 输入 | 预期输出 | 说明 |
|---|------|---------|------|
| 1 | `"Hello World"` | `"Hello World"` | 正常英文 |
| 2 | `"file:name?bad"` | `"file name bad"` | 过滤 `: ?` |
| 3 | `'a\\b/c:d*e?f"g<h>i\|j'` | `"a b c d e f g h i j"` | 全部非法字符 |
| 4 | `"  leading/trailing  "` | `"leading/trailing"` | 首尾空格去除 |
| 5 | `"标题: 包含中文"` | `"标题 包含中文"` | 中文+非法符 |
| 6 | `"😀emoji👍test"` | `"😀emoji👍test"` | Emoji 保留 |
| 7 | `""` | `"untitled"` | 空字符串 |
| 8 | `"   "` | `"untitled"` | 全空格 |
| 9 | `".hidden"` | `"hidden"` | 去除前导点号 |
| 10 | `"a".repeat(300)` | 长度 200 | 超长截断 |

**运行：**
```bash
npx vitest run tests/unit/export/safeFilename.test.ts
```

---

### Commit 7.2：MarkdownSerializer.serializeSingle 单元测试

**文件：** `tests/unit/export/markdown-serializer.test.ts`

| # | 场景 | 验证点 |
|---|------|--------|
| 1 | 只有标题+正文，默认 options | `# title\n\n正文` |
| 2 | 全部字段，全部包含 | 完整的元信息+总结+翻译+笔记 |
| 3 | 全部字段，不包含总结 | 不输出总结块 |
| 4 | 全部字段，不包含翻译 | 不输出翻译块 |
| 5 | 全部字段，不包含笔记 | 不输出笔记块 |
| 6 | 全部字段，全部不包含 | 只输出标题+正文 |
| 7 | 缺少作者/日期/来源/链接 | 对应行省略 |
| 8 | Summary 存在但 options 不包含 | 省略（同 3） |
| 9 | 数据不存在但 options 包含 | 省略（不报错） |
| 10 | cleanedMarkdown 为空 | 输出 `*(无正文内容)*` |
| 11 | 中文/Emoji/特殊字符 | 原文保留 |

**运行：**
```bash
npx vitest run tests/unit/export/markdown-serializer.test.ts
```

---

### Commit 7.3：MarkdownSerializer.serializeMultiple 单元测试

**文件：** `tests/unit/export/markdown-serializer.test.ts`（追加）

| # | 场景 | 验证点 |
|---|------|--------|
| 1 | 2 篇，不同选项（A 要翻译 B 不要） | 各篇独立控制 |
| 2 | 1 篇（单篇退化） | 文件头 + `## 1.` |
| 3 | 5 篇，有缺字段 | 每篇格式独立正确 |
| 4 | 序号 1-based | 从 1 开始递增 |
| 5 | 空数组 | 输出文件头 + "无文章"提示 |

**运行：**
```bash
npx vitest run tests/unit/export/markdown-serializer.test.ts
```

---

### Commit 7.4：测试 Fixture 文件

**文件：** `tests/fixtures/export/export-test-articles.ts`

```typescript
import type { ExportableArticle } from '../../../src/shared/contracts/export.types';
import type { PerArticleOptions } from '../../../src/shared/contracts/export.ipc';

export const defaultOptions: PerArticleOptions = {
  includeSummary: true,
  includeTranslation: true,
  includeNotes: true,
};

export const noOptions: PerArticleOptions = {
  includeSummary: false,
  includeTranslation: false,
  includeNotes: false,
};

export const fullArticle: ExportableArticle = {
  entryId: 1,
  feedTitle: 'Tech Blog',
  url: 'https://example.com/article-1',
  title: 'Hello World',
  author: 'Alice',
  publishedAt: '2024-01-01T12:00:00.000Z',
  cleanedMarkdown: 'This is the **body** of the article.',
  summary: 'A short summary.',
  translation: '这是一篇翻译。',
  notes: 'My note.',
  exportOptions: defaultOptions,
};

export const minimalArticle: ExportableArticle = {
  entryId: 2,
  cleanedMarkdown: 'Just body.',
  exportOptions: defaultOptions,
};
```

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 7.5：ArticleAvailability 逻辑测试

**文件：** `tests/unit/export/article-availability.test.ts`

测试 `checkAvailability` 响应对选项对话框渲染的影响：

| # | 场景 | 验证点 |
|---|------|--------|
| 1 | 全部已清洗+有所有数据 | 全部 checkbox 可用 |
| 2 | 部分未清洗 | unwashedIds 正确 |
| 3 | 没有总结数据 | hasSummary: false |
| 4 | 没有翻译数据 | hasTranslation: false |
| 5 | 没有笔记数据 | hasNotes: false |

**运行：**
```bash
npx vitest run tests/unit/export/article-availability.test.ts
```

---

### Commit 7.6：集成测试（可选，需要数据库）

**文件：** `tests/integration/export-service.test.ts`

| # | 场景 | 验证点 |
|---|------|--------|
| 1 | 真实 Store → ExportService → 文件写入 | 文件存在、内容正确、UTF-8 |
| 2 | entryId 不存在 | `EXPORT_ENTRY_NOT_FOUND` |
| 3 | content 不存在 | `EXPORT_CONTENT_NOT_FOUND` |
| 4 | 写入到无效路径 | `EXPORT_WRITE_FAILED` |
| 5 | 选项控制——不包含总结 | 写入文件中无总结块 |
| 6 | 选项控制——全不包含 | 只输出元信息+正文 |

**运行：**
```bash
npx vitest run tests/integration/export-service.test.ts
```

---

## 完成后验证

```bash
npx vitest run tests/unit/export/
npx vitest run
npx tsc --noEmit --pretty
```

## 测试覆盖率目标

- safeFilename：100% 分支覆盖
- MarkdownSerializer：90%+ 行覆盖（含 options 不同组合）
- ArticleAvailability：95%+ 分支覆盖

## 回退方案

如果集成测试环境搭建复杂，先只完成单元测试，集成测试以人工验证代替。