# Advanced Translation 交接文档

> 最后更新：2026-07-25  
> 当前分支：`cyj-translation-advanced`  
> 跟踪 Issue：<https://github.com/qytlix/readability-multiplatform/issues/60>  
> 当前阶段：AT-M3、AT-M4 与 AT-M5 已完成代码和自动化验证，状态为 `Review`；下一实现阶段是 AT-M6。

## 1. 接手前必须阅读

按以下顺序阅读，并继续遵守其中的工程边界：

1. `AGENTS.md`
2. `INIT.md`
3. `PLAN.md`
4. GitHub Issue #60
5. `docs/adr/001-advanced-translation-boundaries.md`
6. `docs/ai/translation-advanced.md`
7. `docs/ai/translation-advanced-resources.md`
8. `docs/ai/translation-p0.md`

不要跳过当前工作树检查。仓库中已有大量未提交修改，且暂存区和工作区混合存在。

## 2. Git 与工作树状态

- 分支：`cyj-translation-advanced`
- 当前没有由本轮 AI 创建的 commit、push 或 PR。
- M1/M2 的不少文件已经在暂存区。
- M3 改动主要仍在工作区或为 untracked 文件。
- `MM` 表示同一文件同时包含已暂存的早期改动和未暂存的 M3 改动。
- 不要运行 `git reset --hard`、`git checkout --`、全量还原或其他会覆盖用户改动的命令。
- 未经用户要求，不要擅自改变当前暂存状态。

接手后首先执行：

```powershell
git branch --show-current
git status --short
git diff --check
```

如果准备提交，必须先区分 M1/M2 已暂存内容与 M3/M4 新内容，确认用户希望采用一个累计提交还是按 milestone 拆分。

## 3. Milestone 状态

| Milestone | 状态 | 已交付内容 |
|---|---|---|
| AT-M0 | Done | 契约、ADR、资源快照、Fixture 和实施边界 |
| AT-M1 | Done | Provider 抽象；OpenAI、DeepSeek、OpenRouter、Anthropic、Gemini |
| AT-M2 | Done | `auto + 8` 源语言、8 个目标语言、香港繁体、迁移与 Fixture |
| AT-M3 | Review | 智能上下文、29 个内置专家、用户 YAML 专家、设置和缓存 |
| AT-M4 | Review | 34 个内置库、逐库开关、用户 CSV 事务导入 |
| AT-M5 | Review | 单词/短语/句子结构化结果、源语言发音、多义项、上下文释义、专家/术语和主动取消 |
| AT-M6 | Backlog | 集成、迁移、安全、双平台和发布加固 |

除非用户明确改变顺序，下一步从 AT-M6 开始。

## 4. M1：Provider 抽象

已完成：

- 使用中性的 `TextGenerationProvider`，不再让 Translation 依赖 Summary 命名的端口。
- 支持 Provider：
  - OpenAI
  - DeepSeek
  - OpenRouter
  - Anthropic
  - Gemini
  - 自定义 OpenAI-compatible
- `ProviderRegistry` 根据配置解析协议适配器。
- migration 012 扩展 Provider profile，同时保留旧 profile ID、密钥引用和外键。
- Provider 设置页支持 preset 默认值和自定义模型 ID。
- 原生协议请求、SSE、错误、超时、取消和连接测试均使用 Mock，不消耗真实 Key。

关键文件：

- `src/main/ai/provider/TextGenerationProvider.ts`
- `src/main/ai/provider/ProviderRegistry.ts`
- `src/main/ai/provider/ProviderTransport.ts`
- `src/main/ai/provider/OpenAICompatibleProvider.ts`
- `src/main/ai/provider/AnthropicProvider.ts`
- `src/main/ai/provider/GeminiProvider.ts`
- `src/main/migrations/012_expand_ai_providers.ts`

## 5. M2：八语言双向翻译

支持：

- 自动检测：`auto`
- English：`en`
- 简体中文：`zh-CN`
- 繁体中文（香港）：`zh-HK`
- 日语：`ja`
- 韩语：`ko`
- 德语：`de`
- 法语：`fr`
- 西班牙语：`es`

已完成：

