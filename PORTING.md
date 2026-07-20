# Shale Cross-Platform Architecture

| Item | Value |
|---|---|
| Status | Accepted for the cross-platform implementation |
| Primary validation platform | Windows 11 x64 |
| Other supported platforms | macOS and Linux, with native Wayland support as a first-class target |
| Reference implementation | The existing macOS SwiftUI application |

## 1. Decision Summary

Build the cross-platform Shale application with the following stack:

| Area | Decision |
|---|---|
| Desktop runtime | Electron 40 or later, pinned to an exact version |
| UI | React + strict TypeScript |
| Build tooling | Vite + Electron Forge |
| Persistence | SQLite through `better-sqlite3` |
| Content extraction | Mozilla Readability in an isolated DOM environment |
| Clean Markdown | HTML-to-Markdown conversion with GFM support |
| Original website view | Electron `WebContentsView` |
| LLM integration | OpenAI-compatible HTTP/SSE client in the main process |
| Secrets | Electron `safeStorage` |
| Testing | Vitest, React Testing Library, and Playwright |
| Releases | Native GitHub Actions runners for each operating system |

The first version must not introduce a Rust backend, a Swift sidecar, or a second application runtime. TypeScript is the default implementation language for the renderer, preload bridge, main process, feed services, agent runtime, and persistence layer.

Native code may be introduced later only when profiling identifies a concrete bottleneck that cannot be solved safely in TypeScript. This keeps lifecycle ownership visible and makes AI-generated code easier to review, test, and maintain.

This decision supersedes the previous Tauri and shared-Swift-sidecar proposal.

## 2. Why Electron

### Product fit

Shale is dominated by web-shaped workloads:

- rendering cleaned HTML and Markdown
- loading original article websites
- parsing XML and HTML
- streaming responses from OpenAI-compatible APIs
- presenting dense, stateful desktop UI

Electron provides one Chromium implementation on Windows, macOS, and Linux. It avoids platform-specific differences between WebView2, WebKitGTK, and WKWebView, which is especially valuable for Reader, Web, and Dual display modes.

### Windows

Windows is Electron's strongest deployment target for this project:

- Chromium is bundled with the application; Shale does not depend on the installed WebView2 version.
- Electron Forge can produce a normal Windows installer.
- Windows code signing and automatic update paths are officially supported.
- Windows on ARM is supported, although it is not a first-release requirement.
- `safeStorage` uses Windows DPAPI for local secret encryption.

The first validated Windows target is Windows 11 x64. Windows ARM64 should be added only after all native Node modules have reproducible ARM64 builds.

### Linux and Hyprland

Electron uses Chromium's Ozone platform layer and can run as a native Wayland client. XWayland remains a useful fallback for driver- or compositor-specific failures.

Hyprland support is a release criterion, not a best-effort afterthought. Native Wayland behavior must be tested explicitly rather than inferred from an X11 CI run.

### Trade-offs

Electron increases download size and idle memory use. Those costs are accepted because it provides:

- one predictable rendering engine across all required platforms
- the most direct route to reliable Windows validation
- a substantially stronger native Wayland path than a GTK3/WebKitGTK shell
- one primary implementation language for AI-assisted development

If measured resource use later violates a concrete product requirement, reconsider the shell after the cross-platform behavior and test suite are stable. Do not optimize for package size before feature and platform correctness.

## 3. Process Architecture

```text
React renderer
    |
    | narrow, typed preload API
    v
Electron main process
    |-- application lifecycle and windows
    |-- feed and OPML services
    |-- synchronization scheduler
    |-- SQLite repositories and migrations
    |-- Reader content pipeline
    |-- agent runtime and LLM streaming
    |-- settings, secrets, files, and logging
    |
    +-- optional utility process for measured CPU-heavy work

Isolated WebContentsView
    `-- original remote website only
