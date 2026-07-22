# Issue #47 分析：统一 Feed 身份判定与去重规则

> 分析日期：2025-07-17  
> 分析人：Coding Agent（qytlix 辅助）  
> 对应 Issue：[#47](https://github.com/qytlix/readability-multiplatform/issues/47)

---

## 1. 问题总结

目前 Add Feed 与 OPML Import 使用**不同的 URL 去重规则**，导致同一来源可能因 URL 的大小写、协议、尾部路径等差异被保存为多个 Feed，各自拥有独立 `feedId` 和独立文章历史。

---

## 2. 现有去重逻辑现状

### 2.1 Add Feed 路径

**代码位置**：`src/main/feed/services/FeedService.ts` → `addFeed()` 第 2 步

```typescript
// 精确匹配（大小写敏感）
const existing = this.feedStore.findByUrl(url);
if (existing) { throw createFeedError('FEED_DUPLICATE', ...); }
```

**`FeedStore.findByUrl`**（`src/main/feed/stores/FeedStore.ts` 第 45 行）：

```typescript
const stmt = this.db.prepare('SELECT * FROM feed WHERE feedURL = ?');
const row = stmt.get(url) as Record<string, unknown> | undefined;
```

→ **大小写敏感精确匹配**（SQLite TEXT 默认 `BINARY` 比较）

### 2.2 OPML Import — Merge 模式

**代码位置**：`src/main/feed/services/OPMLImportService.ts` → `importMerge()` 第 230 行

```typescript
const existingUrls = new Set(
  this.feedStore.findAll().map((f) => f.feedURL.toLowerCase()),
);
// ...
if (existingUrls.has(feed.xmlUrl.toLowerCase())) {
  result.skipCount++;
  continue;
}
```

→ **大小写不敏感比较**（两边都 `.toLowerCase()`）

### 2.3 OPML Import — Replace 模式

**代码位置**：`src/main/feed/services/OPMLImportService.ts` → `importReplace()`

```typescript
// 添加时用的是 FeedStore.findByUrl（精确匹配）
const existing = this.feedStore.findByUrl(feed.xmlUrl);
if (!existing) {
  this.feedStore.create({ ... });
}
```

```typescript
// 但删除时 FeedStore.deleteAllExcept 用大小写不敏感比较
toDelete = allFeeds.filter((f) => !keepUrls.has(f.feedURL.toLowerCase()));
```

→ **添加用精确匹配，删除用不敏感匹配**（内部不一致）

### 2.4 数据库约束

**代码位置**：`src/main/migrations/001_create_feeds.ts`

```sql
feedURL TEXT NOT NULL UNIQUE,
```

→ **SQLite `UNIQUE` 默认大小写敏感**（等同于 `BINARY` 排序规则）

### 2.5 不一致导致的组合问题

| 场景 | Add Feed → 精确匹配 | OPML Merge → 不敏感 | OPML Replace → 混合 | DB 约束 |
|---|---|---|---|---|
| `https://xkcd.com` + `https://XKCD.com` | **不拦截**（精确不等） → 写入 DB → 可能被 DB 放行（Binary UNIQUE 允许） | 视作重复 → 跳过 | 添加时精确（可能插入重复），删除时不敏感 | **可能允许两条** |
| `https://xkcd.com/rss.xml` + `https://xkcd.com/RSS.xml` | 同上 | 视作重复 | 同上 | 同上 |

---

## 3. 受影响文件清单

| 文件路径 | 影响程度 | 说明 |
|---|---|---|
| `src/main/feed/services/FeedService.ts` | **修改** | `addFeed()` 中重复检查需改用统一判定模块 |
| `src/main/feed/services/OPMLImportService.ts` | **修改** | `importMerge()` 和 `importReplace()` 中的匹配逻辑需统一 |
| `src/main/feed/stores/FeedStore.ts` | **修改** | `findByUrl()` 和 `deleteAllExcept()` 的匹配逻辑需考虑规范化；`create()` 需写入 `dedupKey` |
| `src/main/feed/services/FeedIdentity.ts` | **新增** | 统一的 Feed URL 规范化和身份判定模块 |
| `src/main/feed/stores/index.ts` | **可能修改** | 如需暴露 `FeedIdentity` |
| `src/main/migrations/` | **新增迁移** | 新增 `dedupKey` 列并填充 |
| `tests/unit/feed/opml-import.test.ts` | **修改/新增** | 补充规范化、大小写差异测试 |
| `tests/integration/feed-service.test.ts` | **修改/新增** | 同上 |
| `tests/unit/feed/feed-store-ext.test.ts` | **修改** | 调整 `deleteAllExcept` 行为后更新 |
| `tests/unit/feed/feed-identity.test.ts` | **新增** | `FeedIdentity` 模块单元测试 |

---

## 4. 关键设计决策

### 4.1 团队确认的规范化规则

以下决策已由团队确认（2025-07-17）：

| 差异类型 | 决策 | 理由 |
|---|---|---|
| **Host 大小写** | ✅ **规范为小写** | DNS 协议层面大小写不敏感，业界共识。`XKCD.COM` → `xkcd.com` |
| **默认端口** | ✅ **去除** | `:443`（https）、`:80`（http）是标准端口，URL 语义等价 |
| **片段** | ✅ **去除** | `#section` 对服务器无意义，仅客户端使用 |
| **尾部斜杠** | ✅ **规范掉** | `https://xkcd.com/feed/` → `https://xkcd.com/feed`。多数 Feed 服务器不区分尾部斜杠；原始 URL 保留在 `feedURL` 列供 fallback |
| **协议（http vs https）** | ❌ **不视为同一 Feed** | 同一站点可能对不同协议返回不同内容，保守处理，避免误合并 |
| **Path 大小写** | ❌ **不规范** | 仅规范 host 大小写，path 保持原样，避免误判 |
| **查询参数** | ❌ **不处理** | 可能含 token、身份信息或分流标识，保留原样 |
| **RSS vs Atom endpoint** | ❌ **不视为同一 Feed** | 同一站点的不同 Feed 格式视为不同 Feed |

### 4.2 既有重复数据

> **决策：只防新，不治旧。**

项目尚未正式发布，当前数据库中没有需要保留的用户数据。统一规则上线后，新的 Add Feed 和 OPML Import 不再产生重复。已有的重复保持原样，不作迁移合并。后续如有需要可单独开发合并工具。

### 4.3 数据库方案

> **决策：方案 A — 新增 `dedupKey` 列，保留原始 `feedURL`。**

- `feedURL` 列保留用户输入的原始 URL，用于显示、网络请求和 fallback。
- 新增 `dedupKey` 列，存储规范化后的去重键，并加 UNIQUE 索引。
- 新记录在 `create()` 时同时写入 `dedupKey`。
- 现有记录的 `dedupKey` 通过数据库迁移填充。

```sql
ALTER TABLE feed ADD COLUMN dedupKey TEXT;
CREATE UNIQUE INDEX idx_feed_dedupKey ON feed(dedupKey);
```

### 4.4 与现有 Entry 去重的关系

Entry 去重基于 `(feedId, guid)` 或 `(feedId, url)`（见 `EntryStore.createOrUpdate`）。Feed 去重规则变化不影响 Entry 去重的正确性。但由于不做既有重复合并，不涉及 Entry 数据迁移。

---

## 5. 推荐架构

### 5.1 提取统一的 `FeedIdentity` 模块

新建模块：`src/main/feed/services/FeedIdentity.ts`

```typescript
/**
 * Feed URL 规范化与身份判定
 * 
 * 职责：
 * - 为 URL 生成规范化的 dedupKey（用于去重匹配）
 * - 与其他去重入口共享同一规则
 * - 不涉及网络请求或数据库访问
 * 
 * 规范化规则（团队确认，2025-07-17）：
 * - host 转为小写
 * - 去除默认端口（:443, :80）
 * - 去除片段（#section）
 * - 去除尾部斜杠
 */

export function normalizeFeedURL(url: string): string {
  // 只返回 dedupKey 字符串，不包装对象
  // FeedStore 内部使用，不暴露到公共类型
}
```

> `FeedIdentity` 不导出类型接口，`normalizeFeedURL` 是一个纯函数，返回规范化的 `dedupKey` 字符串。

### 5.2 在各入口统一调用

**`dedupKey` 是 `FeedStore` 的内部实现细节，不暴露到公共契约。**

- **`FeedStore.create`**：内部自动计算 `dedupKey` 并写入。调用方按原样传 `feedURL`，不感知 `dedupKey` 存在。
- **`FeedStore.findByDedupKey`**：新增内部方法，用于重复检查。
- **`FeedStore.findByUrl`**：保留（用于向后兼容和原始 URL 查找）。
- **`FeedStore.deleteAllExcept`**：内部改用 `dedupKey` 比较，而非 `.toLowerCase()`。
- **`FeedService.addFeed`**：通过 `FeedStore.findByDedupKey` 检查重复，不直接调用 `FeedIdentity`。
- **`OPMLImportService`**：同样通过 `FeedStore` 的 `dedupKey` 方法做判断，不直接依赖 `FeedIdentity`。
- **`Feed` 公共类型**：不暴露 `dedupKey`。

### 5.3 数据库变更

**迁移脚本（新增）：** 在 `feed` 表添加 `dedupKey` 列并填充现有数据的 dedupKey：

```sql
ALTER TABLE feed ADD COLUMN dedupKey TEXT;
UPDATE feed SET dedupKey = ...;  -- 对每条记录执行规范化
```

**UNIQUE 索引按需创建：** 执行迁移前先扫描是否有 `dedupKey` 重复的记录。
- 无重复 → 创建 `CREATE UNIQUE INDEX idx_feed_dedupKey ON feed(dedupKey);`
- 有重复 → **跳过索引创建**，记录 warn 日志。应用层 `FeedStore.create` 仍通过 `findByDedupKey` 前置检查保证不产生新重复。用户可手动删除重复记录后自行创建索引。

**`FeedStore.create` 变更：** 接收的 `CreateFeedParams` 不变（仍传 `feedURL`），内部计算 `dedupKey` 后写入 `dedupKey` 列。

**`FeedStore.normalizeFeed`（行映射）：** 从 `row` 中读取 `dedupKey` 但不映射到 `Feed` 返回类型，仅在需要时内部使用。

---

## 6. 团队决策记录

| 序号 | 问题 | 决策 | 说明 |
|---|---|---|---|
| 1 | 尾部斜杠是否规范掉 | ✅ **规范掉** | 保留原始 URL 在 `feedURL` 列，`dedupKey` 使用无尾部斜杠的版本 |
| 2 | http vs https 是否视为同一 | ❌ **不视为同一** | 保守处理，避免不同协议内容差异导致的误合并 |
| 3 | 规范化粒度 | ✅ **仅 host 大小写** | 仅 host 转小写 + 去默认端口 + 去片段 + 去尾部斜杠。path 大小写和协议保持不变 |
| 4 | 已有重复数据 | ✅ **只防新不治旧** | 项目未正式发布，不执行迁移合并。统一规则后不再产生新重复 |
| 5 | dedupKey 列 vs 统一 feedURL 存储 | ✅ **方案 A：新增 dedupKey 列** | 保留原始 `feedURL`，新增 `dedupKey` 列做去重和 UNIQUE 约束 |
| 6 | dedupKey 是否暴露到 Feed 类型 | ❌ **不暴露** | `dedupKey` 是 `FeedStore` 内部实现细节，不在 `shared/contracts` 中出现，`normalizeFeed()` 行映射时丢弃 |
| 7 | dedupKey 由谁计算 | ✅ **FeedStore.create 内部自动算** | 调用方按原样传 `feedURL`，不感知 `dedupKey` 存在。`FeedStore` 依赖 `FeedIdentity.normalizeFeedURL` 纯函数 |
| 8 | 迁移遇到已有重复时怎么处理 | ✅ **3C：无重复则建 UNIQUE 索引；有重复则跳过索引、记 warn** | 应用层 `create()` 前置检查保证不产生新重复；用户可后续手动清理重复后自行建索引 |

---

## 7. Git Commit 分配与执行计划

按 AGENTS.md「每个 commit 尽量保持可运行、可验证且目的单一」的原则，划分为 **3 个 commit**，每个 commit 均可独立编译并通过对应测试。

### Commit 1：`feat(feed): add FeedIdentity URL normalization`

**范围：** 纯函数模块 + 单元测试

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/main/feed/services/FeedIdentity.ts` | **新增** | `normalizeFeedURL()` 纯函数，实现规范化规则（host 小写、去默认端口、去片段、去尾部斜杠） |
| `tests/unit/feed/feed-identity.test.ts` | **新增** | 全覆盖单元测试：大小写、尾部斜杠、默认端口、片段、查询参数保留、http/https 不合并、path 大小写保留、RSS vs Atom endpoint 保留 |

**提交后可验证：**

```bash
npx vitest run tests/unit/feed/feed-identity.test.ts  # 全绿
npx tsc --noEmit                                        # 类型通过
```

**依赖：** 无

---

### Commit 2：`feat(feed): add dedupKey column and integrate into FeedStore`

**范围：** 数据库迁移 + Store 层改造

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/main/migrations/010_create_dedup_key.ts` | **新增** | `ALTER TABLE feed ADD COLUMN dedupKey TEXT`；填充现有数据的 `dedupKey`；无重复则建 UNIQUE 索引，有重复则跳过并记 warn |
| `src/main/feed/stores/FeedStore.ts` | **修改** | `create()` 内部自动计算 `dedupKey` 并写入；新增 `findByDedupKey()`；`deleteAllExcept()` 改用 `dedupKey` 比较；`normalizeFeed()` 行映射读取但不暴露 `dedupKey` |
| `tests/unit/feed/feed-store-ext.test.ts` | **修改** | `deleteAllExcept` 用例调整；新增 `findByDedupKey` 用例；新增 `create` 自动计算 `dedupKey` 用例 |

**提交后可验证：**

```bash
npx vitest run tests/unit/feed/feed-store-ext.test.ts  # 全绿
npx vitest run tests/unit/feed/feed-identity.test.ts   # commit 1 内容不受影响
npm run test                                            # 确保不破坏现有测试
```

**依赖：** Commit 1（`FeedIdentity.normalizeFeedURL`）

---

### Commit 3：`feat(feed): unify dedup logic across FeedService and OPMLImportService`

**范围：** 业务层统一 + 集成测试收口

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/main/feed/services/FeedService.ts` | **修改** | `addFeed()` 中重复检查改为 `feedStore.findByDedupKey(dedupKey)` |
| `src/main/feed/services/OPMLImportService.ts` | **修改** | `importMerge()` 和 `importReplace()` 中的 URL 匹配统一为基于 `dedupKey` 的判断 |
| `tests/unit/feed/opml-import.test.ts` | **修改** | 新增大小写/尾部斜杠混合用例 |
| `tests/integration/feed-service.test.ts` | **修改** | 新增 Add Feed + OPML 混合路径、大小写/协议差异的集成用例 |

**提交后可验证：**

```bash
npx vitest run tests/unit/feed/           # Feed Identity + Store + OPML import + Service ext 全部通过
npx vitest run tests/integration/feed-     # 集成测试通过
npm run test                                # 全量测试不破坏其他模块
```

**依赖：** Commit 2（FeedStore 的 `findByDedupKey` 和 `create` 自动计算）

---

### Commit 边界总结

```
Commit 1:   纯函数 + 测试
                ↓
Commit 2:   迁移 + FeedStore + 测试
                ↓
Commit 3:   FeedService + OPMLImportService + 集成测试
```

每个 commit 都是可独立编译、可独立执行的逻辑单元；commit 2 依赖 commit 1，commit 3 依赖 commit 2，但不会因为后续 commit 的问题导致前面的改动失效。

### 非常规情况

如果某个步骤发现设计遗漏或需要回退：

| 情况 | 处理方式 |
|---|---|
| Commit 1 测试未通过 | 修复后再提交，不携带未验证的 commit 2 内容 |
| Commit 2 迁移脚本有 Bug | 回滚该 commit，修复后重新提交，commit 1 不受影响 |
| Commit 3 引入回归 | 回退 commit 3 即可，store 层和迁移仍然有效 |
| 设计决策需要调整 | 更新本文档第 4/6 节，按新决策重写受影响的 commit |

---

## 8. 验证要点

- ✅ `addFeed('https://XKCD.COM/Feed')` 与 `addFeed('https://xkcd.com/feed')` → 后者抛出 `FEED_DUPLICATE`（host 小写规范化后 dedupKey 相同）
- ✅ `addFeed('https://xkcd.com/feed/')` 与 `addFeed('https://xkcd.com/feed')` → 后者抛出 `FEED_DUPLICATE`（尾部斜杠规范化后 dedupKey 相同）
- ✅ `addFeed('http://xkcd.com/feed')` 与 `addFeed('https://xkcd.com/feed')` → 两者均成功（协议不同，dedupKey 不同）
- ✅ OPML Merge 导入大小写不同的相同 URL → 跳过而非创建新 Feed
- ✅ OPML Replace 正确处理大小写差异（添加 + 删除一致，均基于 dedupKey）
- ✅ 数据库 UNIQUE 约束基于 `dedupKey` 列，与应用层判断一致
- ✅ 不同 endpoint（`/rss` vs `/atom`）不被误合并
- ✅ 查询参数不被规范掉（`?key=xxx` 保持原样）
- ✅ `feedURL` 保留用户输入的原始 URL，`dedupKey` 仅用于去重
- ✅ 所有路径不在日志中泄露原始 URL 中的敏感查询参数
