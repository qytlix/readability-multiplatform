# Shale Article Chat handoff

## 1. Handoff point

- Date: 2026-07-30
- Branch: `cyj-aichat`
- Base: `origin/cyj-aichat` at `e490720`
- Stop point: `CHAT-05` completed; `CHAT-06` has not started
- Local branch state before this handoff commit: 31 commits ahead of
  `origin/cyj-aichat`
- Scope interpretation: every `CHAT-00` through `CHAT-10` work package is a
  milestone and must contain at least five single-purpose commits

This handoff intentionally stops at the backend/runtime boundary requested by
the owner. There is no Article Chat panel or Reader entry point yet.

## 2. Completed milestones and commits

### CHAT-00 — scope, boundaries, contracts, context, and verification

1. `03b4add` `docs(chat): define article chat product scope`
2. `23c3b57` `docs(chat): record process and security boundaries`
3. `cd0ae8b` `docs(chat): specify shared and provider contracts`
4. `a1498a2` `docs(chat): fix context compression invariants`
5. `8f43f93` `docs(chat): define verification and privacy gates`

### CHAT-01 — independent Chat Provider route

1. `75e4a4d` `feat(chat): migrate independent provider route`
2. `ac7d3bb` `feat(chat): expose provider profile route`
3. `f878138` `feat(chat): manage independent provider secrets`
4. `003a13a` `feat(chat): add dedicated provider settings card`
5. `d5b637f` `feat(chat): test dedicated provider connection`

### CHAT-02 — multimodal Provider contracts and adapters

1. `0ff358a` `feat(chat): define multimodal provider contract`
2. `0c7d7c4` `feat(chat): map OpenAI multimodal messages`
3. `1f6858c` `feat(chat): map Anthropic multimodal messages`
4. `32b7648` `feat(chat): map Gemini multimodal messages`
5. `ccaaad0` `feat(chat): verify provider image capability`

### CHAT-03 — persistence model and stores

1. `0d00bce` `feat(chat): create conversation schema`
2. `c531d03` `feat(chat): define persisted chat domain types`
3. `1260919` `feat(chat): persist content-scoped conversations`
4. `8b46b65` `feat(chat): transact and recover chat runs`
5. `6e561d5` `feat(chat): persist ordered attachment references`

### CHAT-04 — context budget, compression, and article maps

1. `9be13bf` `feat(chat): cache versioned article context`
2. `2a0bc9f` `feat(chat): build injection-safe article prompts`
3. `bffb392` `feat(chat): choose observable context modes`
4. `37182a6` `feat(chat): compress early conversation history`
5. `783f114` `feat(chat): build and reuse article maps`

### CHAT-05 — runtime, IPC, usage, recovery, and lifecycle

1. `7e3fc3f` `feat(chat): extend usage ledger for chat`
2. `5aed7fb` `feat(chat): stream and persist article answers`
3. `f5cc556` `feat(chat): cancel and retry isolated runs`
4. `32b46a3` `feat(chat): expose typed chat IPC runtime`
5. `905e610` `feat(chat): assemble runtime and shutdown cleanup`
6. `5d3cba3` `test(chat): update cross-feature regression gates`

## 3. Delivered architecture

### Provider and security

- Summary, Translation, Tag, and Chat routes can use different Provider kinds,
  base URLs, models, and secret references.
- Chat image capability is explicit and tested; a text-only route fails with a
  stable `CHAT_IMAGE_UNSUPPORTED` error.
- OpenAI-compatible, Anthropic, and Gemini adapters share a Provider-neutral
  message/image contract.
- Renderer receives neither API keys nor arbitrary IPC access.

### Persistence

- Migration `026`: independent Chat Provider route.
- Migration `027`: threads, messages, runs, attachments, and ordered message
  attachment references.
- Migration `028`: versioned article-context and article-map cache.
- Migration `029`: Chat task/request kinds in the usage ledger.
- A conversation is bound to `entryId + sourceContentHash`; changed article
  content creates a new active thread instead of silently reusing stale
  context.
- User message, assistant placeholder, and run are created transactionally.
- Incomplete running records are reconciled to `interrupted` on restart.

### Context and runtime

