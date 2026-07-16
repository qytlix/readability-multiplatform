import { useState, type FormEvent } from 'react';
import type { Feed } from '../../../shared/contracts/feed.types';

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

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Feed</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-title">Title</label>
            <input
              id="edit-title"
              type="text"
              placeholder="Feed title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              disabled={status === 'saving'}
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-site-url">Site URL</label>
            <input
              id="edit-site-url"
              type="url"
              placeholder="https://example.com"
              value={siteURL}
              onChange={(e) => setSiteURL(e.target.value)}
              disabled={status === 'saving'}
            />
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
};