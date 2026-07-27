# Phase 3 — 标签列表页 + 文章列表标签可见 + 筛选

## 目标

新增与「所有文章」「收藏」「未读」同级的标签列表导航页，展示全部标签及其关联的文章数。点击标签跳转文章列表并自动筛选。文章列表的每行条目可见标签 pill。

## 范围

| 包含 | 不包含 |
|---|---|
| 标签列表页（全部标签 + 计数） | 多选模式（后续） |
| 导航栏「标签」入口 | 导入/导出标签 |
| 点击标签 → 文章列表筛选 | 标签合并/重命名 |
| EntryList 每行显示标签 pill | |
| 标签筛选 × 搜索同时生效 | |

## 导航结构

```
┌── Sidebar / Navigation ──────┐
│                               │
│  📡 所有文章                  │
│  ⭐ 收藏                      │
│  👁 未读                      │
│  🏷️ 标签              ← 新增 │
│  ...                         │
└──────────────────────────────┘
```

## 标签列表页

选中「标签」导航项后，主区域切换为标签列表视图：

```
┌── 标签 (12) ──────────────────────────────┐
│                                            │
│  [AI]         12 篇文章                     │
│  [机器学习]    8 篇文章                     │
│  [深度学习]    5 篇文章                     │
│  [编程]        3 篇文章                     │
│  [阅读]        2 篇文章                     │
│  ...                                        │
│                                            │
│  点击标签进入筛选后的文章列表               │
└────────────────────────────────────────────┘
```

### 设计要点

- 标签按文章数降序排列
- 每个标签显示 TagBadge（自动颜色）+ 文章计数
- 点击标签 → 导航到文章列表页面，URL/状态带标签参数
- 标签列表页本身也是一个独立路由/视图

## 文章列表标签可见

在 `EntryList` 的每行尾部或标题下方显示标签 pill：

```
┌────────────────────────────────────────────┐
│ 标题：如何学习机器学习                       │
│ Feed: AI Blog · 2024-01-15                 │
│                              [AI] [ML]      │
├────────────────────────────────────────────┤
│ 标题：深度学习入门                           │
│ Feed: Deep Blog · 2024-01-14               │
│                              [深度学习]      │
└────────────────────────────────────────────┘
```

### EntryListItem 类型变更

```ts
// 现有 EntryListItem 增加 tags 字段
export interface EntryListItem {
  // ... 现有字段 ...
  tags: Tag[];  // 新增
}
```

## 后端查询

### TagStore 增强

```ts
class TagStore {
  /** 返回所有标签及其关联的文章数，按文章数降序 */
  listAllWithCount(): Array<Tag & { count: number }>;
}
```

SQL:

```sql
SELECT t.*, COUNT(et.entryId) AS count
FROM tag t
LEFT JOIN entry_tag et ON t.id = et.tagId
GROUP BY t.id
ORDER BY count DESC, t.name ASC;
```

### EntryStore 增强 — 按标签筛选

```ts
class EntryStore {
  listByTags(params: {
    tagNames: string[];
    matchAll?: boolean;  // true: AND, false: OR, 默认 true
    limit: number;
    cursor?: { publishedAt: string; id: number };
    search?: string;  // 与标签同时生效
  }): { entries: EntryListItem[]; nextCursor?: ... };
}
```

AND 查询 SQL:

```sql
SELECT e.*, GROUP_CONCAT(t.name, ',') AS tagNames
FROM entry e
JOIN entry_tag et ON e.id = et.entryId
JOIN tag t ON et.tagId = t.id
WHERE t.name IN (?, ?, ...)
  AND (e.title LIKE ? OR e.summary LIKE ?)  -- 搜索关键词
GROUP BY e.id
HAVING COUNT(DISTINCT t.name) = ?  -- AND: 需等于标签数
ORDER BY e.publishedAt DESC
LIMIT ?;
```

OR 查询去掉 HAVING 即可。

### EntryStore — 查询文章时带回标签

修改 `listByFeed` 和 `listByCursor` 等方法，在返回 `EntryListItem` 时包含 `tags: Tag[]`。可通过：

