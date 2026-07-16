export type FeedLoadStatus = 'loading' | 'success' | 'error';
export type EntryLoadStatus = 'loading' | 'success' | 'error';

export type ReaderDisplayState =
  | 'feed-loading'
  | 'feed-error'
  | 'no-feeds'
  | 'entries-loading'
  | 'entries-error'
  | 'no-articles'
  | 'no-selection'
  | 'article';

interface ReaderStateInput {
  feedLoadStatus: FeedLoadStatus;
  feedCount: number;
  entryLoadStatus: EntryLoadStatus;
  entryCount: number;
  hasSelectedEntry: boolean;
}

export const getReaderDisplayState = ({
  feedLoadStatus,
  feedCount,
  entryLoadStatus,
  entryCount,
  hasSelectedEntry,
}: ReaderStateInput): ReaderDisplayState => {
  if (feedLoadStatus === 'loading') return 'feed-loading';
  if (feedLoadStatus === 'error') return 'feed-error';
  if (feedCount === 0) return 'no-feeds';
  if (entryLoadStatus === 'loading') return 'entries-loading';
  if (entryLoadStatus === 'error') return 'entries-error';
  if (entryCount === 0) return 'no-articles';
  if (!hasSelectedEntry) return 'no-selection';

  return 'article';
};
