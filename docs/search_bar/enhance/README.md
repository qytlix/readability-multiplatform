# 搜索过滤器多字段扩展

> 状态：**规划中**
> 对应 Issue：待创建
> 关联：`src/shared/search.ts`、`src/shared/contracts/feed.types.ts`
>       `src/main/feed/stores/EntryStore.ts`、`src/renderer/features/search/entrySearch.ts`

---

## 概述

在现有 `tag:` 前缀解析基础上，扩展搜索框支持更多结构化过滤字段，并引入 `+`/`-` 操作符表示 AND/排除语义。

### 目标

- 用户在搜索框可输入 `tag:tech`、`+tag:AI`、`-tag:news`、`feed:nytimes`、`title:climate`、`starred:yes` 等形式过滤
- 无前缀的纯文本继续走 FTS5 全文搜索（title + markdown）
- 向后兼容：现有 `tag:` 语法和 `parseTagSearchQuery` 消费者完全不受影响

### 范围

| 包含 | 不包含 |
|---|---|
| Parser 通用化（`shared/search.ts`） | UI chip 可视化展示 |
| Contract 扩展（`feed.types.ts`） | 排序下拉 |
| Store SQL 实现（`EntryStore.ts`） | 搜索栏位置/样式改造 |
| 前端 `buildEntryQuery` 适配 | |

---

## 一、Parser 层

### 新增类型

```typescript
// src/shared/search.ts

export type FilterField =
  | 'tag'
  | 'feed'
  | 'title'
  | 'content'
  | 'author'
  | 'starred'
  | 'read';

export type FilterOperator = '+' | '-' | '';

export interface SearchFilter {
  field: FilterField;
  operator: FilterOperator;
  value: string;
}

export interface ParsedSearchQuery {
  /** 纯文本部分（无前缀的搜索词） */
  textQuery: string;
  /** 结构化字段过滤器 */
  filters: SearchFilter[];
  /** 向后兼容：tag OR 列表（模糊匹配） */
  tagAnyFuzzy: string[];
  /** 向后兼容：tag OR 列表（精确匹配） */
  tagAnyExact: string[];
}
```

### 解析规则

| 输入 | 解析结果 |
|---|---|
| `tag:tech` | `{ field:'tag', op: '', value:'tech' }` |
| `+tag:tech` | `{ field:'tag', op: '+', value:'tech' }` |
| `-tag:news` | `{ field:'tag', op: '-', value:'news' }` |
| `feed:"New York Times"` | `{ field:'feed', op: '', value:'New York Times' }` |
| `title:climate` | `{ field:'title', op: '', value:'climate' }` |
| `+author:"John Doe"` | `{ field:'author', op: '+', value:'John Doe' }` |
| `starred:yes` | `{ field:'starred', op: '', value:'yes' }` |
| `read:no` | `{ field:'read', op: '', value:'no' }` |
| `content:"machine learning"` | `{ field:'content', op: '', value:'machine learning' }` |
| `machine learning` | `textQuery = "machine learning"`（纯文本走 FTS5） |

### 算法

```
parseSearchQuery(query):
  1. normalize + trim
  2. 逐个 token 扫描（支持引号括起的值）
  3. 对每个 token 判断是否匹配 pattern: [+/-]field:value
     - 支持引号: tag:"Exact Name"、+feed:"My Feed"
     - 不支持引号的 field 值也被收集为 value
  4. field 不在 FilterField 列表中的 token 视为 textQuery
  5. 返回 ParsedSearchQuery
```

### 向后兼容

`parseTagSearchQuery` 保持签名不变，内部委托给 `parseSearchQuery`：

```typescript
export const parseTagSearchQuery = (query: string): TagSearchResult => {
  const parsed = parseSearchQuery(query);
  return {
    textQuery: parsed.textQuery,
    tagFuzzyNames: parsed.tagAnyFuzzy,
    tagExactNames: parsed.tagAnyExact,
  };
};
```

