import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { Tag, TagWithCount } from '../../../shared/contracts/tag.types';
import { TagBadge } from './TagBadge';
import { TagInput } from './TagInput';
import { AutoTagPanel } from './AutoTagPanel';

interface TagFloatingWindowProps {
  entryId: number;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** Portal container — defaults to .reader-page */
  container?: HTMLElement;
  /** Called after any tag is added or removed (for sidebar count refresh) */
  onTagsChanged?: () => void;
  /** Max candidate tags from user preferences (tagAgentMaxCandidates). */
  maxCandidates?: number;
}

type LoadState = 'loading' | 'loaded' | 'error';

export const TagFloatingWindow = ({
  entryId,
  anchorEl,
  onClose,
  container,
  onTagsChanged,
  maxCandidates,
}: TagFloatingWindowProps) => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [availableTags, setAvailableTags] = useState<TagWithCount[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [operationError, setOperationError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  // Position the floating window relative to the anchor button
  useEffect(() => {
    if (!anchorEl) {
      setPosition(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    // Position below the button, right-aligned
    setPosition({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    });
  }, [anchorEl]);

  // Load tags on mount and when entryId changes
  useEffect(() => {
    let cancelled = false;
    const loadTags = async () => {
      setLoadState('loading');
      setOperationError('');
      try {
        const [entryResult, availResult] = await Promise.all([
          window.shaleAPI.tag.listByEntry(entryId),
          window.shaleAPI.tag.listAvailableForEntry(entryId),
        ]);
        if (cancelled) return;
        if (!entryResult.ok) {
          setLoadState('error');
          setOperationError(entryResult.error?.message ?? 'Failed to load tags.');
        } else if (!availResult.ok) {
          setLoadState('error');
          setOperationError(availResult.error?.message ?? 'Failed to load tags.');
        } else {
          setTags(entryResult.data);
          setAvailableTags(availResult.data);
          setLoadState('loaded');
        }
      } catch {
        if (!cancelled) {
          setLoadState('error');
          setOperationError('Failed to load tags.');
        }
      }
    };
    void loadTags();
    return () => { cancelled = true; };
  }, [entryId]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        windowRef.current
        && !windowRef.current.contains(e.target as Node)
        && anchorEl
        && !anchorEl.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    // Use mousedown to catch before the button's click event
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, anchorEl]);

  const handleAdd = useCallback(async (tagName: string) => {
    setOperationError('');
    setDuplicateWarning('');

    // Check for duplicate (case-sensitive)
    if (tags.some((t) => t.name === tagName)) {
      setDuplicateWarning(`标签“${tagName}”已存在。`);
      return;
    }

    try {
      // First ensure the tag exists, then link it
      const createResult = await window.shaleAPI.tag.createTag(tagName);
      if (!createResult.ok) {
        setOperationError(createResult.error?.message ?? 'Failed to create tag.');
        return;
      }
      const tagResult = await window.shaleAPI.tag.tagEntry(entryId, tagName);
      if (!tagResult.ok) {
        setOperationError(tagResult.error?.message ?? 'Failed to tag entry.');
        return;
      }
      // Reload tag list and available tags
      await reloadTagData(entryId, setTags, setAvailableTags);
      onTagsChanged?.();
    } catch {
      setOperationError('Failed to add tag.');
    }
  }, [entryId, tags, onTagsChanged]);

  const handleAddAvailable = useCallback(async (tagName: string) => {
    setOperationError('');
    setDuplicateWarning('');
    try {
      // The tag already exists globally, just link it
      const tagResult = await window.shaleAPI.tag.tagEntry(entryId, tagName);
      if (!tagResult.ok) {
        setOperationError(tagResult.error?.message ?? 'Failed to tag entry.');
        return;
      }
      // Reload tag list and available tags
      await reloadTagData(entryId, setTags, setAvailableTags);
      onTagsChanged?.();
    } catch {
      setOperationError('Failed to add tag.');
    }
  }, [entryId, onTagsChanged]);

  const handleRemove = useCallback(async (tagId: number) => {
    setOperationError('');
    setDuplicateWarning('');
    // Optimistic UI: remove immediately
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    try {
      const result = await window.shaleAPI.tag.untagEntry(entryId, tagId);
      if (!result.ok) {
        setOperationError(result.error?.message ?? 'Failed to remove tag.');
        // Reload to restore correct state
        await reloadTagData(entryId, setTags, setAvailableTags);
      } else {
        // Reload available tags to reflect freed tag
        const availResult = await window.shaleAPI.tag.listAvailableForEntry(entryId);
        if (availResult.ok) setAvailableTags(availResult.data);
      }
      onTagsChanged?.();
    } catch {
      setOperationError('Failed to remove tag.');
      await reloadTagData(entryId, setTags, setAvailableTags);
    }
  }, [entryId, onTagsChanged]);

  const floatingContent = (
    <div
      ref={windowRef}
      className="tag-floating-window"
      style={
        position
          ? { position: 'fixed', top: position.top, right: position.right }
          : undefined
      }
      role="dialog"
      aria-label="Tag editor"
    >
      <div className="tag-floating-header">
        <span className="tag-floating-title">标签</span>
      </div>
      <TagInput onAdd={handleAdd} disabled={loadState === 'loading'} />
      <AutoTagPanel
        entryId={entryId}
        onTagsChanged={onTagsChanged}
        autoTrigger
        maxCandidates={maxCandidates}
      />
      {duplicateWarning && (
        <p className="tag-floating-warning" role="alert">{duplicateWarning}</p>
      )}
      {operationError && (
        <p className="tag-floating-error" role="alert">{operationError}</p>
      )}
      {loadState === 'loading' && (
        <p className="tag-floating-loading">正在加载标签…</p>
      )}
      {loadState === 'error' && !operationError && (
        <p className="tag-floating-error" role="alert">Failed to load tags.</p>
      )}
      {loadState === 'loaded' && availableTags.length > 0 && (
        <>
          <p className="tag-floating-suggestion-label">已有标签</p>
          <div className="tag-floating-suggestions">
            {availableTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="tag-suggestion-pill"
                onClick={() => handleAddAvailable(tag.name)}
              >
                {tag.name}
                <span className="tag-suggestion-count">{tag.count}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {loadState === 'loaded' && tags.length === 0 && (
        <p className="tag-floating-empty">本文还没有标签，点击已有标签或输入标签以添加。</p>
      )}
      {tags.length > 0 && (
        <div className="tag-floating-list">
          {tags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  );

  return createPortal(floatingContent, container ?? getPageRoot());
}

function getPageRoot(): HTMLElement {
  return document.querySelector<HTMLElement>('.reader-page') ?? document.body;
}

async function reloadTagData(
  entryId: number,
  setTags: (tags: Tag[]) => void,
  setAvailableTags: (tags: TagWithCount[]) => void,
): Promise<void> {
  const [entryResult, availResult] = await Promise.all([
    window.shaleAPI.tag.listByEntry(entryId),
    window.shaleAPI.tag.listAvailableForEntry(entryId),
  ]);
  if (entryResult.ok) setTags(entryResult.data);
  if (availResult.ok) setAvailableTags(availResult.data);
}
