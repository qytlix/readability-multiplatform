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
   │                        │                          │  LEFT JOIN feed f
   │                        │                          │  LEFT JOIN entry_content ec
   │                        │                          │  WHERE title/summary LIKE ?
   │                        │                          │       + new: markdown + feed.title
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
| `entry_content.markdown` — 清洗正文搜索 | EntryStore.query ECASE WHEN + LIKE | ✅ 已实现 |
| `feed.title` — 来源名称搜索 | EntryStore.query LEFT JOIN + LIKE | ✅ 已实现 |
| 相关性评分排序 | CASE WHEN 评分: title=3, markdown=2, summary=1, feed.title=1 | ✅ 已实现 |
| LIKE 特殊字符转义 | escapeLike() + ESCAPE '\\' | ✅ 已实现 |
| 空字符串防御 | options.search?.trim() | ✅ 已实现 |

### 2.2 IPC 层

| 文件 | 内容 | 状态 |
|------|------|------|
| `src/main/ipc/feed.handler.ts` — `entry:list` handler | 直接调用 `entryStore.query(request)`，request 中包含 search | ✅ 已就绪 |

IPC Handler 已经是通用转发，不需要新增 channel。

### 2.3 查询 SQL

`EntryStore.query()` 当前的 SQL：

```sql
SELECT e.*, f.title AS feedTitle, ec.pipelineStatus
FROM entry e
LEFT JOIN feed f ON f.id = e.feedId
LEFT JOIN entry_content ec ON ec.entryId = e.id
WHERE e.isDeleted = 0
  [AND e.feedId = ?]
  [AND e.isRead = ?]
  [AND e.isStarred = ?]
  [AND (e.title LIKE ? OR e.summary LIKE ?)]
  [AND keyset pagination]
ORDER BY e.publishedAt DESC, e.id DESC
LIMIT ?
```

✅ `LEFT JOIN feed f` 和 `LEFT JOIN entry_content ec` 已存在。
✅ 搜索条件已接入 `e.title` 和 `e.summary`。
✅ 结果可 keyset 分页。

---

## 3. 后端实现状态 — ✅ 已完成

所有后端工作已通过以下 4 个提交完成（详见同目录 `search-feature-backend-commit-plan.md`）：

| 提交 | 变更内容 | 文件 |
|------|----------|------|
| commit 2 | 搜索扩展至 4 字段 + 相关性评分 | `EntryStore.ts` |
| commit 3 | escapeLike 工具函数 + LIKE ESCAPE | `EntryStore.ts` |
| commit 4 | 空字符串/纯空格防御 | `EntryStore.ts` |
| commits 5-6 | 13 个新增测试 | `entry-store.test.ts` |

### 3.1 最终 SQL 形态

```sql
SELECT e.*, f.title AS feedTitle, ec.pipelineStatus,
  (CASE WHEN e.title LIKE ? ESCAPE '\\'         THEN 3 ELSE 0 END +
   CASE WHEN ec.markdown LIKE ? ESCAPE '\\'     THEN 2 ELSE 0 END +
   CASE WHEN e.summary LIKE ? ESCAPE '\\'       THEN 1 ELSE 0 END +
   CASE WHEN f.title LIKE ? ESCAPE '\\'         THEN 1 ELSE 0 END) AS relevance
FROM entry e
LEFT JOIN feed f ON f.id = e.feedId
LEFT JOIN entry_content ec ON ec.entryId = e.id
WHERE e.isDeleted = 0
  [AND e.feedId = ?]
  [AND e.isRead = ?]
  [AND e.isStarred = ?]
  [AND (e.title LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\'
        OR ec.markdown LIKE ? ESCAPE '\\' OR f.title LIKE ? ESCAPE '\\')]
  [AND keyset pagination]
ORDER BY relevance DESC, e.publishedAt DESC, e.id DESC
LIMIT ?
```

- 搜索时：SELECT 含 `relevance` 列，ORDER BY 以 `relevance DESC` 开头
- 无搜索时：SELECT 不含 `relevance`，ORDER BY `e.publishedAt DESC, e.id DESC`
- 所有 8 处 LIKE 表达式均带 `ESCAPE '\\'`

### 3.2 参数绑定顺序

SQLite 的 `?` 占位符按出现顺序绑定。实现中将参数分为三组：

1. `selectParams` — SELECT 中 CASE WHEN 的 4 个 `?` 参数
2. `whereParams` — WHERE 中所有过滤和搜索条件参数
3. `limit + 1` — LIMIT 参数

最终参数数组为 `[...selectParams, ...whereParams, limit + 1]`。

---

## 4. 测试实现状态

测试总数：**28 个**（15 已有 + 13 新增），全部通过 ✅

