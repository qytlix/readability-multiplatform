export interface ArticleChatLayoutSnapshot {
  sidebarOpen: boolean;
  entryListCollapsed: boolean;
  entryListWidth: number;
}

export interface ReaderColumnState {
  sidebarOpen: boolean;
  readingFocus: boolean;
  storyListWidth: number;
}

const normalizeStoryListWidth = (width: number): number => (
  Number.isFinite(width) && width > 0 ? Math.round(width) : 0
);

export const createArticleChatLayoutSnapshot = ({
  sidebarOpen,
  readingFocus,
  storyListWidth,
}: ReaderColumnState): ArticleChatLayoutSnapshot => ({
  sidebarOpen,
  entryListCollapsed: readingFocus,
  entryListWidth: normalizeStoryListWidth(storyListWidth),
});

export const restoreReaderColumnState = (
  snapshot: ArticleChatLayoutSnapshot,
): ReaderColumnState => ({
  sidebarOpen: snapshot.sidebarOpen,
  readingFocus: snapshot.entryListCollapsed,
  storyListWidth: normalizeStoryListWidth(snapshot.entryListWidth),
});
