# Translation P0 design and verification

## Scope

Translation P0 translates one persisted Reader article into `zh-CN` or `en` and presents a paragraph-aligned bilingual projection in Reader mode. The projection keeps the sanitized Reader HTML as its layout skeleton, so figures, standalone images, tables, code blocks, and other non-translatable nodes remain in their original positions while translated blocks are inserted alongside their source blocks. It uses the existing active OpenAI-compatible provider profile and the same Main-only secret boundary as Summary.

The translation source is the sanitized `CleanedContent.cleanedHtml` contract plus Reader title/byline metadata. `ContentSegmenter` v2 emits deterministic semantic blocks for `title`, `byline`, `heading`, `paragraph`, `list`, `blockquote`, and `caption`. Existing v1 content is rebuilt lazily before Translation. Each segment has a stable ID, and the complete normalized segment sequence produces a SHA-256 `sourceContentHash`.

Reader also supports non-persisted inline Translation. Pressing the configured keyboard shortcut translates the current Reader selection, or the paragraph under the pointer when there is no selection. Renderer sends text-only source/context through `translation:inline`; Main validates length limits and uses the active provider without exposing its key. Starting another inline request aborts the previous one, and application shutdown aborts any remaining request.

The latency-optimized runtime groups adjacent blocks into batches of at most three segments and 1,600 source characters. It executes at most two provider requests concurrently. Each request returns ordered NDJSON, so Main can validate, persist, and emit each completed segment without waiting for the rest of its batch. A provider failure marks the run failed without deleting already completed segments; generating the same compatible Translation again resumes only pending/failed segments. Cancellation UI and provider fallback remain outside this scope.

Before contacting the provider, Main performs a conservative per-segment target-language check. High-confidence Simplified Chinese or English segments, empty blocks, and standalone HTTP(S) URLs are persisted unchanged and emit the same `segment-completed` event as model-produced translations. Ambiguous, mixed-language, Traditional Chinese, Japanese, Korean, and short text without enough language evidence still use the provider. This avoids repeated model calls when a user selects the language already used by an article without silently skipping uncertain translations.

## Persistence and cache behavior

Migration `008_create_translation` adds `segmentsJson` to `entry_content` plus:

- `translation_result`: one run/result header keyed by `(entryId, targetLanguage, sourceContentHash, segmenterVersion)`;
- `translation_segment`: source snapshot, translated text, order, and status per stable segment ID.

Migration `009_enhance_translation` adds source role/HTML, sanitized translated HTML, per-segment terminology provenance, and the terminology-pack version. Compatibility checks include that pack version, preventing a result generated from an older glossary from being silently reused.

Completed compatible results are reused without a provider call. Compatibility includes source hash, segmenter version, prompt version, and terminology-pack version. Failed compatible results keep successful segments and resume only unfinished work. If the current segmented source hash differs, the API returns `stale` and the Renderer does not display the old bilingual projection. Re-generating creates a result for the current source. On startup, persisted `running` results become retryable `TRANSLATION_INTERRUPTED` failures and can use the same resume path.

`agent_task_run` remains Summary-only in the current application because its shipped migration has a `taskType = 'summary'` constraint. Translation shares the provider configuration, secure-key boundary, stream protocol, and lifecycle conventions without rebuilding that applied table. Generalizing all AI runs into a common persistent runtime remains follow-up work and must use a reviewed migration.

## Runtime and IPC

`TranslationService` depends only on a narrow Cleaned Content lookup port, provider profile store, secret store, translation store, local terminology lookup, and existing streaming provider interface. It validates entry and language values before creating a persisted run and keeps incomplete provider tokens in memory. Provider output must contain a translation with the same sanitized element/tag/nesting structure as `sourceHtml`; Main rejects structural changes, restores source attributes, and persists only safe final HTML. Before comparison, Main unwraps empty or punctuation-only presentation tags such as `<strong>.</strong>` on both sides, preventing localized punctuation from causing a false style-boundary failure while keeping meaningful styled text strict.

