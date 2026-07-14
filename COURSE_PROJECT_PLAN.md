# Shale Cross-Platform Course Project Plan

## 1. Purpose and Fixed Decisions

This document is the execution baseline for converting the Shale product concept into a course project.

### 1.1 Fixed technical direction

- Desktop shell: Electron.
- UI: React and TypeScript.
- Application logic: TypeScript, owned by the Electron main process.
- Renderer process: React UI only. It must not access SQLite, credentials, filesystem paths, or provider secrets directly.
- Persistence: SQLite with versioned migrations.
- Desktop support: Windows is the required live demonstration platform. The architecture, CI checks, path handling, and packaging design must remain compatible with Windows, Linux, and macOS.
- Privacy: local-first. The application must never proactively collect, upload, or transmit telemetry, logs, article content, credentials, or usage data to a project-controlled service.

### 1.2 Course feature scope

All eight feature groups are in scope. The first four groups are mandatory core functionality and must be completed before optional polish work is allowed to consume critical-path time.

| Group | Feature group | Delivery class |
|---|---|---|
| 1 | Feed / OPML parsing, sync, and content presentation | Mandatory core |
| 2 | Cleaned HTML, cleaned Markdown, and reader styling | Mandatory core |
| 3 | Summary Agent and LLM Providers | Mandatory core |
| 4 | Translation Agent | Mandatory core |
| 5 | Localization, local logs, and debugging tools | Required supporting feature |
| 6 | LLM usage statistics | Required supporting feature |
| 7 | Notes, single-entry export, and multi-entry export | Required supporting feature |
| 8 | Tags, filtering, Tag Agent, and tag management | Required supporting feature |

### 1.3 Non-negotiable product constraints

1. No registration, login, subscription, or project-operated backend is required.
2. Feed fetching and user-configured LLM calls are user-directed product functions. They are not telemetry.
3. Logs and diagnostics stay local by default. Any external sharing action must be initiated and confirmed by the user.
4. API keys are stored only in the operating system credential store. SQLite stores a credential reference, never the key itself.
5. Provider support is OpenAI Chat Completions-compatible by default, with a configurable base URL and model name. Local providers running on `localhost` are first-class supported configurations.
6. The user interface must depend on provider/model profiles, not on vendor-specific names or branches.
7. Summary, translation, and tagging must use one shared task runtime, provider routing layer, usage recorder, and error projection policy.

## 2. Target Architecture

```text
Electron main process
  |
  +-- Application services
  |     +-- Feed and OPML service
  |     +-- Reader pipeline
  |     +-- Agent runtime
  |     +-- Provider router
  |     +-- Export service
  |     +-- Local diagnostic service
  |
  +-- SQLite repositories and migrations
  +-- OS adapters (credentials, files, clipboard, notifications, paths)
  +-- Narrow IPC boundary
              |
              v
Electron renderer process
  +-- React application shell
  +-- Feed, list, reader, settings, usage, and tag views
  +-- View state and IPC client only
```

### 2.1 Main-process ownership rules

The main process is the authoritative owner for mutable application state that has persistence, network, credential, or task-lifecycle consequences.

- Only the main process opens SQLite.
- Only the main process reads an API key from the credential store.
- Only the main process sends Feed or LLM network requests.
- Only the main process starts, cancels, retries, queues, or persists background tasks.
- The renderer receives stable data-transfer objects and task events. It never receives a raw database handle or API key.

### 2.2 IPC contract rules

Each IPC endpoint is a coarse application command or query. Examples:

- `feeds.list`, `feeds.create`, `feeds.sync`, `opml.import`, `opml.export`
- `entries.list`, `entries.loadDetail`, `reader.build`
- `agents.configureProvider`, `agents.testProvider`, `summary.start`, `translation.start`, `tagging.start`
- `digest.exportSingle`, `digest.exportMultiple`, `usage.query`

Do not expose generic SQL, arbitrary filesystem access, arbitrary shell execution, or a general network proxy through IPC.

### 2.3 Persisted reader contract

The reader stores four logically distinct layers:

1. Source HTML: fetched article page HTML.
2. Cleaned HTML: article body extracted from source HTML.
3. Canonical Markdown: text-first representation used by Reader, agents, and export.
4. Rendered Reader HTML cache: theme-specific output for rapid display.

