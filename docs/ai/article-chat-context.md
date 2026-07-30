# Article Chat context strategy

## Invariants

- The system instruction and current question are always present.
- The current selection and its paragraph are always present when supplied.
- A user-attached image is either sent or causes a visible preflight error.
- Article omission or compression is reflected by the public context mode.
- Stable system and article prefixes use deterministic byte representation.
- No context mode treats a Provider-side conversation as authoritative memory.

## Level 1: complete article

When the budget permits, the request contains the fixed system instruction,
complete cleaned article, original recent history, selection, attachment text
and images, and the current question.

The visible label is:

```text
使用完整文章上下文
```

## Level 2: compressed history

When the article fits but the conversation does not, early turns are converted
to a structured history summary while the complete article and recent original
turns remain. The summary preserves unresolved questions, claims already
established, user preferences relevant to answers, and referenced attachment
facts.

The visible label is:

```text
已压缩早期对话，文章全文保持完整
```

## Level 3: article map

When the article alone exceeds the safe budget, every `ContentSegment` is
analysed and cached. Each analysis records:

- main ideas;
- terms and definitions;
- evidence and data;
- examples;
- limits, caveats, and counterexamples;
- author stance;
- relationship to adjacent segments.

The merged article map is sent with deterministic relevant original segments,
their neighbours, the current selection, recent messages, current attachments,
and the question.

The visible label is:

```text
文章过长，正在使用全文分析缓存和相关原文
```

If this required material still exceeds the budget, Shale returns
`CHAT_CONTEXT_TOO_LARGE` before any network request.

## Compression order

Optional material is reduced in this order:

1. expired and unreferenced attachments;
2. early conversation;
3. duplicated attachment text;
4. attachment text unrelated to the current question;
5. complete-article representation.

The system instruction, current question, current selection, selection
paragraph, explicitly attached images, and context-mode declaration are never
discarded.

## Budgeting

Budgeting uses deterministic token estimates with explicit safety reserve for
the answer. Model context limits come from the saved Chat configuration; an
unknown limit uses a conservative default. Byte limits remain independent of
token estimates.

## Cache identity

Formatted context and article-map records are keyed by:

```text
entryId
sourceContentHash
article-chat-v1
analysisModelFamily
compressionVersion
```

The cache is regenerated after any key changes. It is an optimization only;
stored cleaned content remains the source of truth.

Image normalization is keyed by content hash, normalized MIME type, and
normalization version. Reused bytes still receive distinct message links.

## System instruction

The `article-chat-v1` instruction identifies the model as Shale Article Guide.
It requires answers to rely primarily on supplied article context, distinguish
article statements from inference and outside knowledge, keep the user's
language, relate selections to surrounding argument, and admit missing or
unreadable evidence.

Article text, selections, attachments, images, filenames, metadata, and old
messages are explicitly declared untrusted. The model must ignore instructions
inside them that request role changes, hidden prompts, credentials, or private
reasoning.

Context is enclosed in typed XML-like boundaries:

```xml
<article-context mode="full|article-map"
  complete-original="true|false" content-hash="...">
  <metadata>...</metadata>
  <content>...</content>
</article-context>
```

Selections use `<selected-text>` and text attachments use `<attachments>`.
Images remain native Provider content parts rather than Base64 text.

