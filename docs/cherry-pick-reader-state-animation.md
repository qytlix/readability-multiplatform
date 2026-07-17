# Cherry-pick: Reader State + 空状态动画

从 `origin/cyn/feat-renderer` 合并 Reader State 状态机和空状态动画到 `qyt/feed`。

**目标**：在最右边一栏（EntryDetail/Reader）添加：
- 基于 SVG CSS 帧动画的空状态插图（"Select an article to read"——一个矿物绿色的点缓慢陷入三层地质层）
- 多种空/加载/错误状态的提示页面（feed-loading / feed-error / no-feeds / entries-loading / entries-error / no-articles）
- `readerState` 状态机统一管理 Reader 面板的显示状态

**关键 commits**：
- `52fc9a1` gif in plane white — 动画 SVG + 静态降级 SVG
- `ce09758` no-feed prompt — readerState 状态机 + 多状态空页面 UI

---

## 文件清单

### 新增 4 个文件

| # | 文件 | 行数 | 说明 |
|---|---|---|---|
| 1 | `src/renderer/assets/illustrations/empty-state/settling-point-animated.svg` | 47 | 6 帧 CSS step-end 动画，3.6s 循环 |
| 2 | `src/renderer/assets/illustrations/empty-state/settling-point-static.svg` | 6 | prefers-reduced-motion 降级用静态图 |
| 3 | `src/renderer/features/feeds/readerState.ts` | 38 | 状态机：8 种 ReaderDisplayState |
| 4 | `tests/unit/readerState.test.ts` | 60 | 状态机单元测试 |

### 修改 7 个文件

| # | 文件 | 幅度 | 主要变更 |
|---|---|---|---|
| 5 | `src/renderer/assets.d.ts` | 新增 | SVG/PNG 模块类型声明（qyt/feed 不存在此文件） |
| 6 | `src/renderer/assets/brand/shale-mark.svg` | 新增 | App header 品牌标记（依赖 `265f337`） |
| 7 | `src/renderer/index.css` | 中 | 添加 empty state 系列样式；移除 view-controls/OPML 样式；header 48→60px；多处 layout fix |
| 8 | `src/renderer/features/feeds/EntryDetail.tsx` | 大 | Props 从 1 个增至 10 个；集成 readerState；渲染 6 种空状态 + 动画 no-selection；简化内容加载/错误处理；删除 pipeline error 细分逻辑 |
| 9 | `src/renderer/features/feeds/FeedList.tsx` | 中 | 移除内部 dialog 管理；新增 `onOpenAddFeed`/`feedLoadStatus` props |
| 10 | `src/renderer/App.tsx` | 中 | 新增 feed/entry load status 状态；FeedAddDialog 托管到 App 层；传递新 props 到子组件 |
| 11 | `src/renderer/features/layout/paneLayout.ts` | 小 | reader min width 改为动态计算 |

---

## 关键设计

### readerState 状态机

```text
feedLoadStatus ──┬── 'loading'  → feed-loading
                 ├── 'error'    → feed-error
                 └── 'success'  ──┬── feedCount === 0  → no-feeds
                                  └── feedCount > 0 ────┬── entryLoadStatus === 'loading'  → entries-loading
                                                        ├── entryLoadStatus === 'error'    → entries-error
                                                        └── entryLoadStatus === 'success' ─┬── entryCount === 0 → no-articles
                                                                                            ├── !hasSelectedEntry → no-selection (动画)
                                                                                            └── hasSelectedEntry → article
```

### 动画 SVG (`settling-point-animated.svg`)

- 6 帧，CSS `@keyframes` 通过 `opacity` + `step-end` 逐帧切换
- `<picture>` + `<source media="(prefers-reduced-motion)">` 实现无障碍降级
- 无外部依赖，纯 `<svg>` + `<style>` 内联

### EntryDetail Props 变化

```diff
- entry: Entry | null
+ entry: Entry | null
+ feedLoadStatus: FeedLoadStatus
+ feedLoadError: string
+ feedCount: number
+ entryLoadStatus: EntryLoadStatus
+ entryLoadError: string
+ entryCount: number
+ onAddFeed: () => void
+ onRetryFeeds: () => void
+ onRetryEntries: () => void
```

### App.tsx 新增状态

```typescript
const [feedLoadStatus, setFeedLoadStatus] = useState<FeedLoadStatus>('loading');
const [feedLoadError, setFeedLoadError] = useState('');
const [entryLoadStatus, setEntryLoadStatus] = useState<EntryLoadStatus>('loading');
const [entryLoadError, setEntryLoadError] = useState('');
const [showAddFeedDialog, setShowAddFeedDialog] = useState(false);
```

### FeedList Props 变化

```diff
- onLocalRefresh: () => Promise<void>
+ onOpenAddFeed: () => void
+ feedLoadStatus: FeedLoadStatus
```

---

## 不涉及的 `cyn/feat-renderer` 改动

这些差异属于 `cyn/feat-renderer` 分支上的其他功能/清理，**不会**在这次 cherry-pick 中带入：

- Main 进程改动（main.ts, ipc.ts, FeedService, SyncCoordinator 等）
- Icon 资源文件（png/icns/ico）
- forge.config.ts 打包配置
- 被删除的文档（docs/feed/*.md）
- OPML 相关代码删除（OPMLDialog, Import/Export services）
- Feature 策略代码删除（FetchStrategy.ts）
- 其他测试文件删除/修改
- package-lock.json / package.json

---

## 验证

1. **状态机逻辑**：`npm test -- tests/unit/readerState.test.ts`
2. **动画 SVG**：启动应用 → 选择有文章的 Feed → 不选文章 → 观察 "Select an article to read" 区域是否出现动画
3. **多种空状态**：
   - 无 Feed 时显示 "Add your first feed"
   - 无文章时显示 "No articles yet"
   - 加载失败时显示对应 error + retry
4. **prefers-reduced-motion**：系统启用减少动画 → 应显示静态图而非动画
5. **TypeScript 编译**：`npx tsc --noEmit`