Each layer has an explicit version and invalidation rule. A renderer change must not re-fetch the network; a Markdown converter change must not require re-running extraction when cleaned HTML remains valid.

### 2.4 Shared agent runtime contract

The shared task runtime has the following task states:

```text
waiting -> requesting -> generating -> persisting -> completed
                       |                         |
                       +-> failed / cancelled / timedOut
```

- Summary, translation, and tagging use the same task record format.
- User cancellation is explicit. Switching entries must not silently cancel an in-flight operation.
- A waiting request may be discarded when the user leaves the entry before it starts.
- The runtime emits typed progress, terminal state, and user-safe error events.
- Provider calls record an LLM usage event whether they succeed, fail, time out, or are cancelled.

## 3. Delivery Principles and Priority Gates

### 3.1 Priority order

1. A stable Windows desktop application that opens and persists local data.
2. Mandatory core groups 1 through 4.
3. Required supporting groups 5 through 8.
4. Visual polish, performance optimization, extra integrations, and automatic update mechanisms.

### 3.2 Scope gates

The team must not begin a later gate before the previous gate has an accepted demo and recorded verification evidence.

| Gate | Entry condition | Exit condition |
|---|---|---|
| G0 | Course requirements confirmed | Architecture ADR, backlog, and risk spikes accepted |
| G1 | Desktop foundation started | Windows app starts, persists SQLite data, and has no telemetry path |
| G2 | Feed/Reader work started | Groups 1 and 2 accepted against a fixed article corpus |
| G3 | Agent work started | Groups 3 and 4 work with one local and one remote-compatible provider |
| G4 | Supporting work started | Groups 5 through 8 meet their minimum acceptance criteria |
| G5 | Release work started | Windows demonstration package accepted; Linux/macOS design and CI evidence recorded |

### 3.3 Explicit de-scope order

If schedule pressure occurs, remove work in this order. Do not remove the mandatory core groups.

1. Automatic update support.
2. Advanced usage charts; retain tabular reports.
3. Local NLP fallback quality improvements; retain manual tags and LLM Tag Agent.
4. Batch tagging performance enhancements; retain bounded batch execution.
5. Advanced Reader source-specific adapters.
6. Visual animation and non-essential customization.

## 4. Phased Implementation Plan

### Phase 0 — Baseline, requirements, and feasibility spikes

**Goal**: establish a reproducible development baseline before feature implementation.

**Scope**:

- Create the course-project repository and preserve the upstream Mercury license/reference notice.
- Create issue, pull-request, ADR, and Coding Agent record templates.
- Define the Electron main/renderer boundary and the initial SQLite migration strategy.
- Build time-boxed technical spikes for Windows packaging, SQLite, credential storage, and Reader HTML rendering.
- Create a fixed Feed and article corpus, including malformed Feed XML, Chinese content, images, tables, lists, and long articles.

**Risk validations**:

- Windows package can start on a clean demonstration device.
- SQLite native dependency opens, migrates, closes, and reopens on Windows.
- Electron secure credential storage is available; define a user-visible fallback policy if the OS vault is unavailable.
- Reader HTML displays safely inside Electron without granting unrestricted navigation or Node access.

**Deliverables**:

- ADR-001: Electron/React/TypeScript architecture.
- ADR-002: local-first privacy and logging policy.
- ADR-003: database schema/migration ownership.
- A short spike report with pass/fail evidence and unresolved risks.
- Prioritized GitHub Project backlog.

**Acceptance**:

- All P0 risks have an owner and a decision date.
- The team can run a Windows development build without real Feed or LLM credentials.
- No telemetry SDK or external project analytics endpoint exists in dependencies or configuration.

**Parallel work**: all three members may work in parallel after agreeing on IPC and schema ownership.

**Suggested ownership**: Project Lead owns requirements/corpus/templates; Tech Lead owns architecture spikes; Development Lead owns the Electron shell prototype.

**Effort**: Medium.

**Fallback**: if a native SQLite binding blocks packaging, switch to a proven packaged SQLite driver before implementing repositories. Do not implement the app on an in-memory-only store.

### Phase 1 — Cross-platform application foundation

