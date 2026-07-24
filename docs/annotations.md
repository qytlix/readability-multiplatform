# Text annotations

## Goal and scope

The Reader supports local, per-article text annotations:

- choose one of four highlighter colors from the Reader toolbar;
- select rendered article text to create a persistent highlight;
- right-click any highlighted text to edit its note, even outside annotation mode;
- click outside the note to save and close it;
- hover a highlight with a non-empty note to preview the note;
- delete the annotation from the note, removing both its highlight and note.

The note is vertically anchored to its highlight and is placed in the Reader
margin beside the article whenever space allows. Its header shows the
annotation's latest local update date and time. On narrow windows it falls back
to the opposite margin or the viewport edge so the note remains usable. A
non-interactive translucent projection in the annotation color visually joins
the highlighted text to the open note without blocking article interaction.
When a highlight wraps across lines, the projection uses the exact line fragment
under the pointer instead of the inline element's multi-line bounding box, so
sidebar and story-list width changes do not distort the projection. If the
layout must reflow, the component keeps the original mark ordinal and wrapped
line ordinal, then remeasures that same fragment instead of switching to a
different highlighted phrase. The projection begins at the fragment's right
edge and is never mirrored backward.
While the Reader scrolls, the open note and projection are remeasured against
that same fragment on the next animation frame. Their initial vertical offset
is preserved, so the note follows the article instead of drifting in viewport
coordinates. Both elements are rendered in the Reader root overlay rather than
inside the paint-contained article pane, ensuring initial placement and scroll
updates use the same viewport coordinate system with either sidebar open.
While a note is being edited, the article body yields a responsive right-side
rail when its normal margin is too narrow, keeping the note and projection in
the same left-to-right arrangement with either Reader sidebar open. The note is
also clamped to the actual Reader pane rather than the full application window.

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
