import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  getProviderPreset,
  type ProviderChatModel,
  type ProviderProfile,
} from '../../../shared/contracts/provider.types';
import {
  formatChatModelLabel,
  getChatModelOptions,
  type ChatModelCatalogStatus,
} from './chatModelSelection';

interface ChatModelSwitcherProps {
  profile: ProviderProfile | null;
  disabled: boolean;
  models?: ProviderChatModel[];
  catalogStatus?: ChatModelCatalogStatus;
  catalogErrorMessage?: string;
  onRequestModels?: () => Promise<boolean>;
  onSelectModel: (model: string) => Promise<boolean>;
}

export const ChatModelSwitcher = ({
  profile,
  disabled,
  models = [],
  catalogStatus = 'idle',
  catalogErrorMessage = '',
  onRequestModels,
  onSelectModel,
}: ChatModelSwitcherProps) => {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const options = profile ? getChatModelOptions(profile, models) : [];
  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => (
      option.label.toLocaleLowerCase().includes(normalizedQuery)
      || option.value.toLocaleLowerCase().includes(normalizedQuery)
      || option.description.toLocaleLowerCase().includes(normalizedQuery)
    ));
  }, [options, query]);
  const currentLabel = profile
    ? formatChatModelLabel(profile.chatModel)
    : '未配置模型';
  const unavailable = disabled || selecting || !profile;

  useEffect(() => {
    if (!open) {
      setQuery('');
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node
        && !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery('');
    }
  }, [disabled]);

  const handleToggle = (): void => {
    if (open) {
      setOpen(false);
      setQuery('');
      return;
    }
    setOpen(true);
    if (
      onRequestModels
      && (catalogStatus === 'idle' || catalogStatus === 'error')
    ) {
      void onRequestModels();
    }
  };

  const handleSelect = async (
    event: ReactMouseEvent<HTMLButtonElement>,
    model: string,
  ): Promise<void> => {
    event.preventDefault();
    if (!profile || selecting) return;
    if (model === profile.chatModel) {
      setOpen(false);
      return;
    }

    setSelecting(true);
    const switched = await onSelectModel(model);
    setSelecting(false);
    if (switched) setOpen(false);
  };

  return (
    <div className="article-chat-model-switcher" ref={rootRef}>
      <button
        type="button"
        className="article-chat-model-trigger"
        aria-label={`切换问答模型，当前 ${currentLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={unavailable}
        title={profile?.chatModel}
        onClick={handleToggle}
      >
        <span>{selecting ? '切换中…' : currentLabel}</span>
        <span className="article-chat-model-chevron" aria-hidden="true" />
      </button>
      {open && profile && (
        <div
          className="article-chat-model-menu"
          aria-label="选择问答模型"
          data-placement="top"
        >
          <div className="article-chat-model-menu-header">
            <span>
              {getProviderPreset(profile.chatProviderKind).label} 问答模型
            </span>
            <button
              type="button"
              aria-label="刷新可用模型"
              title="使用已保存的 API Key 刷新模型"
              disabled={catalogStatus === 'loading'}
              onClick={() => void onRequestModels?.()}
            >
              ↻
            </button>
          </div>
          <div className="article-chat-model-search">
            <input
              type="search"
              value={query}
              aria-label="搜索模型"
              placeholder="搜索模型"
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {catalogStatus === 'loading' && (
            <div className="article-chat-model-catalog-status" role="status">
              正在读取此 API Key 可用的模型…
            </div>
          )}
          {catalogStatus === 'error' && (
            <div
              className="article-chat-model-catalog-status is-error"
              role="status"
              title={catalogErrorMessage}
            >
              在线模型读取失败，可继续使用已加载或常用模型
            </div>
          )}
          {catalogStatus === 'success' && models.length === 0 && (
            <div className="article-chat-model-catalog-status" role="status">
              Provider 未返回可用于问答的模型
            </div>
          )}
          <div
            className="article-chat-model-options"
            role="listbox"
            aria-label="可用问答模型"
            aria-busy={catalogStatus === 'loading'}
            data-placement="top"
          >
            {visibleOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.current}
                className={option.current ? 'is-current' : ''}
                data-model={option.value}
                onClick={(event) => void handleSelect(event, option.value)}
              >
                <span className="article-chat-model-check" aria-hidden="true">
                  {option.current ? '✓' : ''}
                </span>
                <span className="article-chat-model-copy">
                  <strong>
                    {option.label}
                    {option.recommended && (
                      <span
                        className="article-chat-model-star"
                        aria-label="推荐"
                      >
                        ★
                      </span>
                    )}
                  </strong>
                  <small>{option.description}</small>
                </span>
              </button>
            ))}
            {visibleOptions.length === 0 && (
              <p className="article-chat-model-empty">没有匹配的模型</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