```

### Main process responsibilities

The main process is the authoritative owner of:

- the SQLite connection and schema migration lifecycle
- feed synchronization and background task state
- HTTP requests, including LLM streaming
- filesystem access and import/export dialogs
- secret storage
- window and application lifecycle
- opening approved external URLs

The renderer must not open the database, access Node APIs, read arbitrary files, or call arbitrary URLs directly.

### Renderer responsibilities

The renderer owns presentation state only:

- navigation and selection
- list and Reader presentation
- forms and settings UI
- local interaction state
- projection of task progress received from the main process

Reloading or crashing the renderer must not silently cancel feed sync, database work, or an in-flight agent task.

### Preload bridge

Expose a small typed API under a single namespace such as `window.mercury`. Validate every request at the main-process boundary and return structured results and error codes.

Do not expose any of the following generic capabilities:

- raw `ipcRenderer`
- arbitrary SQL execution
- arbitrary filesystem paths
- arbitrary HTTP requests
- process execution
- unrestricted shell access

Use a runtime schema validator at IPC boundaries. Shared TypeScript types alone do not validate data at runtime.

### Utility processes and workers

Start with a single main-process owner. Move work into an Electron utility process or worker only when profiling shows that parsing, conversion, or a batch operation blocks the main event loop.

A worker must receive immutable inputs and return explicit results. It must not become a second owner of the application database or task scheduler.

## 4. Data and SQLite

Use SQLite as the local source of truth. Store the database under an application-specific directory derived from `app.getPath('userData')`, for example:

```text
<userData>/data/mercury.sqlite
```

Keep Chromium session data and large caches outside the database directory.

Database rules:

- Access `better-sqlite3` only from the main process.
- Put all queries behind repositories; do not spread SQL through IPC handlers.
- Use versioned, forward-only migrations.
- Wrap related writes in transactions.
- Enable and test foreign keys.
- Define backup and corruption-recovery behavior before schema stability is declared.
- Close the database during orderly application shutdown and before an updater replaces files.
- Preserve notes, read state, tags, summaries, translations, usage records, and task checkpoints across restarts.

`better-sqlite3` is a native Node module. It must be rebuilt for Electron's ABI and for every target OS and CPU architecture. A Node-targeted `npm rebuild` replaces the Electron binary with an incompatible ABI, so Vitest runs through Electron's Node mode and the project keeps one Electron-targeted binary for development, tests, and packaging. `npm start` verifies a real Electron SQLite load before launching, while `npm ci` / `npm install` run the Electron rebuild and the same load probe. Each release artifact must still be produced and tested on its native operating system.

Do not assume that a package created on Linux proves that the Windows native module is valid.

## 5. Feed and Reader Pipeline

Keep each pipeline stage explicit and independently testable:

```text
Feed discovery/import
    -> RSS/Atom/JSON Feed normalization
    -> source article retrieval
    -> cleaned HTML extraction
    -> sanitized Reader HTML
    -> cleaned GFM Markdown
    -> styled Reader rendering
```

Required behavior:

- Import and export OPML.
- Normalize feed formats into one domain model.
- Persist source content separately from derived Reader content.
- Version derived Reader output so extraction or rendering changes can invalidate caches safely.
- Preserve article title, author, canonical URL, publication date, and base URL.
- Resolve relative links and image URLs against the source page.
- Produce stable Markdown for LLM input and export.

Use Mozilla Readability in a DOM environment such as JSDOM for extraction. Sanitize the resulting HTML before displaying it in the application renderer. HTML produced by a cleaning library is still untrusted input.

Render cleaned Markdown with a controlled component map and GFM support. Do not enable raw HTML in Markdown unless it passes the same sanitization policy as Reader HTML.

## 6. Reader, Web, and Dual Modes

Use two different trust boundaries:

- Reader mode renders sanitized content inside the React application.
- Web mode loads the remote article in an isolated `WebContentsView`.

Dual mode composes these two surfaces side by side. It must not inject the remote page into the trusted application renderer.

Do not use Electron's deprecated `BrowserView`. Do not use the `<webview>` tag for the main design; Electron recommends alternatives such as `WebContentsView` because the tag has additional architectural and stability concerns.

Remote website configuration must include:

- `nodeIntegration: false`
- `contextIsolation: true`
- sandboxing enabled
- no privileged preload script
- a separate session or partition from the application UI
- denied or allowlisted navigation outside the selected article
- denied unexpected popup windows
- explicit handling of approved `http` and `https` external links

Cookies and persisted website storage should be disabled by default unless a real product requirement justifies them.

## 7. Agent and Provider Architecture

All model calls run in the main process. The renderer sends an application command and receives progress events, structured output, and terminal status.

Provider-neutral rules:

- Treat provider configuration as `baseURL`, API key, model ID, and capability metadata.
- Preserve custom paths in provider base URLs; do not replace them accidentally when appending API endpoints.
- Support local HTTP endpoints such as `http://localhost:5810/v1`.
- Test at least DeepSeek, chatECNU, and one local OpenAI-compatible service.
- Implement streaming through HTTP/SSE without assuming one vendor's optional fields.
- Record token usage when reported and distinguish missing usage from zero usage.
- Never log API keys or complete authorization headers.

