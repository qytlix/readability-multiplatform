# M1 修复总结

> 基于 `M1-review.md` 审查结果，对 `qyt/feed` 分支工作区进行的完整修复。
> 修复日期：2026-07-15
> 审查依据：`docs/feed/M1.md`、`docs/feed/M1-review.md`

---

## 修复清单

### P0 — 阻塞性

| # | 问题 | 修复 |
|---|------|------|
| 1 | `better-sqlite3` + `@types/better-sqlite3` 缺失，代码无法编译 | 安装依赖；`vite.main.config.ts` external 列表同步添加 |
| — | `@types/dompurify` 残留（无代码引用） | 移除；P1-#4 中随 `dompurify` 重新安装 |

### P1 — 必须修复

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 2 | `FeedService.ts` | `addFeed` catch 块中 `FEED_DUPLICATE` 检查永不可达 | 移除该分支 |
| 3 | `FeedService.ts` / `EntryStore.ts` | `createdAt === updatedAt` 判断新文章依赖实现细节 | `createOrUpdate` 返回 `{id, isNew}`；同步更新所有调用方和测试 |
| 4 | `ContentCleaner.ts` | 手工正则 HTML 清洗不够健壮（XSS 向量覆盖不全） | 安装 `dompurify`，用 `JSDOM.fragment` + `DOMPurify.sanitize` 替换 |
| 5 | `feed.handler.ts` / `shared/ipc.ts` / 所有 Renderer 组件 | IPC 响应格式不一致（有的裸数据，有的 `{ok:true}`） | 全部统一为 `IPCResult<T>` = `{ok,data}` \| `{ok,error}`；Preload API 类型具体化 |
| 6 | `FeedService.ts` | `ShaleErrorClass` 定义为类但从未实例化抛出，却用 `instanceof` 检查 | 删除 `ShaleErrorClass`，移除相关 `instanceof` 检查 |
| 7 | `tests/integration/feed-service.test.ts` | 文件名与实际测试内容不匹配（测的是 ContentCleaner） | 重命名为 `content-pipeline.test.ts`；新增真实 `feed-service.test.ts`（12 tests） |
| — | 缺失测试 | FeedService、ContentService、ContentFetcher 无集成/单元测试 | 新增 3 个测试文件：`feed-service.test.ts`(12)、`content-service.test.ts`(9)、`content-fetcher.test.ts`(7) |
| 8 | `FeedService.ts:syncFeed` | ETag/Last-Modified 仅空字符串占位 | 新增迁移 `004_add_feed_etag`；`FeedStore.updateSyncHeaders()`；发送条件请求并存储响应头 |

### P2 — 建议优化

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 9 | `ContentFetcher.ts` | `maxRedirects` 参数未实际使用（`fetch` 自动跟随不暴露计数） | 移除该参数 |
| 10 | `EntryDetail.tsx` | 快速切换文章存在竞态 | 添加 `AbortController`，卸载时取消在途请求 |
| 13 | `shared/ipc.ts` | Preload API 类型中 `Promise<any>` | 全部替换为具体的 `IPCResult<T>` 类型 |
| 14 | `EntryDetail.tsx` | `content.get` 返回 `!ok` 不等于"无内容"，可能是 IPC 错误 | `IPCResult<CleanedContent\|null>`：`null`=无内容，`!ok`=获取失败 |

---

## 数据库持久化

原 `main.ts` 调用 `initializeServices()` 未传路径，`DatabaseManager` 默认使用 `:memory:`，重启后数据丢失。

**修复**：传入 `app.getPath('userData') + '/shale.db'`。

| 平台 | 数据库路径 |
|------|-----------|
| Linux | `~/.config/shale/shale.db` |
| macOS | `~/Library/Application Support/shale/shale.db` |
| Windows | `%APPDATA%/shale/shale.db` |

---

## Mercury Schema 对齐

`entry_content` 表两处命名与 Mercury 设计文档不一致，已对齐：

| 列 | 修复前 | 修复后（= Mercury） |
|----|--------|---------------------|
| 原始 HTML | `sourceHtml` | `html` |
| Markdown | `cleanedMarkdown` | `markdown` |

同步更新：`ContentStore`、`ContentService`、`CleanedContent` 契约、`EntryDetail`、相关测试。

---

## 新增文件（相对 M0 commit `43d28fc`）