| 测试 | 文件 | 状态 |
|------|------|------|
| 按标题搜索 | `entry-store.test.ts` | ✅ 通过 |
| 按 summary 搜索 | `entry-store.test.ts` | ✅ 通过 |
| 按来源名称搜索（feed.title） | `entry-store.test.ts` — search with entry_content > should search by feed.title | ✅ 通过 |
| 按正文关键词搜索（markdown） | `entry-store.test.ts` — should search by markdown content | ✅ 通过 |
| 相关性排序 — title 优先 | 标题命中的排在最前 | ✅ 通过 |
| 相关性排序 — markdown 高于 summary | 正文匹配的优先级验证 | ✅ 通过 |
| 特殊字符 `%` | 搜索含 `100%` 的内容不产生误匹配 | ✅ 通过 |
| 特殊字符 `_` | 搜索含 `test_data` 的内容不产生误匹配 | ✅ 通过 |
| 特殊字符 `\` | 搜索含 `backslash` 的内容不崩溃 | ✅ 通过 |
| 空查询（undefined） | `options.search` 为 undefined 时正常返回 | ✅ 通过 |
| 空查询（空字符串） | `options.search` 为 `''` 时等同无搜索 | ✅ 通过 |
| 空查询（纯空格） | `options.search` 为 `'   '` 时等同无搜索 | ✅ 通过 |
| 未清洗条目 — 按 title 搜索 | 只有 entry 无 entry_content，按 title 可搜到 | ✅ 通过 |
| 未清洗条目 — 按 markdown 搜索 | 只有 entry 无 entry_content，按 markdown 不返回 | ✅ 通过 |
| 超过 limit 的搜索结果 | 搜索后 keyset 分页正常工作 | ✅ 通过 |

未覆盖（P1/P2 低优先级，可后续补充）：
- 特殊字符单引号搜索
- 大小写不敏感行为显式验证

---

## 5. 设计决策

### 5.1 搜索范围

**搜索覆盖全部 Feed，不保留当前 Feed 过滤。**

用户搜索时，结果来自所有已持久化文章，不受当前 feed 选择影响。搜索结束后恢复之前的 Feed 上下文。

对应 Issue #34 验收标准："用户可以搜索所有已持久化文章"。

### 5.2 未清洗条目

**未清洗条目仍可通过标题/摘要/来源名搜索到，只是不能按正文内容匹配。**

`WHERE` 条件是 4 个字段的 `OR` 串联，且 `entry_content` 使用 `LEFT JOIN`。未清洗的条目（无对应 `entry_content` 行，或 `markdown = NULL`）中 `ec.markdown LIKE ?` 为 NULL（假值），但只要 `e.title` 或 `e.summary` 或 `f.title` 命中，整行就会被返回。

这是预期行为，不需要 fallback 或特殊处理。

### 5.3 相关性排序

**第一版即使用基于 LIKE 的相关性评分排序。**

| 命中字段 | 分值 | 理由 |
|---------|------|------|
| `entry.title` | **+3** | 标题匹配最相关 |
| `entry_content.markdown` | **+2** | 正文匹配比摘要/来源名更相关 |
| `entry.summary` | **+1** | RSS 摘要匹配 |
| `feed.title` | **+1** | 来源名称匹配 |

多个字段同时命中时分数累加。同分时按 `publishedAt DESC, id DESC` 排序，保证结果稳定。

非搜索模式（无 `search` 参数）不生成 `relevance` 列，按原排序规则返回。

### 5.4 空字符串防御

**后端对空字符串做防御性处理：**

```typescript
if (options.search?.trim()) {
  // 执行搜索
}
```

`undefined`、空字符串 `''` 和纯空格 `'   '` 都不触发 LIKE 搜索，等效于无搜索条件的普通查询。

### 5.5 为什么不使用 SQLite FTS5？

| 对比项 | LIKE + JOIN | FTS5 |
|--------|-------------|------|
| 实现复杂度 | 低 | 中 |
| 需要 Migration | 否（现有 JOIN 可用） | 是（新建 FTS 表 + triggers） |
| 性能（小数据量 <1 万） | 可接受 | 好 |
| 性能（大数据量 >10 万） | 下降 | 好 |
| 相关性排序 | ✅ 可使用 CASE WHEN 模拟 | 原生支持 |
| 中文分词 | 不支持 | 需要额外 ICU tokenizer |

**决定**: 第一版使用 `LIKE + JOIN` + `CASE WHEN` 相关性评分快速实现。当条目数超过 5 万且搜索延迟超过 1s 时，开新 Issue 迁移至 FTS5。

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
- **搜索结果高亮的富文本处理** — 前端范围

---

## 7. 参考

后端逐提交实现计划详见同目录文档：

[`search-feature-backend-commit-plan.md`](./search-feature-backend-commit-plan.md)
