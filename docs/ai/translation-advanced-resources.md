# Advanced Translation upstream resource inventory

This inventory freezes the upstream inputs researched for Issue #60. It is a
build-time acquisition plan, not a runtime network contract. M3 compiles the
pinned AI expert snapshot into a shipped offline resource; terminology remains
an M4 build input.

## Research snapshots

| Resource | Upstream | Snapshot |
|---|---|---|
| Immersive Translate release repository | https://github.com/immersive-translate/immersive-translate | `7cc81d71bb79de3f6f5a4be461c4350c7ef183c5` |
| AI expert prompts | https://github.com/immersive-translate/prompts | `94d6522081902fce6cbe07418c402b3a5ade99ca` |
| Prompt variables and behavior | https://immersivetranslate.com/en/docs/prompts/ | Read 2026-07-24 |
| Terminology catalog | https://assets.immersivetranslate.cn/static/terms/meta/index.json | 34 entries; SHA-256 `69a53b41d883a3ed3016706ad65252c5bfe1275f2c1c2ec0aa1627da0dca4ed6`; read 2026-07-24 |

Future resource builds must record the exact upstream commit or catalog entry
hash. Updating to "latest" is an explicit resource update, never an application
startup action.

## AI experts

The pinned prompts snapshot contains 29 YAML files:

| ID/file | ID/file | ID/file |
|---|---|---|
| `ao3.yml` | `bilingual-mix.yml` | `chess.yml` |
| `classicalToModern.yml` | `dbh.yml` | `design.yml` |
| `ebook.yml` | `ecommerce.yml` | `fiction.yml` |
| `financial.yml` | `game.yml` | `github.yml` |
| `legal.yml` | `medical.yml` | `music.yml` |
| `news.yml` | `paper.yml` | `paragraph-summarizer-expert.yml` |
| `paraphrase.yml` | `plain-english.yml` | `reddit.yml` |
| `steam.yml` | `subliminal_lingo.yml` | `tech.yml` |
| `twitter.yml` | `VocabularyAssistant.yml` | `web3.yml` |
| `wordByWord.yml` | `wyw.yml` |  |

Observed upstream fields include:

- metadata: `id`, `version`, `extensionVersion`, `name`, `description`,
  `avatar`, `details`, `i18n`, `author`, `homepage`, `matches`;
- prompt data: `env`, `systemPrompt`, `multipleSystemPrompt`, `prompt`,
  `multiplePrompt`, `subtitlePrompt`, `langOverrides`,
  `enableRichTranslate`;
- version patches such as `systemPrompt.add_v.[1.17.2]` and
  `multiplePrompt.remove_v.[1.17.2]`.

Compatibility notes:

- some upstream files contain legacy and version-patched prompt fields together;
- some use custom YAML input/output fields or multi-stage translations;
- upstream separator/YAML transport is not compatible with Shale's persisted
  NDJSON and safe-HTML contract;
- subtitle prompts are outside Issue #60;
- upstream YAML is normalized by a build compiler, not interpreted directly
  during translation.

The resource compiler must produce, for every expert:

```json
{
  "id": "paper",
  "version": "1.1.1",
  "sourceCommit": "94d6522081902fce6cbe07418c402b3a5ade99ca",
  "sourceFile": "plugins/paper.yml",
  "sourceSha256": "...",
  "compiledSha256": "...",
  "warnings": []
}
```

M3 implementation:

- committed artifact: `resources/ai-experts/experts.json`;
- reproducible command: `npm run build:experts`;
- optional local-source command:
  `npm run build:experts -- --source=<checked-out-prompts-directory>`;
- pinned source commit:
  `94d6522081902fce6cbe07418c402b3a5ade99ca`;
- runtime startup reads only the committed artifact and never contacts
  upstream;
- the build requires exactly 29 unique experts and records the source file,
  source SHA-256, compiled SHA-256, selected prompt field, and discarded
  transport warnings.

## Terminology catalog

Only the aggregate `builtin:default` library is enabled on first install.
All other libraries are included but disabled. `builtin:default` retains the
current AGROVOC pack and adds the upstream default preservation entries.

