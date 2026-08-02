# Article Chat contracts

## Shared domain

The implementation defines its serializable types in:

```text
src/shared/contracts/chat.types.ts
src/shared/contracts/chat.ipc.ts
src/shared/errors/chat.errors.ts
```

The public domain includes `ChatThread`, `ChatMessage`, `ChatAttachment`,
`ChatSelectionContext`, `ChatContextMode`, `ChatSendRequest`, `ChatRun`,
`ChatRegenerateRequest`, `ChatState`, and `ChatStreamEvent`.

Chat run states are:

```text
idle
running
succeeded
failed
interrupted
```

Persisted message states are `completed`, `failed`, and `interrupted`. Context
modes are `full`, `history-compressed`, and `article-map`.

Each stream event includes all four identities:

```text
runId
threadId
entryId
messageId
```

Renderer also creates an opaque, bounded `operationId` for each
`chat:send`, `chat:retry`, and `chat:regenerate` invocation. It is runtime-only
and is never persisted. Before Main returns the durable `runId`, cancellation
uses this `operationId`; after streaming starts, cancellation may use the
`runId`. A `chat:cancel` request contains exactly one of those identities and
never uses `entryId` as a cancellation key.

## IPC surface

Preload exposes domain methods backed by:

```text
chat:get
chat:send
chat:cancel
chat:retry
chat:regenerate
chat:attachment-pick
chat:attachment-import-clipboard-image
chat:attachment-remove
chat:attachment-preview
chat:stream
```

Handlers validate both payloads and that the sender is the main frame of the
main window. Clipboard import accepts bytes, a suggested display name, and a
declared MIME type but never an arbitrary path. File picking receives only
picker options; Main owns the selected path.

Chat model selection also uses the additive read-only
`provider:list-chat-models` channel. Main reads the saved Chat credential,
queries the configured Provider's model-catalog endpoint, and returns only
safe model metadata (`id`, optional display name, description, and owner).
The API Key is never returned to Preload or Renderer. Selecting a model saves
the normal Provider profile, so the Chat composer and Provider settings always
show the same active Chat model. If discovery fails, Renderer keeps the
provider preset suggestions as an offline fallback.

## Provider-neutral messages

Summary, Translation, and Tag continue to use the legacy `prompt` request.
Chat uses `systemInstruction` and `messages`.

```ts
type ProviderMessageRole = 'user' | 'assistant';

type ProviderContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      mimeType: 'image/png' | 'image/jpeg';
      bytes: Uint8Array;
    };

interface ProviderMessage {
  role: ProviderMessageRole;
  content: ProviderContentPart[];
}
```

A request cannot contain both `prompt` and `messages`. Adapters validate image
type and size. They map the neutral contract as follows:

| Adapter | System | Text/image mapping |
|---|---|---|
| OpenAI-compatible | system message | text and `image_url` parts |
| Anthropic | top-level `system` | text and Base64 image source blocks |
| Gemini | `systemInstruction` | text and `inlineData`; assistant → model |

Provider image rejection becomes `CHAT_IMAGE_UNSUPPORTED` and preserves the
draft and attachment references.

## Persistence identity

A thread belongs to one `entryId`, cleaned-content hash, and prompt version.
Changing the article content hash creates a new active conversation identity.

User message and run creation are transactional. A retry identifies the
existing run/user message and does not duplicate the question. Attachments are
linked to messages through an ordered join table, allowing content-addressed
files to be reused without conflating message references.

Editing a user message or regenerating its assistant answer uses
`chat:regenerate`. The request identifies the persisted user message and may
include replacement question text. Main reuses the persisted selection and
attachments, marks that user turn and every later current-branch message with
`supersededAt`, and creates a new transactional user/assistant/run graph. Only
messages whose `supersededAt` is null are returned as the current linear
conversation. Superseded runs and attachment links remain durable so usage
identity and private-file lifecycle are not broken.

Article-context caches use:

```text
entryId
sourceContentHash
contextPromptVersion
analysisModelFamily
compressionVersion
```

Any identity change invalidates the cached formatted context, segment
analyses, and article map.

## Cancellation and Usage boundary

Main registers one active runtime object before context preparation and passes
its single `AbortSignal` through article preparation, segment analysis, the
answer Provider, deltas, and final persistence. Cancellation is checked before
Provider calls, asynchronous continuation, cache writes, deltas, and terminal
persistence. Exact operation identity prevents a late panel cleanup from
canceling a newer task for the same article.

Usage begins only at a real Provider request boundary. A cancellation before
any Provider call creates no Usage row; segment-analysis requests account only
for the segments actually started; the final answer starts its Usage record
immediately before the answer Provider call. Active requests are settled once
through `interrupt()` on cancellation.
