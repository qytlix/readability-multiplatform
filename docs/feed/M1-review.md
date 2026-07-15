# M1 代码审查记录

> 审查时间：2026-07-15
> 审查范围：`qyt/feed` 分支工作区代码
> 审查依据：`docs/feed/M1.md`

---

## 1. 文件清单

### 已提交（commit `43d28fc`）

| 文件 | 说明 |
|------|------|
| `src/main/feed/FeedParserAdapter.ts` | M0-FEED-02 |
| `src/shared/contracts/feed.types.ts` | M0 契约 |
| `src/shared/contracts/content.types.ts` | M0 契约 |
| `src/shared/errors/feed.errors.ts` | M0 错误码 |
| `src/shared/types/ambient.d.ts` | M0 环境类型 |
| `tests/unit/FeedParserAdapter.test.ts` | M0 解析测试 |
| `tests/unit/ReadabilityPrototype.test.ts` | M0 Readability 原型测试 |
| `tests/fixtures/feeds/*` | M0 Feed Fixture×9 |
| `tests/fixtures/articles/*` | M0 文章 Fixture×3 |
| `vitest.config.ts` | M0 vitest 配置 |

### 工作区未提交

| 文件 | 对应任务 |
|------|----------|
| `src/main/database/DatabaseManager.ts` | 数据库底座 |
| `src/main/migrations/001_create_feeds.ts` | feed 表 |
| `src/main/migrations/002_create_entries.ts` | entry 表 |
| `src/main/migrations/003_create_contents.ts` | entry_content 表 |
| `src/main/feed/FeedStore.ts` | M1-FEED-01 |
| `src/main/feed/EntryStore.ts` | M1-FEED-01 |
| `src/main/feed/FeedService.ts` | M1-FEED-01 |
| `src/main/feed/ContentFetcher.ts` | M1-FEED-03 |
| `src/main/feed/ContentCleaner.ts` | M1-FEED-03 |
| `src/main/feed/ContentService.ts` | M1-FEED-03 |
| `src/main/feed/ContentStore.ts` | M1-FEED-03 |
| `src/main/feed/MarkdownConverter.ts` | M1-FEED-03 |
| `src/main/ipc/feed.handler.ts` | M1-FEED-04/05 |
| `src/shared/contracts/feed.ipc.ts` | M1-FEED-04 |
| `src/renderer/features/feeds/FeedList.tsx` | M1-FEED-04 |
| `src/renderer/features/feeds/FeedAddDialog.tsx` | M1-FEED-04 |
| `src/renderer/features/feeds/EntryList.tsx` | M1-FEED-05 |
| `src/renderer/features/feeds/EntryDetail.tsx` | M1-FEED-05 |
| `tests/fixtures/databases/feed-fixture.ts` | 测试 fixture |
| `tests/integration/feed-store.test.ts` | M1-FEED-01 |
| `tests/integration/entry-store.test.ts` | M1-FEED-01/02 |
| `tests/integration/feed-service.test.ts` | M1-FEED-03（注：文件名为 feed-service 但内容是 ContentCleaner/MarkdownConverter 测试） |
| `tests/integration/content-store.test.ts` | M1-FEED-03 |

### 已修改已有文件

| 文件 | 变更 |
|------|------|
| `src/main/ipc.ts` | 添加 `initializeServices`，集成 feed IPC handler |
| `src/main/main.ts` | 调用 `initializeServices` |
| `src/preload/preload.ts` | 添加 feed/entry/content API |
| `src/shared/ipc.ts` | 添加 `FeedAPI`/`EntryAPI`/`ContentAPI` 类型 |
| `src/renderer/App.tsx` | 重写为三栏布局 |
| `src/renderer/index.css` | 完整的 feed reader 样式 |
| `vite.main.config.ts` | 添加 external 配置（native modules） |

---

## 2. M1 验收标准完成情况

