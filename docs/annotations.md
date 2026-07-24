# Text annotations

## Goal and scope

The Reader supports local, per-article text annotations:

- choose one of four highlighter colors from the Reader toolbar;
- select rendered article text to create a persistent highlight;
- right-click highlighted text while annotation mode is active to edit its note;
- click outside the note to save and close it;
- hover a highlight with a non-empty note to preview the note;
- delete the annotation from the note, removing both its highlight and note.

The first version applies only to cleaned Reader HTML. Raw Markdown, embedded
video views, translated output, exports, synchronization, and overlapping
highlights are outside this scope.

## Data and process boundaries

`entry_annotation` stores an annotation separately from cleaned content. The
Renderer never writes markup back to `entry_content`; it calls the typed
`annotation:*` Preload API, and Main validates requests before delegating to
`AnnotationService` and `AnnotationStore`.

Each anchor contains UTF-16 text offsets, the exact selected text, and up to 64
characters of prefix and suffix context. On render, the exact offsets are used
when they still match. If article text shifted, the quote and context select
the best matching occurrence. If the quote no longer exists, the annotation
remains in SQLite but is not rendered.

Highlights may span multiple HTML text nodes. Rendering wraps only the selected
text nodes in `mark[data-annotation-id]`; the sanitized source markup and links
remain unchanged. Overlapping ranges are rejected to keep rendering and
interaction deterministic.

## Verification

Automated coverage includes:

- migration, CRUD, entry cascade, validation, and overlap behavior;
- authorized and invalid typed IPC requests;
- multi-node DOM selections, highlight rendering, context recovery, and range
  intersection rules;
- full typecheck, lint, and project test suite.

Human verification is still required on Windows 11 and native Wayland for the
hover palette, text selection, context menu, note positioning, light/dark
themes, and persistence after restarting the application.
