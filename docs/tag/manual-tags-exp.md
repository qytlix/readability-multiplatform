# Phase 1 (expanded) — 手动标签 E2E

> 从用户可添加/删除标签，到全局已有标签快速关联、主题色适应、标签名大小写敏感。
> Phase 1 本体 + 修复增强 + Phase 3 标签页/筛选前置的基础扩展。

## 最终用户流程

1. 打开一篇文章 → 工具栏出现标签按钮 `#`
2. 点击按钮 → 浮动窗口弹出在按钮下方，光照/暗色主题自动匹配
3. **已有标签区**：下方列出当前文章已有的标签行（每行一个，占满宽度），hover 显示 × 可删除
4. **快速添加区**：输入框下方列出全局已有（count >= 1）但当前文章未有的其他标签，点击即关联
5. **输入框**：输入新标签名回车 → 创建并关联
6. 关闭浮窗 → 重新打开同一篇文章 → 状态保持

## Schema（最终）

```sql
-- tag.name UNIQUE（无 NOCASE），大小写敏感
CREATE TABLE IF NOT EXISTS tag (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS entry_tag (
  entryId   INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  tagId     INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  source    TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  createdAt TEXT NOT NULL,
  PRIMARY KEY (entryId, tagId)
);

CREATE INDEX IF NOT EXISTS idx_entry_tag_entry ON entry_tag(entryId);
CREATE INDEX IF NOT EXISTS idx_entry_tag_tag   ON entry_tag(tagId);
CREATE INDEX IF NOT EXISTS idx_tag_name        ON tag(name);
```

## Shared Contracts

### Types (`src/shared/contracts/tag.types.ts`)

```ts
export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface TagWithCount extends Tag {
  count: number; // 关联的文章数
}

export interface EntryTag {
  entryId: number;
  tagId: number;
  source: 'manual' | 'auto';
  createdAt: string;
}

// IPC 请求
export interface TagEntryRequest   { entryId: number; tagName: string }
export interface UntagEntryRequest { entryId: number; tagId: number }
export interface EntryIdRequest    { entryId: number }
export interface CreateTagRequest  { tagName: string }
```

### IPC Channels (`src/shared/contracts/tag.ipc.ts`)

```ts
export const TAG_IPC_CHANNELS = {
  listByEntry:            'tag:list-by-entry',
  createTag:              'tag:create-tag',
  tagEntry:               'tag:tag-entry',
  untagEntry:             'tag:untag-entry',
  listAllWithCount:       'tag:list-all-with-count',
  listAvailableForEntry:  'tag:list-available-for-entry',
} as const;

export interface TagAPI {
  listByEntry:            (entryId: number) => Promise<IPCResult<Tag[]>>;
  createTag:              (tagName: string) => Promise<IPCResult<Tag>>;
  tagEntry:               (entryId: number, tagName: string) => Promise<IPCResult<void>>;
  untagEntry:             (entryId: number, tagId: number) => Promise<IPCResult<void>>;
  listAllWithCount:       () => Promise<IPCResult<TagWithCount[]>>;
  listAvailableForEntry:  (entryId: number) => Promise<IPCResult<TagWithCount[]>>;
}
```

## Backend

### TagStore (`src/main/tags/TagStore.ts`)

| 方法 | 作用 | SQL 要点 |
|---|---|---|
| `findOrCreate(name): Tag` | 查找或创建标签 | `SELECT * FROM tag WHERE name = ?` (精确匹配，不 COLLATE NOCASE) |
| `listByEntry(entryId): Tag[]` | 列出文章已有标签 | `JOIN entry_tag`，`WHERE et.entryId = ?` |
| `tagEntry(entryId, tagId): void` | 关联标签到文章 | `INSERT OR IGNORE INTO entry_tag` (幂等) |
| `untagEntry(entryId, tagId): void` | 解除关联 | `DELETE FROM entry_tag WHERE ...` |
| `listAllWithCount(): TagWithCount[]` | 所有标签 + 计数 | `COUNT(et.entryId)` + `isDeleted = 0` |
| `listAvailableForEntry(entryId): TagWithCount[]` | 全局可用标签（当前文章未用） | `WHERE t.id NOT IN (SELECT tagId FROM entry_tag WHERE entryId = ?)` |

