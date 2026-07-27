# Phase 2 — AI 标签 + Tag Agent 配置

## 目标

在浮动窗口中增加 AI 标签功能：调用当前配置的 AI Provider 生成标签候选列表，用户勾选后确认落库。在 Settings → AI 页面中增加 Tag Agent 配置区域，支持触发模式与确认模式的切换。

## 范围

| 包含 | 不包含 |
|---|---|
| AutoTagService（后端调用 Provider） | 标签列表页（Phase 3） |
| AI 标签候选列表生成与解析 | 文章列表标签 pill（Phase 3） |
| 候选标签用户确认 UI（勾选 + 确认） | 标签筛选（Phase 3） |
| Settings 页面 Tag Agent 配置 | |
| 触发模式（manual/auto）与确认模式（manual/auto） | |
| 设置项持久化 | |

## Tag Agent 配置项

在 **Settings → AI** 页面新增「标签生成（Tag Agent）」区域：

```
┌────────────────────────────────────────┐
│  Tag Agent                             │
│                                         │
│  触发方式                               │
│  ○ 手动触发  ○ 进入文章自动触发          │
│                                         │
│  确认方式                               │
│  ○ 手动确认  ○ 自动确认                 │
│                                         │
│  ┌──────────────┐                       │
│  │  max 候选数: 8 │                     │
│  └──────────────┘                       │
└────────────────────────────────────────┘
```

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `tagAgent.triggerMode` | `'manual' \| 'auto'` | `'manual'` | 手动：用户点击按钮才触发；自动：进入文章页时自动请求 |
| `tagAgent.confirmMode` | `'manual' \| 'auto'` | `'manual'` | 手动：AI 返回候选列表供勾选；自动：直接落库 |
| `tagAgent.maxCandidates` | `number` | `8` | AI 生成候选项上限 |

### 标签生成 Provider 配置

标签生成使用**独立的 Provider 路由**（不共享 Summary 或 Translation 的配置），在 `ai_provider_profile` 表中新增以下列（参见下方迁移）：

```
┌────────────────────────────────────────────┐
│  标签生成 Provider      （独立于总结/翻译）   │
│                                              │
│  Provider 类型                               │
│  [OpenAI          ▾]                         │
│                                              │
│  Provider 基础 URL                           │
│  [https://api.openai.com/v1          ]       │
│                                              │
│  标签模型                                     │
│  [gpt-5.4-mini                        ]      │
│                                              │
│  API Key                                     │
│  [••••••••••••••••••••••••••        ]       │
└──────────────────────────────────────────────┘
```

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `tagProviderPreset` | `ProviderKind` | `'openai'` | Tag 标签生成的 Provider 类型 |
| `tagBaseUrl` | `string` | OpenAI 默认 URL | Tag 的 Provider 基础 URL |
| `tagModel` | `string` | `'gpt-5.4-mini'` | Tag 标签生成专用的模型 ID |
| `tagApiKeyRef` | `string`（不透明引用） | `''` | Tag 的 API Key 引用 |

UI 复用 `ProviderSettings.tsx` 的字段模式（Provider 类型 select + URL 输入 + 模型输入 + API Key 密码框），但独立为一个 **「标签生成」** 的 `<fieldset>`（与「总结」「翻译」並列）。

不存在 Tag 路由时，AutoTagService 的 `generateCandidates` 应抛出一个明确的「未配置 Tag Provider」错误，指引用户前往设置页。

### 设置存储

Tag Agent 行为设置（triggerMode/confirmMode/maxCandidates）复用现有的 settings 机制（`005_create_settings` migration 已有 settings 表），通过现有 IPC 通道读写。Tag Provider 设置存入 `ai_provider_profile` 的新增列。

## AI 标签后端

### AutoTagService (`src/main/tags/AutoTagService.ts`)

```ts
class AutoTagService {
  constructor(
    private contentStore: ContentStore,
    private providerProfileStore: ProviderProfileStore,
    private secretStore: SecretStore,
    private providerRegistry: ProviderRegistry,
    private tagStore: TagStore,
  ) {}

  /**
   * 为 entry 生成标签候选列表（不持久化）
   * 返回候选标签名列表
   */
  async generateCandidates(entryId: number): Promise<string[]>;

  /**
   * 用户确认候选标签后，将勾选的标签落库
   */
  confirmTags(entryId: number, tagNames: string[]): Tag[];
}
```

