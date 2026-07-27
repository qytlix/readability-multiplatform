import { useCallback, useEffect, useRef, useState } from 'react';
import type { TagCandidate } from '../../../shared/contracts/tag.types';

interface AutoTagPanelProps {
  entryId: number;
  /** Called when tags are confirmed and persisted. */
  onTagsChanged?: () => void;
  /** Whether to auto-trigger generation on mount. */
  autoTrigger?: boolean;
}

type PanelState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'candidates'; candidates: TagCandidate[]; selected: Set<string> }
  | { type: 'error'; message: string };

const DEFAULT_MAX_CANDIDATES = 8;

export const AutoTagPanel = ({ entryId, onTagsChanged, autoTrigger }: AutoTagPanelProps) => {
  const [panelState, setPanelState] = useState<PanelState>({ type: 'idle' });
  const [isConfirming, setIsConfirming] = useState(false);
  const hasTriggered = useRef(false);

  // Auto-trigger on mount
  useEffect(() => {
    if (!autoTrigger || hasTriggered.current) return;
    hasTriggered.current = true;
    let cancelled = false;
    void (async () => {
      setPanelState({ type: 'loading' });
      try {
        const result = await window.shaleAPI.tag.autoTagGenerate({
          entryId,
          maxCandidates: DEFAULT_MAX_CANDIDATES,
        });
        if (cancelled || !result.ok) {
          if (!cancelled) setPanelState({ type: 'idle' });
          return;
        }
        const candidates = result.data;
        if (candidates.length === 0) {
          if (!cancelled) setPanelState({ type: 'idle' });
          return;
        }
        if (!cancelled) {
          setPanelState({
            type: 'candidates',
            candidates,
            selected: new Set(candidates.map((c) => c.name)),
          });
        }
      } catch {
        if (!cancelled) setPanelState({ type: 'idle' });
      }
    })();
    return () => { cancelled = true; };
  }, [autoTrigger, entryId]);

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

  // Idle: show generate button
  if (panelState.type === 'idle') {
    return (
      <div className="auto-tag-panel">
        <p className="tag-floating-suggestion-label">AI标签</p>
        <button
          type="button"
          className="auto-tag-trigger-pill"
          onClick={() => void generate()}
        >
          ✨ 生成标签
        </button>
      </div>
    );
  }

  // Loading: show spinner
  if (panelState.type === 'loading') {
    return (
      <div className="auto-tag-panel">
        <p className="tag-floating-suggestion-label">AI标签</p>
        <div className="tag-floating-loading">
          <span className="auto-tag-spinner" aria-hidden="true" />
          {' '}正在生成…
        </div>
      </div>
    );
  }

  // Error: show message + retry
  if (panelState.type === 'error') {
    return (
      <div className="auto-tag-panel">
        <p className="tag-floating-suggestion-label">AI标签</p>
        <p className="auto-tag-error" role="alert">{panelState.message}</p>
        <button
          type="button"
          className="auto-tag-trigger-pill"
          onClick={() => void generate()}
        >
          ✨ 重试
        </button>
      </div>
    );
  }

  // Candidates: show pill suggestions + confirm/cancel
  if (panelState.type === 'candidates') {
    const { candidates, selected } = panelState;
    const allSelected = selected.size === candidates.length;
    return (
      <div className="auto-tag-panel">
        <div className="auto-tag-header">
          <p className="tag-floating-suggestion-label">AI标签</p>
          <button
            type="button"
            className="auto-tag-select-all"
            onClick={() => {
              setPanelState((prev) => {
                if (prev.type !== 'candidates') return prev;
                return {
                  ...prev,
                  selected: allSelected
                    ? new Set<string>()
                    : new Set(candidates.map((c) => c.name)),
                };
              });
            }}
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
        </div>
        <div className="tag-floating-suggestions">
          {candidates.map((candidate) => {
            const isSelected = selected.has(candidate.name);
            return (
              <button
                key={candidate.name}
                type="button"
                className={`tag-suggestion-pill${isSelected ? ' is-selected' : ''}`}
                onClick={() => toggleCandidate(candidate.name)}
                title={candidate.source === 'matched' ? '已有标签' : '新标签建议'}
              >
                {candidate.source === 'matched' ? '☆ ' : '✨ '}
                {candidate.name}
              </button>
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
            {isConfirming ? '正在保存…' : `确认添加 (${selected.size})`}
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
