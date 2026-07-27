import { useCallback, useState } from 'react';
import type { TagCandidate } from '../../../shared/contracts/tag.types';

interface AutoTagPanelProps {
  entryId: number;
  /** Called when tags are confirmed and persisted. */
  onTagsChanged?: () => void;
  /** Pre-generated candidates from auto-trigger (skip idle state). */
  initialCandidates?: TagCandidate[];
}

type PanelState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'candidates'; candidates: TagCandidate[]; selected: Set<string> }
  | { type: 'error'; message: string };

const DEFAULT_MAX_CANDIDATES = 8;

export const AutoTagPanel = ({ entryId, onTagsChanged, initialCandidates }: AutoTagPanelProps) => {
  const [panelState, setPanelState] = useState<PanelState>(
    initialCandidates && initialCandidates.length > 0
      ? { type: 'candidates', candidates: initialCandidates, selected: new Set(initialCandidates.map((c) => c.name)) }
      : { type: 'idle' },
  );
  const [isConfirming, setIsConfirming] = useState(false);

  const generate = useCallback(async () => {
    setPanelState({ type: 'loading' });
    try {
      const result = await window.shaleAPI.tag.autoTagGenerate({
        entryId,
        maxCandidates: DEFAULT_MAX_CANDIDATES,
      });
      if (!result.ok) {
        setPanelState({ type: 'error', message: result.error.message });
        return;
      }
      const candidates = result.data;
      if (candidates.length === 0) {
        setPanelState({ type: 'error', message: '未能生成标签，请重试。' });
        return;
      }
      setPanelState({
        type: 'candidates',
        candidates,
        selected: new Set(candidates.map((c) => c.name)),
      });
    } catch {
      setPanelState({ type: 'error', message: '标签生成请求失败。' });
    }
  }, [entryId]);

  const toggleCandidate = useCallback((name: string) => {
    setPanelState((prev) => {
      if (prev.type !== 'candidates') return prev;
      const next = new Set(prev.selected);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...prev, selected: next };
    });
  }, []);

  const confirm = useCallback(async () => {
    if (panelState.type !== 'candidates') return;
    const selectedNames = Array.from(panelState.selected);
    if (selectedNames.length === 0) return;
    setIsConfirming(true);
    try {
      const result = await window.shaleAPI.tag.autoTagConfirm({
        entryId,
        tagNames: selectedNames,
      });
      setIsConfirming(false);
      if (!result.ok) {
        setPanelState({ type: 'error', message: result.error.message });
        return;
      }
      setPanelState({ type: 'idle' });
      onTagsChanged?.();
    } catch {
      setIsConfirming(false);
      setPanelState({ type: 'error', message: '标签确认失败。' });
    }
  }, [entryId, panelState, onTagsChanged]);

  const cancel = useCallback(() => {
    setPanelState({ type: 'idle' });
  }, []);

  // ── Render ──────────────────────────────────────────────

  if (panelState.type === 'idle') {
    return (
      <div className="auto-tag-panel">
        <button
          type="button"
          className="auto-tag-trigger"
          onClick={() => void generate()}
        >
          ✨ 生成标签
        </button>
      </div>
    );
  }

  if (panelState.type === 'loading') {
    return (
      <div className="auto-tag-panel">
        <button type="button" className="auto-tag-trigger" disabled>
          <span className="auto-tag-spinner" aria-hidden="true" />
          正在生成…
        </button>
      </div>
    );
  }

  if (panelState.type === 'error') {
    return (
      <div className="auto-tag-panel">
        <button
          type="button"
          className="auto-tag-trigger"
          onClick={() => void generate()}
        >
          ✨ 生成标签
        </button>
        <p className="auto-tag-error" role="alert">{panelState.message}</p>
      </div>
    );
  }

  if (panelState.type === 'candidates') {
    const { candidates, selected } = panelState;
    return (
      <div className="auto-tag-panel">
        <div className="auto-tag-candidate-list">
          {candidates.map((candidate) => {
            const label = candidate.source === 'matched'
              ? '已有标签'
              : '新标签建议';
            return (
              <label key={candidate.name} className="auto-tag-candidate">
                <input
                  type="checkbox"
                  checked={selected.has(candidate.name)}
                  onChange={() => toggleCandidate(candidate.name)}
                />
                <span
                  className={`auto-tag-candidate-name is-${candidate.source}`}
                  title={label}
                >
                  {candidate.source === 'matched' ? '☆ ' : '✨ '}
                  {candidate.name}
                </span>
              </label>
            );
          })}
        </div>
        <div className="auto-tag-actions">
          <button
            type="button"
            className="auto-tag-confirm"
            disabled={selected.size === 0 || isConfirming}
            onClick={() => void confirm()}
          >
            {isConfirming ? '正在保存…' : '确认添加'}
          </button>
          <button
            type="button"
            className="auto-tag-cancel"
            onClick={cancel}
            disabled={isConfirming}
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return null;
};