- source/target 从设置页经过 typed Preload/IPC 进入 Main。
- migration 013 扩展 Translation language CHECK，同时保留父结果、segment ID 和外键。
- `zh-HK` 提示词明确要求香港词汇和书写习惯，不默认使用台湾国语。
- 高置信度脚本才会短路；含混拉丁文本和繁体中文仍交给 Provider。
- 八份固定离线 HTML Fixture 已加入 `tests/fixtures/translation/`。
- 当前旧 AGROVOC 术语库只服务其现有语言范围；其他语言的完整术语库属于 M4。

关键文件：

- `src/shared/contracts/translation.types.ts`
- `src/main/ai/provider/TranslationLanguage.ts`
- `src/main/ai/provider/TranslationPrompt.ts`
- `src/main/migrations/013_expand_translation_languages.ts`
- `src/renderer/features/settings/aiPreferences.ts`
- `src/renderer/features/settings/AISettingsPage.tsx`

## 6. M3：智能上下文

实现文件：

- `src/shared/contracts/translation-context.types.ts`
- `src/main/ai/services/TranslationContextService.ts`
- `src/main/ai/stores/TranslationContextStore.ts`
- `src/main/migrations/014_add_translation_context_and_experts.ts`

行为：

- 设置项 `useSmartContext` 默认 `false`。
- 启用后，翻译前先分析文章主题、关键术语和风格。
- 短文章使用一次分析请求。
- 长文章按 6,000 字符分块，最多 8 块，然后执行一次 merge。
- 成功上下文按以下身份缓存：
  - source content hash
  - source/target language
  - Provider profile ID
  - Provider model
  - expert ID
  - expert content hash
  - context prompt version
- 上下文超时、非法 JSON 或 Provider 错误不会让普通翻译失败。
- 降级时持久化 `TRANSLATION_CONTEXT_UNAVAILABLE`，Reader 显示非致命警告。
- 用户主动取消仍会中断整个 Translation。
- 文章内容按不可信输入隔离，不能改变上下文 JSON 契约。

已知边界：

- 当前只分析文章文本的前 `48,000` 个字符，即 `8 × 6,000`。AT-M3 Review 时应确认这是否满足“全文理解”；如需覆盖超长文章，可在不放大请求上限的前提下改为全篇代表性采样或分层摘要。
- 上下文总超时为 45 秒，覆盖所有 chunk 和 merge。
- 智能上下文会增加模型调用次数，设置页已明确提示。

## 7. M3：AI 专家

上游固定为：

- 仓库：<https://github.com/immersive-translate/prompts>
- commit：`94d6522081902fce6cbe07418c402b3a5ade99ca`
- 数量：29

资源：

- `resources/ai-experts/experts.json`
- 当前 artifact 为 29 个唯一 ID。
- 每个专家记录 source SHA-256、compiled SHA-256、来源文件和编译警告。
- 应用启动时只读取本地 artifact，不在运行时访问上游。

构建：

```powershell
npm run build:experts
```

也可使用已经 checkout 到固定 commit 的本地仓库：

```powershell
npm run build:experts -- --source=C:\path\to\prompts
```

构建脚本：

- `scripts/build-ai-experts.mjs`
- 会 clone 固定 commit。
- 必须恰好编译出 29 个专家。
- 重复 ID、缺失 prompt 或安全清洗后没有可用 instruction 会直接失败。

运行时：

- `src/main/ai/experts/ExpertCompiler.ts`
- `src/main/ai/stores/TranslationExpertStore.ts`
- `src/main/ai/services/TranslationExpertService.ts`
- `src/shared/contracts/translation-expert.types.ts`
- `src/shared/contracts/translation-expert.ipc.ts`

用户 YAML 专家：

- 支持 `.yml` 和 `.yaml`。
- 必填：`id`、`version`、`name`、`instruction`/`systemPrompt`/`multipleSystemPrompt`。
- 支持变量：
  - `{{sourceLanguage}}`
  - `{{targetLanguage}}`
- 限制：
  - YAML 最多 100,000 字符
  - instruction 最多 20,000 字符
  - 嵌套深度最多 10
  - 禁止 aliases
  - 禁止 custom tags
  - 禁止危险 mapping key
  - `env` 仅允许 string value
  - 未知变量会导致 preview 失败
