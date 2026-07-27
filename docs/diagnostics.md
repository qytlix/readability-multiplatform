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

Markdown export records are operation-level terminal records only:
`markdown.export.completed` includes the exported article count and duration;
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

## Save behavior

Main owns the native save dialog and the final write. Cancel returns a normal
`cancelled` result. The report is written to a temporary file beside the chosen
target and renamed only after serialization succeeds; source logs are read only
and are never cleared or rewritten.
