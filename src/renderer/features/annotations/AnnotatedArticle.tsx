import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ANNOTATION_COLORS,
  type AnnotationColor,
  type EntryAnnotation,
} from '../../../shared/contracts/annotation.types';
import { HighlighterIcon, LockIcon, TrashIcon } from '../reader/ReaderIcons';
import {
  applyAnnotationHighlights,
  createAnnotationRequestFromSelection,
  rangesOverlap,
} from './annotationAnchors';

interface AnnotatedArticleProps {
  entryId: number;
  sourceHtml: string;
  toolbarTarget: HTMLDivElement | null;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
}

type NotePopover =
  | {
      annotationId: number;
      mode: 'preview' | 'edit';
      position: CSSProperties;
      connector: CSSProperties | null;
      anchorMarkIndex: number;
      anchorLineIndex: number;
      anchorTopOffset: number;
      locked: boolean;
    }
  | null;

const COLOR_LABELS: Record<AnnotationColor, string> = {
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
  pink: '粉色',
};

export const AnnotatedArticle = ({
  entryId,
  sourceHtml,
  toolbarTarget,
  onClick,
}: AnnotatedArticleProps) => {
  const [annotations, setAnnotations] = useState<EntryAnnotation[]>([]);
  const [selectedColor, setSelectedColor] = useState<AnnotationColor>('yellow');
  const [annotationMode, setAnnotationMode] = useState(false);
  const [popover, setPopover] = useState<NotePopover>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const articleRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const connectorRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback((message: string): void => {
    setFeedback(message);
    if (feedbackTimerRef.current !== null) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => setFeedback(''), 2600);
  }, []);

  useEffect(() => {
    let disposed = false;
    setAnnotations([]);
    setAnnotationMode(false);
    setPopover(null);
    setLoading(true);
    void window.shaleAPI.annotation.list({ entryId }).then((result) => {
      if (disposed) return;
      if (result.ok) {
        setAnnotations(result.data);
      } else {
        showFeedback(result.error.message);
      }
    }).catch(() => {
      if (!disposed) showFeedback('批注加载失败，请稍后重试。');
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [entryId, showFeedback]);

  useEffect(() => () => {
    if (hoverCloseTimerRef.current !== null) {
      clearTimeout(hoverCloseTimerRef.current);
    }
    if (feedbackTimerRef.current !== null) {
      clearTimeout(feedbackTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setAnnotationMode(false);
      setPopover((current) => current?.locked ? current : null);
      window.getSelection()?.removeAllRanges();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const highlightedHtml = useMemo(
    () => applyAnnotationHighlights(sourceHtml, annotations),
    [annotations, sourceHtml],
  );

  const activeAnnotation = popover
    ? annotations.find((annotation) => annotation.id === popover.annotationId)
    : undefined;

  const popoverAnnotationId = popover?.annotationId;
  const popoverMode = popover?.mode;
  const popoverAnchorMarkIndex = popover?.anchorMarkIndex;
  const popoverAnchorLineIndex = popover?.anchorLineIndex;
  const popoverAnchorTopOffset = popover?.anchorTopOffset;

  useLayoutEffect(() => {
    if (
      popoverAnnotationId === undefined
      || popoverMode !== 'edit'
      || popoverAnchorMarkIndex === undefined
      || popoverAnchorLineIndex === undefined
    ) {
      return;
    }
    const article = articleRef.current;
    if (!article) return;
    const highlightRect = getStoredHighlightRect(
      article,
      popoverAnnotationId,
      popoverAnchorMarkIndex,
      popoverAnchorLineIndex,
    );
    if (!highlightRect) return;
    const layout = getNoteLayout(
      highlightRect,
      article.getBoundingClientRect(),
      getNoteHostBounds(article),
      popoverMode,
    );
    setPopover((current) => current
      ? {
          ...current,
          position: layout.position,
          connector: layout.connector,
          anchorTopOffset: Number(layout.position.top) - highlightRect.top,
        }
      : null);
  }, [
    popoverAnchorLineIndex,
    popoverAnchorMarkIndex,
    popoverAnnotationId,
    popoverMode,
  ]);

  useEffect(() => {
    if (
      popoverAnnotationId === undefined
      || popoverMode === undefined
      || popoverAnchorMarkIndex === undefined
      || popoverAnchorLineIndex === undefined
      || popoverAnchorTopOffset === undefined
    ) {
      return;
    }
    const article = articleRef.current;
    const scrollContainer = article?.closest<HTMLElement>('.entry-detail-scroll');
    if (!article || !scrollContainer) return;
    let animationFrame: number | null = null;
    const refreshLayout = (): void => {
      const highlightRect = getStoredHighlightRect(
        article,
        popoverAnnotationId,
        popoverAnchorMarkIndex,
        popoverAnchorLineIndex,
      );
      if (!highlightRect) return;
      const layout = getNoteLayout(
        highlightRect,
        article.getBoundingClientRect(),
        getNoteHostBounds(article),
        popoverMode,
        popoverAnchorTopOffset,
      );
      applyPopoverLayout(popoverRef.current, connectorRef.current, layout);
    };
    const scheduleRefresh = (): void => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        refreshLayout();
      });
    };
    scrollContainer.addEventListener('scroll', scheduleRefresh, { passive: true });
    window.addEventListener('resize', scheduleRefresh);
    return () => {
      scrollContainer.removeEventListener('scroll', scheduleRefresh);
      window.removeEventListener('resize', scheduleRefresh);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [
    popoverAnchorLineIndex,
    popoverAnchorMarkIndex,
    popoverAnchorTopOffset,
    popoverAnnotationId,
    popoverMode,
  ]);

  const persistNote = useCallback((
    annotationId: number,
    noteText: string,
  ): void => {
    const previous = annotations.find((annotation) => annotation.id === annotationId);
    if (!previous || previous.noteText === noteText) {
      setPopover(null);
      return;
    }
    setAnnotations((current) => current.map((annotation) => (
      annotation.id === annotationId
        ? { ...annotation, noteText }
        : annotation
    )));
    setPopover(null);
    void window.shaleAPI.annotation.updateNote({
      annotationId,
      noteText,
    }).then((result) => {
      if (result.ok) {
        setAnnotations((current) => current.map((annotation) => (
          annotation.id === result.data.id ? result.data : annotation
        )));
      } else {
        setAnnotations((current) => current.map((annotation) => (
          annotation.id === annotationId ? previous : annotation
        )));
        showFeedback(result.error.message);
      }
    }).catch(() => {
      setAnnotations((current) => current.map((annotation) => (
        annotation.id === annotationId ? previous : annotation
      )));
      showFeedback('便签保存失败，请重试。');
    });
  }, [annotations, showFeedback]);

  useEffect(() => {
    if (popover?.mode !== 'edit' || popover.locked) return;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node
        && popoverRef.current?.contains(event.target)
      ) {
        return;
      }
      persistNote(popover.annotationId, noteDraft);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    };
  }, [noteDraft, persistNote, popover]);

  const chooseColor = (color: AnnotationColor): void => {
    setSelectedColor(color);
    setAnnotationMode(true);
    setPopover((current) => current?.locked ? current : null);
    showFeedback(`批注模式已开启：${COLOR_LABELS[color]}荧光笔`);
  };

  const handleMouseUp = (): void => {
    if (!annotationMode || loading) return;
    const root = articleRef.current;
    if (!root) return;
    const selection = window.getSelection();
    const request = createAnnotationRequestFromSelection(
      selection,
      root,
      entryId,
      selectedColor,
    );
    if (!request) return;
    if (rangesOverlap(request.startOffset, request.endOffset, annotations)) {
      showFeedback('所选文字与已有批注重叠，请重新选择。');
      selection?.removeAllRanges();
      return;
    }

    void window.shaleAPI.annotation.create(request).then((result) => {
      if (result.ok) {
        setAnnotations((current) => [...current, result.data]);
        showFeedback('已添加高亮，右键高亮文字可编辑便签。');
      } else {
        showFeedback(result.error.message);
      }
    }).catch(() => {
      showFeedback('高亮保存失败，请重试。');
    }).finally(() => {
      selection?.removeAllRanges();
    });
  };

  const openEditor = (
    annotation: EntryAnnotation,
    mark: HTMLElement,
    clientX: number,
    clientY: number,
  ): void => {
    const article = articleRef.current;
    if (!article) return;
    const anchor = getHighlightAnchor(
      article,
      annotation.id,
      mark,
      clientX,
      clientY,
    );
    if (!anchor) return;
    const layout = getNoteLayout(
      anchor.rect,
      article.getBoundingClientRect(),
      getNoteHostBounds(article),
      'edit',
    );
    setNoteDraft(annotation.noteText);
    setPopover({
      annotationId: annotation.id,
      mode: 'edit',
      position: layout.position,
      connector: layout.connector,
      anchorMarkIndex: anchor.markIndex,
      anchorLineIndex: anchor.lineIndex,
      anchorTopOffset: Number(layout.position.top) - anchor.rect.top,
      locked: false,
    });
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    const annotation = findAnnotationFromTarget(event.target, annotations);
    const mark = closestAnnotationMark(event.target);
    if (!annotation || !mark) return;
    event.preventDefault();
    if (popover?.locked) return;
    openEditor(annotation, mark, event.clientX, event.clientY);
  };

  const handleMouseOver = (event: MouseEvent<HTMLDivElement>): void => {
    if (popover?.mode === 'edit' || popover?.locked) return;
    const annotation = findAnnotationFromTarget(event.target, annotations);
    if (!annotation?.noteText.trim()) return;
    const mark = closestAnnotationMark(event.target);
    if (!mark) return;
    if (
      event.relatedTarget instanceof Node
      && mark.contains(event.relatedTarget)
    ) {
      return;
    }
    if (hoverCloseTimerRef.current !== null) {
      clearTimeout(hoverCloseTimerRef.current);
    }
    const article = articleRef.current;
    if (!article) return;
    const anchor = getHighlightAnchor(
      article,
      annotation.id,
      mark,
      event.clientX,
      event.clientY,
    );
    if (!anchor) return;
    const layout = getNoteLayout(
      anchor.rect,
      article.getBoundingClientRect(),
      getNoteHostBounds(article),
      'preview',
    );
    setPopover({
      annotationId: annotation.id,
      mode: 'preview',
      position: layout.position,
      connector: layout.connector,
      anchorMarkIndex: anchor.markIndex,
      anchorLineIndex: anchor.lineIndex,
      anchorTopOffset: Number(layout.position.top) - anchor.rect.top,
      locked: false,
    });
  };

  const schedulePreviewClose = (): void => {
    if (popover?.mode !== 'preview' || popover.locked) return;
    if (hoverCloseTimerRef.current !== null) {
      clearTimeout(hoverCloseTimerRef.current);
    }
    hoverCloseTimerRef.current = setTimeout(() => setPopover(null), 140);
  };

  const handleMouseOut = (event: MouseEvent<HTMLDivElement>): void => {
    const mark = closestAnnotationMark(event.target);
    if (
      mark
      && event.relatedTarget instanceof Node
      && mark.contains(event.relatedTarget)
    ) {
      return;
    }
    schedulePreviewClose();
  };

  const togglePopoverLock = (): void => {
    if (hoverCloseTimerRef.current !== null) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    setPopover((current) => current
      ? { ...current, locked: !current.locked }
      : null);
  };

  const deleteAnnotation = (annotationId: number): void => {
    void window.shaleAPI.annotation.delete({ annotationId }).then((result) => {
      if (!result.ok) {
        showFeedback(result.error.message);
        return;
      }
      setAnnotations((current) => current.filter(
        (annotation) => annotation.id !== annotationId,
      ));
      setPopover(null);
      showFeedback('批注已删除。');
    }).catch(() => {
      showFeedback('批注删除失败，请重试。');
    });
  };

  const toolbar = toolbarTarget
    ? createPortal(
      <div className="annotation-toolbar">
        <span
          className="article-action-tooltip annotation-tool-trigger"
          data-tooltip={annotationMode ? '退出批注模式' : '选择荧光笔颜色'}
        >
          <button
            type="button"
            className={`icon-button annotation-tool-button${
              annotationMode ? ' is-active' : ''
            }`}
            aria-label={annotationMode ? '退出批注模式' : '开启批注模式'}
            aria-pressed={annotationMode}
            disabled={loading}
            onClick={() => setAnnotationMode((active) => !active)}
          >
            <HighlighterIcon />
            <span
              className="annotation-active-color"
              data-annotation-color={selectedColor}
              aria-hidden="true"
            />
          </button>
          <div className="annotation-color-palette" aria-label="荧光笔颜色">
            {ANNOTATION_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={color === selectedColor ? 'is-selected' : ''}
                data-annotation-color={color}
                aria-label={`使用${COLOR_LABELS[color]}荧光笔`}
                aria-pressed={annotationMode && color === selectedColor}
                onClick={() => chooseColor(color)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
        </span>
      </div>,
      toolbarTarget,
    )
    : null;

  return (
    <>
      {toolbar}
      <div
        ref={articleRef}
        className={`entry-detail-html${annotationMode ? ' is-annotating' : ''}${
          popover?.mode === 'edit' ? ' has-open-annotation-note' : ''
        }`}
        data-inline-translation-root
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        onClick={onClick}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onMouseOver={handleMouseOver}
        onMouseOut={handleMouseOut}
      />
      {feedback && (
        <div className="annotation-feedback" role="status">{feedback}</div>
      )}
      {popover && activeAnnotation && createPortal(
        <>
          <div
            ref={connectorRef}
            className="annotation-note-connector"
            data-annotation-color={activeAnnotation.color}
            style={popover.connector ?? { display: 'none' }}
            aria-hidden="true"
          />
          <aside
            ref={popoverRef}
            className={`annotation-note is-${popover.mode}`}
            style={popover.position}
            role={popover.mode === 'edit' ? 'dialog' : 'tooltip'}
            aria-label="批注便签"
            onMouseEnter={() => {
              if (hoverCloseTimerRef.current !== null) {
                clearTimeout(hoverCloseTimerRef.current);
              }
            }}
            onMouseLeave={schedulePreviewClose}
          >
            <header className="annotation-note-header">
              <strong>批注</strong>
              <time dateTime={activeAnnotation.updatedAt}>
                {formatAnnotationTimestamp(activeAnnotation.updatedAt)}
              </time>
            </header>
            <div className="annotation-note-body">
              {popover.mode === 'edit' ? (
                <textarea
                  autoFocus
                  value={noteDraft}
                  maxLength={20_000}
                  placeholder="写下你的想法…"
                  aria-label="批注内容"
                  onChange={(event) => setNoteDraft(event.target.value)}
                />
              ) : (
                <p>{activeAnnotation.noteText}</p>
              )}
            </div>
            <footer>
              <button
                type="button"
                className={`annotation-note-lock${popover.locked ? ' is-active' : ''}`}
                aria-label={popover.locked ? '解除批注锁定' : '锁定批注'}
                aria-pressed={popover.locked}
                title={popover.locked ? '解除锁定' : '锁定便签'}
                onClick={togglePopoverLock}
              >
                <LockIcon locked={popover.locked} />
              </button>
              {popover.mode === 'edit' && (
                <span>
                  {popover.locked
                    ? '便签已锁定，解除后可自动保存并收起'
                    : '点击便签外任意位置自动保存'}
                </span>
              )}
              <button
                type="button"
                className="annotation-note-delete"
                aria-label="删除批注"
                title="删除批注"
                onClick={() => deleteAnnotation(activeAnnotation.id)}
              >
                <TrashIcon />
              </button>
            </footer>
          </aside>
        </>,
        document.querySelector<HTMLElement>('.annotation-overlay-root')
          ?? document.body,
      )}
    </>
  );
};

function closestAnnotationMark(target: EventTarget): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>('mark[data-annotation-id]')
    : null;
}

function findAnnotationFromTarget(
  target: EventTarget,
  annotations: EntryAnnotation[],
): EntryAnnotation | undefined {
  const annotationId = Number(
    closestAnnotationMark(target)?.dataset.annotationId,
  );
  return Number.isInteger(annotationId)
    ? annotations.find((annotation) => annotation.id === annotationId)
    : undefined;
}

function distanceToRect(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): number {
  const horizontalDistance = Math.max(rect.left - clientX, 0, clientX - rect.right);
  const verticalDistance = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
  return horizontalDistance ** 2 + verticalDistance ** 2;
}

interface NoteLayout {
  position: CSSProperties;
  connector: CSSProperties | null;
}

interface HighlightAnchor {
  rect: DOMRect;
  markIndex: number;
  lineIndex: number;
}

interface NoteHostBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function getHighlightAnchor(
  article: HTMLElement,
  annotationId: number,
  mark: HTMLElement,
  clientX: number,
  clientY: number,
): HighlightAnchor | null {
  const marks = Array.from(article.querySelectorAll<HTMLElement>(
    `mark[data-annotation-id="${annotationId}"]`,
  ));
  const markIndex = marks.indexOf(mark);
  if (markIndex < 0) return null;
  const lineRects = getMarkLineRects(mark);
  const containingLineIndex = lineRects.findIndex((rect) => (
    clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom
  ));
  const lineIndex = containingLineIndex >= 0
    ? containingLineIndex
    : lineRects.reduce((closestIndex, candidate, candidateIndex) => (
      distanceToRect(clientX, clientY, candidate)
        < distanceToRect(clientX, clientY, lineRects[closestIndex])
        ? candidateIndex
        : closestIndex
    ), 0);
  return { rect: lineRects[lineIndex], markIndex, lineIndex };
}

function getStoredHighlightRect(
  article: HTMLElement,
  annotationId: number,
  markIndex: number,
  lineIndex: number,
): DOMRect | null {
  const mark = Array.from(article.querySelectorAll<HTMLElement>(
    `mark[data-annotation-id="${annotationId}"]`,
  ))[markIndex];
  if (!mark) return null;
  const lineRects = getMarkLineRects(mark);
  return lineRects[Math.min(lineIndex, lineRects.length - 1)] ?? null;
}

function getMarkLineRects(mark: HTMLElement): DOMRect[] {
  const lineRects = Array.from(mark.getClientRects());
  return lineRects.length > 0 ? lineRects : [mark.getBoundingClientRect()];
}

function getNoteHostBounds(article: HTMLElement): NoteHostBounds {
  const readerPane = article.closest<HTMLElement>('.entry-detail');
  if (readerPane) return readerPane.getBoundingClientRect();
  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
}

function getNoteLayout(
  highlightRect: DOMRect,
  articleRect: DOMRect,
  hostBounds: NoteHostBounds,
  mode: 'preview' | 'edit',
  anchorTopOffset?: number,
): NoteLayout {
  const viewportPadding = 12;
  const articleGap = 26;
  const hostLeft = Math.max(0, hostBounds.left) + viewportPadding;
  const hostRight = Math.min(window.innerWidth, hostBounds.right)
    - viewportPadding;
  const hostTop = Math.max(0, hostBounds.top) + viewportPadding;
  const hostBottom = Math.min(window.innerHeight, hostBounds.bottom)
    - viewportPadding;
  const width = Math.min(320, Math.max(0, hostRight - hostLeft));
  const rightOfArticle = articleRect.right + articleGap;
  const maximumLeft = Math.max(hostLeft, hostRight - width);
  const left = Math.min(Math.max(hostLeft, rightOfArticle), maximumLeft);
  const estimatedHeight = mode === 'edit' ? 270 : 180;
  const maximumTop = Math.max(hostTop, hostBottom - estimatedHeight);
  const top = anchorTopOffset === undefined
    ? Math.min(maximumTop, Math.max(hostTop, highlightRect.top - 4))
    : highlightRect.top + anchorTopOffset;
  return {
    position: { left, top, width },
    connector: getNoteConnector(
      highlightRect,
      { left, top, right: left + width },
    ),
  };
}

function getNoteConnector(
  highlightRect: DOMRect,
  noteRect: { left: number; top: number; right: number },
): CSSProperties | null {
  const noteBandTop = noteRect.top + 8;
  const noteBandBottom = noteRect.top + 54;
  const top = Math.min(highlightRect.top, noteBandTop);
  const bottom = Math.max(highlightRect.bottom, noteBandBottom);

  if (noteRect.left >= highlightRect.right) {
    const left = highlightRect.right - 1;
    const right = noteRect.left + 1;
    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
      clipPath: `polygon(0 ${highlightRect.top - top}px, `
        + `100% ${noteBandTop - top}px, `
        + `100% ${noteBandBottom - top}px, `
        + `0 ${highlightRect.bottom - top}px)`,
    };
  }

  return null;
}

function applyPopoverLayout(
  note: HTMLElement | null,
  connector: HTMLElement | null,
  layout: NoteLayout,
): void {
  if (note) {
    setStyleValue(note, 'left', layout.position.left);
    setStyleValue(note, 'top', layout.position.top);
    setStyleValue(note, 'width', layout.position.width);
  }
  if (!connector) return;
  if (!layout.connector) {
    connector.style.display = 'none';
    return;
  }
  connector.style.display = '';
  setStyleValue(connector, 'left', layout.connector.left);
  setStyleValue(connector, 'top', layout.connector.top);
  setStyleValue(connector, 'width', layout.connector.width);
  setStyleValue(connector, 'height', layout.connector.height);
  connector.style.clipPath = String(layout.connector.clipPath ?? '');
}

function setStyleValue(
  element: HTMLElement,
  property: 'left' | 'top' | 'width' | 'height',
  value: string | number | undefined,
): void {
  if (value === undefined || value === null) return;
  element.style.setProperty(
    property,
    typeof value === 'number' ? `${value}px` : String(value),
  );
}

function formatAnnotationTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}
