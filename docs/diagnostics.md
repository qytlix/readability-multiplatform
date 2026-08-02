# Diagnostic export v1

Shale can export one user-selected JSON file from **Settings → Diagnostics**.
The feature is local only: it does not read the application database, call the
network, upload data, or include the selected destination path in the Renderer
response.

## Report contract

The file uses `reportVersion: 1` and always contains:

- application version and packaged state;
- Electron and Node versions;
- operating system, OS release, CPU architecture, and a limited display
  environment summary;
- generation time;
- structured-log format version, read status, aggregate read issues, omitted
  valid-record count, and the latest 1,000 valid structured records in
  chronological order.

Environment fields that are not available are represented as `null`. Log read
issues use stable codes and aggregate counts only:

- `LOG_DIRECTORY_UNAVAILABLE`
- `LOG_FILE_READ_FAILED`
- `LOG_RECORD_MALFORMED`

The report never contains raw filesystem errors, file paths, or log filenames.

## Privacy boundary

The exporter reads only `structured-YYYY-MM-DD[-N].jsonl` files from Electron's
log directory. Each JSONL line is parsed and passed through the same strict
structured-record sanitizer used by the logger before it enters the report.
This is a second redaction boundary; the exporter does not trust local files
merely because their name resembles a managed log.

The report excludes API keys, Authorization headers, cookies, tokens, feed and
article URLs, user text, article and cleaned content, summaries, translations,
notes, SQLite data, full home paths, provider configuration, and raw system
errors. Translation's console-only timing output is deliberately outside v1.

For `translation.provider.request.failed` and omission records, the report may
also contain a deliberately flat, allow-listed response summary: request kind,
stable reason, validation stage, HTML-validation subreason when applicable,
and a text-slot compensation protocol plus aggregate slot counts when applicable,
an available normalized finish reason,
segment counts, input/output character counts, and up to three 16-character
segment-ID hashes. It never includes nested provider objects, prompts, raw
NDJSON, chunks, source text, or translated text.

Translation run lifecycle records share `taskRunId`, an opaque `attemptId`,
the controlled trigger, and `translationVariant`. Terminal and interruption
records aggregate the current attempt's persisted Usage ledger by
`requestKind`: standard batch and compensation, deep draft/review/rewrite,
deep draft/rewrite compensation, and smart-context requests. Request outcomes
and Provider-reported token fields come from those same Usage rows; resumed
attempts do not recount completed segments or deep checkpoints from an earlier
attempt. Failed runs also include a controlled `finalFailureStage` and the
existing safe error classification.

`translation.run.creation-blocked` is emitted only when Main's canonical live
task prevents another run from being created, or a canonical paused task is
continued instead of creating a concurrent replacement. Startup reconciliation
emits aggregate recovery records only when it changes interrupted work or corrects
stale metadata/checkpoints on a terminal success. Ordinary state reads,
completed-result reuse, Renderer state derivation, and UI interactions do not
produce diagnostics.

Article Chat emits failure terminals only. One operation-scoped terminal token
is shared from context preparation through streaming completion. The terminal
is selected only after required failure persistence and event notification have
been attempted, so a later database fault can own the final classification and
a listener exception cannot swallow or duplicate the Chat failure record:

- `chat.run.failed` owns final context-preparation, Provider request/protocol
  parsing, timeout, empty-response, and event-listener failures;
- `chat.session.persistence.failed` owns conversation loading, thread/message/run
  reservation, attachment linking, context identity, delta append, and run
  success/failure persistence failures;
- `chat.attachment.operation.failed` owns valid attachment operations that end
  in file-read, file-write, database-read, database-write, or cleanup failure;
- `usage.ledger.persistence.failed` remains the independent best-effort Usage
  ledger boundary and is never reused as a Chat terminal.

These records contain only a controlled `operation`, `finalFailureStage`, stable
`errorCode`, `durationMs`, `success: false`, and an optional opaque `taskRunId`.
The StructuredLogger applies an event-specific second allowlist before JSONL is
written, and diagnostic export runs that sanitizer again. Questions, answers,
history, article/selection/Prompt text, URLs, attachment metadata or content,
paths, Provider configuration, secrets, SQL, and raw errors are excluded.

Successful Chat runs, successful context preparation, Provider timing, internal
retry, ordinary reads and attachment operations, user stop, article change,
normal shutdown, and zero-work recovery produce no Chat business record.
Expected results such as invalid input, `CHAT_BUSY`, an unconfigured Provider,
unsupported/oversized attachments, encrypted PDFs, and PDFs without extractable
text likewise produce no system-failure record.

Markdown export records are operation-level terminal records only:
`markdown.export.completed` includes the exported article count and duration.
When image localization actually processed remote images, it also includes only
the aggregate downloaded and failed image counts; a partial image failure stays
a completed export record. Exports with no localizable image omit both counts.
`markdown.export.failed` adds a stable stage and error code. A save-dialog
cancel produces no export log record. These records never include destination
paths, generated names, article metadata, URLs, Markdown, annotations, or raw
write errors.

`content.pipeline.failed` is likewise one terminal record for an operation that
cannot return displayable content. It may contain only entry/feed identifiers,
duration, a controlled final stage, and a stable error code; it does not record
cache data, page URLs, response bodies, cleaned content, or raw errors. Cached
or Feed-content fallback success remains a completed Content operation, and a
confirmed caller abort has no business-failure record.

`annotation.operation.failed` is emitted only by the annotation IPC operation
boundary after a final failed load, create, update, or delete. It includes only
the controlled operation, final stage, stable error code, duration, failure
flag, and entry ID when the request already identifies an article. It never
contains annotation IDs, notes, selected text, anchors, offsets, article data,
or raw database errors. Normal annotation actions and ordinary input or overlap
validation produce no diagnostic record.

`translation.inline.failed` is emitted only by the one-shot inline Translation
service after a final configuration, Provider, or structured-output parse
failure. It contains only a controlled stage, stable error code, duration, and
`success: false`. Successful translations, overlay closure, selection changes,
`translation:inline-cancel`, and confirmed Provider aborts produce no record.
It never includes selected text, paragraph context, output, terminology,
expert or model data, IDs, hashes, or raw errors.

`usage.statistics.failed` is one terminal record emitted by the Usage Statistics
IPC boundary only when a valid, read-only query cannot return a result. It
contains only `stage: "read"`, `USAGE_STATISTICS_READ_FAILED`, duration, and
`success: false`; it is distinct from `usage.ledger.persistence.failed`, which
diagnoses Usage ledger writes. Successful queries and invalid requests produce
no statistics record. Query dates, time zone, filters, Provider or model data,
usage totals, execution identities, SQL, paths, and raw errors are excluded.

## Save behavior

Main owns the native save dialog and the final write. Cancel returns a normal
`cancelled` result. The report is written to a temporary file beside the chosen
target and renamed only after serialization succeeds; source logs are read only
and are never cleared or rewritten.
