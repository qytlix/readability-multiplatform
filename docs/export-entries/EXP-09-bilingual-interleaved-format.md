# EXP-09：导出译文改为逐段穿插格式（Bilingual Interleaved Markdown）

> 负责人：qytlix
> 状态：待实施
> 对应 Issue：#79（Bug）+ 导出格式改进
> 最后更新：2026-07-26

---

## 1. 背景

### 1.1 Issue #79：导出译文重复、拼接、乱序

阅读界面（Shale）中翻译显示正常，但导出后的译文出现：
- 同一段落出现两版译文（重复）
- 项目符号被错误拼接
- 后半部分段落顺序交错

**根因**：`ExportService.findTranslationContent()` 的 SQL 查询没有限制到单个 run：

```sql
-- 当前（有 Bug）：JOIN 了所有成功的 run
SELECT ts.translatedText
FROM translation_result tr
JOIN translation_segment ts ON ts.translationResultId = tr.id
WHERE tr.entryId = ? AND tr.status = 'succeeded'
ORDER BY ts.orderIndex ASC
```

而阅读界面使用 `TranslationService.getState()` → `findCompatibleResult()` / `findLatestResult()`，
每次只读取**一个 run** 的数据。

### 1.2 导出格式改进：逐段穿插

当前导出格式是全部译文堆在末尾：

```markdown
正文全文...

---

> **翻译：**
>
> 译文段落1
>
> 译文段落2
```

目标格式改为一段原文一段译文（无标签）：

```markdown
This is paragraph one with **bold** text.

> 这是第一段，包含**粗体**字。

This is paragraph two.

> 这是第二段。

- List item A
- List item B

> - 列表项 A
> - 列表项 B
```

### 1.3 关键技术决策：分 segment 转 Markdown（方案 C）

原文格式保留方案对比：

| 方案 | 说明 | 结论 |
|---|---|---|
| A：直接用 `sourceText` | 纯文本，丢失加粗/斜体/链接/代码 | ❌ 不采用 |
| B：`cleanedMarkdown` + 偏移匹配 | 需全文查找插入位置，重复文本易错位 | ❌ 不采用 |
| **C：分 segment 转 Markdown** | 将每段 `sourceHtml` 单独过 Turndown | ✅ **采用** |

**方案 C 原理**：

```
TranslationSegment.sourceHtml = "<p>This is <b>bold</b> text</p>"
         ↓ 复用已有的 MarkdownConverter（Turndown）
         "This is **bold** text"
```

每段独立转换、格式保留可靠、与 `cleanedMarkdown` 全文无偏移耦合。

---

## 2. 改动清单

### 2.1 修正 Issue #79 导出重复/乱序 Bug

**文件**：`src/main/export/ExportService.ts`

**改动**：`findTranslationContent()` 从裸 SQL 改为调用 `TranslationStore.findLatestResult()`，只取最新成功的一个 run。

```typescript
// 旧：返回拼接字符串，混用所有成功 run
private findTranslationContent(entryId: number): string | undefined {
  const rows = this.db.prepare(`
    SELECT ts.translatedText FROM translation_result tr
    JOIN translation_segment ts ON ts.translationResultId = tr.id
    WHERE tr.entryId = ? AND tr.status = 'succeeded'
    ORDER BY ts.orderIndex ASC
  `).all(entryId) as Array<{ translatedText: string | null }>;
  if (rows.length === 0) return undefined;
  return rows.map((r) => r.translatedText ?? '').join('\n\n');
}

// 新：通过 TranslationStore 取最新 run 的 segments
private findTranslationContent(entryId: number): TranslationSegment[] | undefined {
  // 需要 sourceLanguage / targetLanguage 参数——见下方接口变更
  const result = this.translationStore.findLatestResult(
    entryId, sourceLanguage, targetLanguage,
  );
  if (!result || result.status !== 'succeeded') return undefined;
  return result.segments.filter((s) => s.status === 'succeeded');
}
```

**注意**：`findTranslationContent()` 当前只有 `entryId` 参数，但 `findLatestResult()` 需要 `sourceLanguage` + `targetLanguage`。需要将这两个参数传入——见下方 2.3 接口变更。

### 2.2 ExportableArticle 新增字段

