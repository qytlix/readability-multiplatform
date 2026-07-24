# ADR-001: Advanced Translation contracts and boundaries

- Status: Accepted
- Date: 2026-07-24
- Owner: AI / Translation
- Reviewers: Product/Reader owner, shared IPC and SQLite owners
- Related issue: https://github.com/qytlix/readability-multiplatform/issues/60

## Context

Translation P0 already provides deterministic Reader segmentation, progressive
segment persistence, safe translated-HTML validation, an OpenAI-compatible
streaming provider, a read-only English/Chinese AGROVOC pack, and non-persisted
inline Translation. Issue #60 expands that implementation to eight languages,
five provider presets, document-level context, AI experts, multiple terminology
libraries, user imports, and richer inline lookup.

This expansion changes shared contracts, SQLite constraints, prompt composition,
provider resolution, cache compatibility, Settings, Preload, and Reader
consumers. The boundaries below must be kept stable before implementation is
split into independent Issues.

## Decision

### 1. Language contract

The supported language identity is shared by full-article Translation, inline
Translation, context analysis, expert overrides, and terminology entries:

| Code | Display name | Notes |
|---|---|---|
| `en` | English | Existing language remains supported |
| `zh-CN` | 简体中文 | Simplified Chinese |
| `zh-HK` | 繁體中文（香港） | Must request Hong Kong usage, not `zh-TW` |
| `ja` | 日本語 | Japanese |
| `ko` | 한국어 | Korean |
| `de` | Deutsch | German |
| `fr` | Français | French |
| `es` | Español | Spanish |

Full and inline requests use `sourceLanguage: 'auto' | SupportedLanguage` and
an explicit `targetLanguage: SupportedLanguage`. The Settings default remains
automatic source detection. A manual source selector is required because short
Latin-script text cannot be classified reliably by a conservative local
heuristic.

Target-language short-circuiting remains conservative. Empty content, URLs, and
high-confidence matching scripts may skip a provider call. Ambiguous,
Latin-script, mixed-language, and short content must use the provider unless the
user explicitly selected the source language.

### 2. Provider presets and wire protocols

The Renderer selects a provider preset. Main maps it to a protocol adapter:

| Provider preset | Protocol adapter |
|---|---|
| `openai` | `openai-chat-completions` |
| `deepseek` | `openai-chat-completions` |
| `openrouter` | `openai-chat-completions` |
| `anthropic` | `anthropic-messages` |
| `gemini` | `gemini-generate-content` |
| `custom-openai-compatible` | `openai-chat-completions` |

`ProviderKind = 'openai-compatible'` is a migration input, not a new-profile
output. Existing profiles migrate without losing their encrypted secret
reference. Model IDs become provider-specific validated strings rather than a
hard-coded GPT union.

`SummaryProvider` is renamed to a neutral text-generation interface used by
Summary, Translation, context analysis, and inline Translation. The interface
accepts a fully composed prompt and yields text deltas. Authentication,
request shape, stream parsing, usage extraction, and provider error mapping stay
inside adapters.

The Main process remains the only process allowed to read secrets or contact a
model API. Renderer and Preload receive only serializable profile metadata,
task state, results, and stable errors.

### 3. Prompt composition

Prompt composition has immutable and extensible layers, in this order:

1. Shale safety, untrusted-input boundaries, HTML preservation, and output
   contract;
2. source/target language instruction;
3. selected expert's domain and style strategy;
4. document context theme and style guide;
5. matched entries from enabled terminology libraries;
6. article segments wrapped as untrusted data.

Experts cannot replace layers 1, 2, or 6. Full-article output remains Shale's
ordered NDJSON envelope and must pass the existing HTML structure validator
before persistence.

Every prompt family has an explicit version. Translation cache compatibility
includes the full prompt identity instead of relying on a single global
terminology-pack version.

### 4. Smart context

Smart context is opt-in and uses the active user-configured provider. Shale does
not call Immersive Translate's proprietary context endpoint.

The normalized analysis result is:

```ts
interface TranslationContext {
  schemaVersion: 1;
  detectedSourceLanguage?: SupportedLanguage;
  theme: string;
  keyTerms: Array<{
    source: string;
    suggestedTarget?: string;
    meaning?: string;
  }>;
  styleGuide: string[];
}
```

Short documents use one analysis request. Long documents use deterministic
chunks followed by a merge request; exact size budgets are provider-runtime
configuration, not part of the public IPC contract.

Context analysis starts before segment translation. Translation waits only for a
bounded period. Timeout, invalid structured output, cancellation, or provider
failure produces an observable warning and falls back to normal Translation; it
does not fail an otherwise valid translation run.

Context cache identity includes:

- source content hash;
- source and target language;
- provider profile and model;
- expert ID and content hash;
- context prompt version.

### 5. AI experts

Built-in experts are imported from a pinned upstream snapshot. User experts use
UTF-8 YAML and are stored separately from immutable built-ins.

The Shale expert model accepts:

- identity: `id`, `version`, `name`, `description`, `author`;
- optional presentation metadata: `details`, `i18n`, `matches`, `avatar`;
- translation strategy: `systemPrompt`, `multipleSystemPrompt`, `prompt`,
  `multiplePrompt`, `langOverrides`, `env`, `enableRichTranslate`.