- 内置专家不可覆盖或删除。
- 用户专家同 ID 更新必须显式确认 `replace`。
- 导入先 preview，校验成功后事务写入 SQLite。
- 设置页提供格式说明、示例、预览、导入、替换确认和删除。

提示词优先级：

1. Shale 的安全和 source isolation
2. Shale 的 HTML 保真和 NDJSON 输出契约
3. 用户选择的专家 domain/style instruction
4. 智能上下文
5. 术语候选
6. 不可信文章内容

专家不能覆盖前置的安全、HTML 或输出格式规则。

## 8. 数据库与缓存

当前最新迁移：

- 012：Provider presets/protocol
- 013：多语言 Translation
- 014：用户专家、上下文缓存和 Translation context/expert identity
- 015：术语库开关、用户库和用户条目

migration 014 新增：

- `translation_expert_user`
- `translation_context_cache`
- `translation_result.expertId`
- `translation_result.expertContentHash`
- `translation_result.smartContextEnabled`
- `translation_result.contextPromptVersion`
- context warning 字段

Translation 兼容缓存现在必须同时匹配：

- entry/source/target
- source content hash
- segmenter version
- Translation prompt version
- terminology pack version
- expert ID/content hash
- smart-context enable state
- context prompt version

不要在 Renderer 写 SQL，也不要绕过 migration 修改 schema。

## 9. IPC 与 Renderer

新增专家 IPC：

- `expert:list`
- `expert:preview`
- `expert:import`
- `expert:remove`

Renderer 只通过 `window.shaleAPI.expert` 使用这些能力，未暴露任意文件系统或完整 `ipcRenderer`。

设置页：

- 智能上下文默认关闭。
- 专家默认 `none`。
- 可以查看专家详情和编译警告。
- 上传文件使用浏览器 `File.text()`，YAML 内容通过 typed IPC 交给 Main 校验。

整篇翻译：

- `TranslationPanel` 请求携带 `expertId` 和 `useSmartContext`。
- 结果可显示 `contextWarning`。
- inline Translation 已接入当前专家、冻结的术语候选和受限段落上下文。
- 选区、偏好、卡片或应用生命周期结束请求时，通过
  `translation:inline-cancel` 中止 Main 中的 Provider 工作。

## 10. 自动化验证

最后一次完整验证结果：

```text
npm run typecheck
  通过

npm test
  88 test files passed
  658 tests passed

npm run lint
  0 errors
  120 warnings

git diff --check
  通过
```

120 条 Lint warning 是仓库已有问题，本次 M3/M4 没有新增 Lint error 或 warning。

重点测试：

- `tests/unit/ai/translation-expert.test.ts`
- `tests/unit/ai/translation-context.test.ts`
- `tests/integration/translation-service.test.ts`
- `tests/integration/translation-store.test.ts`
- `tests/integration/translation-language-migration.test.ts`
- `tests/unit/translation-prompt.test.ts`
- `tests/unit/ai-preferences.test.ts`
- `tests/unit/ai/terminology-csv.test.ts`
- `tests/integration/terminology-store.test.ts`
- `tests/integration/terminology-library-migration.test.ts`

测试覆盖：

- 29 个固定专家和 artifact 完整性
- YAML tag/alias/变量/env/替换/删除
- context cache、长文 chunk/merge、非法输出和取消
- context 失败后继续 Translation
- expert/context prompt composition
- expert hash 和 context identity 缓存失效
- migration 014 保留旧 Translation 数据
- 34 个内置术语库与首次启用状态
- CSV quoting/行号错误/duplicate/conflict/事务导入
- 用户/语言/内置优先级、启用状态重启恢复和 deterministic cache hash
- migration 015 用户库、条目和开关表
- word/phrase/sentence 严格结构、英语多义词双上下文、Pinyin/Kana Fixture
- 非 JSON/嵌套结构错误、专家/术语快照组合和主动取消

## 11. 尚未完成的人工验证

AT-M3～AT-M5 仍为 `Review`，需要人类完成：