**文件**：`src/shared/contracts/export.types.ts`

```typescript
import type { TranslationSegment } from './translation.types';

export interface ExportableArticle {
  // ... 现有字段保持不变 ...

  /** 可选译文（向后兼容，interleaved 模式不再使用） */
  translation?: string;

  /** 新：逐段译文数据（含原文 HTML 和译文 HTML/Text） */
  translationSegments?: TranslationSegment[];
}
```

保留旧的 `translation` 字段，interleaved 模式下使用 `translationSegments`，确保旧的 `includeTranslation: true` 在无 `translationSegments` 时仍能回退。

### 2.3 prepareArticleData() 接收 sourceLanguage / targetLanguage

**文件**：`src/main/export/ExportService.ts`

```typescript
prepareArticleData(
  entryId: number,
  options: PerArticleOptions,
  translationLanguage?: { source: TranslationSourceLanguage; target: TranslationTargetLanguage },
): ExportableArticle
```

当 `options.includeTranslation === true` 且 `translationLanguage` 提供时，调用 `findTranslationContent()` 获取 segments 并填入 `translationSegments`。

**IPC Handler**（`src/main/ipc/export.handler.ts`）：

`ExportSingleRequest` 和 `ExportMultipleRequest` 需要增加可选的 `sourceLanguage` / `targetLanguage` 字段。

```typescript
// src/shared/contracts/export.ipc.ts
export interface ExportSingleRequest {
  entryId: number;
  options: PerArticleOptions;
  /** 新增：翻译语言对，不传则跳过翻译 */
  translationLanguage?: {
    sourceLanguage: TranslationSourceLanguage;
    targetLanguage: TranslationTargetLanguage;
  };
}
```

### 2.4 ExportService 构造函数注入 TranslationStore

**文件**：`src/main/export/ExportService.ts`

当前 `ExportService` 构造函数：
```typescript
constructor(
  private entryStore: EntryStore,
  private contentStore: ContentStore,
  private contentService: ContentService,
  private db: Database.Database,
  private annotationService?: AnnotationService,
) {}
```

需要新增 `translationStore?: TranslationStore`：

```typescript
constructor(
  private entryStore: EntryStore,
  private contentStore: ContentStore,
  private contentService: ContentService,
  private db: Database.Database,
  private annotationService?: AnnotationService,
  private translationStore?: TranslationStore,
) {}
```

`findTranslationContent()` 在 `translationStore` 不存在时返回 `undefined`（不出错）。

**注入点**：`src/main/ipc.ts` 中构造 `ExportService` 的地方：

```typescript
const exportService = new ExportService(
  entryStore,
  contentStore,
  contentService,
  db,
  annotationService,
  translationServices?.translationStore, // 新增注入
);
```

### 2.5 MarkdownSerializer 新增 interleaved 序列化函数

**文件**：`src/main/export/MarkdownSerializer.ts`

新增 `serializeInterleaved()` 函数（或在 `serializeSingle()` 中根据 `article.translationSegments` 存在自动切换）：

```typescript
function serializeInterleavedBody(
  article: ExportableArticle,
  options: PerArticleOptions,
  converter: MarkdownConverter,
): string {
  const segments = article.translationSegments ?? [];
  const result: string[] = [];

  for (const segment of segments) {
    if (segment.sourceType === 'title' || segment.sourceType === 'byline') continue;
    if (segment.status !== 'succeeded' || !segment.translatedText) continue;

    // 原文：将 sourceHtml 过 Turndown 转为 Markdown
    const originalMd = converter.convert(segment.sourceHtml);

    // 译文：translatedText 为纯文本，直接放入引用块
    const translatedMd = segment.translatedText;

    result.push(originalMd);
    result.push(`> ${translatedMd}`);
  }

  return result.join('\n\n');
}
```

**关于 `translatedHtml` vs `translatedText`**：

`TranslationSegment` 包含 `translatedHtml`（带 HTML 格式）和 `translatedText`（纯文本）。译文放在 `>` 引用块中，纯文本格式（`translatedText`）足够。如果有格式需求，也可以用 `translatedHtml` 过 Turndown，但当前先用纯文本。

**多篇导出**（`serializeMultiple`）同样适用。

