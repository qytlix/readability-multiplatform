import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Feed } from '../../../shared/contracts/feed.types';
import { CheckIcon, CopyIcon } from '../reader/ReaderIcons';

interface FeedEditDialogProps {
  feed: Feed;
  onSave: (params: { title?: string; siteURL?: string; syncIntervalMin?: number }) => Promise<void>;
  onClose: () => void;
}

export const FeedEditDialog = ({ feed, onSave, onClose }: FeedEditDialogProps) => {
  const [title, setTitle] = useState(feed.title ?? '');
  const [siteURL, setSiteURL] = useState(feed.siteURL ?? '');
  const [syncIntervalMin, setSyncIntervalMin] = useState(String(feed.syncIntervalMin));
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<'title' | 'siteURL' | null>(null);

  useEffect(() => {
    if (copiedField === null) return;
    const timer = window.setTimeout(() => setCopiedField(null), 2800);
    return () => window.clearTimeout(timer);
  }, [copiedField]);

  const handleCopy = async (
    field: 'title' | 'siteURL',
    value: string,
  ): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
    } catch {
      setStatus('error');
      setError('Failed to copy to clipboard');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('saving');
    setError('');

    try {
      const params: { title?: string; siteURL?: string; syncIntervalMin?: number } = {};

      if (title.trim() && title.trim() !== feed.title) {
        params.title = title.trim();
      }
      if (siteURL.trim() !== (feed.siteURL ?? '')) {
        params.siteURL = siteURL.trim() || undefined;
      }
      const interval = parseInt(syncIntervalMin, 10);
      if (!Number.isNaN(interval) && interval > 0 && interval !== feed.syncIntervalMin) {
        params.syncIntervalMin = interval;
      }

      await onSave(params);
      onClose();
    } catch (err: any) {
      setStatus('error');
      setError(err?.message ?? 'Failed to update feed');
    }
  };

  const dialog = (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog feed-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feed-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="feed-edit-title">Edit Feed</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-title">Title</label>
            <div className="feed-edit-copy-row">
              <input
                id="edit-title"
                type="text"
                placeholder="Feed title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                disabled={status === 'saving'}
              />
              <button
                type="button"
                className={`feed-edit-copy-button${
                  copiedField === 'title' ? ' is-copied' : ''
                }`}
                aria-label={copiedField === 'title' ? 'Title copied' : 'Copy title'}
                disabled={
                  status === 'saving'
                  || title.length === 0
                  || copiedField === 'title'
                }
                onClick={() => void handleCopy('title', title)}
              >
                {copiedField === 'title' ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="edit-site-url">Site URL</label>
            <div className="feed-edit-copy-row">
              <input
                id="edit-site-url"
                type="url"
                placeholder="https://example.com"
                value={siteURL}
                onChange={(e) => setSiteURL(e.target.value)}
                disabled={status === 'saving'}
              />
              <button
                type="button"
                className={`feed-edit-copy-button${
                  copiedField === 'siteURL' ? ' is-copied' : ''
                }`}
                aria-label={copiedField === 'siteURL' ? 'Site URL copied' : 'Copy Site URL'}
                disabled={
                  status === 'saving'
                  || siteURL.length === 0
                  || copiedField === 'siteURL'
                }
                onClick={() => void handleCopy('siteURL', siteURL)}
              >
                {copiedField === 'siteURL' ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="edit-sync-interval">Sync Interval (minutes)</label>
            <input
              id="edit-sync-interval"
              type="number"
              min="5"
              max="1440"
              value={syncIntervalMin}
              onChange={(e) => setSyncIntervalMin(e.target.value)}
              disabled={status === 'saving'}
            />
          </div>
          {status === 'error' && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={status === 'saving'}>
              Cancel
            </button>
            <button type="submit" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const portalHost = document.querySelector<HTMLElement>('.reader-page');
  return createPortal(dialog, portalHost ?? document.body);
};