---

## 二、Contract 层

### 新增类型

```typescript
// src/shared/contracts/feed.types.ts

export type FilterField =
  | 'tag' | 'feed' | 'title' | 'content' | 'author'
  | 'starred' | 'read';

export type FilterOperator = '+' | '-' | '';

export interface SearchFilter {
  field: FilterField;
  operator: FilterOperator;
  value: string;
}
```

### EntryQuery 修改

```typescript
export interface EntryQuery {
  // ... 保留所有已有字段
  feedId?: number;
  isRead?: boolean;
  isStarred?: boolean;
  search?: string;
  tagNames?: string[];
  tagFuzzyNames?: string[];
  matchAll?: boolean;
  limit: number;
  cursor?: EntryCursor;

  // 新增
  filters?: SearchFilter[];
}
```

**设计决策**：`filters` 和旧 `tagNames`/`tagFuzzyNames` 可同时存在，Store 负责合并。逐步迁移，不一次破坏。

---

## 三、Store 层

### `appendScopeConditions` 新增分支

在现有 tagNames/tagFuzzyNames 处理之后，新增 `options.filters` 处理逻辑：

| filter | SQL |
|---|---|
| `tag:tech`（OR） | `e.id IN (SELECT et.entryId FROM entry_tag et JOIN tag t ON ... WHERE t.name LIKE '%tech%')` |
| `+tag:tech`（AND） | `e.id IN (SELECT et.entryId FROM entry_tag et JOIN tag t ON ... WHERE t.name = 'tech')` |
| `-tag:news`（NOT） | `NOT EXISTS (SELECT 1 FROM entry_tag et JOIN tag t ON ... WHERE et.entryId = e.id AND t.name LIKE '%news%')` |
| `feed:xxx` | `f.title LIKE '%xxx%'`（LEFT JOIN feed 已存在） |
| `-feed:xxx` | `f.title NOT LIKE '%xxx%'` |
| `title:xxx` | `search_normalize(e.title) LIKE '%xxx%'` |
| `content:xxx` | `search_normalize(ec.markdown) LIKE '%xxx%'`（LEFT JOIN entry_content 已存在） |
| `author:xxx` | `e.author LIKE '%xxx%'` |
| `starred:yes/no` | `e.isStarred = 1/0` |
| `read:yes/no` | `e.isRead = 1/0` |

**OR 合并优化**：同一 field 且 operator 为空（OR 语义）的 filter 合并到同一个 SQL OR 组。不同类型 filter 之间是 AND 关系。

### `validateEntryQuery` 新增校验

- `filters` 是数组，长度上限 50
- 每个 filter 的 field 必须是合法值
- value 长度上限 100

---

## 四、前端层（Renderer）

### `buildEntryQuery` 修改

```typescript
// src/renderer/features/search/entrySearch.ts

import { parseSearchQuery, ... } from '../../../shared/search';

export const buildEntryQuery = ({ ... }: EntryQueryInput): EntryQuery => {
  const normalizedSearch = normalizeSearchQuery(searchQuery);

  // 使用新的通用解析器替代 parseTagSearchQuery
  const parsed = normalizedSearch
    ? parseSearchQuery(normalizedSearch)
    : { textQuery: '', filters: [], tagAnyFuzzy: [], tagAnyExact: [] };
  const textQuery = parsed.textQuery || undefined;

  const query: EntryQuery = { limit, filters: parsed.filters };
  // ... 其余逻辑（feedId/filter/search/组合 tag names）保持不变
};
```

向后兼容：`query` 输出同时包含 `filters` 和旧的 `tagNames`/`tagFuzzyNames`。

---

## 五、Commit 计划

每个 commit 必须独立可构建、可通过对应的测试验证，不破坏已有测试。