**关于标题（title）**：`title` 和 `byline` 类型的 segment 不参与逐段穿插。title 已经在文章头部的 `# 标题` 中输出，其译文可以：
- 输出在 `# 标题` 下方，作为 `> 译文标题`
- 或跟随其后的第一个正文 segment 的译文

设计决策：**title 的译文可以忽略**（阅读器中 title 的翻译通常通过其他 UI 元素展示），导出时 title 不单独输出译文。

### 2.6 MarkdownSerializer 导入 MarkdownConverter

`MarkdownSerializer` 目前是纯函数，没有类实例。需要改为传入 `MarkdownConverter` 实例，或者在模块级别共享一个实例。

```typescript
// MarkdownSerializer.ts 顶部
import { MarkdownConverter } from '../feed/fetcher/MarkdownConverter';

// 模块级单例（Turndown 无状态，可复用）
const markdownConverter = new MarkdownConverter();
```

或作为函数参数传入——但为了最小化 API 变更，模块级单例更简单。

---

## 3. 执行步骤

### Step 1：共享类型变更

**文件**：`src/shared/contracts/export.ipc.ts`、`src/shared/contracts/export.types.ts`

1. `ExportSingleRequest` 和 `ExportMultipleRequest` 新增 `translationLanguage` 字段
2. `ExportableArticle` 新增 `translationSegments?: TranslationSegment[]`

**验证**：TypeScript 编译通过。

### Step 2：ExportService 注入 + 修复 Bug + 获取 segments

**文件**：`src/main/export/ExportService.ts`

1. 构造函数新增 `translationStore?: TranslationStore`
2. 新增 `findTranslationSegments()` 方法（取代 `findTranslationContent()`）
   - 调用 `translationStore.findLatestResult(entryId, sourceLanguage, targetLanguage)`
   - 只取 `status === 'succeeded'` 的 result 中的 segments
3. `prepareArticleData()` 重载：接收可选 `translationLanguage` 参数
4. `hasTranslation()` 保持不变（轻量检查是否存在翻译）

**验证**：
- 单元测试：mock TranslationStore，验证返回正确的 segments
- 对同一篇文章多次翻译后导出，不会出现重复段落

### Step 3：IPC Handler 传递语言参数

**文件**：`src/main/ipc/export.handler.ts`

1. 从 `ExportSingleRequest` / `ExportMultipleRequest` 中取出 `translationLanguage`
2. 传递给 `exportService.prepareArticleData()`

**验证**：集成测试确认参数传递正确。

### Step 4：ExportService 注入到 ipc.ts

**文件**：`src/main/ipc.ts`

在构造 `ExportService` 时传入 `translationServices?.translationStore`。

**验证**：应用启动不报错，导出功能入口正常。

### Step 5：MarkdownSerializer interleaved 序列化

**文件**：`src/main/export/MarkdownSerializer.ts`

1. 导入 `MarkdownConverter`
2. 新增 `serializeInterleavedBody()` 函数
3. 修改 `serializeSingle()` 和 `serializeBody()`：
   - 如果 `article.translationSegments` 存在且长度 > 0，使用 interleaved 格式
   - 否则回退到旧的 `article.translation` 块引用格式
4. `serializeMultiple()` 也走相同的判断逻辑

**验证**：
- 单元测试：给定 mock segments，验证输出 Markdown 格式正确
- 手动测试：导出含翻译的文章，验证格式为逐段穿插

### Step 6：更新序列化测试

**文件**：`tests/unit/export/markdown-serializer.test.ts`

新增测试用例：
- 空 `translationSegments` → 回退旧格式
- 多个段落 + 列表的 interleaved 输出
- 标题/byline 不参与穿插
- `translatedText` 放入 `>` 引用块

### Step 7：端到端验证

1. 打开一篇文章，翻译
2. 确认阅读界面显示正常
3. 导出单篇，检查：
   - 无重复段落
   - 列表结构完整
   - 段落顺序正确
   - 格式为 原文→>译文→原文→>译文
4. 多篇导出，同样检查
5. 重新翻译后导出，只采用最新结果
6. Windows x64 打包启动后验证

---

## 4. 数据流总览

