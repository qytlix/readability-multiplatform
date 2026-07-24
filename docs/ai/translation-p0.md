# Translation P0 design and verification

## Scope

Translation translates one persisted Reader article from an automatically detected or explicitly selected language into English, Simplified Chinese, Hong Kong Traditional Chinese, Japanese, Korean, German, French, or Spanish and presents a paragraph-aligned bilingual projection in Reader mode. The projection keeps the sanitized Reader HTML as its layout skeleton, so figures, standalone images, tables, code blocks, and other non-translatable nodes remain in their original positions while translated blocks are inserted alongside their source blocks. It uses the active OpenAI, DeepSeek, OpenRouter, Anthropic, Gemini, or custom OpenAI-compatible profile through the same Main-only secret boundary as Summary.

The translation source is the sanitized `CleanedContent.cleanedHtml` contract plus Reader title/byline metadata. `ContentSegmenter` v2 emits deterministic semantic blocks for `title`, `byline`, `heading`, `paragraph`, `list`, `blockquote`, and `caption`. Existing v1 content is rebuilt lazily before Translation. Each segment has a stable ID, and the complete normalized segment sequence produces a SHA-256 `sourceContentHash`.

Reader also supports non-persisted inline Translation. Pressing the configured keyboard shortcut translates the current Reader selection, or the paragraph under the pointer when there is no selection. Renderer sends bounded text-only source/context, the current expert identity, and language preferences through `translation:inline`; Main validates length limits, freezes the current terminology candidates, and uses the active provider without exposing its key. Selection results use a strict word/phrase/sentence schema with a detected source language, contextual translation, source-language pronunciation metadata, and grouped senses. Plain text or malformed structured output is an explicit error. Starting another inline request aborts the previous one; `translation:inline-cancel` also aborts work when selection, preferences, the card lifecycle, or application shutdown ends the request.

The latency-optimized runtime groups adjacent blocks into batches of at most three segments and 1,600 source characters. It executes at most two provider requests concurrently. Each request returns ordered NDJSON, so Main can validate, persist, and emit each completed segment without waiting for the rest of its batch. A provider failure marks the run failed without deleting already completed segments; generating the same compatible Translation again resumes only pending/failed segments. Cancellation UI and provider fallback remain outside this scope.

Before contacting the provider, Main performs a conservative per-segment target-language check. High-confidence Simplified Chinese, Japanese, Korean, English, German, French, or Spanish segments, empty blocks, and standalone HTTP(S) URLs are persisted unchanged and emit the same `segment-completed` event as model-produced translations. Hong Kong and Taiwan usage cannot be distinguished from script alone, so automatic Traditional Chinese content still uses the provider. Ambiguous, mixed-language, and short text without enough language evidence also use the provider. An explicit source equal to the target is treated as the user's authoritative instruction.

## Persistence and cache behavior

Migration `008_create_translation` adds `segmentsJson` to `entry_content` plus:

- `translation_result`: one run/result header keyed by `(entryId, targetLanguage, sourceContentHash, segmenterVersion)`;
- `translation_segment`: source snapshot, translated text, order, and status per stable segment ID.

Migration `009_enhance_translation` adds source role/HTML, sanitized translated HTML, per-segment terminology provenance, and the terminology-pack version. Migration `013_expand_translation_languages` preserves existing result and segment IDs while adding explicit source language, eight target-language constraints, and source-language-aware uniqueness. Legacy rows migrate with automatic source detection.

Completed compatible results are reused without a provider call. Compatibility includes source and target language, source hash, segmenter version, prompt version, and terminology-pack version. Failed compatible results keep successful segments and resume only unfinished work. If the selected source identity or current segmented source hash differs, the API does not reuse the old result. Re-generating creates a result for the current source. On startup, persisted `running` results become retryable `TRANSLATION_INTERRUPTED` failures and can use the same resume path.

`agent_task_run` remains Summary-only in the current application because its shipped migration has a `taskType = 'summary'` constraint. Translation shares the provider configuration, secure-key boundary, stream protocol, and lifecycle conventions without rebuilding that applied table. Generalizing all AI runs into a common persistent runtime remains follow-up work and must use a reviewed migration.

## Runtime and IPC

`TranslationService` depends only on a narrow Cleaned Content lookup port, provider profile store, secret store, translation store, local terminology lookup, and the neutral streaming text-generation interface. `ProviderRegistry` selects the protocol adapter from the active profile; Renderer never receives the API key or provider transport details. The service validates entry and language values before creating a persisted run and keeps incomplete provider tokens in memory. Provider output must contain a translation with the same sanitized element/tag/nesting structure as `sourceHtml`; Main rejects structural changes, restores source attributes, and persists only safe final HTML. Before comparison, Main unwraps empty or punctuation-only presentation tags such as `<strong>.</strong>` on both sides, preventing localized punctuation from causing a false style-boundary failure while keeping meaningful styled text strict.

