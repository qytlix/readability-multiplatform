# Advanced Translation implementation plan

- Tracking issue: https://github.com/qytlix/readability-multiplatform/issues/60
- Branch: `cyj-translation-advanced`
- Owner: AI / Translation
- Baseline date: 2026-07-24
- Contract ADR: `docs/adr/001-advanced-translation-boundaries.md`
- Resource inventory: `docs/ai/translation-advanced-resources.md`

## Goal

Extend the existing P0 Translation pipeline without weakening Reader structure,
offline result recovery, typed IPC, secret isolation, or deterministic segment
persistence.

The completed feature supports:

- automatic or manual source selection and eight translation targets;
- OpenAI, Anthropic, DeepSeek, Gemini, OpenRouter, and custom
  OpenAI-compatible profiles;
- optional document-level context analysis;
- built-in and user-imported AI experts;
- selectable built-in and user-imported terminology libraries;
- contextual word, phrase, and sentence lookup.

## Scope boundaries

In scope:

- Main-only provider access and adapter-specific streaming;
- shared language/provider/expert/terminology contracts;
- SQLite migrations and cache compatibility;
- Settings, Reader Translation, and inline Translation UI;
- pinned local expert and terminology resources;
- automated mock-provider tests and manual Windows/Wayland verification.

Out of scope:

- automatic provider failover;
- cloud synchronization of experts or terminology libraries;
- background runtime updates from Immersive Translate servers;
- subtitle or video translation;
- arbitrary code, network calls, or file access from imported YAML;
- making source-language detection a separately persisted article classifier.

## Fixture baseline

Implementation Issues create the following fixed, offline fixtures. Their
identities and purposes are frozen in M0 so adapters and UI tests use the same
inputs:

| Fixture | Required characteristics |
|---|---|
| `translation-en.html` | headings, paragraphs, terminology, link, inline style |
| `translation-zh-CN.html` | Simplified Chinese and mixed Latin product names |
| `translation-zh-HK.html` | Hong Kong wording distinct from Taiwan usage |
| `translation-ja.html` | Kanji, kana, name, and reading-sensitive word |
| `translation-ko.html` | Hangul, loanword, and proper noun |
| `translation-de.html` | compounds, noun capitalization, and quoted text |
| `translation-fr.html` | elision, accents, and punctuation spacing |
| `translation-es.html` | accents and inverted punctuation |
| `translation-mixed.html` | code, URLs, numbers, and multiple languages |
| `translation-long.md` | deterministic context map/reduce chunks |

Provider fixtures cover successful split SSE, unknown/keepalive events,
authentication failure, rate limit, malformed JSON, and error after partial
content for every protocol adapter. Inline fixtures cover a word, polysemous
word in two contexts, phrase, sentence, and prompt-injection-shaped source text.

## Milestones

### M0: Contracts, resource baseline, and issue split

Status: Done

Deliverables:

- Issue #60 confirmed as the initiative Epic;
- language, provider, prompt composition, context, expert, terminology, inline
  result, cache, and migration decisions recorded in ADR-001;
- upstream expert and terminology snapshots inventoried;
- the shared offline fixture matrix is frozen;
- implementation milestones and verification gates recorded here and in
  `PLAN.md`;
- no feature code or schema changes.

Review gate:

- Product/Reader confirms language selection and default terminology behavior;
- shared IPC owner confirms Preload and event boundaries;
- SQLite owner confirms migration and cache identity direction;
- AI owner confirms provider adapter and prompt composition boundaries.

### M1: Provider abstraction and five provider presets

Status: Done

Estimated effort: 4–6 ideal days.

Candidate Issues:

1. Replace the Summary-named provider port with a neutral text-generation port.
2. Add provider preset/protocol contracts and migrate legacy profiles.
3. Harden the shared OpenAI Chat Completions adapter for OpenAI, DeepSeek, and
   OpenRouter, including in-stream errors.
4. Implement Anthropic Messages request and SSE parsing.
5. Implement Gemini GenerateContent request and SSE parsing.
6. Update Provider Settings, connection tests, error mapping, and mock fixtures.

Gate:

- adapter request URL/header/body and split-chunk streams are covered;
- timeout, abort, unknown events, malformed events, and mid-stream errors are
  covered;
- Summary, Translation, context, and inline consumers resolve the same active
  adapter;
- no real API key is required by CI.

Completion record (2026-07-24):

- the neutral `TextGenerationProvider` port is used by Summary, full-article
  Translation, and inline Translation;
- `ProviderRegistry` resolves OpenAI, DeepSeek, OpenRouter, Anthropic, Gemini,
  and custom OpenAI-compatible profiles to three protocol adapters;
- migration 012 preserves legacy profile IDs, encrypted-secret references, and
  existing child foreign keys while adding the new provider preset;
- Provider Settings exposes preset defaults and editable provider-specific
  model IDs;
- mock tests cover native request shapes, split SSE, keepalives, malformed and
  mid-stream errors, authentication, retryability, connection probes,
  cancellation, timeout, migration, and consumer propagation;
- `npm run typecheck` and the full automated suite pass without a real API key.

### M2: Eight-language bidirectional Translation

Status: Done

Estimated effort: 3–4 ideal days.

Candidate Issues:

1. Add `auto` source and eight shared language identities.
2. Migrate Translation constraints and preserve old results.
3. Add source/target Settings and Hong Kong Traditional Chinese instructions.
4. Replace the English/Chinese-only skip and terminology assumptions.
5. Add eight-language prompt, script, cache, and Reader fixtures.

Gate:

- every source/target identity is accepted and serialized correctly;
- `zh-HK` is distinct from `zh-TW`;
- ambiguous Latin-script and mixed text are not silently skipped;
- translated HTML structure and progressive persistence remain unchanged.

Completion record (2026-07-24):

- shared Translation contracts expose `auto` plus English, Simplified Chinese,
  Hong Kong Traditional Chinese, Japanese, Korean, German, French, and Spanish;
- full-article and inline requests carry an explicit source language and target
  language from Settings through typed Preload/IPC to Main;
- migration 013 copies the Translation parent and segment tables, preserving
  result IDs, segment IDs, provider references, and foreign keys while adding
  source-language-aware cache identity and expanded target constraints;
- prompt version `translation-v4-multilingual-ndjson` adds source detection or
  an explicit source identity and target-specific output instructions;
- `zh-HK` explicitly requires Hong Kong vocabulary and rejects Taiwan Mandarin
  as the default regional form;
- conservative skip rules cover high-confidence scripts and language signals;
  ambiguous Latin text and Traditional Chinese remain provider-routed;
- eight offline article fixtures cover the supported language identities;
- the P0 English/Chinese AGROVOC pack returns no candidates for other targets
  until the multilingual library catalog is implemented in M4;
- the full automated suite and TypeScript checks pass without weakening
  translated-HTML validation or progressive persistence.

### M3: Smart context and AI experts

Status: Review

Estimated effort: 4–6 ideal days.

Candidate Issues:

1. Add the context analysis schema, persistence, cache, and lifecycle.
2. Add bounded single-request and long-document map/reduce analysis.
3. Compose context into Translation with timeout and graceful fallback.
4. Add the expert schema, pinned built-in resource compiler, and diagnostics.
5. Add transactional user YAML import and validation.
6. Add expert selection, details, enable state, and removal UI.

Gate:

- a compatible context is generated at most once and reused;
- timeout/failure does not fail ordinary Translation;
- cache invalidates on content, language, provider/model, expert, or prompt
  version changes;
- imported experts cannot change Shale's output or security envelope;
- every bundled expert either compiles or produces an explicit build error.

Completion record (2026-07-24):

- migration 014 adds user-expert persistence, document-context caching, and
  expert/context identity plus non-fatal context diagnostics on Translation
  results;
- smart context remains opt-in and disabled by default; short articles use one
  bounded analysis request, while long articles use deterministic 6,000
  character chunks followed by a normalized merge;
- successful context is cached by content hash, source/target language,
  provider profile/model, expert ID/content hash, and context prompt version;