```
database-schema.md                       # Mercury 参考设计
docs/feed/M1-fix-summary.md             # 本文件

src/main/database/DatabaseManager.ts     # 数据库底座
src/main/migrations/001_create_feeds.ts  # feed 表
src/main/migrations/002_create_entries.ts # entry 表
src/main/migrations/003_create_contents.ts # entry_content 表
src/main/migrations/004_add_feed_etag.ts  # ETag/Last-Modified

src/main/feed/FeedStore.ts              # Feed CRUD
src/main/feed/EntryStore.ts             # Entry upsert/分页/状态
src/main/feed/ContentStore.ts           # Content upsert/pipeline
src/main/feed/FeedService.ts            # 添加/同步 Feed
src/main/feed/ContentService.ts         # 内容清洗流水线
src/main/feed/ContentCleaner.ts         # Readability + DOMPurify
src/main/feed/ContentFetcher.ts         # HTTP 抓取
src/main/feed/MarkdownConverter.ts      # turndown

src/main/ipc/feed.handler.ts            # 所有 feed/entry/content IPC handler
src/shared/contracts/feed.ipc.ts        # IPC 契约与 channel 常量

src/renderer/features/feeds/FeedList.tsx      # Feed 侧栏
src/renderer/features/feeds/FeedAddDialog.tsx  # 添加 Feed 对话框
src/renderer/features/feeds/EntryList.tsx      # 文章列表（无限滚动）
src/renderer/features/feeds/EntryDetail.tsx    # 文章详情（清洗内容）

tests/fixtures/databases/feed-fixture.ts       # 测试 DB 工厂
tests/integration/feed-store.test.ts           # FeedStore (9)
tests/integration/entry-store.test.ts          # EntryStore (15)
tests/integration/content-store.test.ts        # ContentStore (6)
tests/integration/feed-service.test.ts         # FeedService (12)
tests/integration/content-service.test.ts      # ContentService (9)
tests/integration/content-pipeline.test.ts     # ContentCleaner + MarkdownConverter (7)
tests/unit/content-fetcher.test.ts             # ContentFetcher (7)
```

---

## 测试结果

```
Test Files  9 passed
     Tests  98 passed
  TypeScript  zero errors
  Electron    窗口正常启动，数据持久化
```

---

## IPC Channel 清单

| Channel | 类型 | 状态 |
|---------|------|------|
| `feed:add` | invoke | ✅ 已实现 |
| `feed:list` | invoke | ✅ 已实现 |
| `feed:sync` | invoke | ✅ 已实现 |
| `feed:remove` | invoke | ✅ 已实现 |
| `feed:update` | invoke | ⬜ 类型已定义，handler 未注册 |
| `feed:sync-progress` | send | ⬜ 类型已定义，handler 未注册 |
| `entry:list` | invoke | ✅ 已实现 |
| `entry:mark-read` | invoke | ✅ 已实现 |
| `entry:mark-starred` | invoke | ✅ 已实现 |
| `content:fetch-and-clean` | invoke | ✅ 已实现 |
| `content:get` | invoke | ✅ 已实现 |

所有响应统一为 `IPCResult<T> = { ok: true, data: T } | { ok: false, error: ShaleError }`。

---

## 模块关系

```
数据层（独立基础）
  DatabaseManager ── 迁移(001-004)
        │
        │ getDb(): Database
        ▼
Feed 模块
  FeedStore / EntryStore / ContentStore
        │
  FeedService / ContentService
  ContentCleaner / ContentFetcher / MarkdownConverter
        │
  feed.handler.ts (IPC)
        │         IPCResult<T>
        ▼
  preload.ts → Renderer (FeedList / EntryList / EntryDetail)
```

数据层只被 `ipc.ts` 和测试 fixture 直接引用。Store 依赖 `better-sqlite3` 的 `Database` 实例，不依赖 `DatabaseManager` 类。重写数据库底座只要保持 `runMigrations()` → `getDb()` 契约，下游无需改动。

---

## 与 Mercury schema 对比

| 表 | 状态 |
|----|------|
| feed | ✅ 已实现（Shale 额外：lastSyncStatus/lastSyncError/syncIntervalMin/lastETag/lastModified） |
| entry | ✅ 已实现（Shale 额外：contentHash/updatedAt） |
| entry_content | ✅ 已实现，列名已对齐 Mercury |
| content_html_cache | ❌ 未实现（M2+ 主题渲染缓存） |
| entry_note / entry_note_anchor | ❌ 未实现（M3+ 笔记） |
| agent_provider_profile 等 LLM 表（8 张） | ❌ 未实现（M2 AI 模块） |
| tag / tag_alias / entry_tag 等标签表（7 张） | ❌ 未实现（P1/P2） |