| 验收项 | 状态 | 备注 |
|--------|------|------|
| 有效 Feed URL 可添加并返回文章列表 | ⚠️ | 需真实 HTTP fetch，缺集成测试 |
| 无效 URL 返回 `FEED_INVALID_URL` 错误 | ✅ | `isValidUrl()` 单元逻辑正确 |
| 重复添加返回 `FEED_DUPLICATE` 错误 | ✅ | `findByUrl` + UNIQUE 约束 |
| 手动同步后新文章被写入 | ⚠️ | 逻辑正确但无集成测试 |
| 重复同步不产生重复 Entry | ✅ | `(feedId,guid)` / `(feedId,url)` UNIQUE + 测试 |
| Feed 的 `lastFetchedAt` 在同步后更新 | ✅ | `FeedStore.updateSyncStatus` |
| URL 含中文/特殊字符正常处理 | ❓ | 未验证 |
| 文章清洗 HTML 不含危险标签 | ⚠️ | 正则清洗不够健壮 |
| `cleanedMarkdown` 格式为合法 Markdown | ✅ | turndown 测试通过 |
| `readabilityTitle`/`readabilityByline` 正确提取 | ✅ | ContentCleaner 测试通过 |
| `pipelineStatus` 正确追踪 | ✅ | ContentStore 测试覆盖 |
| 清洗失败时 `pipelineStatus='failed'` 且 `pipelineError` 有值 | ✅ | ContentService.fetchAndClean |
| 已存在 content 时再次请求覆盖更新 | ✅ | ContentStore.upsert |
| 去重：guid 优先 fallback url | ✅ | EntryStore 测试覆盖 |
| tombstone 不复活 | ✅ | EntryStore 测试覆盖 |
| 不同 Feed 同 URL 允许共存 | ✅ | UNIQUE(feedId, url) |
| IPC 安全校验通过 | ✅ | `isAuthorizedSender` 检查 mainWindow webContents |
| UI Loading/Error 状态可区分 | ✅ | FeedAddDialog + EntryDetail |
| `entry:list` keyset 分页 | ✅ | EntryStore 测试覆盖 |

---

## 3. 发现的问题

### P0 — 阻塞性问题

| # | 位置 | 问题 | 修复建议 |
|---|------|------|----------|
| 1 | `package.json` | `better-sqlite3` + `@types/better-sqlite3` 缺失，代码无法编译（5 个文件 `import Database from 'better-sqlite3'`） | 将这两个依赖从 `package-lock.json` 的 diff 中恢复（即重新 `npm install better-sqlite3 @types/better-sqlite3`），与 M1 代码一并提交 |

#### 1.1 附：`package.json` 依赖清理清单

以下清理项已在此次审查中确认，列入修复计划：

| 依赖 | 当前状态 | 处理 | 原因 |
|------|----------|------|------|
| `@types/dompurify` (devDep) | M0 提交中，但无代码引用 | **移除** | 仅在 `docs/feed/README.md` 中作为未来方案提及。等到 P1 #4 修复 ContentCleaner 使用 dompurify 时，再同时添加 `dompurify`（dependency）+ `@types/dompurify`（devDependency） |
| `better-sqlite3` (dependency) | 存在于工作区 `package.json` 但不在 M0 提交中 | **保留**（与 M1 代码一起提交） | DatabaseManager + 所有 Store 的运行时依赖。注意：vite.main.config.ts 的 `external` 列表中也需要 `better-sqlite3` |
| `@types/better-sqlite3` (devDep) | 存在于工作区 `package.json` 但不在 M0 提交中 | **保留**（与 M1 代码一起提交） | Store 层 `import type Database` 的类型来源 |
| `undici` | M1-FEED-01 规范中提及但未使用 | **不需要** | Node.js 24 内置 `fetch` 已满足需求 |

### P1 — 应修复

