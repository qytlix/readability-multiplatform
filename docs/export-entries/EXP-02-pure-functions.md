# EXP-02：实现 MarkdownSerializer + safeFilename（纯函数）

> 对应 Issue #29 — 第二步
> 预估：0.5d
> 依赖：EXP-01（ExportableArticle、PerArticleOptions 类型）

---

## 目标

实现两个纯函数模块——Markdown 序列化器和安全文件名生成器。它们无副作用，不涉及 IPC、Database 或 File System，易于单元测试。

序列化器接收 `PerArticleOptions` 参数，根据用户的选择决定是否输出总结/翻译/笔记。每篇文章独立控制。

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `src/main/export/safeFilename.ts` |
| 新建 | `src/main/export/MarkdownSerializer.ts` |

---

## Git Commits

### Commit 2.1：safeFilename 实现

**文件：** `src/main/export/safeFilename.ts`

```
输入："Hello: World? | Test"
输出："Hello  World   Test"

输入："" 或全部非法字符
输出："untitled"
```

**规则：**
1. 替换 `\ / : * ? " < > |` 为空格
2. 合并连续空格（`/\s+/g` → 单个空格）
3. 去除首尾空格和点号
4. 截断到 200 字符
5. 如果结果为空，返回 `"untitled"`

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 2.2：MarkdownSerializer.serializeSingle() 实现

**文件：** `src/main/export/MarkdownSerializer.ts`

**函数签名：**
```typescript
export function serializeSingle(
  article: ExportableArticle,
  options?: PerArticleOptions,
): string;
```

**`options` 参数作用：**
- 不传 → 等同于 `DEFAULT_PER_ARTICLE_OPTIONS`（全部包含）
- 传了 → 按用户选择决定是否输出总结/翻译/笔记
- 即使用户选择了包含，但数据不存在 → 直接省略（不报错）

**输出规则：**
- 标题 → 一级标题 `# title`
- 来源（有则输出 `**来源：** feedTitle`）
- 作者（有则输出 `**作者：** author`）
- 时间（有则输出 `**发布时间：** publishedAt`）
- 链接（有则输出 `**原文链接：** url`）
- 元信息与正文之间用 `---` 分隔
- 正文 → 直接输出 `cleanedMarkdown`
- Summary（options.includeSummary && summary 存在 → 输出 `> **AI 摘要：**\n>\n> 内容`）
- Translation（options.includeTranslation && translation 存在 → 输出 `> **翻译：**\n>\n> 内容`）
- Notes（options.includeNotes && notes 存在 → 输出 `> **笔记：**\n>\n> - 内容`）
- Summary/Translation/Notes 之间用 `---` 分隔
- 可选字段缺失或被排除时，对应段落和分隔线均**不输出**
- cleanedMarkdown 为空时输出 `*(无正文内容)*`

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

### Commit 2.3：MarkdownSerializer.serializeMultiple() 实现

**文件：** `src/main/export/MarkdownSerializer.ts`（追加）

```typescript
export function serializeMultiple(
  articles: ExportableArticle[],
  defaultOptions?: PerArticleOptions,
): string;
```

每篇文章使用自身的 `article.exportOptions`（如果存在）；不存在则用 `defaultOptions`。

**输出规则：**
- 文件头：`# 文摘 — 当前日期` + 元信息（篇数、导出时间）
- 每篇文章用 `## N. 标题`（二级标题，序号 1-based）
- 每篇文章内容 = serializeSingle() 但不输出标题（已由二级标题承载）
- 文章之间用 `---` 分隔
- 重复 entryId 由调用方保证不传入

**验证：**
```bash
npx tsc --noEmit --pretty
```

---

## 完成后验证

```bash
npx tsc --noEmit --pretty
```

## 回退方案

序列化格式变更时只修改 `MarkdownSerializer.ts`，不影响调用方和测试。