- context timeout, invalid output, or provider failure records
  `TRANSLATION_CONTEXT_UNAVAILABLE` and continues ordinary Translation;
  explicit user cancellation still interrupts the run;
- `resources/ai-experts/experts.json` contains all 29 experts compiled from the
  pinned Immersive Translate prompts commit, with source and compiled hashes;
- `npm run build:experts` reproduces the bundle and fails on missing experts,
  duplicate IDs, invalid YAML, or an empty safe instruction;
- user YAML is parsed locally with size/depth/alias/tag/value restrictions,
  unknown template variables fail preview, built-ins are immutable, and user
  replacement requires explicit confirmation;
- the Translation prompt keeps Shale safety, HTML, and NDJSON rules ahead of
  subordinate expert and trusted context sections;
- Settings provides smart-context opt-in, expert selection/details, a local
  YAML format guide, preview/import, replacement confirmation, and user-expert
  removal;
- TypeScript checks and all 86 automated test files (641 tests) pass; Windows
  and native Wayland UI/provider smoke tests remain part of human review.

### M4: Terminology library catalog and imports

Status: Review

Estimated effort: 5–8 ideal days.

Candidate Issues:

1. Add library/entry/provenance schema and migrate AGROVOC into the default
   catalog model.
2. Build all pinned upstream libraries into reproducible local resources.
3. Implement multilingual lookup, precedence, and enabled-library cache hash.
4. Add per-library Settings; enable only `builtin:default` on first install.
5. Add transactional user CSV import, preview, conflict report, and deletion.
6. Add the "New terminology library" format guide and example download.

Gate:

- resources are usable offline and do not contact upstream at runtime;
- library enable state survives restart;
- invalid CSV cannot create a partial library;
- empty target preserves the original term;
- user, language-specific, and built-in conflicts resolve deterministically.

Completion record (2026-07-24):

- migration 015 adds persistent per-library enable/order configuration plus
  transactional user-library and user-entry tables;
- `terminology-libraries.sqlite` keeps the 41,632-concept AGROVOC baseline in
  `builtin:default` and compiles all 34 pinned catalog libraries (4,521
  normalized entries);
- the catalog SHA-256 is
  `69a53b41d883a3ed3016706ad65252c5bfe1275f2c1c2ec0aa1627da0dca4ed6`;
  the combined SQLite SHA-256 is
  `7b312d935eb464e22ead4e54becb7ac514a94295fd51164e6f9722a996bc2f43`;
- first install enables only `builtin:default`; built-in state and enabled user
  libraries survive restart;
- lookup precedence is user origin, exact target, language-independent,
  explicit `zh-TW` fallback for `zh-HK`, built-in origin, then library order
  and source specificity;
- Translation cache compatibility uses a deterministic hash of enabled
  library IDs, versions, and content hashes, and an active run retains its
  starting snapshot if Settings changes mid-run;
- Settings exposes per-library toggles, the Hong Kong fallback disclosure,
  strict UTF-8/RFC 4180 CSV help and example, preview, line-numbered errors,
  conflict warnings, transactional import/replacement, and user-library
  deletion;
- 88 test files / 647 tests, typecheck, lint (0 errors / 120 existing
  warnings), native verification, and Windows Electron packaging pass;
  Windows/Wayland UI interaction and translation-quality checks remain human
  review items.

### M5: Inline Translation upgrade

Status: Review

Estimated effort: 2–3 ideal days.

Candidate Issues:

1. Add word/phrase/sentence classification prompt and structured response parser.
2. Add source-language pronunciation and language-specific overrides.
3. Integrate bounded paragraph context, experts, and terminology.
4. Update dictionary-card, sentence-only, loading, and structured-error states.

Gate:

- fixtures cover a word, polysemous word, phrase, sentence, and contextual
  meaning change;
- English IPA, Chinese Pinyin, and Japanese reading behavior is deterministic at
  the schema level;
- sentences do not render empty dictionary sections;
- selection changes and shutdown abort pending work and clean listeners.

Completion record (2026-07-25):

- inline responses now use the strict `word | phrase | sentence` schema with a
  concrete detected source language, one contextual translation, optional
  source-language pronunciation, and grouped senses containing definitions,
  contextual meanings, and translated examples;