### TagService (`src/main/tags/TagService.ts`)

- 参数验证：`assertTagName` — 非空，trim，≤50 字符
- `assertEntryExists` — entryId > 0 整数 + `entryStore.findById`
- 每个 public 方法对应一个 Store 方法 + 验证

### TagIpcHandler (`src/main/tags/TagIpcHandler.ts`)

- IPC channel → Store 委托，`IPCResult<T>` 信封
- `isAuthorizedSender` + `is*Request` 校验
- 已注册 6 个 handler：`listByEntry`、`createTag`、`tagEntry`、`untagEntry`、`listAllWithCount`、`listAvailableForEntry`

## 标签颜色

### Renderer (`src/renderer/features/tags/tagColor.ts`)

```ts
export function tagColor(name: string): { hue: number } {
  // HSL hash 算法，只返回色相
  // hue 通过 CSS 变量 --tag-hue 传递
}
```

### CSS 主题适应（`ReaderPage.css`）

```
.tag-badge {                          /* 深色模式（默认） */
  --tag-saturation: 35%;
  --tag-lightness: 30%;
  --tag-bg: hsl(var(--tag-hue), var(--tag-saturation), var(--tag-lightness));
  --tag-text-lightness: clamp(10%, calc(200% - var(--tag-lightness) * 4), 92%);
  color: hsl(0, 0%, var(--tag-text-lightness));
  background: var(--tag-bg);
}

.reader-page[data-theme="light"] .tag-badge {
  --tag-lightness: 88%;
  --tag-saturation: 35%;
}
```

- 深色背景：`hsl(H, 35%, 30%)`，文字自动浅色
- 浅色背景：`hsl(H, 35%, 88%)`，文字自动深色
- × 按钮使用同样 `clamp()` 公式自动选择浅色/深色
- light 主题额外加 `box-shadow: inset 0 0 0 1px` 边框

## UI 组件

### TagBadge (`src/renderer/features/tags/TagBadge.tsx`)

```
┌──────────────────────────────────────┐
│  AI                            [×]  │  ← 占满宽度，label flex:1 + ellipsis
└──────────────────────────────────────┘
```

- 每行一个标签，`display:flex; width:100%`
- label `flex:1 1 auto` + `text-overflow: ellipsis`
- × 按钮初始 `width:0; opacity:0; scale(0)`，hover 时 `width:18px; opacity:1; scale(1)`
- 过渡 120ms ease

### TagInput (`src/renderer/features/tags/TagInput.tsx`)

- 回车提交，空字符串拒绝
- 输入最大 50 字符

### TagFloatingWindow (`src/renderer/features/tags/TagFloatingWindow.tsx`)

```
┌─ Tag Floating Window ────────────────┐
│  标签                                 │
│  [输入标签名，回车添加...          ]   │
│                                       │
│  已有标签                              │
│  [AI 3] [阅读 1] [ML 2]               │  ← 可点击快速关联
│                                       │
│  ┌──────────────────────────────────┐ │
│  │  AI                          [×] │ │
│  ├──────────────────────────────────┤ │
│  │  阅读                        [×] │ │
│  └──────────────────────────────────┘ │
└───────────────────────────────────────┘
```

布局顺序：Header → TagInput → 已有标签 pills (clickable) → 当前文章标签列表 (with ×)

关键技术决策：
- Portal 到 `.reader-page`（而非 `document.body`）继承 CSS 变量
- 关闭通过 `mousedown` 检测外部点击 + Escape
- 添加/删除后同时刷新 `tags` 和 `availableTags`
- `onTagsChanged` 回调触发父组件刷新侧边栏 count

### EntryDetail (`src/renderer/features/feeds/EntryDetail.tsx`)

- 工具栏显示 `#` 标签按钮（`TagIcon` 组件）
- 点击 toggle 开关浮动窗口
- 关闭时 blur 按钮（消除 tooltip）
- 传递 `onTagsChanged` 刷新 sidebar count