The runtime terminology database is a separate read-only SQLite resource. `scripts/build-terminology-pack.mjs` downloads FAO's official AGROVOC Core snapshot at build/release time, imports English/Chinese preferred and alternative labels, records version/license/hash metadata, and creates exact/normalized/alias plus FTS indexes. Runtime code never contacts a terminology service. Candidate matches from the current segment, title, and adjacent context are supplied to the model; the model records only terms it actually chose to apply.

- `translation:get`
- `translation:generate`
- `translation:inline`: translates a bounded text selection or hovered paragraph without persistence
- `translation:prioritize`: updates queued-batch priority with visible segment IDs for the active run
- `translation:terminology-info`
- `translation:stream`: `started`, `segment-started`, `segment-completed`, `completed`, `failed`

Every event includes `runId`, `entryId`, and target language; segment events also include `sourceSegmentId`. Preload exposes typed methods only. `TranslationPanel` filters events by these identities, removes listeners and viewport observers on article/language changes or unmount, and prioritizes the viewport plus a one-screen margin. Provider deltas remain internal to Main: Renderer receives no partial segment text. Pending blocks keep the original Reader structure and show only an inline spinner; a translated block is inserted only after the complete segment passes structural validation and is persisted.

Each provider batch writes one content-free `[translation:timing]` diagnostic record with segment IDs and character counts plus `responseHeadersMs`, `firstDeltaMs`, `lastDeltaMs`, `persistedMs`, and `persistenceMs`. It never logs the prompt, article text, API key, Authorization header, or provider configuration.

## Verification

Automated coverage:

- deterministic segment ID/hash generation, semantic roles, metadata blocks, and source-change invalidation;
- prompt context/terminology instructions and safe translated-HTML validation;
- SQLite run/segment/provenance persistence and interrupted-run recovery;
- local preferred/alias terminology matching from the generated pack;
- adjacent batching, two-request concurrency limit, visible-batch priority, persisted-before-emitted completion, segment-level resume, cache reuse, stale-source protection, and one-active-run behavior;
- complete-segment-only Renderer updates and provider response-header/first-delta timing hooks.

Run:

```sh
npm run typecheck
npm test
```

Manual opt-in verification (never CI):

1. Configure the existing provider from **Settings → Provider** and verify the key remains absent from SQLite, IPC responses, and UI state.
2. Open an article with cleaned Reader content, choose a target language, and generate a Translation.
3. Confirm the original article remains readable during generation; after completion, switch between **Original** and **Bilingual**.
4. Reopen the article and restart the app: the compatible bilingual result must be reused without a second provider request.
5. Refresh the article so its Reader segments change; confirm the old bilingual result is not rendered and a new generation is required.
6. Verify a bad key or network failure gives a readable error and leaves the original article available. Complete the opt-in path once on Windows 11 and native Wayland.
7. Disconnect the network and confirm the local terminology source/version remains visible and a cached local lookup still supplies terminology candidates.
8. With a long article, confirm visible segments are translated ahead of queued off-screen segments, pending titles and paragraphs show only an end spinner, no partial Translation text appears, each completed segment is inserted at once, and no more than two provider requests run concurrently.
9. Interrupt or fail a run after at least one segment completes, retry, and confirm completed segments are not requested again.
10. Translate an article containing captioned, standalone, and inline images; confirm each original image remains visible exactly once and in its original article position throughout progressive rendering and after restart.
11. Select a word and press the configured inline shortcut (Ctrl+Z by default); verify the nearby text-only card shows its contextual translation. Clear the selection, hover a paragraph, press the shortcut again, and verify the translation is inserted directly below that paragraph with the same bilingual styling used by full-article Translation and without opening another page or popup. Record a different modified-key combination in Settings, verify it replaces Ctrl+Z, and confirm inputs/selects keep their native keyboard behavior instead of triggering translation.

## Follow-up scope

Cancellation UI, provider fallback, adaptive provider-specific batch sizing, additional licensed terminology sources, richer Reader/Web/Dual integration, and a generic persisted AI runtime remain follow-up work.
