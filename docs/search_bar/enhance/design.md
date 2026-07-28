# 搜索栏增强：居中浮层搜索

## 目标

将搜索栏交互从 sidebar 顶部输入框升级为**居中浮层（overlay）搜索**，类似 VS Code 的搜索体验。

搜索激活时：搜索栏在 workspace 区域居中浮动，中间栏（story-list-pane + divider）折叠让出空间、搜索结果列表实时拼接在搜索栏下方；退出搜索时恢复原布局。所有布局变化需有平滑动画。

## 交互流程

```
┌── sidebar ──┬──── overlay（浮在 workspace 上方） ────┬── 阅读区 ──┐
│             │                                        │            │
│  FeedList   │       ┌── 搜索 ────────────┐           │  文章内容  │
│             │       │ 🔍 输入...       ✕ │           │            │
│             │       └────────────────────┘           │            │
│             │       ┌── 搜索结果 ────────┐           │            │
│             │       │ 文章 A              │           │            │
│             │       │ 文章 B              │           │            │
│             │       │ 文章 C              │           │            │
│             │       └─────────────────────┘           │            │
└─────────────┴────────────────────────────────────────┴────────────┘
```

### 状态流转

```
 idle ────(聚焦 sidebar 搜索栏 / Ctrl+K)────▶ active
                                               │
                          ┌────────────────────┤
                          │                    │
                    有搜索内容时 Esc       无搜索内容时 Esc
                    先清空内容             退出浮层
                          │                    │
                          ▼                    ▼
                      active(内容清空)        idle
                          │
                    再按一次 Esc
                          │
                          ▼
                       idle
```

## 布局变化

### 搜索未激活（现状）

```css
.reader-workspace {
  grid-template-columns:
    var(--reader-sidebar-width)   /* sidebar */
    var(--reader-list-width)      /* story-list-pane */
    6px                            /* divider */
    minmax(0, 1fr);               /* article-pane */
}
```

### 搜索激活

- `--reader-list-width` → `0`，`--reader-divider-width` → `0`，sidebar 和 article-pane 紧贴
- 搜索 overlay 以 `position: absolute; inset: 0; z-index: 50` 覆盖在 workspace 之上
- overlay 内部：搜索栏居中浮在上部，搜索结果列表紧接其下

## 组件结构

```
App.tsx
 └── reader-workspace
      ├── reader-sidebar              ← 原位，搜索时不变
      ├── story-list-pane              ← 搜索时 grid 宽度折叠到 0
      │   └── EntryList               ← 用户不可见（grid 已折叠）
      ├── PaneDivider                 ← 搜索时 grid 宽度折叠到 0
      ├── article-pane                ← 原位，搜索时不变
      └── SearchOverlay               ← 新组件，absolute 覆盖
           ├── 搜索输入框（居中）
           ├── 关闭按钮
           ├── 搜索范围切换（搜索自当前 feed / 全部 feed）
           └── 搜索结果列表（拼接在下方）
```

## CSS 关键样式

### workspace 状态切换

```css
.reader-workspace.is-search-active {
  --reader-list-width: 0;
  --reader-divider-width: 0;
}

/* 中间栏折叠——动画 */
.reader-workspace.is-search-active .story-list-pane {
  width: 0;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  opacity: 0;
  transition:
    width 320ms cubic-bezier(0.2, 0.75, 0.2, 1),
    opacity 200ms ease;
}

.reader-workspace.is-search-active .reader-list-divider {
  width: 0;
  min-width: 0;
  overflow: hidden;
  opacity: 0;
}
```

### overlay 浮现

```css
.search-overlay {
  position: absolute;
  z-index: 50;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(17, 20, 16, 0.88);
  backdrop-filter: blur(8px);
  opacity: 0;
  transition: opacity 260ms ease;
}

.search-overlay.is-visible {
  opacity: 1;
}

/* 搜索栏居中（垂直偏上，留出大量空间给搜索结果列表） */
.search-overlay-input-row {
  width: min(600px, 80%);
  margin-top: clamp(40px, 12vh, 120px);
}

/* 结果列表紧挨搜索栏 */
.search-overlay-results {
  width: min(600px, 80%);
  flex: 1;
  overflow-y: auto;
}
```

### sidebar 搜索栏隐藏

```css
.sidebar-search.is-search-active {
  opacity: 0;
  pointer-events: none;
  height: 0;
  padding: 0;
  overflow: hidden;
  transition:
    opacity 160ms ease,
    height 260ms ease;
}
```

## 搜索栏元素

搜索 overlay 内的搜索输入框应保持与当前 sidebar 搜索栏相同的功能：

- 搜索图标（🔍 / SearchIcon）
- 输入框，`type="search"`，支持清除按钮
- 搜索状态指示器（spinner / 完成 / 错误）
- 搜索范围切换（当前 feed / 所有 feed）

## 数据流

- 搜索 overlay 使用 App.tsx 中已有的 `searchInput` / `setSearchInput` 和 `searchStatus`
- 搜索结果直接由 `EntryList` 组件渲染（通过 `visibleEntries`），但搜索激活时 EntryList 从 `story-list-pane` 移入 overlay
- 复用现有的 `EntryList` 组件，或者将其内容（story-cards）在 overlay 中重新实例化

**权衡**：为了最小化改动，可以考虑在 overlay 内直接渲染当前搜索结果列表的卡片内容，而不是移动 React 组件实例。

## 动画时序

| 阶段 | 内容 | 持续时间 |
|------|------|----------|
| 搜索激活 | sidebar 搜索栏淡出 + overlay 淡入 + 中间栏宽度折叠 | 260~320ms |
| 搜索退出 | overlay 淡出 + 中间栏宽度展开 + sidebar 搜索栏淡入 | 260~320ms |
| 输入内容 | 实时（无额外动画，由 React 默认 diff 驱动） | - |

## 不做的事

- ❌ 不修改 workspace 的 grid 列定义本身（只改 CSS 变量值）
- ❌ 不修改 shared 或 main 层的代码
- ❌ 不修改 EntryList 内部逻辑
- ❌ 不涉及数据库、IPC 或 store 变更
- ❌ 不改变快捷键绑定逻辑（现有 Ctrl+K、Escape 逻辑仅需适配 searchFocused 状态）