The importer rejects duplicate IDs, unsupported value types, unsafe YAML tags,
oversized/deep documents, and unknown template variables. Remote avatar metadata
may be retained but is not fetched by Renderer. A YAML library must be declared
as a direct dependency before implementation; transitive lockfile packages are
not an application contract.

Immersive expert files contain legacy, version-patched, and output-format fields.
The built-in import compiler selects the newest applicable system/domain
instruction and discards the upstream transport envelope. Shale always supplies
its own NDJSON transport and HTML safety rules. Unsupported expert features are
reported during the resource build instead of being silently ignored.

### 6. Terminology libraries

Terminology is modeled as a catalog of libraries rather than one global pack.
Bundled resources are immutable; user libraries are writable application data.

The first-install state has exactly one enabled library, `builtin:default`. It
contains the existing AGROVOC English/Chinese data plus the pinned upstream
default preservation entries. This keeps current behavior while meeting the
"only default enabled" requirement. All other bundled libraries start disabled.

Entries use:

```ts
interface TerminologyEntry {
  source: string;
  target?: string;
  sourceLanguage?: SupportedLanguage | 'auto';
  targetLanguage?: SupportedLanguage;
}
```

An empty target means preserve the source term. Lookup precedence is:

1. enabled user library;
2. exact target-language match;
3. language-independent entry;
4. explicit `zh-TW` compatibility fallback for a `zh-HK` target;
5. enabled built-in library;
6. more specific source match before normalized/alias match.

Conflicting entries at the same precedence are surfaced in import preview and
resolved deterministically by library order. Cache identity uses a deterministic
hash of the enabled library IDs, versions, and content hashes.

The `zh-TW` fallback remains marked in provenance and the prompt tells the model
to adapt it to Hong Kong terminology. A user or built-in `zh-HK` entry always
wins; upstream Traditional Chinese data is never silently relabeled as native
Hong Kong terminology.

User imports use UTF-8 CSV with the header `source,target,tgt_lng`.
`source` is required; `target` and `tgt_lng` are optional. CSV quoting follows
RFC 4180. Import is transactional and provides a preview with accepted rows,
duplicates, warnings, and line-numbered errors.

### 7. Inline Translation

Inline Translation uses the same language, provider, expert, and terminology
contracts but has a separate prompt and response schema:

```ts
interface InlineTranslationResult {
  inputKind: 'word' | 'phrase' | 'sentence';
  detectedSourceLanguage: SupportedLanguage;
  translation: string;
  pronunciation?: string;
  pronunciationSystem?:
    | 'ipa'
    | 'pinyin'
    | 'jyutping'
    | 'kana'
    | 'revised-romanization';
  senses: Array<{
    partOfSpeech: string;
    definitions: string[];
    contextualMeaning?: string;
    examples: Array<{
      source: string;
      translation: string;
    }>;
  }>;
}
```

Words return pronunciation and grouped senses where available. Phrases
prioritize contextual translation and may return an empty `senses` array.
Sentences return no pronunciation and an empty `senses` array. Structured parse
failure is explicit; arbitrary model text is not silently presented as a
complete dictionary card.

The pronunciation system is derived from the detected source language, not the
target: English/German/French/Spanish use IPA, Simplified Chinese uses Pinyin,
Hong Kong Chinese uses Jyutping, Japanese uses kana reading, and Korean uses
Revised Romanization. Inline results remain non-persisted. Renderer may request
`translation:inline-cancel`, but it does not receive an arbitrary IPC channel
or provider cancellation object.

### 8. Persistence and migrations

All schema changes are append-only migrations. Existing translation rows remain
readable. Migration work must cover:

- adding a provider-preset field while retaining the legacy constrained
  provider-kind field referenced by existing child tables;
- widening language CHECK constraints when M2 adds the expanded language set;
- preserving legacy provider profiles and secret references;
- context cache;
- expert metadata and user expert content;
- terminology library catalog, entries, enable state, and provenance;
- expanded translation compatibility identity.

No migration deletes or rebuilds user articles, summaries, translations, API
keys, or the current terminology resource as a recovery shortcut.

Migration 012 implements the provider part by adding `providerPreset` and
backfilling it from the existing base URL. It deliberately does not rebuild
`ai_provider_profile`: that table is referenced by existing Summary and
Translation rows, so an in-place additive migration preserves profile IDs,
encrypted-secret references, and child foreign keys.

Migration 013 implements the language part by copying both Translation tables
as one transaction before replacing the constrained legacy tables. Existing
result and segment IDs are copied explicitly, legacy rows receive
`sourceLanguage = 'auto'`, and the new compatibility identity includes source
and target language. A foreign-key check verifies the copied segment-to-result
relationship.

## Consequences

- Provider work can proceed independently from language UI after the shared
  preset/protocol contract is merged.
- Expert and terminology resources require build-time normalization rather than
  direct runtime interpretation of upstream files.
- Smart context adds at least one model request and can add more for long
  documents; Settings and task state must disclose this.
- Existing P0 results remain available, but changed prompt compatibility may
  require explicit regeneration before an old result is shown as compatible.
- Public contract, Preload, SQLite, secret handling, and HTML-output changes
  require affected-owner review.
