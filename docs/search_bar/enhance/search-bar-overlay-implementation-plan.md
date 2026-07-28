# 搜索栏增强：实施计划

## 总览

4 个独立可验证的 commit，每个 commit 可编译、可运行、不破坏现有功能。

---

## Commit 1 — CSS 基础设施

**文件**: `src/renderer/features/reader/ReaderPage.css`

### 改动

1. 新增 `--reader-divider-width` CSS 变量（当前硬编码为 `6px`）
2. 新增 `.is-search-active` 状态下 `story-list-pane` 和 `reader-list-divider` 的折叠样式
3. 新增 `.search-overlay` 样式（定位、背景、透明度过渡）
4. 新增 `.sidebar-search.is-search-active` 隐藏样式

### 验证

- `npm run build` 通过
- 界面无任何视觉变化（新样式仅通过 `.is-search-active` 类激活，此时该类尚未被任何代码使用）
- 搜索栏、中栏、分隔条位置和外观与之前完全一致

---

## Commit 2 — searchFocused 状态 + sidebar 搜索栏隐藏

**文件**: `src/renderer/App.tsx`, `src/renderer/features/feeds/FeedList.tsx`

### 改动

1. `App.tsx`：新增 `searchFocused` 状态（`useState(false)`）
2. `App.tsx`：`Ctrl+K` 快捷键改为设置 `searchFocused(true)` 并聚焦
3. `App.tsx`：`Escape` 逻辑适配 `searchFocused`（有搜索内容先清空，无搜索内容退出浮层）
4. `App.tsx`：向 `FeedList` 传递 `searchFocused` prop
5. `FeedList.tsx`：接收 `searchFocused` prop，搜索激活时给 `.sidebar-search` 添加 `.is-search-active` 类

### 验证

- 按 `Ctrl+K` → sidebar 搜索栏淡出（`opacity: 0; height: 0` 动画）
- `Escape` → sidebar 搜索栏恢复
- 有搜索内容时 `Escape` → 先清空内容，再按一次退出
- 无搜索内容时 `Escape` → 直接退出
- 搜索栏消失后 sidebar 其他内容（导航、feed 列表）不变
- 搜索栏恢复后功能正常（输入、搜索、结果显示）

---

## Commit 3 — SearchOverlay 组件

**文件**: `src/renderer/features/search/SearchOverlay.tsx`, `src/renderer/App.tsx`

### 改动

1. 创建 `SearchOverlay.tsx` 组件，包含：
   - 搜索输入框（与当前 sidebar 搜索栏相同功能：SearchIcon、输入、状态指示器、scope 切换）
   - 关闭按钮（X）
   - 点击 overlay 背景关闭
   - 输入内容自动同步到 App.tsx 的 `searchInput` / `setSearchInput`
2. `App.tsx`：`searchFocused` 时在 workspace 中渲染 `SearchOverlay`

### 验证

- 按 `Ctrl+K` → sidebar 搜索栏淡出 + overlay 淡入（搜索栏居中，背景半透明模糊）
- overlay 中输入文字 → sidebar 搜索栏同步隐藏，搜索正常触发
- 点击 overlay 外部或 `Escape` → overlay 淡出，sidebar 搜索栏恢复
- 搜索状态指示器（spinner / 完成 / 错误）正常工作
- 搜索范围切换（当前 feed / 全部 feed）正常工作
- 此时中间栏（story-list-pane）**尚未折叠**，overlay 浮在中间栏上方

---

## Commit 4 — 中间栏折叠 + 搜索结果拼接

**文件**: `src/renderer/App.tsx`, `src/renderer/features/search/SearchOverlay.tsx`, `src/renderer/features/reader/ReaderPage.css`

### 改动

1. `App.tsx`：`searchFocused` 时给 `.reader-workspace` 添加 `.is-search-active` 类
2. `SearchOverlay.tsx`：在搜索栏下方渲染搜索结果列表（复用现有 story-card 样式，或直接渲染 `visibleEntries`）
3. `ReaderPage.css`：微调 overlay 结果列表样式

### 验证

- 按 `Ctrl+K` → sidebar 搜索栏淡出 + overlay 浮现 + 中间栏（story-list-pane + divider）宽度折叠到 0
- sidebar 和阅读区紧贴，中间无间隙
- overlay 中搜索栏居中，下方紧接搜索结果列表
- 搜索结果列表滚动、点击选择文章正常工作
- 退出搜索 → 中间栏展开恢复，全部布局回到原样
- 所有过渡动画平滑（260~320ms）
- 与现有 EntryList 的筛选（全部/未读/收藏）、标签过滤、分页加载兼容