**Goal**: create the secure, local-first skeleton that every feature uses.

**Scope**:

- Electron application shell, React routing/layout, preload bridge, IPC validation.
- Application-data path abstraction for Windows, Linux, and macOS.
- SQLite connection owner, migration runner, repository base utilities, backup/export policy.
- Settings store, language resource loader, local diagnostic store, and platform adapter interfaces.
- Windows packaging pipeline and design-only Linux/macOS package definitions.

**Technical tasks**:

- Disable Node integration in all web contents.
- Expose only named, validated preload APIs.
- Add a `PlatformServices` interface for credentials, files, clipboard, notifications, and external URLs.
- Add a structured local log format with secret redaction.
- Add a privacy settings page that states there is no automatic telemetry upload.

**Acceptance**:

- Windows package launches and creates data only under the correct per-user application-data path.
- A schema migration can be applied and reopened after restart.
- Changing language re-renders at least English and Simplified Chinese UI labels.
- A local diagnostic entry can be viewed and explicitly exported without automatic network transmission.

**Parallel work**: platform/DB foundation, React shell, and i18n/logging can proceed independently.

**Suggested ownership**: Tech Lead owns IPC/DB; Development Lead owns shell; Project Lead owns i18n/privacy/debug UI.

**Effort**: Large.

**Fallback**: reduce the initial UI to sidebar/list/detail mock data, but do not bypass the secure IPC and persistence foundations.

### Phase 2 — Mandatory core group 1: Feed, OPML, sync, and presentation

**Goal**: deliver a reliable local RSS reader loop before AI work.

**Scope**:

- Feed CRUD with URL validation.
- RSS, Atom, and JSON Feed parsing where supported by the chosen parser.
- OPML import/export.
- Bounded concurrent sync, retry/error projection, rate-limit handling, and reading state.
- Feed sidebar, entry list, search baseline, unread/starred filters, and entry detail handoff.

**Technical tasks**:

- Define `Feed`, `Entry`, and entry-list query migrations first.
- Use stable Feed identifiers and deduplication rules.
- Keep feed synchronization in the main process.
- Ensure a failed Feed does not prevent other feeds from syncing.
- Use file dialogs through `PlatformServices`; never pass arbitrary renderer file paths directly to filesystem APIs.

**Acceptance**:

- Import an OPML file, sync at least three distinct Feed formats, restart, and retain all imported data.
- Export produces valid OPML that can be re-imported into a fresh profile.
- A sync failure has a visible local error without exposing secrets.
- Entry list filtering and search are deterministic on Windows.

**Parallel work**: parser/repository work, sidebar/list UI, and OPML flows.

**Suggested ownership**: Development Lead owns Feed/Sync; Tech Lead owns schema/repositories; Project Lead owns import/export UX and acceptance corpus.

**Effort**: Large.

**Fallback**: keep RSS and Atom mandatory; defer JSON Feed only if parser support becomes a verified schedule blocker and record the decision explicitly.

### Phase 3 — Mandatory core group 2: Reader cleaning, Markdown, and styling

**Goal**: provide a dependable Reader experience with versioned local content layers.

**Scope**:

- Source document fetch and redirect policy.
- Article extraction and cleaned HTML persistence.
- Cleaned HTML to canonical Markdown conversion.
- Markdown to sanitized Reader HTML rendering.
- Theme tokens, render cache identity, image/link navigation policy, and Reader errors.

**Technical tasks**:

- Create the `Content` and Reader cache migrations.
- Implement a Reader pipeline with explicit rebuild actions: serve cache, rerender from Markdown, rebuild Markdown, rerun extraction, fetch-and-rebuild.
- Preserve structural fidelity for headings, paragraphs, lists, links, images, captions, tables, code blocks, and inline formatting.
- Allow only trusted, sanitized HTML in the Reader document.
- Use an allowlisted external-link policy; never enable Node APIs inside the article WebView.

**Acceptance**:

- The fixed corpus renders without converting images or links into misleading plain URL text.
- A theme change rerenders locally without a network fetch.
- A Markdown-converter version change rebuilds from cleaned HTML, not from the network.
- Reader output remains usable offline after the article was previously built.