- pronunciation systems are explicit and source-language-specific: IPA,
  Pinyin, Jyutping, kana reading, or Revised Romanization;
- plain text, malformed JSON, invalid nested senses, a conflicting manually
  selected source language, and sentence responses containing dictionary-only
  fields fail with an explicit structured-output error;
- the active expert is rendered through the same restricted expert compiler,
  and terminology candidates use the enabled-library hash captured at request
  start; bounded paragraph context remains untrusted input;
- the Reader card distinguishes word, phrase, and sentence results, renders
  multiple senses without showing an empty dictionary area for sentences, and
  keeps paragraph Translation inline with the article;
- typed `translation:inline-cancel` IPC aborts provider work when the selection,
  Translation preferences, card lifecycle, or application lifecycle ends the
  request; starting another inline request still aborts the previous one;
- the fixed offline inline fixture set covers a polysemous English word in two
  contexts, a phrase, a sentence, Simplified Chinese Pinyin, Japanese reading,
  and prompt-injection-shaped source text;
- TypeScript checks and all 88 automated test files (658 tests) pass; lint
  reports 0 errors and the same 120 pre-existing warnings. Windows/Wayland
  placement, keyboard interaction, pronunciation quality, and real-provider
  structured-output behavior remain human review items.

### M6: Integration and release hardening

Estimated effort: 3–4 ideal days.

Candidate Issues:

1. Add provider/language/feature-combination integration coverage.
2. Verify migration, interruption, restart, stale-cache, and offline behavior.
3. Audit prompt injection, secret logging, imported files, and rendered HTML.
4. Complete Windows 11 and native Wayland manual smoke tests.
5. Update user documentation, diagnostics, project status, and release notes.

Gate:

- automated suites pass;
- required manual checks are recorded;
- no API key, Authorization header, article body, or imported secret appears in
  logs or fixtures;
- affected public-contract owners complete review.

M6 implementation record (2026-07-25):

- added a full upgrade fixture that starts from the migration-011 schema,
  applies 012 through 015 in order, preserves profile/result/segment identity
  and foreign keys, reconciles an interrupted run, and verifies an idempotent
  restart;
- changed oversized smart-context input from a 48,000-character prefix to
  deterministic whole-document sampling under the same eight-by-6,000
  character budget; bumped the cache identity to `translation-context-v2`;
- added diagnostic canaries proving Translation timing/recovery logs exclude
  API keys, Authorization/Bearer values, and article content;
- verified all 89 test files / 662 tests, typecheck, lint (0 errors / 120
  pre-existing warnings), production dependency audit (0 vulnerabilities),
  Electron native ABI, Windows x64 packaging, packaged startup, and offline
  terminology artifact integrity;
- recorded remaining real-provider, GUI, public-boundary review, and native
  Wayland checks in `translation-advanced-verification.md`. The milestone is in
  Review until those human-owned checks are signed off.

## Verification matrix

| Area | Automated verification | Manual verification |
|---|---|---|
| Languages | contract, migration, prompt labels, skip rules, fixtures | quality sample for every target |
| Providers | URL, headers, body, SSE, usage, abort, error fixtures | opt-in connection per provider |
| Context | cache key, chunk/merge, timeout, fallback, cancellation | cost/state visibility |
| Experts | YAML limits, variables, conflicts, compiler diagnostics | import/choose/remove workflow |
| Terminology | CSV parsing, precedence, target language, transaction | guide clarity and per-library toggles |
| Inline | classification, schema, parser, context, abort | Reader card placement and usability |
| Compatibility | old DB, old provider, old results, restart | Windows and Wayland upgrade smoke |

## Expected affected areas

- `src/shared/contracts`
- `src/main/ai/provider`
- `src/main/ai/services`
- `src/main/ai/stores`
- `src/main/migrations`
- `src/main/ipc`
- `src/preload`
- `src/renderer/features/settings`
- `src/renderer/features/translation`
- `resources/ai-experts`
- `resources/terminology`
- `scripts`
- `tests/fixtures`
- AI and Translation documentation
