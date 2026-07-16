# Summary P0 design and verification

## Scope

Summary consumes only persisted `CleanedContent.markdown`; the Feed-provided `entry.summary` remains unrelated metadata. The Reader places the Summary panel directly below the article title and metadata, before the cleaned article body.

P0 supports one active OpenAI-compatible Chat Completions provider, streaming output, `zh-CN` and `en` targets, and `short` / `medium` / `detailed` detail levels. Translation, automatic retry, cancellation UI, queuing, multi-provider management, and chunked/map-reduce summaries remain out of scope.

## Security boundary

- Renderer receives only a redacted provider profile. It never receives `apiKeyRef`, encrypted key data, or a plaintext key response.
- The key input is uncontrolled in the settings dialog, so it is not kept in React state.
- SQLite stores an opaque `apiKeyRef` only. When secure storage is available, the encrypted secret is stored separately in `ai-secrets.json` below Electron `userData` with mode `0600`.
- Electron `safeStorage` encrypts/decrypts persistent key material. On Linux, `basic_text` and `unknown` backends are never used for persistence. If secure storage is unavailable, the key is held in Main-process memory only and discarded on exit; the user is told to enter it again after restart. There is no plaintext-on-disk fallback.
- Main never logs API keys, Authorization headers, article Markdown, or raw provider error bodies.

## Persistence and cache behavior

Migrations `006_create_ai_profiles` and `007_create_summary` add:

- `ai_provider_profile`: active provider URL, model, and opaque key reference;
- `agent_task_run`: Summary identity, input hash, state, and sanitized failure;
- `summary_result`: one result per `(entryId, targetLanguage, detailLevel)`.

Each result stores the SHA-256 hash of the exact Markdown sent to the provider. A matching hash is `fresh` and returned without another provider request. A changed or unavailable Cleaned Markdown makes the stored result `stale`; users explicitly regenerate it. At startup, any persisted `running` run becomes retryable `SUMMARY_INTERRUPTED`.

## Runtime and IPC

`SummaryService` depends on a narrow Cleaned Content lookup port rather than Feed Store internals. It permits one active run globally, persists the run before starting work, keeps partial text only in memory, and atomically persists final text with the `succeeded` transition.

- `provider:get`, `provider:save`, `provider:test`
- `summary:get`, `summary:generate`
- `summary:stream` events: `started`, ordered `delta`, `completed`, `failed`

All Summary stream events contain `runId`, `entryId`, language, and detail level. Preload exposes typed methods only; `SummaryPanel` subscribes before generation, filters by these identities, and removes its listener when the article/settings change or the component unmounts.

## Verification

Automated checks:

```sh
npm run typecheck
npm run lint
npm test
```

The Summary suites cover prompt injection boundaries, encrypted and session-only key storage, OpenAI-compatible SSE parsing and authentication failures, run/result persistence, interrupted-run recovery, cache reuse, stale content, missing Markdown, and the one-active-run limit. They use Mock/fake providers only.

Manual opt-in verification (never CI):

1. Start the app on Wayland or Windows, open an article whose cleaned Markdown is available, and open **Provider settings** from the Summary panel.
2. Save an OpenAI-compatible endpoint, model, and a real key. Confirm the key is not displayed after saving and is absent from `shale.db`.
3. Run **Test connection**, then generate a Summary in each supported language/detail combination. Confirm streaming text appears above the article body.
4. Reopen the article and restart the app: the completed result remains, and its fresh slot does not make another provider call.
5. Interrupt a generation by quitting, restart, and confirm the old `running` state becomes a retryable failure.
6. On Linux without a secure keyring, verify that saving is marked session-only, the key is not written to disk, generation works for the current session, and the key must be entered again after restart.