The main process owns agent task state. Use explicit state transitions, persisted checkpoints where required, `AbortController` for explicit cancellation, and one clear scheduler. Entry navigation must not implicitly cancel an in-flight task.

Summary, translation, and tagging should share provider routing, error projection, usage recording, and terminal-state handling rather than implementing separate network clients.

## 8. Secret Storage and Privacy

Store API keys with Electron `safeStorage`, never as plaintext in settings or SQLite.

Platform notes:

- Windows uses DPAPI.
- macOS uses Keychain-backed encryption.
- Linux normally depends on a supported secret service.

On Linux, check the selected `safeStorage` backend. If Electron reports a weak plaintext-like fallback such as `basic_text`, Shale must warn the user and avoid claiming that the key is securely encrypted. Document the required secret-service packages for supported distributions.

Local-first rules:

- No account or login is required.
- No telemetry is uploaded by default.
- Logs stay local and redact secrets and article bodies where practical.
- Diagnostic export is an explicit user action.
- Explain that article content is sent to the configured LLM provider when an agent is invoked.

## 9. Electron Security Baseline

Every trusted application window must use:

```text
nodeIntegration = false
contextIsolation = true
sandbox = true
webSecurity = true
```

Also require:

- a strict Content Security Policy
- a narrow preload bridge
- runtime validation of all IPC payloads
- validation of IPC senders
- navigation and new-window handlers
- allowlisted external protocols
- sanitized article HTML
- no execution of strings as code
- no remote content with Node privileges

Do not disable `webSecurity` to work around CORS. Network operations belong in the main process.

Security settings are application contracts. They must have regression tests and must not be relaxed for a single problematic feed or website.

## 10. Windows Adaptation Notes

First-release target: Windows 11 x64.

Packaging:

- Use Electron Forge and Squirrel.Windows for the initial `Setup.exe`.
- Add WiX MSI only if the course or an enterprise deployment explicitly requires MSI.
- Add automatic update only after installation, rollback, and database shutdown behavior are tested.
- Sign public releases. Unsigned internal builds may trigger SmartScreen warnings and require manual confirmation.

Runtime and filesystem:

- Use Node and Electron path APIs; never concatenate Windows separators manually.
- Test paths containing Chinese characters, spaces, and long directory names.
- Use atomic replacement for exported and generated files where possible.
- Close database and export handles on shutdown.
- Test 100%, 125%, 150%, and 200% display scaling.
- Test Chinese IME input, clipboard operations, drag and drop, and keyboard shortcuts.
- Do not assume macOS modifier keys or menu behavior.

Build Windows artifacts on a Windows GitHub Actions runner. Native SQLite packaging, installer behavior, signing, and file locking must be validated on Windows itself.

## 11. Native Wayland and Hyprland Notes

Native Wayland is a required manual test path.

Development and release checks must distinguish:

- native Wayland execution, using Chromium's Wayland Ozone backend
- XWayland fallback execution

Do not report Hyprland support when the application was tested only through XWayland.

First-version window rules:

- Keep the normal native window frame.
- Avoid transparent windows, custom shadows, blur, shaped windows, and complex frameless dragging regions.
- Avoid depending on a system tray or global shortcuts for essential workflows.
- Restore window bounds defensively when monitor topology or scale changes.
- Keep all core actions accessible inside the application window.

Hyprland validation must cover:

- fractional scaling
- text sharpness and font fallback
- Chinese IME input
- clipboard and drag and drop
- file open/save dialogs
- external link opening
- Reader/Web/Dual resizing
- focus and keyboard navigation
- multiple monitors and scale changes
- suspend/resume and window restoration
- Intel, AMD, and NVIDIA graphics when hardware is available

The supported Linux setup should document the expected XDG desktop portal and secret-service components. Missing portal configuration can affect file dialogs and other desktop integration even when the Electron application itself is correct.

Do not ship `--disable-gpu` globally. GPU-disabling switches are diagnostic fallbacks for specific driver problems and materially reduce rendering performance. Preserve an XWayland fallback and document any confirmed vendor-specific workaround.

## 12. macOS Adaptation Notes

The existing SwiftUI application remains the behavior and design reference during migration. The Electron application should run alongside it until the required coursework scope reaches parity.

The new cross-platform implementation should reuse:

- product behavior and interaction contracts
- database semantics and migration intent
- prompt templates
- content extraction fixtures
- localization keys and wording
- tests and expected outputs where portable

It should not attempt to embed the current SwiftUI UI or depend on a Swift sidecar in the first version.