**Parallel work**: extraction/conversion, Reader UI/theme work, corpus-based tests.

**Suggested ownership**: Tech Lead owns pipeline/data contracts; Development Lead owns Reader UI; Project Lead owns corpus review and styling acceptance.

**Effort**: Large.

**Fallback**: retain a safe simplified table fallback and basic image/link handling. Do not sacrifice canonical Markdown or cleaned HTML persistence.

### Phase 4 — Mandatory core group 3: Provider abstraction and Summary Agent

**Goal**: deliver provider-neutral article summarization with local and remote-compatible models.

**Scope**:

- Provider and Model profiles.
- OS credential storage and provider connection test.
- OpenAI-compatible request adapter with streaming/non-streaming support.
- Summary prompt templates, target language, detail levels, persistence, cancellation, fallback route, and usage recording.

**Technical tasks**:

- Store provider metadata and a credential reference in SQLite; keep the secret in OS storage.
- Implement request/response error normalization without logging API keys or full prompt text.
- Persist summary results by `entryId + targetLanguage + detailLevel` slot.
- Ensure a failed/cancelled task does not overwrite a previous successful summary.
- Record token usage as unavailable when a provider omits usage fields.

**Acceptance**:

- One localhost model and one remote OpenAI-compatible provider can be configured and tested.
- Summary streams or displays a final response, survives restart, and can be regenerated deliberately.
- Cancellation and timeout leave task state understandable and previous valid output intact.
- No provider credential appears in UI logs, database rows, exported diagnostics, or renderer memory.

**Parallel work**: Provider/security adapter, Summary UI/template work, usage-event persistence/tests.

**Suggested ownership**: Tech Lead owns provider/security/runtime; Development Lead owns Summary feature; Project Lead owns prompt UX and acceptance scripts.

**Effort**: Large.

**Fallback**: support non-streaming first, but retain the same provider contract so streaming can be added without API redesign.

### Phase 5 — Mandatory core group 4: Translation Agent

**Goal**: deliver paragraph-aligned bilingual translation in Reader mode.

**Scope**:

- Translation source segmentation over `p`, `ul`, and `ol` Reader blocks.
- Deterministic segment IDs and source-content hash.
- Per-segment bounded concurrency, provider fallback, retry, checkpoint persistence, and cancellation.
- Original/Bilingual Reader toggle and per-segment error projection.

**Technical tasks**:

- Store translation headers by `entryId + targetLanguage + sourceContentHash + segmenterVersion`.
- Store translated segments with source segment ID and order index.
- Reuse the shared Agent Runtime; do not create a translation-specific scheduler.
- Display persisted results before deciding whether a new task must start.
- Keep in-flight work running unless the user explicitly cancels it.

**Acceptance**:

- Translation aligns source and target segments in Reader mode.
- Changing Reader content invalidates incompatible translations.
- A partial failure is visible without losing successful segments.
- The user can return to original mode immediately while a translation task continues in background.

**Parallel work**: segmentation/storage, per-segment runtime, bilingual UI and error states.

**Suggested ownership**: Development Lead owns Translation feature; Tech Lead owns runtime/storage review; Project Lead owns bilingual UX and test corpus.

**Effort**: Large.

**Fallback**: start with serial segment requests and a single target language default. Do not fall back to a single unstructured full-article translation blob.

### Phase 6 — Supporting groups 5 and 6: localization, debugging, and usage statistics

**Goal**: make the product inspectable and trustworthy without telemetry.

**Scope**:

- English and Simplified Chinese resource files.
- Local debug issue panel, redacted structured logs, explicit export action.
- Usage event retention policy and reports by Provider, Model, and Agent.

**Acceptance**:

- Language can change without restart.
- Diagnostics are useful for Feed/Reader/Agent failures and redact secrets.
- Usage reports show request count, input tokens, output tokens, total tokens, status, and missing-usage count.
- The application performs no background log upload.

**Parallel work**: i18n, diagnostics, usage aggregation/UI.

**Suggested ownership**: Project Lead owns this phase; Tech Lead reviews redaction/storage; Development Lead supplies feature events.

**Effort**: Medium.

**Fallback**: use sortable tables before charts; retain raw local events and summary totals.

### Phase 7 — Supporting group 7: Notes and digest export