### generateCandidates 流程

1. 从 `ContentStore` 读取 entry 的 cleaned markdown（取前 2000 字符作为摘要）
2. 从 `ProviderProfileStore.findActiveWithSecret()` 获取 **Tag 路由**的 Provider 配置：
   - `profile.tagProviderPreset` — Tag 的 Provider 类型
   - `profile.tagBaseUrl` — Tag 的 Provider 基础 URL
   - `profile.tagModel` — Tag 专用的模型 ID
   - `profile.tagApiKeyRef` → 通过 `SecretStore.read()` 获取 API Key
3. 调用 `ProviderRegistry.generateText()`，提示词：

```
你是一个文章标签生成助手。请为以下文章内容生成 {maxCandidates} 个以内的标签。

要求：
- 标签应准确反映文章的核心主题、领域或关键词
- 标签语言与文章语言一致
- 每个标签 1~4 个中文/英文词汇
- 返回 JSON 数组：["标签1", "标签2", ...]

文章内容：
{article_content}
```

4. 解析返回的 JSON，去重，限制数量
5. 返回 `string[]`（不包含已存在的标签）

### confirmTags 流程

逐标签调用 `TagStore.findOrCreate(name)` → `TagStore.tagEntry(entryId, tagId, 'auto')`

## UI 变化

### TagFloatingWindow 增强

Phase 1 的浮窗增加 AI 区域：

```
┌── Tag Floating Window ──────────────────┐
│                                          │
│  当前标签                                 │
│  [AI] [阅读]                              │
│                                          │
│  ┌─ AI 标签 ──────────────────────────┐  │
│  │  [✨ 生成标签]  ← AutoTagButton    │  │
│  │  ── loading 动画 ──               │  │
│  │  ☑ AI   ☑ 机器学习  ☐ 深度学习   │  │
│  │  [确认添加]                        │  │
│  └────────────────────────────────────┘  │
│                                          │
│  手动添加                                 │
│  ┌─ 输入标签名... ────┐                  │
│  └────────────────────┘                  │
└──────────────────────────────────────────┘
```

### AutoTagPanel (`src/renderer/features/tags/AutoTagPanel.tsx`)

| 状态 | 显示 |
|---|---|
| 初始 | [✨ 生成标签] 按钮 |
| loading | 按钮禁用 + 旋转动画 + "正在生成..." |
| 完成（手动确认模式） | 候选标签列表（checkbox + TagBadge）+ [确认添加] 按钮 |
| 完成（自动确认模式） | toast "已为本文添加 N 个标签" + 直接刷新标签列表 |
| 失败 | 按钮恢复 + 错误提示 "标签生成失败，请重试" |

### 自动触发逻辑（triggerMode = 'auto'）

在 EntryDetail 打开文章时（若无标签且已清洗）：
1. 自动调用 `tag:auto-tag-generate`
2. 若 confirmMode = 'auto'：直接落库，toast 提示
3. 若 confirmMode = 'manual'：浮窗自动打开并展示候选列表

## 新增 Migration

新增迁移 `024_add_tag_provider_route.ts`，在 `ai_provider_profile` 表中加入独立的 Tag 路由列：

```ts
/** Migration 024: add independent Tag generation Provider route. */
export const MIGRATION_024 = `
ALTER TABLE ai_provider_profile
ADD COLUMN tagProviderPreset TEXT NOT NULL DEFAULT 'openai' CHECK (
  tagProviderPreset IN (
    'openai',
    'anthropic',
    'deepseek',
    'gemini',
    'openrouter',
    'custom-openai-compatible'
  )
);

ALTER TABLE ai_provider_profile
ADD COLUMN tagBaseUrl TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_profile
ADD COLUMN tagModel TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_provider_profile
ADD COLUMN tagApiKeyRef TEXT NOT NULL DEFAULT '';

UPDATE ai_provider_profile
SET tagProviderPreset = 'openai',
    tagBaseUrl = baseUrl,
    tagModel = 'gpt-5.4-mini',
    tagApiKeyRef = '';
`;
```

初始值规则：
- `tagProviderPreset` 默认 `'openai'`
- `tagBaseUrl` 继承当前 Summary 路由的 `baseUrl`（用户可改）
- `tagModel` 默认 `'gpt-5.4-mini'`
- `tagApiKeyRef` 留空（用户必须手动填写 Tag 专用的 API Key）