- Full article Markdown is used when it fits.
- Older conversation history is compressed deterministically before article
  degradation.
- Oversized articles use a cached, Provider-generated segment map plus relevant
  original passages; the UI contract exposes the actual context mode.
- Article text, selections, history, and attachments are explicitly delimited
  as untrusted reference data.
- `ChatService` persists streamed deltas, isolates late events by run identity,
  supports stop/retry, records final-answer usage, and emits identity-rich
  stream events.
- Structured Chat logs contain lifecycle metadata only, not prompts, article
  text, questions, selections, attachments, paths, or secrets.
- Main startup assembles the complete Chat runtime. Normal application shutdown
  interrupts an active Chat run.

### IPC

The restricted Preload API now exposes:

- `chat.get`
- `chat.send`
- `chat.cancel`
- `chat.retry`
- `chat.onEvent`

Main validates every request and verifies the sender before calling
`ChatService`.

## 4. Verification completed

Run on Windows in this workspace:

- `npm run typecheck`: passed
- `npm run lint`: passed with 0 errors and 123 pre-existing warnings
- `npm test`: 140 test files passed, 1091 tests passed
- `git diff --check`: passed

The full test process exited successfully. Vitest printed one worker-termination
timeout notice after completion for `feed-service.test.ts`; it did not fail or
skip a test.

Focused Chat coverage includes migrations, stores, transactions, context
selection, prompt boundaries, history compression, Provider mappings,
capability checks, streaming persistence, busy-state isolation, cancellation,
late output, retry, restart recovery, IPC validation, safe logging, and service
assembly.

## 5. Deliberately not implemented

These belong to later milestones and must not be mistaken for regressions:

- `CHAT-06`: Reader button, four-state column layout, Chat panel, message UI,
  composer, stop/retry controls, and layout restoration.
- `CHAT-07`: native file picker, text/HTML/PDF extraction, attachment chips,
  limits, expiry, and cleanup.
- `CHAT-08`: image normalization/storage, clipboard images, preview, and the
  production `ChatAttachmentContentLoader`.
- `CHAT-09`: Reader and bilingual selection menus and selection-question UI.
- `CHAT-10`: end-to-end integration, packaging, Windows/Wayland human
  verification, and real Provider smoke tests.

The schema already supports text/image attachment metadata, but there is no
attachment import service. `ChatService` therefore has no production image
loader yet and will reject actual image sending until `CHAT-08`.

The usage ledger distinguishes `chat-answer` and `chat-segment-analysis`.
Final answers are recorded now. Per-segment article-map token usage is not yet
attributed to a persisted Chat run because map preparation currently occurs
before run creation; resolve that lifecycle ordering before final `CHAT-10`
usage acceptance.

## 6. Required human review

Before accepting these milestones, a human should review:

- Preload exposure and IPC authorization/validation.
- migrations `026` through `029` and continuous upgrade behavior.
- secret-reference reuse and cleanup.
- Provider-native image/message serialization.
- prompt-injection boundaries and the no-silent-truncation policy.
- structured logs and diagnostic output for privacy.

No real API key was used, no external Provider call was made, and no
Windows/Wayland GUI or packaging smoke test was performed in this handoff.

## 7. Recommended next work

Start `CHAT-06` from this branch and keep at least five single-purpose commits.
A safe sequence is:

1. define and test the four-column layout state model and snapshot restoration;
2. add the Reader toolbar Chat entry point without remounting `EntryDetail`;
3. build the panel shell and persisted-message rendering;
4. connect composer send/stop/retry behavior to the existing Preload API;
5. add event filtering, listener cleanup, IME/keyboard tests, and responsive
   layout regression tests.

Do not start file/image attachment behavior until the base composer and panel
lifecycle are stable.

## 8. Repository note

During CHAT-00, the workspace was externally switched to `main` while a
documentation commit was being created. Commit `819acdf` exists on local
`main`; the same change was cherry-picked to `cyj-aichat` as `a1498a2`.
Nothing was reset or deleted because the local `main` history may belong to the
owner. Before pushing `main`, the owner should decide whether to keep or remove
that local-only commit. This does not affect the `cyj-aichat` branch content.

The feature branch has not been pushed by this handoff.
