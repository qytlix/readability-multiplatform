# Article Chat verification

## Milestone gates

Each `CHAT-00` through `CHAT-10` milestone is delivered as at least five
single-purpose commits. A milestone is complete only after its focused tests,
typecheck, diff review, and privacy review pass.

Migration numbers in the original design were based on schema version 021.
The implementation starts after the repository's existing migration 025 and
preserves all existing migrations and user data.

## Automated verification

### Contracts and context

- request and stream-event validation;
- stable prompt boundaries and injection resistance;
- no silent article truncation;
- accurate public context-mode labels;
- selection preservation;
- deterministic budget, cache identity, and relevant-segment choice.

### Provider adapters

- legacy prompt requests remain compatible;
- OpenAI-compatible, Anthropic, and Gemini message/image mappings;
- assistant-to-model role mapping for Gemini;
- stable image-capability errors;
- finish reason, cancellation, streaming order, and usage remain intact.

### Persistence and runtime

- continuous migration from migration 001 and from migration 025;
- independent Chat route inheritance and secret-reference cleanup;
- thread/message/run/attachment/cache CRUD and transactions;
- content-hash conversation identity;
- success, failure, cancellation, retry, late-event isolation, and restart
  interruption;
- chat usage records and diagnostic-export redaction.

### Attachments

- signature does not trust extension or declared MIME;
- size, empty-image, dimension, and pixel limits;
- PNG transparency and JPEG/WebP normalization;
- deterministic pasted-image names and content-hash reuse;
- text/HTML/PDF parse failures are visible;
- orphan expiry and path-containment checks.

### Renderer

- all four sidebar/entry-list collapsed-state combinations restore exactly;
- `EntryDetail` stays mounted and its scroll position remains;
- Enter, Shift+Enter, IME composition, stop, and retry;
- image paste with text-only, image-only, and mixed clipboard content;
- attachment preview/removal and partial import failure;
- local and bilingual Reader selection menu;
- listener cleanup and mismatched-event rejection.

The completion run includes focused tests, the full test suite, lint,
typecheck, and packaging on the available host.

## Human verification

Human observation remains required on Windows 11 and native Wayland for:

- widths 1100, 1280, 1440, and 1920;
- four collapsed-column combinations;
- Reader, bilingual/Translation, and Dual modes;
- scroll-position retention;
- native file picker;
- images copied from a browser and screenshot tool;
- transparent PNG, JPEG, WebP, mixed text/images, and multiple images;
- a real text Provider and a real image-capable Provider;
- visible rejection by a text-only model;
- long article/history/attachment behavior;
- offline, stop, article-switch, shutdown, and restart behavior.

## Privacy sentinel

Tests and final diff review must verify that logs and diagnostics contain none
of:

- API keys, Authorization headers, or secret references;
- article, question, conversation, selection, or attachment text;
- image bytes, Base64, original absolute paths, EXIF, or clipboard source.

Allowed diagnostics are limited to identifiers, Provider kind/model, context
mode, counts, normalized dimensions and byte sizes, duration, usage, and stable
error codes.

## Status

| Milestone | Automated | Human | Notes |
|---|---|---|---|
| CHAT-00 | In progress | Review required | Contracts and ADR |
| CHAT-01 | Not started | Not started | Chat Provider route |
| CHAT-02 | Not started | Not started | Multimodal adapters |
| CHAT-03 | Not started | Not started | Schema and stores |
| CHAT-04 | Not started | Not started | Context and compression |
| CHAT-05 | Not started | Not started | Runtime, IPC, usage |
| CHAT-06 | Not started | Not started | Layout and base UI |
| CHAT-07 | Not started | Not started | Text/PDF attachments |
| CHAT-08 | Not started | Not started | Images and clipboard |
| CHAT-09 | Not started | Not started | Selection questions |
| CHAT-10 | Not started | Not started | Integration and release |

