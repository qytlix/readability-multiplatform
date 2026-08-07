import { useState, type FormEvent } from 'react';
import type { SuspectedFeedDuplicate } from '../../../shared/contracts/feed.ipc';

interface FeedAddDialogProps {
  onAdd: (url: string, allowSuspectedDuplicate?: boolean) => Promise<void>;
  onClose: () => void;
}

export const FeedAddDialog = ({ onAdd, onClose }: FeedAddDialogProps) => {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'adding' | 'error'>('idle');
  const [error, setError] = useState('');
  const [suspectedDuplicate, setSuspectedDuplicate] =
    useState<SuspectedFeedDuplicate | null>(null);

  const addFeed = async (allowSuspectedDuplicate: boolean): Promise<void> => {
    setStatus('adding');
    setError('');
    try {
      await onAdd(url.trim(), allowSuspectedDuplicate);
      onClose();
    } catch (failure: unknown) {
      if (isSuspectedDuplicateFailure(failure)) {
        setSuspectedDuplicate(failure.details);
        setStatus('idle');
        return;
      }
      setStatus('error');
      setError(failure instanceof Error ? failure.message : 'Failed to add feed');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    await addFeed(false);
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
                setSuspectedDuplicate(null);
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
          {suspectedDuplicate && (
            <section className="feed-duplicate-warning" role="alert">
              <h3>可能已订阅相同内容</h3>
              <p>{suspectedDuplicate.reason}</p>
              <dl>
                <dt>准备添加</dt>
                <dd>
                  {suspectedDuplicate.candidate.title ?? '未命名 Feed'}
                  <small>{suspectedDuplicate.candidate.feedURL}</small>
                </dd>
                <dt>已有订阅</dt>
                <dd>
                  {suspectedDuplicate.existing.title ?? '未命名 Feed'}
                  <small>{suspectedDuplicate.existing.feedURL}</small>
                </dd>
              </dl>
              <p>这只是内容重合提示，Shale 不会自动合并或删除订阅。</p>
            </section>
          )}
          <div className="dialog-actions">
            {suspectedDuplicate ? (
              <>
                <button type="button" onClick={() => setSuspectedDuplicate(null)}>
                  取消
                </button>
                <button type="button" onClick={onClose}>跳过</button>
                <button
                  type="button"
                  disabled={status === 'adding'}
                  onClick={() => void addFeed(true)}
                >
                  {status === 'adding' ? '正在添加…' : '仍然添加'}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={onClose} disabled={status === 'adding'}>
                  Cancel
                </button>
                <button type="submit" disabled={status === 'adding' || !url.trim()}>
                  {status === 'adding' ? 'Adding...' : 'Add'}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

function isSuspectedDuplicateFailure(
  value: unknown,
): value is Error & {
  code: 'FEED_SUSPECTED_DUPLICATE';
  details: SuspectedFeedDuplicate;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    code?: unknown;
    details?: Partial<SuspectedFeedDuplicate>;
  };
  return candidate.code === 'FEED_SUSPECTED_DUPLICATE'
    && typeof candidate.details?.reason === 'string'
    && typeof candidate.details?.existing?.feedURL === 'string'
    && typeof candidate.details?.candidate?.feedURL === 'string';
}
