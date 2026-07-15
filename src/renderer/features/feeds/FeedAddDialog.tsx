import { useState, type FormEvent } from 'react';

interface FeedAddDialogProps {
  onAdd: (url: string) => Promise<void>;
  onClose: () => void;
}

export const FeedAddDialog = ({ onAdd, onClose }: FeedAddDialogProps) => {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'adding' | 'error'>('idle');
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setStatus('adding');
    setError('');

    try {
      await onAdd(url.trim());
      onClose();
    } catch (err: any) {
      setStatus('error');
      setError(err?.message ?? 'Failed to add feed');
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Add Feed</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="feed-url">Feed URL</label>
            <input
              id="feed-url"
              type="url"
              placeholder="https://example.com/feed.xml"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setStatus('idle');
              }}
              autoFocus
              disabled={status === 'adding'}
            />
          </div>
          {status === 'error' && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={status === 'adding'}>
              Cancel
            </button>
            <button type="submit" disabled={status === 'adding' || !url.trim()}>
              {status === 'adding' ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};