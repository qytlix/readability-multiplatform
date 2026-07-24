# Advanced Translation M6 verification record

> Date: 2026-07-25
>
> Branch: `cyj-translation-advanced`
>
> Issue: [#60](https://github.com/qytlix/readability-multiplatform/issues/60)

## Automated verification

| Check | Result |
|---|---|
| TypeScript | `npm run typecheck` passed |
| Automated tests | `npm test`: 89 files, 662 tests passed |
| Lint | `npm run lint`: 0 errors, 120 pre-existing warnings |
| Legacy upgrade | Schema 011 → migrations 012–015, preserved IDs/FKs, interruption reconciliation, and second startup passed |
| Smart context | Short/long/cache/fallback/cancel plus deterministic oversized-document beginning/middle/end sampling passed |
| Sensitive diagnostics | API Key, Authorization/Bearer, and article-body canaries are absent from Translation diagnostics |
| Production dependencies | `npm audit --omit=dev`: 0 vulnerabilities |
| Native dependency | `npm run ensure:native` passed for Windows x64 |
| Package | Electron Forge Windows x64 package completed |
| Packaged startup | Packaged app remained running for an 8-second process smoke; all spawned test processes were stopped afterward |
| Offline terminology artifact | Source and packaged SHA-256 both `7b312d935eb464e22ead4e54becb7ac514a94295fd51164e6f9722a996bc2f43` |
| Diff hygiene | `git diff --check` passed |

The full development-dependency audit still reports 31 findings: 3 low, 1
moderate, 26 high, and 1 critical. They are confined to Electron Forge/Vite
build tooling; the suggested automatic repair includes a Forge downgrade and a
Vite major upgrade. No `npm audit fix` was run. Upgrade and cross-platform
packaging validation should be handled in a dedicated dependency task.

## Security audit scope

- Provider secrets remain Main-only and are represented in SQLite by an opaque
  `apiKeyRef`.
- Translation prompts isolate article text, expert guidance, context fragments,
  and terminology data from immutable safety and output-format rules.
- User expert YAML rejects aliases, custom tags, unsafe mappings, unknown
  variables, excessive size/depth, and attempts to replace built-ins.
- User terminology CSV validates UTF-8/RFC-4180 structure, field bounds,
  language codes, duplicates, and conflicts before a transactional write.
- Provider HTML output still passes sanitization and source-structure
  validation before persistence or Renderer delivery.
- Repository secret-pattern scan found only explicit fake-key test values; no
  Authorization token or production credential was found.

## Human verification still required

These checks are intentionally not marked complete by the coding agent because
they require a person, credentials, or a native Linux environment:

- [ ] Windows 11 GUI: provider settings, expert upload/replace/remove, 34
  terminology toggles and restart persistence, CSV preview/import/remove.
- [ ] Windows 11 Reader: full translation progress, Original/Bilingual switch,
  inline word/phrase/sentence placement, shortcut changes, selection cancellation,
  and restart cache reuse.
- [ ] Native Wayland: repeat the Settings, Reader, upgrade, restart, and package
  smoke tests.
- [ ] Opt-in real-provider checks for OpenAI, DeepSeek, OpenRouter, Anthropic,
  and Gemini; confirm keys remain absent from SQLite, IPC responses, UI state,
  logs, and diagnostic export.
- [ ] One translation-quality sample for each target language, including Hong
  Kong terminology/orthography and the `zh-TW` fallback behavior.
- [ ] Pronunciation quality for IPA, Pinyin, Jyutping, Kana, and Revised
  Romanization, plus contextual polysemy and malformed structured-output UX.
- [ ] Product/Reader, typed IPC/Preload, SQLite, and security owners sign off
  the affected public boundaries.

Issue #60 should move from Review to Done only after the checklist above is
recorded by the responsible humans.