**Goal**: support user-authored notes and local Markdown exports.

**Scope**:

- Per-entry Markdown notes.
- Single-entry text share/copy.
- Single-entry Markdown export.
- Multiple-entry Markdown export from the current list.
- Built-in and user-customizable digest templates.

**Acceptance**:

- Notes persist locally and are not sent to a project service.
- Exports include title, author, source URL, optional summary, and optional note according to user selection.
- Filename collision handling is deterministic.
- Export directory selection works through the platform adapter.

**Parallel work**: note repository, template renderer, export UI.

**Suggested ownership**: Project Lead owns the feature; Development Lead reviews export flow; Tech Lead reviews filesystem boundaries.

**Effort**: Medium.

**Fallback**: use Copy and Save As before implementing a native system sharing menu.

### Phase 8 — Supporting group 8: Tag system and Tag Agent

**Goal**: provide manual and AI-assisted article organization without making AI mandatory.

**Scope**:

- Tag, alias, and entry-tag schema.
- Manual tagging, tag filters, normalization, tag management, merge, and alias management.
- On-demand Tag Agent using the shared Provider/Runtime stack.
- Bounded batch tagging with review before applying new tag proposals.

**Acceptance**:

- Manual tags work with no Provider configured.
- A Tag Agent suggestion is not applied until the user accepts it.
- Filtering, alias resolution, merge, and duplicate prevention are deterministic.
- Batch work can be cancelled and resumed/reviewed without corrupting tags.

**Parallel work**: data/normalization, Tag UI, Tag Agent/batch runtime.

**Suggested ownership**: Development Lead owns the feature; Tech Lead reviews batch state; Project Lead owns user-review UX.

**Effort**: Large.

**Fallback**: defer local NLP suggestions and optimize batch processing later; preserve manual tags, filters, Tag Agent, and management.

### Phase 9 — Release, documentation, and demonstration

**Goal**: prove the project honestly and reproducibly.

**Scope**:

- Windows installer/package and clean-device rehearsal.
- Linux/macOS build/package compatibility evidence where environment access is available.
- End-to-end demonstration script covering all eight groups.
- README, architecture guide, privacy statement, ADR index, contribution guide, and test evidence.

**Acceptance**:

- Windows demonstration completes with a local Feed dataset and configured local or remote-compatible model.
- No feature depends on a hidden project backend.
- The final repository shows authentic issues, commits, reviews, and Coding Agent records.
- The team can explain any Windows-only demonstration limitation without claiming unsupported platform testing was completed.

**Effort**: Large.

**Fallback**: automatic updates and non-essential installers are excluded before any mandatory feature is removed.

## 5. Three-Person Team Responsibilities

### 5.1 Project Lead / Product Owner

**Primary responsibilities**:

- Own scope, acceptance criteria, demonstrations, backlog priorities, and privacy boundary decisions.
- Own Notes/Digest, localization, local diagnostics, and documentation implementation.
- Maintain the course evidence index and ensure every completed issue has acceptance evidence.

**Must not become a non-coding coordinator**:

- Delivers the Notes/Digest vertical feature and at least one supporting subsystem.
- Opens and reviews PRs with technical detail.
- Owns user-facing wording and demonstration scenarios.

### 5.2 Architect / Tech Lead

**Primary responsibilities**:

- Own Electron security posture, IPC boundary, SQLite migrations, Reader data contract, Agent runtime, Provider abstraction, and CI architecture.
- Write ADRs before cross-cutting changes.
- Review all migrations, IPC additions, credential handling, and queue/concurrency changes.

**Balance rule**:

- Provides interfaces and targeted implementation, but does not absorb all feature work.
- Feature owners implement against documented contracts and bring integration questions to review early.

### 5.3 Development Lead / Feature Owner

**Primary responsibilities**:

- Own Feed/OPML/Sync, Summary, Translation, and Tag System vertical feature delivery.
- Maintain feature-level tests and issue breakdown.
- Deliver React UI plus application-service behavior for each owned feature.

**Balance rule**:

- Does not change migrations, IPC policy, or Agent Runtime rules without Tech Lead review.
- Splits large features into independently reviewable PRs.

### 5.4 Protected ownership areas

