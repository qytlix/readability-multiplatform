# 本地搜索功能 — 后端设计与现状

> 对应 Issue: [#34 [Feature] 支持已持久化文章的本地搜索](https://github.com/qytlix/readability-multiplatform/issues/34)
> 关联 Issue: [#36 feat: 搜索栏](https://github.com/qytlix/readability-multiplatform/issues/36)
> 状态: **✅ 后端已完成**（逐提交实现计划见同目录 `search-feature-backend-commit-plan.md`）

---

## 1. 数据流概述

```
Renderer                 Preload                     Main
   │                        │                          │
   ├─ EntryAPI.list(        │                          │
   │   { search, ... }) ────┤── IPC invoke ────────────┤── entryStore.query()
   │                        │        'entry:list'      │       │
   │                        │                          │  FTS5 trigram / short LIKE
   │                        │                          │  title + cleaned markdown
   │                        │                          │  current feed/filter scope
   │◄──── IPCResult ◄───────┼──────────────────────────┤
```

---

## 2. 当前已就绪的部分

### 2.1 Shared 类型层

| 文件 | 内容 | 状态 |
|------|------|------|
| `src/shared/contracts/feed.types.ts:EntryQuery` | `search?: string` 字段 | ✅ 已就绪 |
| `src/shared/contracts/feed.ipc.ts:EntryListRequest` | `search?: string` 字段 | ✅ 已就绪 |
| `src/shared/contracts/feed.ipc.ts:EntryListResponse` | `{ entries, nextCursor }` — 搜索结果回到同一结构 | ✅ 已就绪 |
| `src/shared/domain-api.ts:EntryAPI.list` | `search?: string` 参数已暴露 | ✅ 已就绪 |
| `entry.title` + `entry_content.markdown` | FTS5 trigram；短词 LIKE | ✅ 已实现 |
| 当前范围 | 保留 `feedId`、`isRead`、`isStarred` | ✅ 已实现 |
| 相关性评分排序 | 标题分层 + `bm25(title=8, markdown=1)` | ✅ 已实现 |
| 搜索分页 | rank-aware keyset cursor | ✅ 已实现 |
| Unicode | 查询与索引统一 NFKC | ✅ 已实现 |

### 2.2 IPC 层

| 文件 | 内容 | 状态 |
|------|------|------|
| `src/main/ipc/feed.handler.ts` — `entry:list` handler | 直接调用 `entryStore.query(request)`，request 中包含 search | ✅ 已就绪 |

IPC Handler 已经是通用转发，不需要新增 channel。

### 2.3 查询 SQL

`EntryStore.query()` 将浏览查询、FTS 查询和短查询回退拆成独立路径。FTS
查询的主要结构为：

```sql
WITH ranked_entries AS (
  SELECT
    e.*,
    CASE
      WHEN normalized_title = ? THEN 4
      WHEN normalized_title LIKE ? THEN 3
      WHEN title_contains_all_terms THEN 2
      ELSE 1
    END AS matchTier,
    bm25(entry_search_fts, 8.0, 1.0) AS searchRank,
    COALESCE(e.publishedAt, e.createdAt) AS effectivePublishedAt
  FROM entry_search_fts
  JOIN entry e ON e.id = entry_search_fts.rowid
  LEFT JOIN entry_content ec ON ec.entryId = e.id
  WHERE entry_search_fts MATCH ?
    [AND current scope]
)
SELECT *
FROM ranked_entries
WHERE [rank-aware cursor]
ORDER BY matchTier DESC, searchRank ASC, effectivePublishedAt DESC, id DESC
LIMIT ?;
```

少于 3 个 Unicode 字符的词不进入 `MATCH`，改为同范围内对规范化标题和
Markdown 执行参数化 `LIKE`。

---

## 3. 后端实现状态 — ✅ 已完成

当前后端包含：

- Migration 019 的 FTS5 trigram contentless-delete 索引；
- Entry 与 Content 表触发器和旧库回填；
- shared 查询规范化、短语解析和 FTS 转义；
- 标题分层、BM25 和搜索专用 keyset cursor；
- 纯文本搜索片段。

第一版 LIKE 实现的提交计划保留在
`search-feature-backend-commit-plan.md`，仅作为历史记录，不再描述当前 SQL。

---

## 4. 测试实现状态

搜索专项测试位于：

- `tests/integration/entry-search-index-migration.test.ts`
- `tests/integration/entry-search-query.test.ts`
- `tests/unit/shared/search.test.ts`
- `tests/unit/renderer/searchHighlightedText.test.ts`

覆盖旧库回填、触发器生命周期、范围组合、标题分层、BM25、多词和短语、
中英文/NFKC、短查询回退、rank-aware 分页和安全高亮。

---

## 5. 设计决策

### 5.1 搜索范围

搜索默认继承当前 Feed、未读和收藏范围。当前 Feed 搜索可以由 Renderer 的
显式范围按钮切换到所有 Feed，避免隐藏地丢弃用户上下文。

### 5.2 未清洗条目

未清洗条目只有标题进入索引，因此仍可按标题找到，但不能按尚不存在的
Cleaned Markdown 匹配。Feed 名称和 Feed Entry 摘要不参与搜索。

### 5.3 相关性排序

搜索先按标题完全匹配、标题前缀、标题包含全部词、正文命中分层，再按
FTS5 BM25、有效发布时间和 Entry ID 排序。搜索 cursor 保存相同排序字段。
非搜索模式继续按有效发布时间和 Entry ID 排序。

### 5.4 空字符串防御

**后端对空字符串做防御性处理：**

```typescript
if (options.search?.trim()) {
  // 执行搜索
}
```

`undefined`、空字符串 `''` 和纯空格 `'   '` 都不触发 LIKE 搜索，等效于无搜索条件的普通查询。

### 5.5 为什么不使用 SQLite FTS5？

第一版曾使用 `LIKE + JOIN` + `CASE WHEN`。该决定已由
Migration `019_create_entry_search_index` 取代：当前实现使用 FTS5 trigram，
支持中英日韩子串检索和 BM25；少于 3 个 Unicode 字符的查询才回退到
限定范围的参数化 `LIKE`。完整设计见
[`search-optimization.md`](./search-optimization.md)。

### 5.6 为什么不在本条 Issue 实现关键词语法？

#36 中提到的 `starred:true title:google content:finish` 语法是 Renderer 层的**查询解析**，不属于后端范围。后端只接收一个 `search` 字符串传给 `LIKE`。如果未来 Renderer 需要结构化查询，可以解析后构建 `EntryQuery` 对象的多字段组合（如 `isStarred: true` 用 `isStarred` 参数，`title:xxx` 用 `search` 参数 + 特定字段）。

---

## 6. 范围外（不在本次后端实现）

- **网络搜索** — 不触发网络请求
- **搜索新的 Feed** — 只搜已持久化文章
- **正则表达式搜索** — 第一版不做
- **高级搜索语法** — 第一版不做
- **按日期/作者等组合条件筛选** — 已有独立 filter 参数但不纳入 search 语法
- **搜索 Summary/Translation/笔记/标签** — 不在 #34 范围内
- **AI 语义搜索** — 不在第一版
- **复杂富文本片段** — 当前只传输纯文本 snippet，并由 React 安全高亮

---

## 7. 参考

后端逐提交实现计划详见同目录文档：

[`search-feature-backend-commit-plan.md`](./search-feature-backend-commit-plan.md)
