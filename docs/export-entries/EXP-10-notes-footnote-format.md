# EXP-10：导出笔记使用 Markdown 脚注格式

> 对应 Issue #29 — 在导出笔记时使用脚注 `[^N]` 将标注锚定到正文对应位置
> 状态：规划阶段
> 依赖：EXP-04（单篇导出 UI 已就绪）、Annotations 模块（数据已就绪）

---

## 1. 目标

在导出 Markdown 时，用户笔记（Annotation）不再简单堆在文档末尾的引用块中，而是通过 **Markdown 脚注** 格式，在正文对应位置插入引用标记 `[^N]`，并在文末给出定义。

---

## 2. 输出格式

### 2.1 脚注定义格式

```markdown
[^1]: "高亮勾选的原文" — 用户写的笔记文本
[^2]: "纯高亮（无笔记）"   ← noteText 为空时省略 `—`
```

### 2.2 完整样例

```markdown
# 文章标题

**来源：** Feed 名称
**作者：** 作者名
**发布时间：** 2024-01-01
**原文链接：** https://example.com/article

---

正文段落。这是一个关键发现，AI 模型在推理任务上的表现优于传统方法[^1]。
另一处重要观点是 multi-agent 协作[^2]。

> 原文可能有自己的脚注[^3]，留在正文中不受影响。

---

> **AI 摘要：**
>
> 这是一篇关于 AI 推理的文章……

---

> **翻译：**
>
> 这是翻译内容……

---

[^1]: "AI 模型在推理任务上的表现优于传统方法" — 这个结论来自 2024 年的实验数据，发布时间较早
[^2]: "multi-agent 协作"
[^3]: 原文脚注定义保持原样，不受影响
```

### 2.3 特殊情况

| 场景 | 脚注内容 | 说明 |
|------|---------|------|
| 高亮 + 有笔记 | `"selectedText" — noteText` | 标准格式 |
| 纯高亮（noteText 空） | `"selectedText"` | 省略 `—` |
| selectedText 过长 | 截断到 80~120 字符后加 `…`，保持脚注块可读性 |
| 匹配不到 selectedText | 不插入正文标记，脚注定义放在文末（降级） |

---

## 3. 排查：技术上可行

### 3.1 数据已完备

`EntryAnnotation` 现有字段完全满足需求：

| 字段 | 用途 |
|------|------|
| `selectedText` | 高亮勾选的原文 → 用于在 Markdown 中定位 + 脚注中显示 |
| `prefixText` / `suffixText` | 消歧辅助，当 `selectedText` 多段匹配时使用 |
| `noteText` | 用户笔记 → 脚注中 `—` 之后的内容 |
| `startOffset` / `endOffset` | 在 cleaned HTML 中的偏移（用于排序，非精确定位） |

### 3.2 流程不变

```
prepareArticleData()
  └─ findAnnotations(entryId)
       └─ annotationService.list(entryId)
            └─ SELECT * FROM annotions WHERE entryId = ?
                 可直接返回 EntryAnnotation[]

serializeSingle() / serializeBody()
  └─ insertFootnoteMarkers(markdown, annotations)
       ├─ detectExistingFootnoteNumbers(markdown) → 获取已用序号
       ├─ 遍历 annotations:
       │   ├─ 在 markdown 中查找 selectedText
       │   ├─ 插入 [^N] 引用标记
       │   └─ N = maxUsed + 1
       └─ 追加脚注定义块
```

### 3.3 零架构变更

- 不新增 IPC
- 不新增 Schema / 迁移
- 不新增依赖
- 不改动 `PerArticleOptions` 的用户选项语义

---

## 4. 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/shared/contracts/export.types.ts` | 修改 | `ExportableArticle` 新增 `annotations?: EntryAnnotation[]` 字段（复用已有类型，或定义 `ExportAnnotation` 子集） |
| `src/main/export/ExportService.ts` | 修改 | 新增 `findAnnotations()` 方法，替代 `findNotesContent()` 中的简单拼接 |
| `src/main/export/MarkdownSerializer.ts` | 修改 | 新增 `insertFootnoteMarkers()` 纯函数 + `detectExistingFootnoteNumbers()`；修改 `serializeBody()` 和 `serializeSingle()` |
| `tests/unit/export/markdown-serializer.test.ts` | 修改 | 新增脚注格式相关测试用例 |

## 5. 不做的（范围外）

- ~~不改 `EntryAnnotation` 数据模型或存储结构~~
- ~~不改 ExportOptionsDialog UI~~
- ~~不改 `notes` 备用字段（保留向后兼容）~~

## 6. 关键风险

| 风险 | 影响 | 应对 |
|------|------|------|
| `selectedText` 在 Markdown 中找不到（HTML→Markdown 转换导致差异） | 脚注定位失败 | 降级：不插入正文标记，脚注定义放在文档末尾 |
| `selectedText` 跨行 | 匹配失败 | 只在不含换行符的连续字符串内搜索 |
| `selectedText` 段落内多次出现 | 插入位置不准 | 用 `prefixText` + `suffixText` 消歧 |
| 原文有 `[^custom-name]` 非数字脚注 | 不冲突 | 冲突检测只关注 `[^数字]` |
| 大量 annotations（>100） | 脚注块过长 | 暂不设上限，与当前多篇导出策略一致 |