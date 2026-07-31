# Article Chat

## Status

- Owner: AI
- Reviewers: Product/Reader, IPC, SQLite, Security
- Scope: one current article and one active generation at a time
- Prompt version: `article-chat-v1`

## Goal

Article Chat helps the user understand the currently open, locally cleaned
article without turning Shale into a general-purpose chatbot. It keeps the
article mounted on the right while a chat panel temporarily replaces the feed
and entry-list area.

The first release includes:

- locally persisted, multi-turn, streaming article questions;
- stop, failure, retry, and restart recovery;
- a separate Provider route, model, API key, and image-capability setting;
- complete-article context whenever it fits;
- observable history compression and article-map fallback when it does not;
- text, Markdown, CSV, JSON, HTML, PDF, PNG, JPEG, and WebP attachments;
- clipboard image paste;
- questions created from selections in local Reader and bilingual Reader;
- copy actions for both roles, user-question editing, and answer regeneration;
- chat usage records;
- Windows 11 and native Wayland verification.

## Product behavior

The Reader header exposes an `aria-label="打开 AI 问答"` toggle. It is disabled
when there is no current article, the cleaned content is unavailable, or the
entry is still only a feed preview.

The workspace has three explicit modes:

```text
reader
article-chat
settings
```

Opening chat snapshots the sidebar state, entry-list state, and custom
entry-list width. The chat panel spans the former sidebar and entry-list
columns. `EntryDetail` remains mounted and retains its scroll position and
Reader/Translation state. Closing chat restores the exact snapshot.

The chat panel contains:

- article information, suggestions, persisted messages, streaming output,
  selections, attachments,
  and visible failure/interruption states;
- per-message copy actions, user-message edit-and-resend, and assistant
  regenerate actions; editing or regenerating an older turn replaces the
  visible suffix of the current linear conversation;
- a fixed composer with attachment picker, growing textarea, and send/stop
  control.

`Enter` sends, `Shift+Enter` inserts a line break, and IME composition never
triggers send. A running generation prevents a second send. Leaving the
article cancels its active run; merely closing the panel does not.

## Scope limits

The first release does not add web search, multi-article chat, OCR, office-file
parsing, audio/video support, image generation/editing, cross-origin Web-view
selection injection, vector storage, cloud chat correctness dependencies,
complex multi-thread management, or concurrent chat generations.

Unsupported or over-budget input fails before the Provider request. Shale
never silently removes an image, truncates the article, or treats an
unparseable attachment as empty text.

If a Provider reports a retryable streaming failure before any answer text is
emitted, Article Chat retries the Provider request once. It never retries after
visible output has started, so persisted and rendered answer text cannot be
duplicated.

