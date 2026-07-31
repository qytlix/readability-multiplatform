import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  getProviderPreset,
  type ProviderProfile,
} from '../../../shared/contracts/provider.types';
import {
  formatChatModelLabel,
  getChatModelOptions,
} from './chatModelSelection';

interface ChatModelSwitcherProps {
  profile: ProviderProfile | null;
  disabled: boolean;
  onSelectModel: (model: string) => Promise<boolean>;
}

export const ChatModelSwitcher = ({
  profile,
  disabled,
  onSelectModel,
}: ChatModelSwitcherProps) => {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = profile ? getChatModelOptions(profile) : [];
  const currentLabel = profile
    ? formatChatModelLabel(profile.chatModel)
    : '未配置模型';
  const unavailable = disabled || selecting || !profile;

  useEffect(() => {
    if (!open) return undefined;

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
    if (disabled) setOpen(false);
  }, [disabled]);

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
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selecting ? '切换中…' : currentLabel}</span>
        <span className="article-chat-model-chevron" aria-hidden="true" />
      </button>
      {open && profile && (
        <div
          className="article-chat-model-menu"
          role="listbox"
          aria-label="选择问答模型"
          data-placement="top"
        >
          <div className="article-chat-model-menu-header">
            {getProviderPreset(profile.chatProviderKind).label} 问答模型
          </div>
          <div className="article-chat-model-options">
            {options.map((option) => (
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
          </div>
        </div>
      )}
    </div>
  );
};
