import { useRef, type RefObject } from 'react';
import { CheckIcon, SearchIcon } from '../reader/ReaderIcons';

type SearchStatus = 'idle' | 'searching' | 'results' | 'no-results' | 'error';

interface SearchOverlayProps {
  visible: boolean;
  searchInput: string;
  searchStatus: SearchStatus;
  searchAllFeeds: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchInputChange: (query: string) => void;
  onSearchAllFeedsChange: (searchAllFeeds: boolean) => void;
  onClose: () => void;
  selectedSearchFeedLabel?: string | null;
  children?: React.ReactNode;
}

export const SearchOverlay = ({
  visible,
  searchInput,
  searchStatus,
  searchAllFeeds,
  searchInputRef,
  onSearchInputChange,
  onSearchAllFeedsChange,
  onClose,
  selectedSearchFeedLabel,
  children,
}: SearchOverlayProps) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === overlayRef.current) {
      onClose();
    }
  };

  const searchScopeLabel = selectedSearchFeedLabel
    ? searchAllFeeds
      ? '所有订阅源'
      : selectedSearchFeedLabel
    : '所有订阅源';

  return (
    <div
      ref={overlayRef}
      className={"search-overlay" + (visible ? ' is-visible' : '')}
      role="dialog"
      aria-label="搜索"
      onClick={handleBackdropClick}
    >
      <div className="search-overlay-panel">
        <div className="search-overlay-inner">
          <div className="search-overlay-input-row">
            <label className="search-overlay-input">
              <SearchIcon />
              <input
                ref={searchInputRef}
                type="search"
                value={searchInput}
                placeholder="搜索本地文章"
                aria-label="搜索本地文章"
                data-entry-search
                onChange={(event) => onSearchInputChange(event.target.value)}
                autoFocus
              />
              {searchStatus !== 'idle' && (
                <span
                  className={`search-overlay-status is-${searchStatus}`}
                  aria-label={searchStatus === 'searching' ? '正在搜索' : undefined}
                >
                  {searchStatus === 'searching' && <span className="mini-spinner" />}
                  {(searchStatus === 'results' || searchStatus === 'no-results') && <CheckIcon />}
                  {searchStatus === 'error' && <span aria-hidden="true">!</span>}
                </span>
              )}
              <button
                type="button"
                className="search-overlay-close-btn"
                aria-label="关闭搜索"
                onClick={onClose}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </label>
            {searchInput.trim() && (
              <div className="search-overlay-scope">
                {selectedSearchFeedLabel && onSearchAllFeedsChange
                  ? (
                      <button
                        type="button"
                        onClick={() => onSearchAllFeedsChange(!searchAllFeeds)}
                        aria-label={`搜索范围：${searchScopeLabel}，点击切换`}
                      >
                        范围：{searchScopeLabel}
                      </button>
                    )
                  : <span>范围：{searchScopeLabel}</span>}
              </div>
            )}
          </div>
          {children && (
            <div className="search-overlay-results">
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};