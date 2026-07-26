import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { SyncIcon } from './ReaderIcons';

interface ArticleSyncMenuProps {
  hasEntry: boolean;
  isRefreshing: boolean;
  onRefreshArticle: () => void;
  onRetranslateArticle: () => void;
}

const HOVER_CLOSE_DELAY_MS = 160;

/** Compact Reader toolbar menu for article-scoped refresh operations. */
export const ArticleSyncMenu = ({
  hasEntry,
  isRefreshing,
  onRefreshArticle,
  onRetranslateArticle,
}: ArticleSyncMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const openMenu = useCallback(() => {
    clearCloseTimer();
    setIsOpen(true);
  }, [clearCloseTimer]);

  const closeMenu = useCallback(() => {
    clearCloseTimer();
    setIsOpen(false);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setIsOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const openAndFocusFirstItem = useCallback(() => {
    openMenu();
    window.requestAnimationFrame(() => firstItemRef.current?.focus());
  }, [openMenu]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>, direction: 1 | -1): void => {
    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    if (!items || items.length === 0) return;
    const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + items.length) % items.length;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      if (!isOpen) return;
      event.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        openAndFocusFirstItem();
        return;
      }
      moveFocus(event, 1);
      return;
    }
    if (event.key === 'ArrowUp' && isOpen) {
      moveFocus(event, -1);
      return;
    }
    if ((event.key === 'Home' || event.key === 'End') && isOpen) {
      const items = rootRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      );
      const target = event.key === 'Home' ? items?.[0] : items?.[items.length - 1];
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className="article-sync-menu"
      onPointerEnter={openMenu}
      onPointerLeave={scheduleClose}
      onFocusCapture={openMenu}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
      }}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`article-toolbar-action article-refresh-button${
          isRefreshing ? ' is-loading' : ''
        }`}
        aria-label={isRefreshing ? '正在重新获取正文' : '文章同步操作'}
        aria-busy={isRefreshing}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={isRefreshing ? '正在重新获取正文' : '文章同步操作'}
        disabled={!hasEntry || isRefreshing}
        onClick={() => {
          if (isOpen) closeMenu();
          else openMenu();
        }}
      >
        <SyncIcon />
      </button>
      {isOpen && (
        <div className="article-sync-menu-panel" role="menu" aria-label="文章同步操作">
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            className="article-sync-menu-item"
            onClick={() => {
              closeMenu();
              onRefreshArticle();
            }}
          >
            重新拉取文章
          </button>
          <button
            type="button"
            role="menuitem"
            className="article-sync-menu-item"
            onClick={() => {
              closeMenu();
              onRetranslateArticle();
            }}
          >
            重新翻译
          </button>
        </div>
      )}
    </div>
  );
};