| # | 位置 | 问题 | 修复建议 |
|---|------|------|----------|
| 2 | `FeedService.ts:48-55` | `addFeed` 的 catch 块检查 `FEED_DUPLICATE` 的代码永远不会执行（fetch 不会抛此错误） | 移除该 if 分支 |
| 3 | `FeedService.ts:184-187` | `createdAt === updatedAt` 判断新文章依赖实现细节，脆弱 | `createOrUpdate` 改为返回 `{ id, isNew }` |
| 4 | `ContentCleaner.ts` | 手工正则清洗 HTML 不够健壮，无法覆盖 SVG handlers、HTML entities 等 XSS 向量 | 安装 `dompurify` 并配合 jsdom 的 `JSDOM.fragment`/DOMPurify |
| 5 | `feed.handler.ts` | IPC 响应格式不一致：成功时有时返回裸数据，有时返回 `{ok:true}` | 统一包装为 `IPCResult<T>`，所有 handler 返回 `{ok:true,data}` 或 `{ok:false,error}` |
| 6 | `FeedService.ts:200-214` | `ShaleErrorClass` 从未被抛出——Service 抛出的是 `createFeedError()` 返回的 plain object | 要么改为抛出 `ShaleErrorClass` 实例，要么删除该类 |
| 7 | `tests/integration/feed-service.test.ts` | 文件名是 `feed-service` 但实际测试 ContentCleaner 和 MarkdownConverter | 重命名文件并添加真实的 FeedService 集成测试 |
| 8 | `src/main/feed/FeedService.ts` | `syncFeed` 的 ETag/Last-Modified 仅放了个空字符串占位 | 从上次响应的 ETag header 存储并复用 |

### P2 — 建议优化

| # | 位置 | 问题 | 修复建议 |
|---|------|------|----------|
| 9 | `ContentFetcher.ts` | `maxRedirects` 配置参数未被实际使用——`fetch` 的 `redirect:'follow'` 自动跟随，不暴露重定向计数 | 手动实现重定向跟踪或移除该参数 |
| 10 | `EntryDetail.tsx:19-52` | 快速切换文章时存在竞态，旧请求可能覆盖新请求结果 | 添加 AbortController 或使用 key 强制重新挂载 |
| 11 | `FeedService.ts:134` | `syncAll` 属于 M2 范围（并发同步），当前实现在 M1 中 | 保留但标记为待完善 |
| 12 | `feed.handler.ts:103-125` | `feed:sync` handler 的 `feedId=undefined` 全量同步分支返回结果不完整（只取 feeds[0] 作为 feed） | 修正返回值或暂时移除全量同步 |
| 13 | `src/shared/ipc.ts` | Preload API 类型中 `Promise<any>` 应具体化 | 补充准确的返回类型 |
| 14 | `EntryDetail.tsx:34-37` | `content.get` 返回 `{ok:false}` 不等于"没有已有内容"，可能是 IPC 错误 | 区分 "无内容" 与 "获取失败" |

---

## 4. 缺失项

| 缺失 | 对应任务 | 优先级 |
|------|----------|--------|
| `FeedService` 集成测试（HTTP mock） | M1-FEED-01 | P1 |
| `ContentService` 集成测试 | M1-FEED-03 | P1 |
| `ContentFetcher` 单元测试（charset/重定向/大小限制） | M1-FEED-03 | P1 |
| UI 功能测试（添加 Feed 端到端） | M1-FEED-04 | P2 |
| `EntryList` 的 `feedId` 筛选项为空列表行为 | M1-FEED-05 | P2 |

---

## 5. 整体评估

M1 的核心链路（FeedService → Feed/Entry/ContentStore → ContentService → IPC → Preload → UI）**结构完整，数据流正确**。去重、tombstone、keyset 分页等关键逻辑有单元/集成测试覆盖，UI 组件实现了 Loading/Empty/Error 状态区分。

剩余工作：
1. **加回 `better-sqlite3` 依赖**
2. **修复 P1 问题**（约 3-4h）
3. **补充集成测试**（约 2-3h）
4. **DOM 清洗升级为 dompurify**（约 30min）

预计修复后可达到 M1 验收标准。