- Windows 11 设置页实际交互
- 原生 Wayland 设置页实际交互
- 上传、替换、删除用户专家
- 选择内置专家后的真实翻译质量
- 智能上下文的成本和等待状态是否清晰
- 使用真实 OpenAI/Anthropic/DeepSeek/Gemini/OpenRouter 的按需测试
- 超长文章的 48,000 字符边界是否可接受
- Windows 11 与原生 Wayland 的 34 库列表、逐库开关和重启恢复
- 用户 CSV preview、替换、删除及格式帮助页实际交互
- `zh-TW` 参考条目用于 `zh-HK` 时的香港用语质量
- Windows 11 与原生 Wayland 的 word/phrase/sentence 卡片位置、滚动和快捷键交互
- 选区变化、关闭卡片、切换语言/专家/术语设置时，待处理划词请求确实停止
- English IPA、简体中文 Pinyin、香港中文 Jyutping、日语假名与韩语罗马字质量
- 使用真实 Provider 验证多义词上下文、严格 JSON 遵循和结构错误提示

Electron Forge 打包情况：

- `npm run ensure:native` 通过。
- 直接运行 `npm run package` 仍因 GitHub `20.205.243.166:443` 超时失败。
- 仅对该次命令设置
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后 Windows x64
  打包通过。
- 输出包内 `terminology-libraries.sqlite` 与源码资源 SHA-256 完全一致：
  `7b312d935eb464e22ead4e54becb7ac514a94295fd51164e6f9722a996bc2f43`。

依赖情况：

- M3 新增 runtime dependency：`yaml@2.9.0`。
- 安装时 npm 报告 31 个依赖漏洞（3 low、1 moderate、26 high、1 critical）；本次未运行自动修复，因为依赖升级不在 M3 范围，且可能影响 Electron 构建。后续应单独审计。

## 12. 已完成：AT-M4 多术语库

目标：

- 把沉浸式翻译当前使用的术语库编译进项目。
- 首次安装仅启用 `builtin:default`。
- 其他内置术语库默认关闭，可由用户逐库开关。
- 支持用户上传规范 CSV 创建术语库。
- “新建术语库”页面必须先展示格式说明和示例。
- 运行时离线，不请求上游资源。

已冻结的上游资源和 34 个 catalog 条目见：

- `docs/ai/translation-advanced-resources.md`

必须保持的决策：

- 当前 AGROVOC 数据迁入 `builtin:default`，不能丢失已有默认行为。
- 所有 built-in 资源在 build time 固定并记录 hash。
- `zh-TW` 上游术语只能作为 `zh-HK` 的最低优先级繁体参考，UI 要说明其不是香港原生词库。
- 用户 `zh-HK` 或内置原生 `zh-HK` 条目优先于 `zh-TW` fallback。
- 空 target 表示保留 source 原文。
- 导入失败或取消不能留下半个 library。
- enabled state 必须持久化并在重启后恢复。
- Translation 缓存身份必须包含启用术语库集合的确定性内容 hash。

建议实施顺序：

1. 复核当前 `TerminologyStore`、旧 `terminology.sqlite` 和 M4 Gate。
2. 设计 shared library/entry/provenance/import-preview contracts。
3. 新增 migration 015 和 Store，迁移当前 AGROVOC 为 `builtin:default`。
4. 编写固定上游资源构建脚本，下载并规范化全部 34 个 catalog 条目。
5. 实现多语言 lookup、启用状态、优先级、冲突和 deterministic cache hash。
6. 增加 terminology IPC、Preload API 和 Settings 逐库开关。
7. 实现用户 CSV preview/transactional import/remove。
8. 实现“新建术语库”格式教学页和可复制示例。
9. 增加 migration、Store、CSV parser、precedence、restart 和 Translation cache 测试。
10. 完整运行 typecheck/test/lint/diff check，更新 `PLAN.md`、`AGENTS.md` 和 Translation 文档，把 M4 置为 `Review`。

完成记录：

- migration 015、typed terminology IPC/Preload、设置页逐库开关已完成；
- 34 个 catalog 库和 4,521 条上游条目已固定到离线 SQLite，AGROVOC
  41,632 个 concept 保留在 `builtin:default`；
