# #24 项目整体代码结构梳理与重构 — 完成报告

> PR: [#24](https://github.com/qytlix/readability-multiplatform/issues/24)
> 分支: `qyt/refactor-main`
> 原则: **不新增功能、不改变交互和数据契约**

---

## 完成状态

### Step 1: 分离 `src/main/ipc.ts` — 服务初始化与 IPC 注册解耦 ✅
- 新建 `src/main/services.ts`：`FeedServices`/`SummaryServices` 接口、`initializeServices()`、模块级单例持有
- 修改 `src/main/ipc.ts`：删除服务创建代码，保留 `registerIpcHandlers()`、`isAuthorizedSender`、dialog handler
- 修改 `src/main/ipc/feed.handler.ts`：`FeedServices` 改为从 `../services` 导入
- 修改 `src/main/ipc/summary.handler.ts`：`SummaryServices` 改为从 `../services` 导入
- 修改 `src/main/main.ts`：从 `./services` 导入 `initializeServices`、`getSyncScheduler`、`getSummaryService`

### Step 2: 重组 `src/main/feed/` — 按职责分目录 ✅
- 创建子目录：`services/`、`stores/`、`fetcher/`、`parser/`
- 15 个文件按职责移入对应子目录
- 修正内部 8 处、外部消费方 ~20 处、测试 ~17 处导入路径

### Step 3: 重组 `src/main/ai/` — 按职责分目录 ✅
- 创建子目录：`services/`、`stores/`、`provider/`
- 9 个文件按职责移入对应子目录
- 修正内部 5 处、外部消费方 ~5 处、测试 ~6 处导入路径

### Step 4: 分离 `src/shared/ipc.ts` — 领域 API 类型与公共契约分离 ✅
- 新建 `src/shared/domain-api.ts`：提取 `FeedAPI`、`EntryAPI`、`ContentAPI`、`OPMLAPI`、`ExternalAPI`
- 修改 `src/shared/ipc.ts`：保留 `IPC_CHANNELS`、`PingResponse`、`ShaleAPI`，从 `./domain-api` 导入领域类型
- 无消费方需修改（领域 API 当前仅由 `ShaleAPI` 间接引用）

### Step 5: 重组测试文件 — 按模块分目录 ✅
- `tests/unit/` 从 20 个文件平铺 → 按 `feed/`(11)、`ai/`(4)、`shared/`(1)、`renderer/`(3)、`main/`(1) 分目录
- `tests/integration/` 本轮不重组（按计划记录为后续事项）

### Step 6: 统一各模块的公共 barrel export ✅
- 新增 `src/main/feed/services/index.ts`（被 3 个外部文件 import + 6 个文件）
- 新增 `src/main/feed/stores/index.ts`（被 4 个外部文件 import + 4 个文件）
- ai 模块内部导入路径较明确，暂不添加 barrel

### Step 7: 最终整体检查 ✅
详见下方验证结果。

---

## 最终目录结构

```
src/
  main/
    services.ts              ← 新建：服务初始化与依赖装配
    ipc.ts                   ← 精简：仅 IPC 注册 + isAuthorizedSender + dialog
    main.ts                  ← 应用入口
    application-menu.ts
    navigation-guards.ts
    page-zoom.ts
    ai/
      services/
        ProviderService.ts
        SummaryService.ts
      stores/
        ProviderProfileStore.ts
        SecretStore.ts
        SummaryStore.ts
      provider/
        MockSummaryProvider.ts
        OpenAICompatibleProvider.ts
        SummaryProvider.ts         ← 抽象基类
        SummaryPrompt.ts
    feed/
      services/
        ContentService.ts
        FeedService.ts
        OPMLExportService.ts
        OPMLImportService.ts
        SyncCoordinator.ts
        SyncScheduler.ts
        index.ts                   ← barrel export
      stores/
        ContentStore.ts
        EntryStore.ts
        FeedStore.ts
        SettingsStore.ts
        index.ts                   ← barrel export
      fetcher/
        ContentCleaner.ts
        ContentFetcher.ts
        FetchStrategy.ts
        MarkdownConverter.ts
      parser/
        FeedParserAdapter.ts
    ipc/
      feed.handler.ts
      summary.handler.ts
      external.handler.ts
    database/
      DatabaseManager.ts
    external/
      ExternalLinkService.ts
    migrations/                    ← 7 个迁移文件（不变）
  shared/
    ipc.ts                         ← 保留 IPC_CHANNELS + ShaleAPI
    domain-api.ts                  ← 新建：领域 API 接口
    contracts/                     ← 按领域拆分（不变）
    errors/                        ← feed.errors + summary.errors（不变）
    types/                         ← 类型定义（不变）
  preload/
    preload.ts                     ← 不变
  renderer/                        ← 本计划不修改
tests/
  unit/
    feed/          ← 11 个文件
    ai/            ← 4 个文件
    shared/        ← 1 个文件
    renderer/      ← 3 个文件
    main/          ← 1 个文件
  integration/     ← 8 个文件（平铺，后续事项）
  fixtures/        ← 不变
```

---

## Step 7 验证结果

### 自动化检查

| 检查项 | 结果 |
|--------|------|
| `npm run typecheck` | ✅ 通过（0 errors） |
| `npm run lint` | ✅ 通过（0 errors, 125 warnings，均为重构前已存在的 warning） |
| `npm test` | ✅ 全部通过（28 test files, 235 tests, 1.64s） |
| 循环依赖 (dpdm) | ⚠️ `ipc.ts → external.handler.ts` — **重构前已存在**，非本重构引入 |
| 循环依赖 (madge) | ✅ 无循环依赖 |
| 死 import / 残留旧路径 | ✅ 无残留旧路径文件 |
| Barrel exports | ✅ `feed/services/index.ts`、`feed/stores/index.ts` 正常 |

### 手工冒烟（待用户验证）

- [ ] 启动应用，确认窗口正常打开
- [ ] 添加一个 Feed，确认同步完成
- [ ] 阅读一篇文章，确认内容清洗和渲染正常
- [ ] 触发一次 AI Summary，确认流式响应正常

---

## 已知遗留事项（不在本轮范围）

1. **`tests/integration/` 目录重组** — 当前 8 个文件仍可管理，后续随测试增多再分类
2. **`ipc.ts ↔ external.handler.ts` 循环依赖** — 重构前已存在（`isAuthorizedSender` 跨文件引用），需在独立 PR 中修复
3. **`isAuthorizedSender` 重复** — `ipc.ts` 和 `feed.handler.ts` 中存在重复实现，handler 内版本有意保持局部独立
4. **`FetchStrategy.ts` 拆分** — 当前 17000+ 行，拆分属于逻辑重构，应在功能稳定后独立进行
5. **Renderer 相关** — 全部由子 Issue #23 负责

---

## 提交历史

| Commit | 描述 |
|--------|------|
| `1da30c5` | Step 1: 分离服务初始化与 IPC 注册 |
| `a141cab` | Step 2: 重组 src/main/feed/ |
| `3536082` | Step 2: 补充 commit convention 文档 |
| `4704847` | Step 3: 重组 src/main/ai/ |
| `d28003c` | Step 4: 分离领域 API 类型 |
| `6775595` | Step 5: 重组 tests/unit/ |
| `de7a580` | Step 6: 添加 barrel exports |
| `(current)` | Step 7: 最终整体检查 |