# Translation P0 design and verification

## Scope

Translation P0 translates one persisted Reader article into `zh-CN` or `en` and presents a paragraph-aligned bilingual projection in Reader mode. It uses the existing active OpenAI-compatible provider profile and the same Main-only secret boundary as Summary.

The translation source is the sanitized `CleanedContent.cleanedHtml` contract. `ContentSegmenter` extracts deterministic `p`, `ul`, and `ol` blocks, excluding paragraphs nested in list items. Each segment has a stable ID, and the complete normalized segment sequence produces a SHA-256 `sourceContentHash`. Both are versioned by `segmenterVersion` (`v1`).

P0 is intentionally serial: one Translation run processes one segment at a time. It persists each completed segment and then marks the result succeeded. A provider failure marks the active segment and run failed without deleting already completed segments, but P0 does not expose segment-level retry, resume, cancellation UI, concurrency controls, or provider fallback.

## Persistence and cache behavior

Migration `008_create_translation` adds `segmentsJson` to `entry_content` plus:

- `translation_result`: one run/result header keyed by `(entryId, targetLanguage, sourceContentHash, segmenterVersion)`;
- `translation_segment`: source snapshot, translated text, order, and status per stable segment ID.

Completed compatible results are reused without a provider call. If the current segmented source hash differs, the API returns `stale` and the Renderer does not display the old bilingual projection. Re-generating creates a result for the current source. On startup, persisted `running` results become retryable `TRANSLATION_INTERRUPTED` failures.

`agent_task_run` remains Summary-only in the current application because its shipped migration has a `taskType = 'summary'` constraint. Translation shares the provider configuration, secure-key boundary, stream protocol, and lifecycle conventions without rebuilding that applied table. Generalizing all AI runs into a common persistent runtime remains follow-up work and must use a reviewed migration.

## Runtime and IPC

`TranslationService` depends only on a narrow Cleaned Content lookup port, provider profile store, secret store, translation store, and existing streaming provider interface. It validates entry and language values before creating a persisted run, keeps incomplete token text in memory, and persists only final non-empty segment text.

- `translation:get`
- `translation:generate`
- `translation:stream`: `started`, `segment-started`, `segment-delta`, `completed`, `failed`

Every event includes `runId`, `entryId`, and target language; segment events also include `sourceSegmentId`. Preload exposes typed methods only. `TranslationPanel` filters events by these identities, removes its listener on article/language changes or unmount, and leaves the original Reader content available while a task runs or fails.

## Verification

Automated coverage:

- deterministic segment ID/hash generation, list handling, and source-change invalidation;
- prompt-injection boundary and target-language instructions;
- SQLite run/segment persistence and interrupted-run recovery;
- serial service streaming, cache reuse, stale-source protection, and one-active-run behavior.

Run:

```sh
npm run typecheck
npm test
```

Manual opt-in verification (never CI):

1. Configure the existing provider from **Summary** settings and verify the key remains absent from SQLite, IPC responses, and UI state.
2. Open an article with cleaned Reader content, choose a target language, and generate a Translation.
3. Confirm the original article remains readable during generation; after completion, switch between **Original** and **Bilingual**.
4. Reopen the article and restart the app: the compatible bilingual result must be reused without a second provider request.
5. Refresh the article so its Reader segments change; confirm the old bilingual result is not rendered and a new generation is required.
6. Verify a bad key or network failure gives a readable error and leaves the original article available. Complete the opt-in path once on Windows 11 and native Wayland.

## Follow-up scope

Per-segment retry, resume, cancellation UI, bounded concurrency, provider fallback, richer Reader/Web/Dual integration, and a generic persisted AI runtime are deliberately excluded from Translation P0.
