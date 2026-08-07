import {
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Tag } from '../../../shared/contracts/tag.types';

type SelectionChange = 'read' | 'starred' | 'tags';
type TagDialogMode = 'add' | 'remove' | null;

interface EntrySelectionActionsProps {
  selectedIds: Set<number>;
  onChanged: (change: SelectionChange) => Promise<void>;
  onFeedback: (message: string) => void;
  onExport: () => void;
}

export const EntrySelectionActions = ({
  selectedIds,
  onChanged,
  onFeedback,
  onExport,
}: EntrySelectionActionsProps) => {
  const [busyAction, setBusyAction] = useState<SelectionChange | null>(null);
  const [dialogMode, setDialogMode] = useState<TagDialogMode>(null);
  const [tagName, setTagName] = useState('');
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const ids = Array.from(selectedIds);
  const disabled = ids.length === 0 || busyAction !== null;

  useEffect(() => {
    if (dialogMode === null) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDialogMode(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogMode]);

  const runEntryAction = async (change: Exclude<SelectionChange, 'tags'>): Promise<void> => {
    if (ids.length === 0) return;
    setBusyAction(change);
    try {
      const result = change === 'read'
        ? await window.shaleAPI.entry.markRead(ids, true)
        : await window.shaleAPI.entry.markStarred(ids, true);
      if (!result.ok) throw new Error(result.error.message);
      await onChanged(change);
      onFeedback(change === 'read'
        ? `已将 ${ids.length} 篇文章标记为已读。`
        : `已收藏 ${ids.length} 篇文章。`);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '批量操作失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const openRemoveDialog = async (): Promise<void> => {
    if (ids.length === 0) return;
    setDialogMode('remove');
    setLoadingTags(true);
    setAvailableTags([]);
    try {
      const result = await window.shaleAPI.tag.listByEntries(ids);
      if (!result.ok) throw new Error(result.error.message);
      setAvailableTags(result.data);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '未能读取所选文章的标签。');
      setDialogMode(null);
    } finally {
      setLoadingTags(false);
    }
  };

  const handleAddTag = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const name = tagName.trim();
    if (!name || ids.length === 0) return;
    setBusyAction('tags');
    try {
      const result = await window.shaleAPI.tag.tagEntries(ids, name);
      if (!result.ok) throw new Error(result.error.message);
      await onChanged('tags');
      onFeedback(`已为 ${ids.length} 篇文章添加标签「${name}」。`);
      setTagName('');
      setDialogMode(null);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '批量添加标签失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveTag = async (tag: Tag): Promise<void> => {
    if (ids.length === 0) return;
    setBusyAction('tags');
    try {
      const result = await window.shaleAPI.tag.untagEntries(ids, tag.id);
      if (!result.ok) throw new Error(result.error.message);
      await onChanged('tags');
      onFeedback(`已从所选文章移除标签「${tag.name}」。`);
      setDialogMode(null);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '批量移除标签失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const dialog = dialogMode && (
    <div className="dialog-overlay" onClick={() => setDialogMode(null)}>
      <div
        className="dialog selection-tag-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="selection-tag-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="selection-tag-dialog-title">
          {dialogMode === 'add' ? '批量添加标签' : '批量移除标签'}
        </h2>
        <p>将操作应用到已选择的 {ids.length} 篇文章。</p>
        {dialogMode === 'add' ? (
          <form onSubmit={(event) => void handleAddTag(event)}>
            <label className="selection-tag-field">
              <span>标签名称</span>
              <input
                autoFocus
                value={tagName}
                maxLength={50}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="输入标签名称"
              />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setDialogMode(null)}>取消</button>
              <button type="submit" disabled={!tagName.trim() || busyAction !== null}>
                添加
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="selection-tag-list">
              {loadingTags && <p>正在读取标签…</p>}
              {!loadingTags && availableTags.length === 0 && (
                <p>所选文章暂时没有可移除的标签。</p>
              )}
              {availableTags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  disabled={busyAction !== null}
                  onClick={() => void handleRemoveTag(tag)}
                >
                  <span style={{ backgroundColor: tag.color }} aria-hidden="true" />
                  {tag.name}
                </button>
              ))}
            </div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setDialogMode(null)}>关闭</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="selection-actions" aria-label="批量操作">
        <button type="button" disabled={disabled} onClick={() => void runEntryAction('read')}>
          标为已读
        </button>
        <button type="button" disabled={disabled} onClick={() => void runEntryAction('starred')}>
          收藏
        </button>
        <button type="button" disabled={disabled} onClick={() => setDialogMode('add')}>
          添加标签
        </button>
        <button type="button" disabled={disabled} onClick={() => void openRemoveDialog()}>
          移除标签
        </button>
        <button type="button" disabled={disabled} onClick={onExport}>
          导出
        </button>
      </div>
      {dialog && createPortal(dialog, document.querySelector('.reader-page') ?? document.body)}
    </>
  );
};