| Upstream ID | Name | Author | Available targets | Initial state |
|---|---|---|---|---|
| `default` | Default | self | auto | merged into default/on |
| `twitter` | Twitter | immersive | zh-CN, zh-TW | off |
| `web3` | Web3 Expert | immersive | auto, zh-CN, zh-TW | off |
| `tech` | Technology Expert | immersive | auto, zh-CN, zh-TW | off |
| `news` | News Media Expert | immersive | zh-CN, zh-TW | off |
| `ao3` | AO3 | immersive | zh-CN, zh-TW | off |
| `programming` | Programming | immersive | auto, zh-CN, zh-TW | off |
| `education` | Education | immersive | zh-CN, zh-TW | off |
| `finance` | Finance | immersive | zh-CN, zh-TW | off |
| `legal` | Legal | immersive | zh-CN, zh-TW | off |
| `car` | Car Expert | immersive | zh-CN, zh-TW | off |
| `ecommerce` | E-commerce Expert | immersive | zh-CN, zh-TW | off |
| `fashion` | Fashion Expert | immersive | zh-CN, zh-TW | off |
| `food` | Food Expert | immersive | zh-CN, zh-TW | off |
| `gardening` | Gardening | immersive | zh-CN, zh-TW | off |
| `medical` | Medical | immersive | zh-CN, zh-TW | off |
| `music` | Music | immersive | zh-CN, zh-TW | off |
| `pet` | Pet | immersive | zh-CN, zh-TW | off |
| `sports` | Sports | immersive | zh-CN, zh-TW | off |
| `travel` | Travel | immersive | zh-CN, zh-TW | off |
| `chess` | Chess Expert | immersive | zh-CN, zh-TW | off |
| `game` | Game | immersive | auto, zh-CN, zh-TW | off |
| `golf` | Golf Expert | immersive | zh-CN, zh-TW | off |
| `movie` | Movie | immersive | zh-CN, zh-TW | off |
| `photography` | Photography | immersive | zh-CN, zh-TW | off |
| `stellar-blade-clothing` | Stellar Blade Costumes | MaMihLaPiNaTaPaI0 | zh-CN | off |
| `Shelter69-Slang` | Shelter69 Slang | MaMihLaPiNaTaPaI0 | zh-CN | off |
| `Vocaloid` | Vocaloid | 人造石 | zh-CN | off |
| `access-control` | Access Control | Ziv | zh-CN | off |
| `hd2` | Helldivers 2 | TWSFFTS_07007 | zh-CN | off |
| `bg3` | Baldur's Gate 3 | Au3C2 | zh-CN, zh-TW | off |
| `biology` | Biology Expert | mmlet | zh-CN | off |
| `tennis` | Tennis Expert | Tabris-ZX | zh-CN, zh-TW | off |
| `programming-contest` | Programming Contest | Tabris-ZX | zh-CN, zh-TW | off |

The upstream catalog uses `zh-TW`; Shale supports `zh-HK`. During resource
building, those entries retain `zh-TW` provenance and become an explicit,
lowest-priority Traditional Chinese compatibility fallback for `zh-HK`. The
prompt asks the model to adapt Taiwan-specific wording to Hong Kong usage.
Native or user-imported `zh-HK` entries always win. Settings must show that these
libraries provide a Traditional Chinese reference rather than a native Hong Kong
glossary.

Each bundled library manifest records:

- internal and upstream IDs;
- display metadata and author;
- upstream catalog URL;
- target language and upstream `langsHash`;
- downloaded file SHA-256;
- normalized entry count;
- build timestamp and resource format version.

M4 implementation:

- committed runtime artifact:
  `resources/terminology/terminology-libraries.sqlite`;
- committed provenance:
  `resources/terminology/terminology-libraries.sqlite.manifest.json`;
- reproducible command: `npm run build:terminology-libraries`;
- catalog SHA-256:
  `69a53b41d883a3ed3016706ad65252c5bfe1275f2c1c2ec0aa1627da0dca4ed6`;
- final SQLite SHA-256:
  `7b312d935eb464e22ead4e54becb7ac514a94295fd51164e6f9722a996bc2f43`;
- 34 libraries, 65 pinned upstream CSV files, 4,521 normalized catalog
  entries, and 41,632 retained AGROVOC concepts;
- runtime startup reads only the committed SQLite artifact and never contacts
  the catalog or glossary host.

## User expert upload format

User experts are UTF-8 `.yml` or `.yaml` files. The import page links to a local
example and documents:

- required: `id`, `version`, `name`, and at least one system/domain prompt;
- optional: descriptive metadata, `i18n`, `matches`, prompt variants,
  language overrides, and string-only `env`;
- supported variables are displayed in the UI and unknown variables fail
  preview;
- duplicate IDs require a new ID or explicit replacement of a user expert;
- built-in experts are immutable;
- no YAML custom tags, executable values, remote includes, or filesystem
  references.

Import is previewed and transactional. The preview shows the resolved name,
version, supported languages, prompt fields used, ignored unsupported fields,
and errors.

## User terminology upload format

The "New terminology library" page teaches this UTF-8 CSV form:

```csv
source,target,tgt_lng
Large language model,大语言模型,zh-CN
colour,color,en
Shale,,
"term, with comma","译文，含逗号",zh-CN
```

Rules:

- the first row is exactly `source,target,tgt_lng`;
- `source` is required and trimmed for lookup;
- empty `target` means preserve the source spelling;
- empty `tgt_lng` applies to all supported targets;
- `tgt_lng` must be one of the eight supported target codes;
- commas, quotes, and newlines follow RFC 4180 quoting;
- empty source, invalid target language, malformed quoting, and excessive field
  sizes are line-numbered errors;
- duplicates and conflicts are warnings shown before commit;
- cancel or validation failure writes nothing.
