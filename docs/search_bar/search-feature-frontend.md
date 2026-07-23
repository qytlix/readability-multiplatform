# 本地搜索功能 — 前端设计与需求

> 对应 Issue: [#34 [Feature] 支持已持久化文章的本地搜索](https://github.com/qytlix/readability-multiplatform/issues/34)  
> 子 Issue: [#36 feat: 搜索栏](https://github.com/qytlix/readability-multiplatform/issues/36)  
> 状态: **待 UI 优化完成后实现**

---

## 1. 功能概要

用户通过搜索栏输入关键词，搜索结果在中栏（EntryList）展示，点击结果可打开 Reader。

搜索基于已持久化的本地数据，不触发网络、同步或 AI 请求。

---

## 2. 搜索框

### 2.1 位置

搜索框位于**顶栏中部**。

当前顶栏结构（`App.tsx`）只有左侧品牌标识：

```tsx
<header className="app-header">
  <h1>
    <img className="app-brand-mark" src={shaleMark} alt="" />
    <span>Shale</span>
  </h1>
</header>
```

需要在中部增加搜索输入框。

### 2.2 唤出 / 关闭

- **快捷键**唤出搜索框（建议 `Ctrl+K` 或 `Cmd+K`，参考 Issue #36 描述的 "快捷键唤醒"）
- **Escape** 关闭搜索并恢复普通列表视图
- **点击搜索框外部**是否关闭？可讨论决定

### 2.3 交互行为

| 交互 | 行为 |
|------|------|
| 输入文字 | 触发搜索（需防抖，见 §3） |
| 清空输入 | 恢复普通文章列表（当前 feed 全部文章） |
| 无结果 | 显示空状态提示（如 "No results for 'xxx'"） |
| 按回车搜索 | Issue #36 提到"按下回车搜索"，可结合防抖决定是否需要二次回车确认 |

---

## 3. 请求控制（防抖 + 取消）

### 3.1 防抖

连续输入时避免每个按键都发送 IPC 请求。建议：

| 方案 | 延迟 | 说明 |
|------|------|------|
| Debounce | 300ms | 用户停止输入 300ms 后发送请求 |
| 输入为空时立即清除 | 0ms | 输入框清空时立即恢复列表，无需等待 |

### 3.2 取消过期请求

当新搜索请求发出时，旧请求的返回应该被丢弃，避免"后发先至"的竞态问题。

**实现方式**（Renderer 侧）：

```typescript
// 方案 A: AbortController
const abortRef = useRef<AbortController | null>(null);

// 每次新搜索前，abort 旧请求
if (abortRef.current) abortRef.current.abort();
abortRef.current = new AbortController();

// 调用 IPC
const result = await window.shaleAPI.entry.list({ search, ... });
// 如果被 abort，promise resolve 的 IPCResult 会被忽略
```

由于 Electron IPC 本身不支持 AbortController 原生取消，上述方案的实际效果是：

- **忽略旧请求的结果**（不 update state），而不是真正取消已经在 Main 进程执行的 SQL 查询
- 真正取消需要在 Main 进程实现查询中断（如 `db.prepare(...).pluck()` 不支持中断），第一版不实现

### 3.3 Renderer 中搜索状态

需要区分以下状态：

- **idle** — 未激活搜索
- **searching** — 请求已发出，等待返回
- **results** — 有搜索结果
- **no-results** — 搜索完成但无匹配
- **error** — 搜索失败

对应空状态的展示：

```tsx
// EntryList 中新增
if (isSearching && searchQuery) {
  if (status === 'searching')
    return <p>Searching...</p>;
  if (status === 'no-results')
    return <p>No results for "{searchQuery}"</p>;
  if (status === 'error')
    return <p>Search failed. Please try again.</p>;
}
```

---

## 4. 搜索结果展示

搜索结果复用在**中栏的 `EntryList`** 组件中展示，而不是新建独立的搜索结果视图。

### 4.1 数据流

```
App.tsx
  searchQuery: string              ← 搜索框组件控制
  selectedFeedId                   ← 搜索时是否保留 feed 过滤？按 Issue #36 需求

  ↓ 传递给 WorkspaceLayout.entryPane

EntryList
  entries: filtered by search      ← 由 App 的 loadEntries 逻辑根据 searchQuery 调用 IPC
  searchActive: boolean            ← 是否处于搜索模式（影响空状态文案）
  searchQuery: string              ← 用于空状态展示
```

### 4.2 与现有筛选的协同

`EntryQuery` 同时支持 `search` 和 `isStarred`（Issue #33）：

| 场景 | feedId | isStarred | search | 行为 |
|------|--------|-----------|--------|------|
| 普通浏览 | ✅ | — | — | 显示当前 feed 全部文章 |
| 星标筛选 | ✅ | `true` | — | 当前 feed 的星标文章 |
| 搜索 | — | — | `keyword` | 所有 feed 的搜索结果 |
| 星标 + 搜索 | ✅ | `true` | `keyword` | 当前 feed 星标文章中搜索 |

具体组合策略由 #36 的关键词语法解析决定，后端不做特殊处理 —— 四个维度都是独立的 `EntryQuery` 参数。

---

## 5. 关键词语法（#36 需求）

Issue #36 描述了搜索语法：

```
starred:true title:google content:finish tag:LLM
```

### 5.1 第一版实现建议

**不在第一版实现**完整的语法解析。理由：

1. 后端目前只接受一个 `search` 字符串做 `LIKE` 匹配；
2. 要实现 `starred:` → `isStarred`、`title:` → 字段级搜索 需要后端新增字段级过滤能力；
3. #34 已将"高级搜索语法"明确标记为**范围外**。

### 5.2 如果后续需要

前端解析步骤：

1. 解析 `keyword:value` 模式为结构化查询
2. 将结构化字段映射到 `EntryQuery`：
   - `starred:true` → `{ isStarred: true }`
   - `title:xxx` → `{ search: xxx }`（未来可改为字段级搜索）
   - `content:xxx` → `{ search: xxx }`（同上）
   - `tag:xxx` → 需要跨模块（标签系统），P2
3. 剩余裸词作为全文搜索放入 `search` 字段

---

## 6. 依赖的后端接口

前端只需要使用现有的 `EntryAPI.list`：

```typescript
interface EntryAPI {
  list: (params: {
    feedId?: number;
    isRead?: boolean;
    isStarred?: boolean;
    search?: string;         // ← 搜索关键词
    limit: number;
    cursor?: { publishedAt: string; id: number };
  }) => Promise<IPCResult<{
    entries: EntryListItem[];
    nextCursor?: { publishedAt: string; id: number };
  }>>;
}
```

**不需要新增 IPC channel**，不需要修改 Shared 类型，不需要修改 Preload。

---

## 7. 搜索高亮（范围外）

Issue #34 明确将"搜索结果高亮的复杂富文本处理"标记为范围外。第一版搜索结果列表与普通列表样式一致，不突出显示匹配词。

---

## 8. 实现清单（前端）

待 UI 优化完成后按顺序实现：

- [ ] 顶栏搜索框组件（含快捷键唤出、Escape 关闭）
- [ ] 搜索状态管理（App.tsx: searchQuery, searchActive, debounce, abort）
- [ ] loadEntries 增加 `search` 参数传递
- [ ] EntryList 搜索模式下的空状态（"searching"、"no-results"、"error"）
- [ ] 清除搜索后恢复普通列表视图
- [ ] 搜索结果点击打开 Reader（已有逻辑可复用）
- [ ] 搜索与 Feed/星标筛选的协同