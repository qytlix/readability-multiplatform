import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Feed } from '../../../shared/contracts/feed.types';

interface FeedDeleteDialogProps {
  feed: Feed;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

type DeleteStatus = 'idle' | 'deleting' | 'error';

const getErrorMessage = (error: unknown): string => (
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : '删除失败，请稍后重试。'
);

export const FeedDeleteDialog = ({
  feed,
  onConfirm,
  onClose,
}: FeedDeleteDialogProps) => {
  const [status, setStatus] = useState<DeleteStatus>('idle');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const feedName = feed.title?.trim() || feed.feedURL;
  const isDeleting = status === 'deleting';

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || isDeleting) return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isDeleting, onClose]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), '
        + 'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusableElements || focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isDeleting) {
      onClose();
    }
  };

  const handleConfirm = async () => {
    if (isDeleting) return;

    setStatus('deleting');
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (caughtError: unknown) {
      setStatus('error');
      setError(getErrorMessage(caughtError));
    }
  };

  const dialog = (
    <div
      className="dialog-overlay feed-delete-overlay"
      onClick={handleOverlayClick}
    >
      <div
        ref={dialogRef}
        className="dialog feed-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isDeleting}
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id={titleId}>确定要删除这个 Feed 吗？</h2>

        <div className="feed-delete-target">
          <span className="feed-delete-target-mark" aria-hidden="true">
            {feedName.slice(0, 1).toLocaleUpperCase()}
          </span>
          <span className="feed-delete-target-copy">
            <strong title={feedName}>{feedName}</strong>
            <span title={feed.feedURL}>{feed.feedURL}</span>
          </span>
        </div>

        <p className="feed-delete-description" id={descriptionId}>
          Shale 会同时移除这个订阅源已保存在本地的文章、收藏和阅读进度。
          原网站内容不会受到影响。
        </p>

        <div className="feed-delete-warning">
          <span aria-hidden="true">!</span>
          <p><strong>此操作无法撤销</strong>，如需恢复，你需要重新添加这个 Feed。</p>
        </div>

        {status === 'error' && (
          <p className="error-message feed-delete-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions feed-delete-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="feed-delete-cancel"
            disabled={isDeleting}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="feed-delete-confirm"
            disabled={isDeleting}
            onClick={() => void handleConfirm()}
          >
            {isDeleting && <span className="mini-spinner" aria-hidden="true" />}
            {isDeleting ? '正在删除…' : '删除订阅源'}
          </button>
        </div>
      </div>
    </div>
  );

  const pageRoot = document.querySelector<HTMLElement>('.reader-page');
  return createPortal(dialog, pageRoot ?? document.body);
};