## 新增 IPC

```ts
// Phase 2 新增
export const TAG_IPC_CHANNELS = {
  // ... Phase 1 channels ...
  autoTagGenerate: 'tag:auto-tag-generate',   // { entryId } → string[]
  autoTagConfirm:  'tag:auto-tag-confirm',     // { entryId, tagNames } → Tag[]
} as const;
```

Provider 管理复用已有的 `provider:*` IPC 通道（`provider:save` / `provider:get` / `provider:test`），但 `SaveProviderRequest` 需要扩展以支持第三个 Tag 路由：

```ts
export type SaveProviderRequest =
  | {
      summary: SaveProviderTaskRequest;
      translation: SaveProviderTaskRequest;
      tag: SaveProviderTaskRequest;     // ← 新增
    }
  | /* ... legacy compatibility shapes ... */;
```

## TODO（后续 Phase）

- **多选模式**：AutoTagPanel 需支持批量文章 AI 标签生成，AutoTagService 增加 `batchGenerateCandidates`。

## 受影响的文件清单

| 操作 | 文件 |
|---|---|
| **新建** | `src/main/tags/AutoTagService.ts` |
| **新建** | `src/renderer/features/tags/AutoTagPanel.tsx` |
| **改** | `src/shared/contracts/tag.ipc.ts`（新增 channel） |
| **改** | `src/main/tags/TagIpcHandler.ts`（新增 handler） |
| **改** | `src/main/services.ts`（注入依赖） |
| **改** | `src/preload/preload.ts`（暴露新 API） |
| **改** | `src/renderer/features/tags/TagFloatingWindow.tsx`（集成 AutoTagPanel） |
| **改** | `src/renderer/features/settings/AISettingsPage.tsx`（Tag Agent 配置区 + Tag Provider 配置区） |
| **改** | `src/renderer/features/summary/ProviderSettings.tsx`（新增「标签生成」fieldset） |
| **改** | `src/shared/contracts/provider.types.ts`（`SaveProviderRequest` 扩展 Tag 路由 + `ProviderProfile` 增加 Tag 字段） |
| **改** | `src/main/ai/stores/ProviderProfileStore.ts`（`ProviderProfileRow` + `toActiveProviderProfile` + `saveActive` 增加 Tag 字段） |
| **改** | `src/main/ai/services/ProviderService.ts`（`validateProviderRequest` + `save` 支持 Tag 路由） |
| **改** | `src/main/database/DatabaseManager.ts`（注册 Migration 024） |
| **新建** | `src/main/migrations/024_add_tag_provider_route.ts` |
| **改** | `database-schema.md`（更新 `ai_provider_profile` 表结构） |

## 验收标准（人工）

1. **手动触发 + 手动确认（默认）**：
   - 打开一篇文章 → 浮动窗口中点击「生成标签」按钮
   - 显示 loading → 候选标签以 checkbox 列表出现（每个有自动颜色）
   - 勾选 2~3 个 → 点击「确认添加」→ 标签出现在「当前标签」区域
   - source = 'auto'（视觉上用虚线边框区分 manual 标签）

2. **手动触发 + 自动确认**：
   - 在 Settings 切换确认模式为「自动确认」
   - 点击「生成标签」→ loading → 直接落库 → toast 提示 → 标签刷新

3. **自动触发 + 自动确认**：
   - 在 Settings 切换触发模式为「自动触发」
   - 打开一篇无标签的文章 → 静默生成 → toast 提示标签已添加

4. **Tag Provider 配置**：
   - 在 Settings → AI 页面的「模型服务」区域，可见新增的「标签生成」fieldset
   - 选择 Provider 类型、填写 URL、模型 ID 和 API Key → 保存成功
   - Tag 配置不干扰已有的 Summary 和 Translation 配置

5. **失败处理**：
   - Tag Provider 未配置 → 按钮灰色 + 提示「请先在 AI 设置中配置 Tag Provider」
   - API Key 错误 → 清晰的错误提示，不影响 Summary/Translation 功能

6. **设置持久化**：
   - 修改行为设置（triggerMode/confirmMode/maxCandidates）→ 关闭设置页 → 重新打开 → 设置值保持
   - 修改 Tag Provider 配置 → 保存后重新打开 → 配置值保持