- 首装仅默认库开启，用户库优先，`zh-TW` 只作为 `zh-HK` 最低优先级参考；
- 用户 CSV 提供教学、preview、行号错误、冲突 warning、事务导入/替换和删除；
- 启用集合 deterministic hash 已进入 Translation 缓存身份，并冻结活动 run
  的术语快照；
- AT-M5 未回退 M4 的离线、缓存、安全和 typed IPC 边界；AT-M6 继续保持。

用户 CSV 规范：

```csv
source,target,tgt_lng
Large language model,大语言模型,zh-CN
colour,color,en
Shale,,
"term, with comma","译文，含逗号",zh-CN
```

规则：

- 第一行必须恰好是 `source,target,tgt_lng`。
- UTF-8、RFC 4180 quoting。
- `source` 必填。
- 空 `target` 表示保留原文。
- 空 `tgt_lng` 对所有目标语言生效。
- `tgt_lng` 只能是项目支持的八个 target code。
- malformed quoting、空 source、非法语言和超长字段必须给出行号错误。
- duplicate/conflict 在 commit 前作为 warning 展示。

## 13. 已完成：AT-M5 划词翻译升级

结果契约：

- `inputKind` 严格为 `word | phrase | sentence`；
- `detectedSourceLanguage` 必须是八个受支持语言之一；
- `translation` 必须是非空字符串；
- 发音由 `pronunciation` 与 `pronunciationSystem` 成对出现；
- `senses[]` 按词性分组，包含 definitions、可选 contextualMeaning 和例句；
- sentence 必须返回空 senses，且 Reader 不渲染空词典区；
- 非 JSON、错误嵌套类型、语言冲突、发音体系冲突和 sentence 夹带词典字段都会显式失败。

发音体系：

- English、Deutsch、Français、Español：IPA；
- 简体中文：Pinyin；
- 香港中文：Jyutping；
- 日本語：Kana；
- 한국어：Revised Romanization。

运行时与边界：

- 划词仍为 one-shot、非持久化结果，没有新增 migration；
- 当前专家通过受限 expert compiler 渲染，不能覆盖 Shale 安全和 JSON 契约；
- 当前启用术语库集合的 hash 在请求开始时冻结，lookup 使用同一快照；
- 选中段落 context 最多 4,000 字符，并按不可信内容隔离；
- 新增 typed `translation:inline-cancel`，Renderer 不接触任意 IPC；
- 新请求、选区变化、关闭卡片、偏好变化、组件卸载和应用退出都会中止待处理工作；
- Provider 输出上限仍为 12,000 字符。

关键文件：

- `src/shared/contracts/translation.types.ts`
- `src/shared/contracts/translation.ipc.ts`
- `src/main/ai/services/InlineTranslationService.ts`
- `src/main/ipc/translation.handler.ts`
- `src/preload/preload.ts`
- `src/renderer/features/translation/InlineTranslationOverlay.tsx`
- `tests/fixtures/translation/inline-translation-cases.json`
- `tests/unit/inline-translation.test.ts`
- `tests/unit/inline-translation-target.test.ts`

自动化结果：

- `npm run typecheck` 通过；
- `npm test`：88 个文件、658 项测试通过；
- `npm run lint`：0 error、120 条既有 warning；
- M5 没有新增依赖、Schema、持久化缓存或敏感日志。

## 14. 不要做的事情

- 不要在 M4 顺便实现 M5 划词翻译。
- 不要运行时从沉浸式翻译服务器更新专家或术语。
- 不要把 API Key、Authorization Header、全文或用户 YAML 写入日志。
- 不要让 Renderer 直接访问 Node、SQLite、文件系统或密钥。
- 不要让专家、上下文或术语覆盖 Shale 的安全和输出格式契约。
- 不要删除或重建用户数据库来规避 migration。
- 不要自动执行 `npm audit fix`。
- 不要覆盖当前混合 staged/unstaged 工作树。

## 15. 完成 M4 时的交付格式

最终汇报至少包含：

- 完成的用户功能
- Schema/IPC/缓存身份变化
- 上游术语资源 commit/hash/数量
- 默认启用状态
- CSV 导入安全和事务行为
- 自动化验证结果
- 仍需人工验证的项目
- 文档状态
- 是否执行了 stage/commit/push
