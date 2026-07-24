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

## Save behavior

Main owns the native save dialog and the final write. Cancel returns a normal
`cancelled` result. The report is written to a temporary file beside the chosen
target and renamed only after serialization succeeds; source logs are read only
and are never cleared or rewritten.
