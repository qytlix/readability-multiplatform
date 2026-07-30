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
`ChatState`, and `ChatStreamEvent`.

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

## IPC surface

Preload exposes domain methods backed by:

```text
chat:get
chat:send
chat:cancel
chat:retry
chat:attachment-pick
chat:attachment-import-clipboard-image
chat:attachment-remove
chat:stream
```

Handlers validate both payloads and that the sender is the main frame of the
main window. Clipboard import accepts bytes, a suggested display name, and a
declared MIME type but never an arbitrary path. File picking receives only
picker options; Main owns the selected path.

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