The runtime terminology database is a separate read-only SQLite resource.
`scripts/build-terminology-pack.mjs` builds the FAO AGROVOC base and
`scripts/build-terminology-libraries.mjs` compiles the pinned 34-library
catalog into the combined offline artifact. Runtime code never contacts a
terminology service. Candidate matches from the current segment, title, and
adjacent context are supplied to the model; the model records only terms it
actually chose to apply. Enabled-library state and user CSV libraries live in
the application database. Cache identity is the deterministic enabled-library
ID/version/content-hash set. Upstream `zh-TW` entries remain marked and are
only a lowest-priority Traditional Chinese reference for a `zh-HK` target.

- `translation:get`
- `translation:generate`
- `translation:inline`: translates a bounded text selection or hovered paragraph without persistence
- `translation:inline-cancel`: aborts the active non-persisted inline request
- `translation:prioritize`: updates queued-batch priority with visible segment IDs for the active run
- `translation:terminology-info`
- `translation:stream`: `started`, `segment-started`, `segment-completed`, `completed`, `failed`

Every event includes `runId`, `entryId`, source language, and target language; segment events also include `sourceSegmentId`. Preload exposes typed methods only. `TranslationPanel` filters events by these identities, removes listeners and viewport observers on article/language changes or unmount, and prioritizes the viewport plus a one-screen margin. Provider deltas remain internal to Main: Renderer receives no partial segment text. Pending blocks keep the original Reader structure and show only an inline spinner; a translated block is inserted only after the complete segment passes structural validation and is persisted.

Each provider batch writes one content-free `[translation:timing]` diagnostic record with segment IDs and character counts plus `responseHeadersMs`, `firstDeltaMs`, `lastDeltaMs`, `persistedMs`, and `persistenceMs`. It never logs the prompt, article text, API key, Authorization header, or provider configuration.

## Verification

Automated coverage:

- deterministic segment ID/hash generation, semantic roles, metadata blocks, and source-change invalidation;
- prompt context/terminology instructions and safe translated-HTML validation;
- SQLite run/segment/provenance persistence and interrupted-run recovery;
- local preferred/alias terminology matching from the generated pack;
- adjacent batching, two-request concurrency limit, visible-batch priority, persisted-before-emitted completion, segment-level resume, cache reuse, stale-source protection, and one-active-run behavior;
- complete-segment-only Renderer updates and provider response-header/first-delta timing hooks.
- `auto + 8` language serialization, source-aware cache separation, legacy
  migration, Hong Kong instructions, conservative skip rules, and eight
  offline language fixtures.
- strict inline word/phrase/sentence parsing, contextual polysemy, deterministic
  pronunciation-system metadata, expert/terminology composition, malformed
  output rejection, cancellation, and sentence-only Reader presentation.

Run:

```sh
npm run typecheck
npm test
```

Manual opt-in verification (never CI):

1. Configure a provider from **Settings → Provider**, run the opt-in connection test, and verify the key remains absent from SQLite, IPC responses, and UI state.
2. Open an article with cleaned Reader content, choose automatic or manual source language plus a target language, and generate a Translation.
3. Confirm the original article remains readable during generation; after completion, switch between **Original** and **Bilingual**.
4. Reopen the article and restart the app: the compatible bilingual result must be reused without a second provider request.
5. Refresh the article so its Reader segments change; confirm the old bilingual result is not rendered and a new generation is required.
6. Verify a bad key or network failure gives a readable error and leaves the original article available. Complete the opt-in path once on Windows 11 and native Wayland.
7. Disconnect the network and confirm the local terminology source/version remains visible and a cached local lookup still supplies terminology candidates.
8. With a long article, confirm visible segments are translated ahead of queued off-screen segments, pending titles and paragraphs show only an end spinner, no partial Translation text appears, each completed segment is inserted at once, and no more than two provider requests run concurrently.
9. Interrupt or fail a run after at least one segment completes, retry, and confirm completed segments are not requested again.
10. Translate an article containing captioned, standalone, and inline images; confirm each original image remains visible exactly once and in its original article position throughout progressive rendering and after restart.
11. Select a word and press the configured inline shortcut (Ctrl+Z by default); verify the nearby text-only card shows its contextual translation. Clear the selection, hover a paragraph, press the shortcut again, and verify the translation is inserted directly below that paragraph with the same bilingual styling used by full-article Translation and without opening another page or popup. Record a different modified-key combination in Settings, verify it replaces Ctrl+Z, and confirm inputs/selects keep their native keyboard behavior instead of triggering translation.
12. Generate one quality sample for every target language. For `zh-HK`, verify Hong Kong terms and orthography are used rather than default Taiwan wording; then change only the source selector and confirm the previous cache is not silently reused.

## Follow-up scope

Cancellation UI, provider fallback, adaptive provider-specific batch sizing, additional licensed terminology sources, richer Reader/Web/Dual integration, and a generic persisted AI runtime remain follow-up work.