The following areas require explicit owner approval and must not be casually edited by multiple people in parallel:

| Area | Owner | Required reviewers |
|---|---|---|
| SQLite migrations and repository conventions | Tech Lead | At least one teammate |
| IPC/preload security boundary | Tech Lead | Project Lead |
| Reader canonical-content contract | Tech Lead | Development Lead |
| Agent Runtime and Provider contract | Tech Lead | Development Lead |
| Product scope, acceptance criteria, demo script | Project Lead | Both teammates |
| Feed/Translation/Tag feature behavior | Development Lead | Tech Lead for cross-cutting changes |

### 5.5 Parallelization map

- Phase 1: shell, DB, and i18n/privacy UI can run in parallel after IPC interfaces are approved.
- Phase 2: Feed parser/service and Feed UI can run in parallel against repository mocks.
- Phase 3: Reader renderer UI and extraction/conversion tests can run in parallel against the corpus.
- Phases 4 and 5: Provider runtime work can precede Summary/Translation UI work.
- Phases 6 through 8: localization/usage, digest, and tags can run in parallel once core schema additions are sequenced.

## 6. Repository Workflow and Coding Agent Evidence

### 6.1 Required repository structure

```text
.github/
  ISSUE_TEMPLATE/
  pull_request_template.md
docs/
  adr/
  agent-records/
  evidence/
  architecture/
CONTRIBUTING.md
PRIVACY.md
COURSE_PROJECT_PLAN.md
```

### 6.2 Issue template minimum fields

- Problem and user value.
- In-scope and out-of-scope behavior.
- Acceptance criteria.
- Risks and dependency issues.
- Owner.
- Test and demonstration evidence expected.

### 6.3 Pull request template minimum fields

- Linked issue.
- Summary of behavior changed.
- Design decision and alternatives considered.
- Tests run and manual verification evidence.
- Privacy/security impact.
- Migration/rollback impact.
- Coding Agent record link, if an agent was used.
- Reviewer checklist.

### 6.4 Commit conventions

Use concise Conventional Commit-style messages:

```text
feat(feed): import OPML with duplicate handling (#42)
fix(reader): preserve linked images in canonical markdown (#57)
test(agent): cover translation checkpoint cancellation (#63)
docs(adr): record credential-storage policy (#71)
```

Each commit must be authored by the person who performed or directly supervised the work. Do not create commits under another teammate's identity.

### 6.5 Branch and PR policy

- One issue normally maps to one short-lived branch and one PR.
- Branch names: `feature/42-opml-import`, `fix/57-reader-linked-images`, `docs/71-credential-adr`.
- No direct push to the protected default branch.
- Every PR receives at least one teammate review.
- Database, IPC, credential, queue, and privacy changes require Tech Lead review.
- Scope/acceptance or demo claims require Project Lead review.

### 6.6 Coding Agent record standard

No exact course format is prescribed, so use a small, meaningful Markdown record per non-trivial agent-assisted issue:

```text
docs/agent-records/issue-42-opml-import.md
```

Each record contains:

1. Issue and task objective.
2. Human-provided constraints.
3. Files, tests, and documentation inspected by the agent.
4. Proposed approach and alternatives rejected.
5. Exact files changed by the agent.
6. Verification performed, including commands and results.
7. What the human reviewer checked manually.
8. Acceptance, revision, or rejection decision and reason.
9. Known gaps or deferred follow-ups.

Never include API keys, raw credentials, private Feed URLs, article bodies that should remain private, or a complete unfiltered chat transcript.

### 6.7 Definition of done

An issue is done only when:

- the implementation is merged through a reviewed PR;
- acceptance criteria are demonstrably met;
- relevant tests pass or an explicit manual verification record explains why automation is not possible;
- user-visible strings are localized;
- privacy/security consequences are reviewed;
- documentation and the Coding Agent record are updated when the change is non-trivial.

## 7. Risk Register

