# #24 项目整体代码结构梳理与重构 — 执行计划

> 关联 Issue: [#24](https://github.com/qytlix/readability-multiplatform/issues/24)
> 分支: `qyt/refactor-main`  
> 原则: **不新增功能、不改变交互和数据契约**
> 范围: 仅涉及 Issue #24（整体重构统筹），不涉及子 Issue #23（Renderer 布局）

---

## 当前结构问题

```
src/
  main/
    ipc.ts           ← 200+ 行，混合服务初始化 + IPC 注册 + dialog handler
    main.ts          ← 应用入口
    ai/              ← 9 个文件平铺：Store + Service + Provider + Prompt 混在一起
    feed/            ← 15 个文件平铺：Service + Store + Parser + Cleaner + Fetcher + OPML
    ipc/             ← feed/summary/external handler（相对干净）
    database/        ← 只有 DatabaseManager.ts
    external/        ← 只有 ExternalLinkService.ts
    migrations/      ← 7 个迁移文件（OK）
  shared/
    ipc.ts           ← 同时定义 IPC_CHANNELS + ShaleAPI 类型 + 领域 API 接口
    contracts/       ← 按领域拆分（OK）
    errors/          ← feed.errors + summary.errors（OK）
    types/           ← 类型定义（OK）
  preload/           ← 干净（仅 preload.ts）
  renderer/          ← 本计划不修改
tests/
  unit/              ← 20 个文件全部平铺
  integration/       ← 8 个文件全部平铺
```

### 主要痛点

1. **`src/main/ipc.ts` 职责过载** — 同时处理 service 初始化、IPC 注册、dialog handler、`isAuthorizedSender`，超过 200 行；其中 `isAuthorizedSender` 逻辑在 `ipc/feed.handler.ts` 中存在重复
2. **`src/main/feed/` 目录膨胀** — 15 个文件，Store/Service/Fetcher/Cleaner/Parser/OPML 全部平铺，无子目录分层
3. **`src/main/ai/` 职责混杂** — 9 个文件，Store/Service/Provider 接口/Prompt 工具混在一起
4. **缺少模块内 `services/` / `stores/` 分层** — feed 和 ai 模块均没有按职责划分子目录
5. **`src/shared/ipc.ts` 混合类型与通道常量** — `IPC_CHANNELS`、`PingResponse`、`FeedAPI` 等领域 API 接口、`ShaleAPI` 聚合接口全部在同一文件
6. **测试文件扁平堆放** — `tests/unit/` 20 个文件、`tests/integration/` 8 个文件，无模块分类，随数量增长越来越难维护

---

## 执行步骤

---

### Step 1: 分离 `src/main/ipc.ts` — 服务初始化与 IPC 注册解耦

**变更规模：** ~3 个文件修改 + 1 个新文件

**问题：** `ipc.ts` 同时包含 `initializeServices()`（服务实例化、依赖装配）和 `registerIpcHandlers()`（IPC handler 注册、dialog handler），两者职责不同但耦合在同一文件。

此外，`FeedServices` 和 `SummaryServices` 接口目前分别定义在 `ipc/feed.handler.ts` 和 `ipc/summary.handler.ts` 中。若 `services.ts` 从 handler 文件导入这些类型，会形成 `services.ts → handler` 的依赖方向，而 `ipc.ts` 又需同时依赖 `services.ts`（取实例）和 handler（注册），造成隐式双向耦合。

**改动：**

- **新建 `src/main/services.ts`**：
  - 定义并导出 `FeedServices`、`SummaryServices` 接口（从 handler 文件中提取出来）
  - 包含 `initializeServices()` — 数据库初始化、迁移、所有 service/store 实例创建与装配
  - 包含 `getSyncScheduler()`、`getSummaryService()` — 应用生命周期清理所需的访问器
  - 管理模块级单例持有（`feedServices`、`summaryServices`、`syncScheduler`）

- **修改 `src/main/ipc.ts`**：
  - 删除 `initializeServices()` 及服务实例创建代码
  - 删除 `FeedServices`、`SummaryServices` 类型定义（改为从 `./services` 导入）
  - 保留 `registerIpcHandlers()`、`isAuthorizedSender`、dialog handler
  - `registerIpcHandlers()` 从 `./services` 导入模块级实例

- **修改 `src/main/ipc/feed.handler.ts`**：
  - 删除 `FeedServices` 接口定义，改为从 `../services` 导入

- **修改 `src/main/ipc/summary.handler.ts`**：
  - 删除 `SummaryServices` 接口定义，改为从 `../services` 导入

- **修改 `src/main/main.ts`**：
  - 从 `./services` 导入 `initializeServices`、`getSyncScheduler`、`getSummaryService`
  - 从 `./ipc` 导入 `registerIpcHandlers`

**已知不做：** `isAuthorizedSender` 在 `ipc.ts`（导出）和 `feed.handler.ts`（局部）中存在重复，但 handler 内的局部版本有意保持独立以避免循环依赖，本轮不合并。

**验证：** `npm run typecheck && npm run lint && npm test` 通过

---

### Step 2: 重组 `src/main/feed/` — 按职责分目录

**变更规模：** ~35 个文件修改（15 个源文件移动 + ~20 个消费方导入更新）

**当前平铺（15 个文件）：**
```
feed/
  ContentCleaner.ts       ← 清洗
  ContentFetcher.ts       ← 网络获取
  ContentService.ts       ← 业务服务
  ContentStore.ts         ← 持久化
  EntryStore.ts           ← 持久化
  FeedParserAdapter.ts    ← 解析
  FeedService.ts          ← 业务服务
  FeedStore.ts            ← 持久化
  FetchStrategy.ts        ← 网络获取（17000+ 行，最大文件）
  MarkdownConverter.ts    ← 转换
  OPMLExportService.ts    ← OPML 服务
  OPMLImportService.ts    ← OPML 服务
  SettingsStore.ts        ← 持久化
  SyncCoordinator.ts      ← 同步协调
  SyncScheduler.ts        ← 同步调度
```

**重组后：**
```
feed/
  services/               ← 业务流程与协调
    ContentService.ts
    FeedService.ts
    OPMLExportService.ts
    OPMLImportService.ts
    SyncCoordinator.ts
    SyncScheduler.ts
  stores/                 ← 持久化
    ContentStore.ts
    EntryStore.ts
    FeedStore.ts
    SettingsStore.ts
  fetcher/                ← 网络获取与内容清洗管线
    ContentCleaner.ts
    ContentFetcher.ts
    FetchStrategy.ts
    MarkdownConverter.ts
  parser/                 ← Feed 解析
    FeedParserAdapter.ts
```

> **关于 `MarkdownConverter.ts`：** 放入 `fetcher/` 的理由是它属于内容清洗管线的一环（HTML → Cleaned HTML → Markdown），与 `ContentCleaner` 紧密协作。若后续管线步骤增多，可进一步拆出 `pipeline/` 或 `utils/`。

> **关于 `SyncCoordinator` / `SyncScheduler`：** 两者属于同步编排/调度，放入 `services/` 符合当前规模。若未来同步逻辑膨胀，可拆出独立的 `sync/` 子目录。

#### Step 2a: 移动文件并修正模块内部导入

1. 创建子目录：`feed/services/`、`feed/stores/`、`feed/fetcher/`、`feed/parser/`
2. 按上表移动文件
3. 修正 **feed 模块内部的跨文件导入**（共 8 处），例如：
   - `ContentService.ts` 中 `./ContentStore` → `../stores/ContentStore`
   - `FeedService.ts` 中 `./FeedStore` → `../stores/FeedStore`
   - `SyncScheduler.ts` 中 `./FeedStore` → `../stores/FeedStore`
   - `ContentFetcher.ts` 中 `./FetchStrategy` → `./FetchStrategy`（同目录，不变）

**验证：** `npm run typecheck -- --noEmit` 确认 feed 模块内部无编译错误

#### Step 2b: 修正外部消费方的导入路径

涉及文件：
- `src/main/ipc.ts` — 10 个导入（`./feed/XService` → `./feed/services/XService` 等）
- `src/main/ipc/feed.handler.ts` — 9 个导入
- `src/main/ipc/summary.handler.ts` — 可能间接涉及（通过 ContentStore 等）

**验证：** `npm run typecheck && npm run lint` 通过

#### Step 2c: 修正测试文件导入路径

所有从 `../../src/main/feed/` 导入的测试文件需更新路径。预计影响：
- `tests/unit/` 中约 10 个文件（feed 相关测试）
- `tests/integration/` 中约 7 个文件（feed 相关集成测试）

**验证：** `npm test` 全部通过

---

### Step 3: 重组 `src/main/ai/` — 按职责分目录

**变更规模：** ~14 个文件修改（9 个源文件移动 + ~5 个消费方导入更新）

**当前平铺（9 个文件）：**
```
ai/
  MockSummaryProvider.ts       ← Mock Provider
  OpenAICompatibleProvider.ts  ← 真实 Provider
  ProviderProfileStore.ts      ← 持久化
  ProviderService.ts           ← 业务服务
  SecretStore.ts               ← 密钥持久化
  SummaryPrompt.ts             ← Prompt 构建
  SummaryProvider.ts           ← Provider 抽象接口
  SummaryService.ts            ← 业务服务
  SummaryStore.ts              ← 持久化
```

**重组后：**
```
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
    SummaryPrompt.ts           ← Prompt 构建工具
```

#### Step 3a: 移动文件并修正模块内部导入

ai 模块内部的跨文件导入共 5 处：
- `SummaryService.ts` 中 `./ProviderProfileStore` → `../stores/ProviderProfileStore` 等（5 个导入）
- `ProviderService.ts` 中 `./ProviderProfileStore` → `../stores/ProviderProfileStore` 等（3 个导入）
- `OpenAICompatibleProvider.ts` 中 `./SummaryProvider` → `./SummaryProvider`（同目录，不变）
- `MockSummaryProvider.ts` 中 `./SummaryProvider` → `./SummaryProvider`（同目录，不变）

**验证：** `npm run typecheck -- --noEmit` 确认 ai 模块内部无编译错误

#### Step 3b: 修正外部消费方导入

涉及文件：
- `src/main/ipc.ts`（或 `src/main/services.ts`）— 6 个导入
- `src/main/ipc/summary.handler.ts` — 2 个导入

**验证：** `npm run typecheck && npm run lint` 通过

#### Step 3c: 修正测试文件导入

影响：
- `tests/unit/` 中约 4 个文件（provider-service、secret-store、openai-compatible-provider、summary-prompt）
- `tests/integration/` 中约 2 个文件（summary-service、summary-store）

**验证：** `npm test` 全部通过

---

### Step 4: 分离 `src/shared/ipc.ts` — 领域 API 类型与公共契约分离

**变更规模：** ~4 个文件修改 + 1 个新文件

**当前：** `src/shared/ipc.ts`（92 行）同时包含：
- `IPC_CHANNELS` 常量
- `PingResponse` 类型
- `FeedAPI`、`EntryAPI`、`ContentAPI`、`OPMLAPI`、`ExternalAPI` 领域接口
- `ShaleAPI` 聚合接口

> 注：`ProviderAPI` 和 `SummaryAPI` 已在 `src/shared/contracts/summary.ipc.ts` 中定义，不在 `shared/ipc.ts` 内，不需移动。

**改动：**

- **新建 `src/shared/domain-api.ts`**：
  - 提取 `FeedAPI`、`EntryAPI`、`ContentAPI`、`OPMLAPI`、`ExternalAPI` 接口
  - 这些是 Renderer 视角的领域 API 形态，独立于通道常量和顶层聚合类型

- **修改 `src/shared/ipc.ts`**：
  - 保留 `IPC_CHANNELS`、`PingResponse`、`ShaleAPI`
  - `ShaleAPI` 中的领域字段从 `./domain-api` 导入类型
  - `ShaleAPI` 仍作为 Preload 暴露给 Renderer 的单一公共契约

- **消费方影响检查：**
  - `src/preload/preload.ts` — 导入 `IPC_CHANNELS`、`PingResponse`、`ShaleAPI`，路径不变
  - `src/renderer/global.d.ts` — 导入 `ShaleAPI`，路径不变
  - `src/main/ipc.ts` — 导入 `IPC_CHANNELS`、`PingResponse`，路径不变
  - **结论：无消费方需修改**（领域 API 接口当前仅由 `ShaleAPI` 间接引用）

**验证：** `npm run typecheck && npm run lint && npm test` 通过

---

### Step 5: 重组测试文件 — 按模块分目录

> **🚧 阻塞前提：** 执行本步骤前，必须手工通知 #23 负责人（@chaocyndrome）以下 3 个 Renderer 相关测试文件即将移动到 `tests/unit/renderer/`：
> - `paneLayout.test.ts`
> - `readerState.test.ts`
> - `readerHeaderVisibility.test.ts`
>
> 这些文件虽不在 `src/renderer/` 内，但归属于 Renderer 模块。#23 负责人有权知晓新路径，并在需要时调整其测试内容。
> **通知完成并获得确认后方可执行本步骤。**

**变更规模：** ~30 个文件移动 + 导入路径无需修改（测试通过绝对路径 `../../src/...` 导入源文件，不相互引用）

**当前：**
```
tests/
  unit/         ← 20 个文件全部平铺
  integration/  ← 8 个文件全部平铺
```

**测试文件按模块归属分类：**

| 测试文件 | 归属模块 | 目标目录 |
|----------|---------|----------|
| `FeedParserAdapter.test.ts` | feed | `tests/unit/feed/` |
| `content-fetcher.test.ts` | feed | `tests/unit/feed/` |
| `feed-service-ext.test.ts` | feed | `tests/unit/feed/` |
| `feed-store-ext.test.ts` | feed | `tests/unit/feed/` |
| `fetch-strategies.test.ts` | feed | `tests/unit/feed/` |
| `opml-import.test.ts` | feed | `tests/unit/feed/` |
| `opml-export.test.ts` | feed | `tests/unit/feed/` |
| `settings-store.test.ts` | feed | `tests/unit/feed/` |
| `sync-coordinator.test.ts` | feed | `tests/unit/feed/` |
| `sync-scheduler.test.ts` | feed | `tests/unit/feed/` |
| `ReadabilityPrototype.test.ts` | feed | `tests/unit/feed/` |
| `openai-compatible-provider.test.ts` | ai | `tests/unit/ai/` |
| `provider-service.test.ts` | ai | `tests/unit/ai/` |
| `secret-store.test.ts` | ai | `tests/unit/ai/` |
| `summary-prompt.test.ts` | ai | `tests/unit/ai/` |
| `external-links.test.ts` | shared | `tests/unit/shared/` |
| `paneLayout.test.ts` | renderer | `tests/unit/renderer/` |
| `readerState.test.ts` | renderer | `tests/unit/renderer/` |
| `readerHeaderVisibility.test.ts` | renderer | `tests/unit/renderer/` |
| `page-zoom.test.ts` | main | `tests/unit/main/` |

**改动后结构：**
```
tests/unit/
  feed/       ← 11 个文件
  ai/         ← 4 个文件
  shared/     ← 1 个文件
  renderer/   ← 3 个文件
  main/       ← 1 个文件
tests/integration/
  （本轮不重组，记录为后续事项）
```

> `tests/integration/`（8 个文件）本轮不重组，原因：集成测试涉及的跨模块依赖更复杂，当前规模仍可管理，在 Step 7 中记录为后续事项。

**vitest.config.ts** 当前 `include: ['tests/**/*.test.ts']` 使用 glob 匹配，目录重组后无需修改。

**仅移动不重写测试内容。**

**验证：** `npm test` 全部通过

---

### Step 6: 统一各模块的公共 barrel export

**变更规模：** 按需创建，约 3~5 个 `index.ts` 文件

在每个子目录（如 `feed/services/`、`ai/stores/`）中**按需**添加 `index.ts` barrel 文件。

**添加标准（满足任一即添加）：**
1. 该目录被 **3 个及以上外部文件** import（如 `feed/stores/` 被 `ipc.ts`、`feed.handler.ts`、多个 service 同时导入）
2. 目录内文件数量 **≥ 4 个**，外部消费方需要分别导入多个成员（如 `ai/provider/`）

**不添加 barrel 的情形：**
- 目录仅被 1~2 个文件消费（如 `feed/parser/` 仅 `FeedService.ts` 使用）
- 目录内文件间无公共导出关联

> barrel 会改变模块解析路径，可能意外引入循环依赖或破坏 tree-shaking。本轮仅对明确受益的目录添加，不对全部目录强制创建。

**验证：** `npm run typecheck && npm run lint && npm test` 通过

---

### Step 7: 最终整体检查

**自动化检查：**

- [ ] `npm run typecheck` 通过 — 确认无类型错误
- [ ] `npm run lint` 通过 — 确认代码风格一致
- [ ] `npm test` 全部通过 — 确认无回归

**结构健康检查：**

- [ ] 循环依赖检测：`npx dpdm --circular --no-tree --no-warning src/main/services.ts src/main/ipc.ts`
  - 重点检查 `services.ts ↔ ipc.ts`、`services/ ↔ stores/`、barrel 文件
  - 若无 `dpdm`，替代方案：`npx madge --circular src/`
- [ ] 死 import / 未使用导出检查：`npx ts-prune` 或手动检查编译器未报告 `import` 残留
  - 重点关注移动文件后残留的旧路径引用

**手工冒烟：**

- [ ] 启动应用，确认窗口正常打开
- [ ] 添加一个 Feed，确认同步完成
- [ ] 阅读一篇文章，确认内容清洗和渲染正常
- [ ] （可选）触发一次 AI Summary，确认流式响应正常

**文档更新：**

- [ ] 在 PR 描述中记录主要重构内容、目录变更对照表
- [ ] 记录 `tests/integration/` 重组为后续事项
- [ ] 标注 Breaking Changes：**无**

---

## 范围界定

| 范围 | 包含 | 不包含 |
|---|---|---|
| `src/main/` | 目录重组、文件拆分、import 修正、类型提取 | 逻辑变更、性能优化、API 行为修改 |
| `src/shared/` | 领域 API 类型分离到独立文件 | 修改 IPC 通道名或消息格式、Contract 变更 |
| `src/preload/` | import 路径修正（如有需要） | 修改暴露的 API 或 `ShaleAPI` 结构 |
| `src/renderer/` | — | 不修改任何文件（由 #23 负责） |
| `tests/` | `unit/` 文件重新组织 | 新增或修改测试用例；`integration/` 本轮不重组 |
| 功能 | — | 不改交互、数据契约、IPC 契约、CSS 布局 |

---

## 变更规模总览

| 步骤 | 新增文件 | 修改文件 | 移动文件 | 测试影响 |
|------|---------|---------|---------|---------|
| Step 1 | 1 (`services.ts`) | 4 | 0 | 间接（import 路径） |
| Step 2a | 0 | 8（内部导入） | 15 | — |
| Step 2b | 0 | ~3 | 0 | — |
| Step 2c | 0 | ~17 | 0 | 更新导入路径 |
| Step 3a | 0 | 5（内部导入） | 9 | — |
| Step 3b | 0 | ~3 | 0 | — |
| Step 3c | 0 | ~6 | 0 | 更新导入路径 |
| Step 4 | 1 (`domain-api.ts`) | 1 | 0 | 无影响 |
| Step 5 | 0 | 0 | 20 | 仅移动 |
| Step 6 | ~4 (`index.ts`) | 0 | 0 | 无影响 |
| Step 7 | 0 | 0 | 0 | 验证 |

---

## 风险与缓解

| 风险 | 概率 | 缓解措施 |
|---|---|---|
| import 路径遗漏导致构建失败 | 中 | 每个 Step 及其子步骤后执行 `typecheck` + `lint` + `test`，不累积至下一步 |
| 内部导入更新遗漏（同模块文件相互引用） | 中 | Step 2a/3a 先独立验证模块内部 `typecheck`，再进入 2b/3b 修改外部消费方 |
| 多人并行修改同一文件 | 低 | PR 建立后在该分支独立工作，合并前 `git rebase main` |
| 重构后测试覆盖率下降 | 低 | 只移动文件或更新导入，不删除测试、不修改测试断言 |
| barrel export 引入循环依赖 | 低 | Step 6 按明确标准添加，Step 7 使用 `dpdm`/`madge` 检测 |
| `services.ts` 与 handler 形成隐式双向依赖 | 低 | Step 1 将 `FeedServices`/`SummaryServices` 类型提取到 `services.ts`，handler 单向导入 |
| 测试移动后 vitest glob 不再匹配 | 极低 | 当前 `include: ['tests/**/*.test.ts']` 为递归 glob，目录重组无影响 |
| 未通知 #23 负责人即移动 Renderer 测试文件，越过协作边界 | 高（若跳过） | Step 5 设为阻塞步骤，须手工确认通知完成后方可执行 |

---

## 提交约定

每个 Step 完成后提交，commit message 格式统一为：

```
refactor(#24): <变更摘要> (step N)
```

示例：

- `refactor: separate service initialization from IPC registration (step 1)`
- `refactor(#24): reorganize src/main/feed/ into subdirectories by responsibility (step 2)`

约定：
- 首行前缀固定为 `refactor(#24):`（引用 #24 Issue）
- 末尾用 `(step N)` 标记步骤序号
- body 列出具体变更项、涉及文件数量和验证结果
- 不与 Step 外的工作混杂

---

## 不在本轮范围（记录为后续事项）

1. **`tests/integration/` 目录重组** — 当前 8 个文件仍可管理，后续随测试增多再分类
2. **`isAuthorizedSender` 重复** — `ipc.ts` 和 `feed.handler.ts` 中存在重复实现，handler 内版本有意保持局部独立，合并需评估安全性
3. **`FetchStrategy.ts` 拆分** — 当前 17000+ 行，但拆分属于逻辑重构而非结构调整，应在功能稳定后独立进行
4. **Renderer 相关** — 全部由子 Issue #23 负责
