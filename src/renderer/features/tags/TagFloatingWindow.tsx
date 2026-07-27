import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { Tag } from '../../../shared/contracts/tag.types';
import { TagBadge } from './TagBadge';
import { TagInput } from './TagInput';

interface TagFloatingWindowProps {
  entryId: number;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** Portal container — defaults to document.body */
  container?: HTMLElement;
}

type LoadState = 'loading' | 'loaded' | 'error';

export const TagFloatingWindow = ({
  entryId,
  anchorEl,
  onClose,
  container,
}: TagFloatingWindowProps) => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [operationError, setOperationError] = useState('');
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
        const result = await window.shaleAPI.tag.listByEntry(entryId);
        if (cancelled) return;
        if (result.ok) {
          setTags(result.data);
          setLoadState('loaded');
        } else {
          setLoadState('error');
          setOperationError(result.error?.message ?? 'Failed to load tags.');
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
      // Reload tag list
      const listResult = await window.shaleAPI.tag.listByEntry(entryId);
      if (listResult.ok) {
        setTags(listResult.data);
      }
    } catch {
      setOperationError('Failed to add tag.');
    }
  }, [entryId]);

  const handleRemove = useCallback(async (tagId: number) => {
    setOperationError('');
    // Optimistic UI: remove immediately
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    try {
      const result = await window.shaleAPI.tag.untagEntry(entryId, tagId);
      if (!result.ok) {
        setOperationError(result.error?.message ?? 'Failed to remove tag.');
        // Reload to restore correct state
        const listResult = await window.shaleAPI.tag.listByEntry(entryId);
        if (listResult.ok) {
          setTags(listResult.data);
        }
      }
    } catch {
      setOperationError('Failed to remove tag.');
      // Reload to restore correct state
      const listResult = await window.shaleAPI.tag.listByEntry(entryId);
      if (listResult.ok) {
        setTags(listResult.data);
      }
    }
  }, [entryId]);

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
      {operationError && (
        <p className="tag-floating-error" role="alert">{operationError}</p>
      )}
      {loadState === 'loading' && (
        <p className="tag-floating-loading">正在加载标签…</p>
      )}
      {loadState === 'error' && !operationError && (
        <p className="tag-floating-error" role="alert">Failed to load tags.</p>
      )}
      {loadState === 'loaded' && tags.length === 0 && (
        <p className="tag-floating-empty">还没有标签，输入名称添加。</p>
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

  return createPortal(floatingContent, container ?? document.body);
};