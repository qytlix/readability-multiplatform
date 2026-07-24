import {
  useCallback,
  useEffect,
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
import { HighlighterIcon, TrashIcon } from '../reader/ReaderIcons';
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
      setPopover(null);
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
    if (popover?.mode !== 'edit') return;
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
    setPopover(null);
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
  ): void => {
    const article = articleRef.current;
    if (!article) return;
    setNoteDraft(annotation.noteText);
    setPopover({
      annotationId: annotation.id,
      mode: 'edit',
      position: getNotePosition(
        mark.getBoundingClientRect(),
        article.getBoundingClientRect(),
        'edit',
      ),
    });
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    const annotation = findAnnotationFromTarget(event.target, annotations);
    const mark = closestAnnotationMark(event.target);
    if (!annotation || !mark) return;
    event.preventDefault();
    openEditor(annotation, mark);
  };

  const handleMouseOver = (event: MouseEvent<HTMLDivElement>): void => {
    if (popover?.mode === 'edit') return;
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
    setPopover({
      annotationId: annotation.id,
      mode: 'preview',
      position: getNotePosition(
        mark.getBoundingClientRect(),
        article.getBoundingClientRect(),
        'preview',
      ),
    });
  };

  const schedulePreviewClose = (): void => {
    if (popover?.mode !== 'preview') return;
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
        className={`entry-detail-html${annotationMode ? ' is-annotating' : ''}`}
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
      {popover && activeAnnotation && (
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
            {popover.mode === 'edit' && (
              <span>点击便签外任意位置自动保存</span>
            )}
            <button
              type="button"
              aria-label="删除批注"
              title="删除批注"
              onClick={() => deleteAnnotation(activeAnnotation.id)}
            >
              <TrashIcon />
            </button>
          </footer>
        </aside>
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

function getNotePosition(
  highlightRect: DOMRect,
  articleRect: DOMRect,
  mode: 'preview' | 'edit',
): CSSProperties {
  const viewportPadding = 12;
  const articleGap = 18;
  const width = Math.min(320, Math.max(220, window.innerWidth - 24));
  const rightOfArticle = articleRect.right + articleGap;
  const leftOfArticle = articleRect.left - width - articleGap;
  const viewportRight = window.innerWidth - viewportPadding;
  const left = rightOfArticle + width <= viewportRight
    ? rightOfArticle
    : leftOfArticle >= viewportPadding
      ? leftOfArticle
      : Math.max(viewportPadding, viewportRight - width);
  const estimatedHeight = mode === 'edit' ? 270 : 180;
  const maximumTop = Math.max(
    viewportPadding,
    window.innerHeight - estimatedHeight - viewportPadding,
  );
  const top = Math.min(
    maximumTop,
    Math.max(viewportPadding, highlightRect.top - 4),
  );
  return { left, top, width };
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