**选项 A**: 对每页结果做二次查询（简单，N+1 但每页通常 20-50 条）
**选项 B**: 一次 JOIN 聚合后返回（需要改现有查询结构）

建议选 **选项 A** 首版实现，后续优化。

## 筛选状态管理

### 标签筛选状态

在 renderer 中添加全局或上下文级别的标签筛选状态：

```ts
// 当前选中的标签筛选
interface TagFilterState {
  tagNames: string[];   // 空数组 = 不筛选
  matchAll: boolean;    // true = AND
}
```

- 在标签列表页点击标签 → 设置 `tagNames = [点击的标签]`
- 导航到文章列表页，文章列表读取该状态
- 文章列表页中的标签可以叠加（点击第二个标签切换 AND/OR 或追加）

### 搜索 × 标签协同

- 搜索框关键词和标签筛选各自独立状态
- 两者同时生效（`WHERE` 条件叠加）
- 切换标签不清除搜索词，清除搜索词不清除标签

## IPC 变更

```ts
// Phase 3 新增
export const TAG_IPC_CHANNELS = {
  // ... Phase 1/2 channels ...
  listAllWithCount: 'tag:list-all-with-count',
} as const;
```

以及 feed IPC 增加标签筛选参数：

```ts
// 在 entry list 请求中增加可选参数
interface EntryListParams {
  feedId?: number;
  isRead?: boolean;
  isStarred?: boolean;
  search?: string;
  tagNames?: string[];    // 新增
  matchAll?: boolean;     // 新增
  limit: number;
  cursor?: { publishedAt: string; id: number };
}
```

## TODO（后续 Phase）

- **多选模式**：EntryList 需增加多选模式切换（长按/勾选框）、批量操作工具栏，筛选状态需兼容批量 tag 操作。

## 受影响的文件清单

| 操作 | 文件 |
|---|---|
| **新建** | `src/renderer/features/tags/TagListPage.tsx` |
| **新建** | `src/renderer/features/tags/TagListPage.css` |
| **改** | `src/main/tags/TagStore.ts`（增强 listAllWithCount / EntryStore 查询） |
| **改** | `src/main/feed/stores/EntryStore.ts`（listByTags + 携带 tags） |
| **改** | `src/shared/contracts/feed.types.ts`（EntryListItem 增 tags） |
| **改** | `src/shared/contracts/feed.ipc.ts`（增 tagNames/matchAll 参数） |
| **改** | `src/shared/contracts/tag.ipc.ts`（增 listAllWithCount channel） |
| **改** | `src/main/tags/TagIpcHandler.ts`（增 handler） |
| **改** | `src/preload/preload.ts`（暴露新 API） |
| **改** | `src/shared/domain-api.ts`（entry list 参数增 tagNames/matchAll） |
| **改** | `src/renderer/App.tsx`（导航增加「标签」项，路由） |
| **改** | `src/renderer/features/feeds/EntryList.tsx`（显示标签 pill + 标签筛选状态） |
| **改** | `src/main/ipc.ts`（注册新 handler） |

## 验收标准（人工）

1. **标签列表页可见**：
   - 侧边栏出现「标签」导航项
   - 点击后进入标签列表页
   - 看到所有已创建的标签（Phase 1/2 中手动/AI 添加的）及各自文章数
   - 按文章数降序排列

2. **标签筛选**：
   - 点击某个标签 → 跳转到文章列表，只显示包含该标签的文章
   - 文章列表每篇文章下方显示其标签 pill
   - 标签 pill 颜色与创建时一致

3. **搜索 + 标签协同**：
   - 标签筛选状态下，在搜索框输入关键词 → 结果同时满足标签和搜索条件
   - 清除搜索词 → 回到纯标签筛选结果

4. **空状态**：
   - 没有任何标签时 → 标签列表页显示「暂无标签」提示
   - 标签筛选无结果时 → 显示「没有匹配的文章」

5. **性能**：
   - 1000 个标签、每页 50 篇文章、每篇文章 5 个标签 → 首屏加载 < 500ms