Public macOS releases require signing and notarization. Apple Silicon and Intel artifacts may be separate initially; a universal build can be added after both architectures pass native-module tests.

## 13. Build and Release Strategy

Use a locked dependency graph and pin the Electron major and exact package versions used for release. Upgrade Electron deliberately, with security review and the full platform matrix.

GitHub Actions should build on native runners:

| Runner | Initial artifact | Required validation |
|---|---|---|
| Windows | x64 `Setup.exe` | install, launch, persistence, uninstall |
| Linux | x64 portable archive and selected distro package | native Wayland plus XWayland fallback |
| macOS | Apple Silicon package first | launch, persistence, signing path |

Do not treat cross-compilation alone as release validation. Native modules and platform packaging must be built and smoke-tested on the target OS.

Store checksums with release artifacts. Keep signing credentials only in protected CI secrets and never expose them to untrusted pull-request workflows.

## 14. Testing Strategy

### Unit tests

- feed normalization and OPML round trips
- URL and provider endpoint resolution
- database repositories and migrations
- Reader pipeline stage outputs
- Markdown conversion fixtures
- agent state transitions and queue policy
- token usage aggregation
- import/export formatting

### Integration tests

- fresh database creation and upgrade
- sync with deterministic HTTP fixtures
- source HTML to Reader HTML and Markdown
- local LLM streaming with deterministic responses
- application restart during resumable work
- secret-storage availability and fallback behavior
- IPC schema rejection and sender validation

### End-to-end tests

- add a feed, sync, open an article, and mark it read
- OPML import and export
- switch among Reader, Web, and Dual modes
- generate a summary and translation
- add notes and tags, search, and export a digest
- restart and verify persisted state
- install and uninstall a packaged Windows build

### Manual platform matrix

| Platform | Minimum manual coverage |
|---|---|
| Windows 11 x64 | scaling, Chinese paths/IME, installer, SmartScreen/signing path, local LLM |
| Hyprland Wayland | native Wayland, fractional scaling, portals, GPU, focus, Dual mode |
| Linux XWayland | documented fallback launch and core workflows |
| macOS Apple Silicon | core workflows, file dialogs, secrets, package launch |

## 15. Implementation Phases

### Phase 1: vertical slice

- Scaffold Electron, React, TypeScript, Vite, and Forge.
- Establish secure BrowserWindow and preload defaults.
- Create the database and first migrations.
- Import one OPML file or add one feed.
- Sync and display an article list.
- Produce cleaned HTML and Markdown for one article.
- Package and run the slice on Windows 11 and native Wayland.

Do not begin broad feature porting until this slice passes on both target environments.

### Phase 2: complete reading foundation

- feed management and scheduled synchronization
- Reader, Web, and Dual modes
- themes and localization
- read state, search, and offline behavior
- migration and backup handling

### Phase 3: agent foundation

- provider and model settings
- secure API key storage
- shared streaming runtime
- Summary Agent
- Translation Agent
- usage recording

### Phase 4: additional coursework features

- notes and single/multi-entry digest export
- manual and agent-assisted tags
- batch tagging and tag management
- local logs and diagnostic export

### Phase 5: release hardening

- full Windows installer validation
- native Wayland and XWayland matrix
- macOS packaging
- code signing where applicable
- GitHub Actions releases, checksums, and reproducibility notes
- user documentation and in-app help

## 16. Non-Goals for the First Version

- Rust backend or commands
- Swift sidecar or Swift ABI bridge
- direct reuse of SwiftUI views
- Windows ARM64 release
- mandatory auto-update
- custom frameless or transparent windows
- login, cloud synchronization, or server-owned user data
- telemetry uploaded without explicit user action

## 17. Acceptance Criteria

The framework decision is successful when:

- one codebase builds for Windows, Linux, and macOS
- the packaged Windows 11 x64 application completes all required coursework workflows
- the Linux application runs as a native Wayland client under Hyprland
- XWayland remains a documented fallback
- Reader, Web, and Dual modes preserve their security boundaries
- SQLite state survives installation upgrades and application restarts
- local and remote OpenAI-compatible providers work without provider-specific UI code
- no remote webpage or article content receives Node privileges
- secrets are encrypted where a secure platform backend exists, with honest Linux fallback reporting
- CI produces native release artifacts and the manual platform checklist is recorded

## 18. Official References

- [Electron packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [`WebContentsView`](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Using native Node modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [Code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Application updates](https://www.electronjs.org/docs/latest/tutorial/updates)
- [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Windows on ARM](https://www.electronjs.org/docs/latest/tutorial/windows-arm)
