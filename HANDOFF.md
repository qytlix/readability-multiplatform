# Shale Article Chat handoff

## 1. Handoff point

- Date: 2026-07-30
- Branch: `cyj-aichat`
- Base: `origin/cyj-aichat` at `e490720`
- Completion point: `CHAT-00` through `CHAT-10` are implemented and
  automatically verified
- The feature branch remains local and has not been pushed
- Scope interpretation: every `CHAT-00` through `CHAT-10` work package is a
  milestone and must contain at least five single-purpose commits

The original handoff stopped at the backend/runtime boundary. The continuation
now delivers the Reader UI, file and image attachments, selection questions,
usage/recovery hardening, and Windows packaging verification.

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

### CHAT-06 — Reader layout and base conversation UI

1. `57fa264` `feat(chat): preserve reader column layout`
2. `94708c3` `feat(chat): add reader chat entry point`
3. `b411bd7` `feat(chat): render persisted article conversation`
4. `4ae947f` `feat(chat): send stop and retry answers`
5. `7af19d4` `test(chat): harden renderer chat lifecycle`

### CHAT-07 — text, HTML, and PDF attachments

1. `ea8f9c8` `feat(chat): define file attachment IPC`
2. `fc43026` `feat(chat): extract safe text attachments`
3. `e42b508` `feat(chat): extract selectable PDF text`
4. `59f56bc` `feat(chat): import and expire file attachments`
5. `05389e7` `feat(chat): manage file attachment chips`

### CHAT-08 — image attachments and clipboard input

1. `68238c6` `feat(chat): normalize safe image inputs`
2. `b47bba7` `feat(chat): store normalized images by content`
3. `d6ed277` `feat(chat): import persisted image attachments`
4. `43a7f7d` `feat(chat): paste and preview chat images`
5. `af690df` `test(chat): verify multimodal image delivery`

### CHAT-09 — Reader selection questions

1. `2ef02d4` `feat(chat): map reader selection context`
2. `c27361a` `feat(chat): show reader selection action`
3. `47013ae` `feat(chat): route reader selections to questions`
4. `555a444` `feat(chat): compose questions from selections`
5. `d2ce075` `test(chat): harden selection question boundaries`

### CHAT-10 — integration and release hardening

1. `979b77a` `feat(chat): record article map analysis usage`
2. `992af0e` `feat(chat): attribute map usage to durable runs`
3. `a0a8aea` `fix(chat): surface context preparation failures`
4. `ee4ca2f` `fix(chat): whitelist lifecycle diagnostics`
5. `cc24d41` `test(chat): verify packaged runtime assets`
6. `4d8320d` `test(chat): recover durable runs after restart`

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
- `chat.pickAttachments`
- `chat.removeAttachment`

Main validates every request and verifies the sender before calling
`ChatService`.

## 4. Verification completed

Completion run on Windows 11 x64 in this workspace:

- `npm run typecheck`: passed
- `npm run lint`: passed with 0 errors and 123 existing warnings
- `npm test`: 155 test files passed, 1168 tests passed
- `npm run verify:chat-image`: passed
- `npm run package`: passed
- `npm run verify:chat-package`: passed
- `git diff --check`: passed

The full test process exited successfully. Vitest printed worker-termination
timeout notices after completion for 11 test files; they did not fail or skip
tests.

Focused Chat coverage includes migrations, stores, transactions, context
selection, prompt boundaries, history compression, Provider mappings,
capability checks, streaming persistence, busy-state isolation, cancellation,
late output, retry, attachment validation, Reader layout, clipboard/selection
behavior, restart recovery, IPC validation, safe logging, service assembly,
and packaged runtime assets.

## 5. Remaining human verification

Automated implementation and Windows packaging are complete. The following
acceptance work still requires a human and is not claimed as completed:

- visual and interaction smoke testing at the documented widths on Windows 11;
- native Wayland layout, picker, clipboard, shutdown, and restart smoke tests;
- real text-only and image-capable Provider tests using owner-supplied keys;
- human review of Preload/IPC, migrations, secret handling, prompt boundaries,
  diagnostics, attachment storage, and Provider serialization.

Per-segment article-map usage and final-answer usage now share one durable Chat
run and attempt identity. Context-preparation failures are persisted and become
visible after the Renderer reloads state.

## 6. Required human review

Before accepting these milestones, a human should review:

- Preload exposure and IPC authorization/validation.
- migrations `026` through `029` and continuous upgrade behavior.
- secret-reference reuse and cleanup.
- Provider-native image/message serialization.
- prompt-injection boundaries and the no-silent-truncation policy.
- structured logs and diagnostic output for privacy.

No real API key was used and no external Provider call was made. Windows x64
automated packaging passed; Windows GUI and native Wayland observation remain
human acceptance items.

## 7. Recommended next work

Proceed with human acceptance and review. Record Windows/Wayland observations
and real Provider results in `docs/ai/article-chat-verification.md`. Fix only
verified defects on this feature branch, then open the owner-approved PR; do
not treat automated GUI assertions as a substitute for human observation.

## 8. Repository note

During CHAT-00, the workspace was externally switched to `main` while a
documentation commit was being created. Commit `819acdf` exists on local
`main`; the same change was cherry-picked to `cyj-aichat` as `a1498a2`.
Nothing was reset or deleted because the local `main` history may belong to the
owner. Before pushing `main`, the owner should decide whether to keep or remove
that local-only commit. This does not affect the `cyj-aichat` branch content.

The feature branch has not been pushed by this handoff.