```
Commit 1 ── Parser: parseSearchQuery + parseTagSearchQuery 重构
            文件:
              src/shared/search.ts
              tests/unit/shared/search.test.ts
            验证: npm test (单元测试全通过)
            信息: feat(shared): add generic parseSearchQuery with +/-/field filters

Commit 2 ── Contract: SearchFilter 类型 + EntryQuery.filters
            文件:
              src/shared/contracts/feed.types.ts
            验证: tsc --noEmit (类型检查通过)
            信息: feat(shared): add SearchFilter types and extend EntryQuery

Commit 3 ── Renderer: buildEntryQuery 接入 parseSearchQuery
            文件:
              src/renderer/features/search/entrySearch.ts
              tests/unit/renderer/entrySearch.test.ts
            验证: npm test (前端单元测试通过)
            说明: 此时 filters 已传入但 backend 尚不处理，
                  旧 tagNames/tagFuzzyNames 路径仍然生效
            信息: feat(renderer): use parseSearchQuery in buildEntryQuery

Commit 4 ── Store: appendScopeConditions 处理 filters
            文件:
              src/main/feed/stores/EntryStore.ts
              tests/integration/entry-store.test.ts
            验证: npm test (集成测试通过)
            信息: feat(main): implement filters in EntryStore query

Commit 5 ── 人工端到端验证
            文件: 无
            验证:
              - tag:xxx 仍然工作
              - +tag:xxx 工作
              - -tag:xxx 工作
              - feed:xxx / title:xxx / content:xxx 工作
              - starred:yes / read:no 工作
              - 纯文本搜索不受影响
```

### 各 commit 的独立性论证

| Commit | 能否独立构建 | 能否独立测试 | 是否会破坏中间状态 |
|---|---|---|---|
| 1 | ✅ 纯 search.ts + 测试，无外部依赖 | ✅ `npm test` | ❌ 无破坏，纯新增+重构 |
| 2 | ✅ 仅类型文件 | ✅ `tsc --noEmit` | ❌ 无破坏，只新增类型 |
| 3 | ✅ 依赖 1、2 的类型但编译不报错 | ✅ `npm test` | ❌ Store 未实现 filters，静默忽略 |
| 4 | ✅ 依赖 2 的类型 | ✅ `npm test` | ❌ 之前 filters 被忽略，现在正常处理 |
| 5 | N/A | 人工 | ❌ |

所有中间状态均可运行、可测试、不破坏现有功能。

### 各 commit 的详细改动

#### Commit 1 ── Parser

**`src/shared/search.ts`**

新增代码：
- 类型：`FilterField`（联合字符串字面量）、`FilterOperator`（`'+'` &#124; `'-'` &#124; `''`）、`SearchFilter`（`{ field, operator, value }`）、`ParsedSearchQuery`（`{ textQuery, filters, tagAnyFuzzy, tagAnyExact }`）
- 函数：`parseSearchQuery(query: string): ParsedSearchQuery`
  - 扫描 token，识别 `[+-]field:value` 模式
  - 引号支持：`field:"quoted value"` 整个被引号括起的内容作为 value
  - 不识别的 token 归入 `textQuery`
  - 同时填充 `tagAnyFuzzy`/`tagAnyExact` 向后兼容字段

修改代码：
- `parseTagSearchQuery` 主体删除，改为委托给 `parseSearchQuery`

**`tests/unit/shared/search.test.ts`**

新增测试：
- `parseSearchQuery`：每个 filter 字段的独立测试（tag/feed/title/content/author/starred/read）
- `parseSearchQuery`：`+`/`-` 操作符测试
- `parseSearchQuery`：引号值测试（`tag:"Exact Name"`）
- `parseSearchQuery`：混合输入测试（filter + 纯文本）
- `parseSearchQuery`：空/边界输入测试
- `parseTagSearchQuery`：回归测试（确保旧行为不变）

#### Commit 2 ── Contract

**`src/shared/contracts/feed.types.ts`**

新增导出类型：
- `FilterField`、`FilterOperator`、`SearchFilter`