```
Renderer                              Main
─────────                             ────
ExportSingleRequest {
  entryId,
  options,
  translationLanguage: {               export.handler.ts
    sourceLanguage,                       → exportService.prepareArticleData()
    targetLanguage,                         → ExportService
  }                                           → entryStore.findById()
}                                             → contentStore.findByEntry()
                                              → translationStore.findLatestResult()
                                                  → (修复后的 SQL，只取一个 run)
                                              → MarkdownConverter.convert(sourceHtml)
                                                   每段独立转 Markdown
                                              → 组装 ExportableArticle {
                                                  cleanedMarkdown,  ← 保持不变
                                                  translationSegments: [  ← 新增
                                                    { sourceHtml, sourceText,
                                                      translatedText, ... }
                                                  ]
                                                }
                                              → serializeSingle(article)
                                                  → 有 translationSegments？
                                                     是 → interleaved 格式
                                                     否 → 旧块引用格式
                                              → writeFile(markdown)
```

---

## 5. 风险与注意事项

| 风险 | 缓解措施 |
|---|---|
| `findLatestResult()` 需要 `sourceLanguage`/`targetLanguage`，而当前 Export IPC 没有这两个字段 | ExportSingleRequest 新增可选 `translationLanguage`，Renderer 传入当前阅读界面的语言设置 |
| Turndown 转换单段 HTML 与转换全文 HTML 结果可能不一致（如上下文依赖的规则） | 现有 `MarkdownConverter` 规则都是元素级别的，无上下文依赖。需在测试中验证 |
| 译文 `translatedText` 是纯文本，放入 `>` 引用块时如果有 Markdown 特殊字符可能被解析 | `>` 引用块中的内容按 Markdown 规范仍会被解析（如 `*`、`[]`），但译文通常不包含 Markdown 语法。如有需要可对译文做转义处理 |
| 用户不传 `translationLanguage` 时无法获取 translationSegments | 保持向后兼容：无 `translationLanguage` 时 `translation` 字段用旧逻辑回退 |
| `TranslationStore` 是 AI 模块的内部实现，ExportService 在 main/export 目录下 | 通过接口隔离：`ExportService` 构造函数接受 `TranslationStore` 实例，不直接依赖 AI 模块内部细节 |

---

## 6. 向后兼容

| 场景 | 行为 |
|---|---|
| 旧版本导出（无 translationLanguage 参数） | `translationSegments` 为 undefined，`serializeSingle()` 回退到旧 `translation` 块引用格式 |
| 无翻译的文章 | `findLatestResult()` 返回 undefined，跳过翻译部分 |
| TranslationStore 未注入 | 同上，跳过 |
| 翻译还在 running | `findLatestResult()` 的 status 不是 'succeeded'，跳过 |
| 部分段落翻译失败 | 只有 `status === 'succeeded'` 的 segments 参与输出，失败段落跳过 |

---

## 7. 测试策略

| 测试类型 | 覆盖范围 | 文件 |
|---|---|---|
| 单元测试 | `serializeInterleavedBody()` 输出格式正确性 | `tests/unit/export/markdown-serializer.test.ts` |
| 单元测试 | `findTranslationSegments()` 只返回最新 run | `tests/unit/export/export-service.test.ts`（新建） |
| 单元测试 | `prepareArticleData()` 语言参数传递 | 同上 |
| 集成测试 | IPC handler 参数转发 | `tests/unit/main/export-ipc-handler.test.ts`（新建） |
| 手动验证 | 导出含翻译的文章验证格式 | 本地运行 |

---

## 8. 验收标准

- [ ] 同一段落不会导出多个版本的译文（Issue #79 修复）
- [ ] 列表和项目符号不会与相邻内容错误拼接
- [ ] 导出段落顺序与阅读界面完全一致
- [ ] 重新翻译或发生单段补偿后，导出只采用当前有效结果
- [ ] 译文格式为：原文段落（Markdown 格式保留）→ `> 译文段落`
- [ ] 标题/byline 不参与穿插
- [ ] 普通段落、标题和列表混合的长文章可以正常导出
- [ ] 新增/修改的公共类型编译通过
- [ ] 无 translationLanguage 参数时回退旧格式，不报错
- [ ] 覆盖重复结果、列表结构和段落排序的测试