| ID | Risk | Probability | Impact | Early warning | Mitigation | Latest decision phase |
|---|---|---|---|---|---|---|
| R1 | Windows packaging or native SQLite dependency fails | Medium | High | App launches only in development mode or migration fails after packaging | Package a SQLite spike in Phase 0; test clean-device installation | Phase 1 |
| R2 | Linux/macOS compatibility is ignored until the end | Medium | High | Platform-specific paths or Electron APIs appear in core services | Enforce platform adapters and CI build/package checks from Phase 1 | Phase 1 |
| R3 | Reader extraction loses article structure | Medium | High | Corpus screenshots show lost images, links, tables, or lists | Fixed corpus, four-layer persistence, conversion tests, visual review | Phase 3 |
| R4 | Feed parser cannot handle expected formats | Medium | Medium | Real Feed fixtures fail or duplicate entries grow | Use multiple fixture sources, stable deduplication, clear errors | Phase 2 |
| R5 | Provider APIs differ in routing, streaming, or token usage | High | Medium | 404/stream failure/missing usage across providers | One normalized adapter, provider smoke tests, clear compatibility policy | Phase 4 |
| R6 | API keys leak to renderer, logs, or database | Low | Critical | Secret-like values appear in logs, DevTools, exports, or SQLite | Main-process-only secrets, redaction tests, secure-store review | Phase 4 |
| R7 | Local model connection fails on Windows | Medium | Medium | `localhost` request blocked or provider test fails | Validate local HTTP in Phase 4 on Windows demo device | Phase 4 |
| R8 | Agent tasks duplicate, race, or overwrite valid results | Medium | High | Multiple runs for same slot or stale UI after cancellation | Shared runtime, slot keys, state-machine tests, main-process owner | Phase 5 |
| R9 | Translation scope exceeds schedule | High | High | Bilingual UI starts before stable segmentation/persistence | Implement segment contract/storage first; serial fallback | Phase 5 |
| R10 | Supporting feature work interrupts mandatory core completion | High | High | Tags/export polish begins before Summary/Translation acceptance | Enforce G2/G3 gates and Project Lead scope review | All phases |
| R11 | “Log reporting” accidentally becomes telemetry | Medium | High | Background upload code or analytics SDK added | Privacy ADR, dependency review, explicit export only | Phase 1 |
| R12 | Team history does not show real contribution | Medium | High | One member makes most commits or reviews are absent | Per-owner modules, weekly evidence audit, truthful authorship | All phases |
| R13 | Merge conflicts in shared contracts slow delivery | Medium | Medium | Repeated conflicts in migrations/runtime/IPC | Protected ownership areas, short branches, ADR-first changes | All phases |
| R14 | Demonstration device differs from developer machine | Medium | High | Installer only tested on developer environment | Clean Windows device rehearsal and offline fallback dataset | Phase 9 |

## 8. Demonstration Checklist

The Windows demonstration should show the following in one reproducible flow:

1. Launch the installed local application with no account prompt.
2. Import OPML or add Feed URLs; sync and display entries.
3. Open an article in Reader mode and demonstrate cleaned content, Markdown-derived rendering, theme/style behavior, links, and images.
4. Configure or select an already configured OpenAI-compatible local/remote Provider without revealing its secret.
5. Generate a Summary and show local persistence after reopening the entry.
6. Generate Translation and switch between Original and Bilingual modes.
7. Switch UI language, inspect redacted local diagnostics, and show usage statistics.
8. Add a note, export one digest and a multiple-entry digest.
9. Add/filter/manage tags and show Tag Agent suggestions with explicit user acceptance.
10. State that the application has no automatic telemetry and that logs are only exported by user action.

## 9. Weekly Operating Rhythm

- Monday: backlog refinement, risk review, and interface decisions.
- Mid-week: small PR reviews; resolve dependency blockers immediately.
- Friday: integrated Windows demo of the current main branch, evidence update, and next-week scope gate.
- Every week: verify that all three members have authored meaningful work, reviewed at least one PR, and updated an issue or evidence record.

## 10. First Actions After Adopting This Plan

1. Create the new team repository and add the upstream Mercury attribution and MIT license obligations.
2. Create Phase 0 issues for Windows packaging, SQLite, Electron credential storage, and Reader HTML security.
3. Create ADR-001 through ADR-003 before adding feature-specific dependencies.
4. Set up branch protection, issue/PR templates, and the Coding Agent record directory.
5. Freeze the mandatory core corpus and write its acceptance cases before implementing Feed or Reader code.
