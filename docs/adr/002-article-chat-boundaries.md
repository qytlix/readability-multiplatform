# ADR 002: Article Chat boundaries

- Status: Accepted for implementation
- Date: 2026-07-30
- Decision owners: Product/Reader and AI
- Required reviewers: IPC, SQLite, and Security

## Context

Article Chat crosses Renderer layout, typed IPC, Main-only content and secret
access, SQLite persistence, local files, and third-party model transports.
Correctness and privacy must not depend on Renderer-provided article text,
arbitrary paths, Provider-side conversations, or implicit model capabilities.

## Decision

### Process ownership

- Renderer owns visible chat state, drafts, layout mode, and subscriptions.
- Preload exposes only the typed `chat` domain API.
- Main validates requests, resolves the current cleaned article, owns active
  runs, reads secrets, normalizes attachments, and calls Providers.
- Stores own chat, attachment, cache, and usage persistence.
- Shared modules contain serializable contracts and stable errors only.

Renderer sends an entry ID, question, optional selection, and attachment IDs.
It never sends authoritative article content, a filesystem path, an API key,
or a secret reference.

### Runtime identity

Every stream event carries `runId`, `threadId`, `entryId`, and `messageId`.
Renderer creates a non-persisted `operationId` before each send, retry, or
regenerate request. Cancellation uses that identity during context preparation
and the durable `runId` during streaming; it never targets an `entryId`. Only
one Chat run may be active, and one AbortController spans context preparation,
segment analysis, answer generation, deltas, and persistence. Article changes,
panel closure, unmount, and shutdown abort the exact active operation. Late or
mismatched events and cleanups are ignored, listeners are removed on unmount,
and a startup recovery step changes abandoned `running` rows to `interrupted`.

Cancellation classification requires an explicit Chat/Provider interruption
or an `AbortError` belonging to the active signal. A real fault observed before
a later cancellation remains a failure rather than being hidden as an
interruption.

### Content and attachment trust

Article text, selections, filenames, attachments, images, and previous user
messages are untrusted reference material. They cannot override the system
instruction.

File selection runs in Main. Clipboard import accepts only bounded bytes, a
suggested display name, and a declared MIME type; Main identifies and validates
the real type. Image bytes are decoded and re-encoded before storage beneath:

```text
app.getPath("userData")/chat-attachments/
```

Only a validated relative storage key is persisted. Original absolute paths,
EXIF location, clipboard source, Base64, and raw image data are not stored in
SQLite or logs. Recursive cleanup resolves and verifies the target remains
inside the dedicated attachment directory.

### Provider independence

Summary, Translation, Tag, and Chat retain separate routes and models. Chat
uses a Provider-neutral multi-message and multimodal contract. Provider-side
conversation IDs and prompt caches may optimize requests but never become a
correctness dependency.

Image capability is an explicit user setting. A request containing images is
rejected with `CHAT_IMAGE_UNSUPPORTED` when disabled or rejected by the
Provider; images are never dropped to manufacture a text-only request.

### Rendering

Assistant output uses a safe Markdown subset without raw HTML execution,
remote model-supplied images, or dangerous URL protocols. External links use
the existing guarded external-link API.

## Consequences

- Chat requires schema migrations, a separate Main runtime, typed Preload
  methods, and human review of schema, security, and exposed APIs.
- Attachments remain locally available and auditable, at the cost of explicit
  lifecycle and cleanup code.
- The context strategy is more work than silent truncation but keeps omissions
  visible and preserves the article-understanding product promise.
