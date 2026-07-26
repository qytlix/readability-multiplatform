# Story Card Checkbox 主题适配

## 改动描述

将 `story-card-checkbox` 移入 `story-card-title` 的 flex 容器内，与 `<h2>` 同行且无 gap；  
在深色/浅色主题下正确渲染复选框的未选中背景色。

## 涉及文件

- `src/renderer/features/feeds/EntryList.tsx` — HTML 结构调整
- `src/renderer/features/reader/ReaderPage.css` — 样式与主题适配

## 实现要点

### 1. 结构：checkbox 放入 story-card-title

checkbox 的 `<span>` 从 `story-card-copy` 外部移入 `story-card-title` 内、`<h2>` 之前，使三个元素（checkbox → h2 → reading-progress）在同一 flex 行排列。

### 2. 间距控制

| 选择器 | 变更 | 原因 |
|---|---|---|
| `.story-card-title` | `gap: 10px` → `gap: 0` | checkbox 与 h2 之间无间隙 |
| `.story-card-checkbox` | 移除 `padding-right` | checkbox 右侧不撑开额外空隙 |
| `.story-card-reading-progress` | 新增 `margin-left: auto` | 保持阅读进度 % 推到右侧 |

### 3. 主题适配（`color-scheme` 方案）

利用 CSS `color-scheme` 属性控制浏览器对原生表单控件的主题渲染：

```css
/* 深色模式（默认）：复选框未选中时背景为深灰色 */
.story-card-checkbox {
  color-scheme: dark;
}

/* 浅色模式：恢复为浅色原生样式 */
.reader-page[data-theme="light"] .story-card-checkbox {
  color-scheme: light;
}
```

**优点**：无需 `appearance: none`、SVG 或伪元素，纯原生渲染，跨浏览器兼容。

### 4. 选择模式下的 bar

`export-selection-bar` 在 selectionMode 开启时直接显示，内容根据选中数量切换：

- `selectedIds.size === 0` → 显示「选择模式」
- `selectedIds.size > 0` → 显示「已选 **N** 篇」
