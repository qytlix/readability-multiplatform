# Phase 1 — 手动标签 E2E

## 目标

用户可在文章阅读页打开浮动窗口，手动为当前文章添加/删除标签。标签自动获得颜色，数据持久化到 SQLite，关闭重开后标签保持。

## 范围

| 包含 | 不包含 |
|---|---|
| 数据库 migration（`tag` + `entry_tag` 表） | AI 自动标签（Phase 2） |
| Shared types + IPC 契约 | Tag Agent 设置页面（Phase 2） |
| TagStore + TagService（CRUD） | 标签列表页（Phase 3） |
| IPC handler + Preload 暴露 | 文章列表标签 pill（Phase 3） |
| 浮动窗口 UI（TagFloatingWindow） | 标签筛选（Phase 3） |
| TagBadge、TagInput 组件 | |
| EntryDetail 工具栏集成 | |
| 标签颜色自动生成算法 | |

## 验收标准（人工）

1. 打开一篇文章 → 工具栏出现标签按钮（图标 `#`）
2. 点击按钮 → 浮动窗口弹出（不遮挡正文阅读区）
3. 输入标签名 "AI" → 回车 → 标签 pill 出现，带有自动生成的颜色
4. 再输入 "阅读" → 回车 → 两个标签都在
5. 点击标签 pill 上的删除按钮（×）→ 标签消失
6. 关闭浮窗 → 重新打开同一篇文章 → 剩余标签仍显示
7. 切换到另一篇文章 → 标签为空（标签属于文章而非全局）
8. 输入空字符串 → 不写入，显示提示
9. 输入超过 50 字符 → 截断或拒绝

## Schema

```sql
CREATE TABLE IF NOT EXISTS tag (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
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

## Shared Types (`src/shared/contracts/tag.types.ts`)

```ts
export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface EntryTag {
  entryId: number;
  tagId: number;
  source: 'manual' | 'auto';
  createdAt: string;
}

// Requests
export interface TagEntryRequest {
  entryId: number;
  tagName: string;
}

export interface UntagEntryRequest {
  entryId: number;
  tagId: number;
}

export interface EntryIdRequest {
  entryId: number;
}

export interface TagIdRequest {
  tagId: number;
}
```

## IPC Channels (`src/shared/contracts/tag.ipc.ts`)

```ts
export const TAG_IPC_CHANNELS = {
  listByEntry: 'tag:list-by-entry',
  createTag:   'tag:create-tag',
  tagEntry:    'tag:tag-entry',
  untagEntry:  'tag:untag-entry',
} as const;
```

Phase 1 不需要 `listAll` 和 `autoTag`。

## 标签颜色自动生成 (`src/renderer/features/tags/tagColor.ts`)

```ts
/** 根据标签名生成稳定的 HSL 颜色 */
export function tagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 72%)`;
}
```

## UI 组件树

```
EntryDetail (toolbar button)
  └── TagFloatingWindow (absolute positioned overlay)
        ├── TagInput              (输入框 + 回车确认)
        ├── [TagBadge × N]        (已有标签，每个可删除)
        └── (Phase 2: AutoTagPanel 将插入此处)
```

### TagBadge

```
┌──────────────────┐
│  AI          ×   │   ← 圆角 pill，背景 = tagColor(name)
└──────────────────┘
```

Props: `tag: Tag`, `onRemove: (tagId: number) => void`

### TagInput

```
┌─────────────────────────┐
│  输入标签名，回车添加...  │   ← input + 回车提交
└─────────────────────────┘
```

Props: `onAdd: (tagName: string) => void`

### TagFloatingWindow

- 浮动定位在标签按钮附近
- 点外部 / Escape 关闭
- 打开时加载 `tag:list-by-entry`
- 含 TagInput + 已有 TagBadge 列表
- 添加时调用 `tag:create-tag`（findOrCreate）→ `tag:tag-entry`
- 删除时调用 `tag:untag-entry`

## 后端实现依赖

| 类 | 方法 | 说明 |
|---|---|---|
| `TagStore` | `findOrCreate(name): Tag` | 按名查找（NOCASE），不存在则创建 |
| `TagStore` | `listByEntry(entryId): Tag[]` | JOIN entry_tag + tag |
| `TagStore` | `tagEntry(entryId, tagId): void` | 插入 entry_tag 记录 |
| `TagStore` | `untagEntry(entryId, tagId): void` | 删除 entry_tag 记录 |
| `TagService` | 同上 + 参数验证 | 验证 name 非空 ≤50 字符 |

## TODO（后续 Phase）

- **多选模式**：TagFloatingWindow、TagManager 需支持 `entryIds: number[]` 批量操作，TagStore 增加 `batchTagEntry` / `batchUntagEntry`。

## 受影响的文件清单

| 操作 | 文件 |
|---|---|
| **新建** | `src/main/migrations/019_create_entry_tags.ts` |
| **新建** | `src/shared/contracts/tag.types.ts` |
| **新建** | `src/shared/contracts/tag.ipc.ts` |
| **新建** | `src/main/tags/shared/tag.errors.ts` |
| **新建** | `src/main/tags/TagStore.ts` |
| **新建** | `src/main/tags/TagService.ts` |
| **新建** | `src/main/tags/TagIpcHandler.ts` |
| **新建** | `src/renderer/features/tags/tagColor.ts` |
| **新建** | `src/renderer/features/tags/TagBadge.tsx` |
| **新建** | `src/renderer/features/tags/TagInput.tsx` |
| **新建** | `src/renderer/features/tags/TagFloatingWindow.tsx` |
| **改** | `src/main/database/DatabaseManager.ts` |
| **改** | `src/main/services.ts` |
| **改** | `src/main/ipc.ts` |
| **改** | `src/preload/preload.ts` |
| **改** | `src/shared/ipc.ts` |
| **改** | `src/renderer/features/feeds/EntryDetail.tsx` |