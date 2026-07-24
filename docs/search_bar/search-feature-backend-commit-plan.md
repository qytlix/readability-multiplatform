# 本地搜索后端 — 逐提交实现计划

> 源文档: `search-feature-backend.md`
> 对应 Issue: [#34 支持已持久化文章的本地搜索](https://github.com/qytlix/readability-multiplatform/issues/34)
> 关联 Issue: [#36 feat: 搜索栏](https://github.com/qytlix/readability-multiplatform/issues/36)
> 基分支: `main`（最新目标: `c8f44c1` Merge pull request #48）

---

## 提交序列总览

后端部分计划拆分为 **7 个提交**，按"先契约后实现、先数据后查询、先功能后安全"顺序排列。

每个提交均可独立运行测试（`npm test`），不会破坏已有功能。

| # | 提交 | 涉及文件 | 预估行数 |
|---|------|----------|----------|
| 1 | test: 补充 entry_content 测试夹具工厂函数 | `tests/fixtures/databases/feed-fixture.ts` | ~30 |
| 2 | feat: EntryStore.query 搜索扩展至 4 字段 + 相关性评分 | `src/main/feed/stores/EntryStore.ts` | ~35 |
| 3 | feat: 新增 escapeLike 工具函数 + LIKE ESCAPE 子句 | `src/main/feed/stores/EntryStore.ts` | ~12 |
| 4 | fix: 空字符串/纯空格防御性过滤 | `src/main/feed/stores/EntryStore.ts` | ~3 |
| 5 | test: 新增搜索范围、相关性排序与特殊字符测试 | `tests/integration/entry-store.test.ts` | ~100 |
| 6 | test: 新增空查询、未清洗条目与分页组合测试 | `tests/integration/entry-store.test.ts` | ~70 |
| 7 | docs: 更新搜索功能文档为"后端已完成"状态 | `docs/search_bar/search-feature-backend.md` | ~10 |

---

## 提交 1/7 — 测试夹具：补充 entry_content 数据工厂

### 目的

现有测试夹具 `buildTestDb()` 只创建 feed + entry 表数据，没有 `entry_content` 行。搜索扩展需要测试 `ec.markdown` 字段，必须先有工厂函数支持。

### 改动范围

**文件**: `tests/fixtures/databases/feed-fixture.ts`

在 `buildTestDbWithData()` 之后（或新建函数），新增：

```typescript
/**
 * Build a test database pre-populated with feed, entries, and entry_content.
 */
export function buildTestDbWithContent() {
  const fixture = buildTestDbWithData();
  const { db } = fixture;
  const now = new Date().toISOString();

  // Insert entry_content for each entry
  const insertContent = db.prepare(`
    INSERT INTO entry_content (entryId, html, cleanedHtml, markdown, pipelineStatus, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertContent.run(1, '<html>1</html>', '<p>cleaned one</p>', 'markdown body for first post', 'success', now, now);
  insertContent.run(2, '<html>2</html>', '<p>cleaned two</p>', 'markdown body for second article', 'success', now, now);
  // entry 3 intentionally left without entry_content (simulates un-cleaned entry)

  return fixture;
}
```

**关键设计**:
- entry 3 故意不留 `entry_content`，用于"未清洗条目"场景测试
- 所有 markdown 内容包含可搜索的唯一关键词，便于断言

### 验收标准

- `buildTestDbWithContent()` 返回可正常查询的数据库
- entry 1 和 entry 2 在 `entry_content` 表中有关联行
- entry 3 在 `entry_content` 表中无关联行
- 已有测试不受影响

---

## 提交 2/7 — 搜索扩展：4 字段 LIKE + 相关性评分

### 目的

将 `EntryStore.query()` 的 `LIKE` 搜索从 `(e.title, e.summary)` 扩展到 `(e.title, e.summary, ec.markdown, f.title)`，同时引入基于 `CASE WHEN` 的相关性评分排序。

### 改动范围

**文件**: `src/main/feed/stores/EntryStore.ts` — `query()` 方法

#### 2a. 搜索条件扩展

```typescript
// 修改前（~L121）：
if (options.search) {
  conditions.push('(e.title LIKE ? OR e.summary LIKE ?)');
  params.push(`%${options.search}%`, `%${options.search}%`);
}

// 修改后（使用 escapeLike，见提交 3，此处先用简单拼接）：
if (options.search) {
  const likeParam = `%${options.search}%`;
  conditions.push(
    '(e.title LIKE ? OR e.summary LIKE ? OR ec.markdown LIKE ? OR f.title LIKE ?)'
  );
  params.push(likeParam, likeParam, likeParam, likeParam);
}
```

#### 2b. SELECT 中新增相关性评分列

在 `query()` 的 SELECT 列表中增加 `relevance` 计算列。注意仅在 `options.search` 存在时添加，避免非搜索查询产生无意义的列。

```typescript
// SELECT 列表中增加（仅在 search 时）
const selectFields = options.search
  ? `e.*, f.title AS feedTitle, ec.pipelineStatus,
     (CASE WHEN e.title LIKE ?         THEN 3 ELSE 0 END +
      CASE WHEN ec.markdown LIKE ?     THEN 2 ELSE 0 END +
      CASE WHEN e.summary LIKE ?       THEN 1 ELSE 0 END +
      CASE WHEN f.title LIKE ?         THEN 1 ELSE 0 END) AS relevance`
  : 'e.*, f.title AS feedTitle, ec.pipelineStatus';

// 对应 params.push —— 4 个额外参数给 SELECT 中的 CASE WHEN
// 注意这些是额外追加到 params 尾部的
```

#### 2c. ORDER BY 增加 relevance DESC

仅当搜索时，ORDER BY 改为：

```sql
ORDER BY relevance DESC, e.publishedAt DESC, e.id DESC
```

无搜索时保持原样 `ORDER BY e.publishedAt DESC, e.id DESC`。

#### 2d. SQL 结构重组

当前 `query()` 内 SQL 拼在 `const query = \`SELECT ...\`` 一处。需要拆分为：

1. 条件数组 `conditions`（已有）
2. 参数数组 `params`（已有）
3. SELECT 字段字符串（按是否有 search 动态选择）
4. ORDER BY 字符串（按是否有 search 动态选择）

**实现细节**:

```typescript
query(options: EntryQuery): { ... } {
  const conditions: string[] = ['e.isDeleted = 0'];
  const params: unknown[] = [];

  // ... feedId, isRead, isStarred, cursor 条件不变 ...

  let orderBy = 'ORDER BY e.publishedAt DESC, e.id DESC';
  let relevanceParamsCount = 0;

  if (options.search) {
    const likeParam = `%${options.search}%`;
    conditions.push(
      '(e.title LIKE ? OR e.summary LIKE ? OR ec.markdown LIKE ? OR f.title LIKE ?)'
    );
    params.push(likeParam, likeParam, likeParam, likeParam);

    // relevance 的 CASE WHEN 需要自己的参数
    relevanceParamsCount = 4;
    orderBy = 'ORDER BY relevance DESC, e.publishedAt DESC, e.id DESC';
  }

  // ... keyset pagination ...

  const selectFields = options.search
    ? `e.*, f.title AS feedTitle, ec.pipelineStatus,
       (CASE WHEN e.title LIKE ?         THEN 3 ELSE 0 END +
        CASE WHEN ec.markdown LIKE ?     THEN 2 ELSE 0 END +
        CASE WHEN e.summary LIKE ?       THEN 1 ELSE 0 END +
        CASE WHEN f.title LIKE ?         THEN 1 ELSE 0 END) AS relevance`
    : 'e.*, f.title AS feedTitle, ec.pipelineStatus';

  const limit = options.limit ?? 50;
  const query = `
    SELECT ${selectFields}
    FROM entry e
    LEFT JOIN feed f ON f.id = e.feedId
    LEFT JOIN entry_content ec ON ec.entryId = e.id
    WHERE ${conditions.join(' AND ')}
    ${orderBy}
    LIMIT ?
  `;

  // CASE WHEN params + limit param
  const likeParamVal = options.search ? `%${options.search}%` : '';
  const finalParams = [...params];
  if (options.search) {
    finalParams.push(likeParamVal, likeParamVal, likeParamVal, likeParamVal);
  }
  finalParams.push(limit + 1);

  // 执行查询 ...
}
```

> **注意**: 提交 2 先使用简单 `%value%` 拼装（暂无 escapeLike），提交 3 再叠加转义。这是有意为之的步进，保证每个提交聚焦一个变化，测试可独立验证。

### 验收标准

- 搜索命中 `ec.markdown` 的条目能正确返回
- 搜索命中 `f.title` 的条目能正确返回
- 多条命中时按 `relevance DESC` 排序（title > markdown > summary/feed）
- 无搜索时行为完全不变（SELECT 无 `relevance` 列，ORDER BY 原样）
- 已有测试全部通过

---

## 提交 3/7 — escapeLike 工具函数 + LIKE ESCAPE 子句

### 目的

防止用户输入的 `%`、`_` 等 SQLite LIKE 通配符产生语义误解。例如搜 `100%` 不应匹配 `100anything`。

### 改动范围

**文件**: `src/main/feed/stores/EntryStore.ts`

#### 3a. 新增 escapeLike 函数

```typescript
/**
 * Escape LIKE special characters so user input is treated literally.
 * SQLite default escape character: backslash.
 * Order matters: escape backslash first, then % and _.
 */
function escapeLike(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}
```

放在 `EntryStore` 类之外（文件底部），作为模块私有函数。

#### 3b. query() 中使用 escapeLike

将 `const likeParam = \`%${options.search}%\`` 替换为：

```typescript
const escaped = escapeLike(options.search);
const likeParam = `%${escaped}%`;
```

#### 3c. SQL 尾部增加 ESCAPE 子句

```sql
WHERE ${conditions.join(' AND ')}
ESCAPE '\\'
${orderBy}
LIMIT ?
```

注意 `ESCAPE '\\'` 放在 WHERE 条件闭合后、ORDER BY 之前。

### 关键设计

- 转义顺序：反斜杠先转义自己，然后再转义 `%` 和 `_`
- 如果用户的搜索词本身包含反斜杠（如搜索 `C:\path`），会被正确转义为 `C:\\path`，在 LIKE 中匹配字面反斜杠
- SQLite 的默认转义符是反斜杠，不需要额外配置

### 验收标准

- 搜索含 `%` 的内容（如 `100%`）精确匹配，不匹配 `100anything`
- 搜索含 `_` 的内容（如 `test_data`）精确匹配，不匹配 `testXdata`
- 搜索含 `\` 的内容正常转义
- 搜索普通 ASCII 文本不受影响

---

## 提交 4/7 — 空字符串/纯空格防御

### 目的

避免前端传递空字符串 `''` 或纯空格 `'   '` 时，SQLite 执行 `LIKE '%%'` 导致全量匹配。

### 改动范围

**文件**: `src/main/feed/stores/EntryStore.ts` — `query()` 方法

```typescript
// 修改前：
if (options.search) {

// 修改后：
if (options.search?.trim()) {
```

`undefined`、空字符串和纯空格三种情况都等效于无搜索条件的普通查询。

### 与提交 2/3 的关系

提交 2 引入的临时代码 `if (options.search)` 被 `if (options.search?.trim())` 替换。由于全部在一个文件，这些改动在提交 2→3→4 间累积，最终形态是：

```typescript
if (options.search?.trim()) {
  const escaped = escapeLike(options.search.trim());
  const likeParam = `%${escaped}%`;
  // ...
}
```

### 验收标准

- `options.search = undefined` → 无搜索条件
- `options.search = ''` → 无搜索条件
- `options.search = '   '` → 无搜索条件
- `options.search = 'hello'` → 正常搜索

---

## 提交 5/7 — 集成测试：搜索范围、相关性排序与特殊字符

### 目的

为搜索扩展的核心功能添加集成测试。使用提交 1 的 `buildTestDbWithContent()` 夹具。

### 改动范围

**文件**: `tests/integration/entry-store.test.ts`

在 `describe('query')` 块中新增 `describe('search')` 子块（或直接新增独立 `describe` 块）。

#### 测试清单

| 测试名 | 场景 | 断言 |
|--------|------|------|
| `should search by feed.title` | 通过 feed 名称搜索 | 返回该 feed 下所有 entry |
| `should search by markdown content` | 通过清洗正文关键词搜索 | 返回包含该关键词的 entry |
| `should search by title with higher relevance than markdown` | 一条 title 命中，一条 markdown 命中 | title 命中的排最前面 |
| `should rank markdown match above summary match` | 一条 markdown 命中，一条 summary 命中 | markdown 命中的排前面 |
| `should handle LIKE special char %` | 搜索含 `%` 关键词 | 精确匹配不扩散 |
| `should handle LIKE special char _` | 搜索含 `_` 关键词 | 精确匹配不扩散 |
| `should handle LIKE special char backslash` | 搜索含 `\` 关键词 | 不崩溃且精确匹配 |

#### 特殊字符测试的数据准备

测试夹具中需要额外插入包含 `%`、`_`、`\` 的 entry：

```typescript
beforeEach 中或使用 buildTestDbWithContent 后追加：
entryStore.createOrUpdate({
  feedId, guid: 'g-special',
  title: '100% completion rate',
  summary: 'test_data format',
});

// 然后手动插入 entry_content（使用 db 直连）
// 或者拓展 buildTestDbWithContent 让它支持自定义内容
```

> 建议：在 `buildTestDbWithContent()` 中加入 entry 4（含特殊字符的 title/summary），避免每个测试都重复插入。

### 验收标准

- 6 个核心测试全部通过
- 特殊字符测试覆盖 `%`、`_`、`\` 三种场景

---

## 提交 6/7 — 集成测试：空查询、未清洗条目与分页组合

### 目的

覆盖边界场景和 P1/P2 优先级测试。

### 改动范围

**文件**: `tests/integration/entry-store.test.ts`

#### 测试清单

| 测试名 | 场景 | 断言 |
|--------|------|------|
| `should handle undefined search` | `options.search` 为 undefined | 正常返回全部条目 |
| `should handle empty string search` | `options.search` 为 `''` | 等同无搜索，返回全部 |
| `should handle whitespace-only search` | `options.search` 为 `'   '` | 等同无搜索，返回全部 |
| `should find un-cleaned entry by title` | 未清洗条目（无 entry_content） | 按 title 可搜到 |
| `should not find un-cleaned entry by markdown` | 未清洗条目按 markdown 搜索 | 不会返回该条目 |
| `should paginate search results` | 搜索结果超过 limit | 正确分页，nextCursor 可用 |

> 注意：`should not find un-cleaned entry by markdown` 对理解系统行为很重要，帮助开发者确认 `LEFT JOIN` + `NULL LIKE` 行为正确。

### 验收标准

- 6 个边界测试全部通过
- 特别确认：`undefined` / `''` / `'   '` 三种空查询+搜索都不触发 LIKE
- 未清洗条目按 markdown 搜索不返回（NULL 安全）

---

## 提交 7/7 — 文档更新：搜索功能后端状态

### 目的

反映后端已实现的变更，更新 `search-feature-backend.md` 为"已完成"状态。

### 改动范围

**文件**: `docs/search_bar/search-feature-backend.md`

具体变更：

| 位置 | 变更 |
|------|------|
| 文件头部状态 | `待完成` → `✅ 已完成（提交序列见同目录 commit-plan）` |
| §2 当前已就绪 | 新增第 5 行 `entry_content.markdown` 和 `feed.title` → 标注 ✅ |
| §2.3 查询 SQL | 替换为最终版 SQL（含 4 字段 + relevance + ESCAPE） |
| §3 需要完成的后端工作 | 整体替换为"已完成"标识，指向 commit-plan 文档 |
| §4 测试计划 | 按实际测试实现情况更新状态（P0 全部 ✅，P1/P2 按实际标注） |
| 新增尾部 | 指向 `search-feature-backend-commit-plan.md` 作为详细参考 |

### 验收标准

- 文档头部状态从"待完成"变为"已完成"
- 所有"需要完成"的条目都已标注实际已完成状态
- 保留设计决策章节（§5）不变，决策本身不需要修改
- 保留范围外章节（§6）不变

---

## 依赖关系

```
提交 1 (夹具) ─→ 提交 5 (核心测试) ─→ 提交 6 (边界测试)
                      ↑                      ↑
提交 2 (SQL扩展) ──────┤                      │
提交 3 (escapeLike) ───┤                      │
提交 4 (空字符串) ──────┤                      │
                                                │
提交 7 (文档) ←─────────────────────────────────┘
```

- 提交 2、3、4 修改同一个文件，按顺序叠加，resolve conflicts 方向为"取后一提交"
- 提交 5 依赖提交 1（夹具）和提交 2/3/4（功能代码）
- 提交 6 依赖提交 5 的测试环境
- 提交 7 无代码依赖，可在任意时间完成，但建议放在最后

---

## 测试运行命令

每个提交后运行：

```bash
npx vitest run tests/integration/entry-store.test.ts
```

确保全部通过后再提交。

完整运行：

```bash
npm test
```

---

## 可能的风险与注意事项

1. **ESCAPE '\\' 在 SQLite 中的兼容性** — SQLite 的默认转义字符是反斜杠，但不同的 SQLite 编译选项可能影响行为。已经在 `better-sqlite3`（当前驱动）中验证过即可。
2. **SELECT 中 CASE WHEN 参数的顺序** — SQLite 的 `?` 占位符按出现顺序绑定。`SELECT` 中的 `?` 必须在 `WHERE` 中的 `?` 之后追加，不能交错。本计划已考虑这一点（relevance 参数在 finalParams 尾部追加）。
3. **LEFT JOIN 导致未清洗条目的相关性为 NULL** — SQLite 中 `NULL + 1` 结果为 NULL，所以 `ec.markdown LIKE ?` 为 NULL 时整个 `CASE WHEN` 结果为 NULL。但 `ORDER BY relevance DESC` 会将 NULL 排在最后（SQLite 默认行为），符合"未清洗条目排名靠后"的预期。
4. **分页 + 搜索组合** — keyset pagination 依赖 `publishedAt DESC, id DESC`，搜索模式下变为 `relevance DESC, publishedAt DESC, id DESC`，keyset cursor 只在同分内有效。这是已知限制，大数据量下可考虑在相关性分组内做 keyset。