修改：
- `EntryQuery` 接口新增 `filters?: SearchFilter[]`

验证：
```bash
npm run typecheck
```

#### Commit 3 ── Renderer

**`src/renderer/features/search/entrySearch.ts`**

修改：
- `import { parseSearchQuery } from '../../../shared/search'`
- `buildEntryQuery` 中：`parseTagSearchQuery` → `parseSearchQuery`
- `filters` 从 parsed 直接传到 `EntryQuery`
- 旧 `tagNames`/`tagFuzzyNames` 路径保留，双重填充

导出变动：
- 删除 `export { parseTagSearchQuery } from '../../../shared/search'` 不再需要（但保留导入以防外部引用）

**`tests/unit/renderer/entrySearch.test.ts`**

修改：
- 验证 `buildEntryQuery` 输出中 `filters` 字段存在且正确
- 确认旧字段（feedId/isStarred/search/tagNames 等）仍按预期填充

#### Commit 4 ── Store

**`src/main/feed/stores/EntryStore.ts`**

`appendScopeConditions` 新增分支（在现有 tagNames/tagFuzzyNames 处理之后）：

```typescript
if (options.filters && options.filters.length > 0) {
  const orGroups = new Map<FilterField, string[]>();
  for (const filter of options.filters) {
    if (filter.operator === '') {
      // Collect OR filters for batch processing
      const group = orGroups.get(filter.field) || [];
      group.push(filter.value);
      orGroups.set(filter.field, group);
    } else {
      // + (AND) and - (NOT) filters are applied individually
      appendSingleFilter(filter, conditions, params, esc);
    }
  }
  // Apply OR groups
  for (const [field, values] of orGroups) {
    appendOrFilter(field, values, conditions, params, esc);
  }
}
```

`validateEntryQuery` 新增校验。

**`tests/integration/entry-store.test.ts`**

新增 describe block：
- `filters` 各字段集成测试（tag OR/AND/NOT、feed、title、content、author、starred、read）
- 混合 filters + 旧 tagNames 的兼容测试
- 空 filters、无效 filters 的错误测试

---

## 六、影响分析

### 改动文件总表

| 文件 | Commit | 改动性质 |
|---|---|---|
| `src/shared/search.ts` | 1 | 新增 `parseSearchQuery`；重构 `parseTagSearchQuery` |
| `tests/unit/shared/search.test.ts` | 1 | 新增 parseSearchQuery 测试；确认 parseTagSearchQuery 回归 |
| `src/shared/contracts/feed.types.ts` | 2 | 新增 3 个类型；`EntryQuery` +1 字段 |
| `src/renderer/features/search/entrySearch.ts` | 3 | `buildEntryQuery` 改用新 parser |
| `tests/unit/renderer/entrySearch.test.ts` | 3 | 适配新字段 |
| `src/main/feed/stores/EntryStore.ts` | 4 | `appendScopeConditions` +filters 分支；`validateEntryQuery` +校验 |
| `tests/integration/entry-store.test.ts` | 4 | 新增 filters 集成测试 |

### 不涉及的文件

- 所有 `.css` 文件（UI 后续 PR）
- `FeedList.tsx`、`EntryList.tsx` 等界面组件
- 数据库迁移（不修改 schema）
- IPC handler（不修改 channel）

### 风险

| 风险 | 缓解 |
|---|---|
| `+`/`-` 前缀与现有 `tag:` 语法冲突 | 当前只认 `tag:` 前缀，`+tag:` 是全新合法语法 |
| Store `filters` 和 `tagNames` 同时生效导致重复过滤 | filters 分支处理时不重复处理 tag 类型；旧分支跳过已处理的 tag |
| `content:` 需要 `entry_content` JOIN，`queryBrowse` 已 LEFT JOIN | 无需额外 JOIN |
| `feed:` 需要 `feed` 表 JOIN，两个查询均已 LEFT JOIN | 无需额外 JOIN |