import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type { ChatSelectionContext } from '../../../shared/contracts/chat.types';
import {
  getArticleChatSelectionTarget,
  type ArticleChatSelectionTarget,
} from './articleChatSelection';

interface ArticleChatSelectionMenuProps {
  entryId: number;
  containerRef: RefObject<HTMLElement | null>;
  onAskAI: (selection: ChatSelectionContext) => void;
}

export const ArticleChatSelectionMenu = ({
  entryId,
  containerRef,
  onAskAI,
}: ArticleChatSelectionMenuProps) => {
  const [target, setTarget] = useState<ArticleChatSelectionTarget | null>(null);
  const menuRef = useRef<HTMLElement>(null);
  const captureTimerRef = useRef<number | null>(null);

  const clearCaptureTimer = useCallback((): void => {
    if (captureTimerRef.current !== null) {
      window.clearTimeout(captureTimerRef.current);
      captureTimerRef.current = null;
    }
  }, []);

  const close = useCallback((): void => {
    clearCaptureTimer();
    setTarget(null);
  }, [clearCaptureTimer]);

  useEffect(() => {
    close();
    const container = containerRef.current;
    if (!container) return;

    const captureSelection = (): void => {
      if (captureTimerRef.current !== null) {
        window.clearTimeout(captureTimerRef.current);
      }
      captureTimerRef.current = window.setTimeout(() => {
        captureTimerRef.current = null;
        setTarget(getArticleChatSelectionTarget(
          window.getSelection(),
          container,
          entryId,
        ));
      }, 0);
    };
    const closeOnSelectionChange = (): void => {
      if (!window.getSelection()?.isCollapsed) return;
      setTarget(null);
    };
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node
        && menuRef.current?.contains(event.target)
      ) {
        return;
      }
      setTarget(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };

    container.addEventListener('pointerup', captureSelection);
    container.addEventListener('keyup', captureSelection);
    container.addEventListener('scroll', close, { passive: true });
    document.addEventListener('selectionchange', closeOnSelectionChange);
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      container.removeEventListener('pointerup', captureSelection);
      container.removeEventListener('keyup', captureSelection);
      container.removeEventListener('scroll', close);
      document.removeEventListener('selectionchange', closeOnSelectionChange);
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', closeOnEscape);
      clearCaptureTimer();
    };
  }, [clearCaptureTimer, close, containerRef, entryId]);

  if (!target) return null;

  const askAI = (): void => {
    onAskAI(target.selection);
    window.getSelection()?.removeAllRanges();
    close();
  };

  return (
    <aside
      ref={menuRef}
      className="article-chat-selection-menu"
      style={getArticleChatSelectionMenuPosition(target.rect)}
      role="toolbar"
      aria-label="选中文本操作"
    >
      <button
        type="button"
        onPointerDown={(event) => event.preventDefault()}
        onClick={askAI}
      >
        问问 AI
      </button>
    </aside>
  );
};

export function getArticleChatSelectionMenuPosition(
  rect: DOMRect,
): CSSProperties {
  const width = 112;
  const height = 42;
  const viewportPadding = 12;
  const left = Math.max(
    viewportPadding,
    Math.min(
      rect.left + (rect.width / 2) - (width / 2),
      window.innerWidth - width - viewportPadding,
    ),
  );
  const top = rect.bottom + height + viewportPadding <= window.innerHeight
    ? rect.bottom + 8
    : Math.max(viewportPadding, rect.top - height - 8);
  return { left, top };
}