## Migrations

| ID | 作用 |
|---|---|
| `022_create_entry_tags` | 初始 `tag` + `entry_tag` 表（`UNIQUE COLLATE NOCASE`） |
| `023_tag_name_case_sensitive` | 重建 `tag` 表去掉 `NOCASE`，`name` 改为精确 `UNIQUE` |

## 关键修复记录

1. **Portal 到 `.reader-page`**：从 `document.body` 改为 `.reader-page`（fallback 到 `body`），使 CSS `data-theme` 变量传播正确
2. **× 按钮平滑过渡**：`display:none`→`width:0→16px` + `opacity` + `scale` 过渡 120ms
3. **重复标签警告**：前端在 IPC 前做精确比对，绿色警示文字
4. **Tooltip 残留**：点击标签按钮后 blur() + `:has(button[aria-expanded="true"])` CSS 隐藏 tooltip
5. **垂直布局替代 wrap**：每行一个标签占满宽度，避免 hover × 时换行导致跑飞
6. **Theme-aware 颜色**：`hue` 通过 CSS 变量传递，light/dark 控制 `--tag-lightness`
7. **自动对比度文字**：`clamp(10%, calc(200% - var(--tag-lightness)*4), 92%)` 公式动态选择黑白文字
8. **大小写敏感**：Migration 020 去掉 `NOCASE` + JS 端精确匹配

## 受影响的文件

### 核心模块

| 操作 | 文件 |
|---|---|
| **新建** | `src/main/migrations/022_create_entry_tags.ts` |
| **新建** | `src/main/migrations/023_tag_name_case_sensitive.ts` |
| **改** | `src/main/database/DatabaseManager.ts` |
| **新建** | `src/main/tags/shared/tag.errors.ts` |
| **新建** | `src/main/tags/TagStore.ts` |
| **新建** | `src/main/tags/TagService.ts` |
| **新建** | `src/main/tags/TagIpcHandler.ts` |
| **改** | `src/main/services.ts` |
| **改** | `src/main/ipc.ts` |

### Shared contracts

| 文件 | 内容 |
|---|---|
| `src/shared/contracts/tag.types.ts` | Tag、TagWithCount、EntryTag、请求类型 |
| `src/shared/contracts/tag.ipc.ts` | TAG_IPC_CHANNELS、TagAPI、IPCResult |
| `src/shared/ipc.ts` | ShaleAPI tag 字段 |

### Preload

| 文件 | 内容 |
|---|---|
| `src/preload/preload.ts` | tagAPI 桥接（6 个 IPC 调用） |

### Renderer

| 文件 | 内容 |
|---|---|
| `src/renderer/features/tags/tagColor.ts` | HSL hash 算法，返回 `{ hue }` |
| `src/renderer/features/tags/TagBadge.tsx` | 标签行组件（全宽 + × 按钮） |
| `src/renderer/features/tags/TagInput.tsx` | 输入框组件 |
| `src/renderer/features/tags/TagFloatingWindow.tsx` | 浮动窗口组件 |
| `src/renderer/features/feeds/EntryDetail.tsx` | 工具栏集成 + tag button |
| `src/renderer/features/reader/ReaderIcons.tsx` | TagIcon 组件 |
| `src/renderer/features/reader/ReaderPage.css` | 全部标签相关 CSS |

### 测试

| 文件 | 内容 |
|---|---|
| `tests/unit/tags/TagStore.test.ts` | TagStore 单元测试（findOrCreate、listByEntry、tagEntry、untagEntry） |
| `tests/unit/tags/TagService.test.ts` | TagService 单元测试（验证 + 错误路径） |
| `tests/integration/tags/TagIpcHandler.test.ts` | IPC handler 集成测试 |

## 未完成/后续

- AI 自动标签（Phase 2）
- 标签筛选文章列表（Phase 2 或 3）
- 标签管理页（TagListPage 已实现 Phase 3 基础）
- 批量多选操作