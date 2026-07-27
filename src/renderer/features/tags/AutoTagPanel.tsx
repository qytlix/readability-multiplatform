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
  | { type: 'checking' }
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'candidates'; candidates: TagCandidate[]; selected: Set<string> }
  | { type: 'timeout' }
  | { type: 'error'; message: string }
  | { type: 'done' };

const DEFAULT_MAX_CANDIDATES = 8;

const LOADING_TIMEOUT_SECONDS = 60;

// Persist candidates in the current app session so re-opening the floating
// window shows the same suggestions without re-generating.
const sessionCandidates = new Map<number, TagCandidate[]>();

// Track in-flight generation requests across remounts.
const pendingRequests = new Map<
  number,
  Promise<{ ok: boolean; data?: TagCandidate[]; error?: { message: string } }>
>();

async function fetchCandidates(entryId: number): Promise<{
  ok: boolean;
  data?: TagCandidate[];
  error?: { message: string };
}> {
  const existing = pendingRequests.get(entryId);
  if (existing) return existing;

  const promise = window.shaleAPI.tag.autoTagGenerate({
    entryId,
    maxCandidates: DEFAULT_MAX_CANDIDATES,
  });
  pendingRequests.set(entryId, promise);

  void promise.then(() => {
    if (pendingRequests.get(entryId) === promise) {
      pendingRequests.delete(entryId);
    }
  }, () => {
    if (pendingRequests.get(entryId) === promise) {
      pendingRequests.delete(entryId);
    }
  });

  return promise;
}

export const AutoTagPanel = ({ entryId, onTagsChanged, autoTrigger }: AutoTagPanelProps) => {
  const [panelState, setPanelState] = useState<PanelState>({ type: 'checking' });
  const [isConfirming, setIsConfirming] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(LOADING_TIMEOUT_SECONDS);
  const hasTriggered = useRef(false);
  const loadingStartedAt = useRef(0);
  const panelPhase = useRef<PanelState['type']>('checking');

  useEffect(() => {
    panelPhase.current = panelState.type;
  }, [panelState]);

  // ── On mount: check DB status and session cache ─────────

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // First check session cache for candidates
      const cached = sessionCandidates.get(entryId);
      if (cached && cached.length > 0) {
        if (!cancelled) {
          setPanelState({
            type: 'candidates',
            candidates: cached,
            selected: new Set(cached.map((c) => c.name)),
          });
        }
        return;
      }

      // Then check DB for AI-tag-generated flag
      try {
        const status = await window.shaleAPI.tag.autoTagCheckStatus(entryId);
        if (!cancelled && status.ok && status.data.aiTagGenerated) {
          setPanelState({ type: 'done' });
          return;
        }
      } catch {
        // Silently continue — will fall through to idle/auto-trigger
      }

      if (cancelled) return;

      // Not done and no cached candidates — check auto-trigger
      if (autoTrigger && !hasTriggered.current) {
        hasTriggered.current = true;
        setPanelState({ type: 'loading' });
        loadingStartedAt.current = Date.now();
        try {
          const result = await fetchCandidates(entryId);
          if (cancelled || panelPhase.current !== 'loading') return;
          if (!result.ok) {
            setPanelState({ type: 'error', message: result.error?.message ?? '生成失败。' });
            return;
          }
          const candidates = result.data;
          if (!candidates || candidates.length === 0) {
            setPanelState({ type: 'idle' });
            return;
          }
          sessionCandidates.set(entryId, candidates);
          setPanelState({
            type: 'candidates',
            candidates,
            selected: new Set(candidates.map((c) => c.name)),
          });
        } catch {
          if (!cancelled && panelPhase.current === 'loading') {
            setPanelState({ type: 'idle' });
          }
        }
      } else {
        setPanelState({ type: 'idle' });
      }
    })();
    return () => { cancelled = true; };
  }, [entryId, autoTrigger]);

  // Countdown timer while loading
  useEffect(() => {
    if (panelState.type !== 'loading') {
      loadingStartedAt.current = 0;
      setRemainingSeconds(LOADING_TIMEOUT_SECONDS);
      return;
    }
    if (loadingStartedAt.current === 0) {
      loadingStartedAt.current = Date.now();
    }
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - loadingStartedAt.current) / 1000);
      const remaining = Math.max(0, LOADING_TIMEOUT_SECONDS - elapsed);
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        setPanelState({ type: 'timeout' });
      }
    }, 500);
    return () => clearInterval(interval);
  }, [panelState.type]);

  // ── Core: send request and handle result ────────────────

  const startGeneration = useCallback(async () => {
    // Clear session cache so fresh results replace old ones
    sessionCandidates.delete(entryId);
    setPanelState({ type: 'loading' });
    loadingStartedAt.current = Date.now();
    try {
      const result = await fetchCandidates(entryId);
      if (panelPhase.current !== 'loading') return;
      if (!result.ok) {
        setPanelState({ type: 'error', message: result.error?.message ?? '生成失败。' });
        return;
      }
      const candidates = result.data;
      if (!candidates || candidates.length === 0) {
        setPanelState({ type: 'error', message: '未能生成标签，请重试。' });
        return;
      }
      sessionCandidates.set(entryId, candidates);
      setPanelState({
        type: 'candidates',
        candidates,
        selected: new Set(candidates.map((c) => c.name)),
      });
    } catch {
      if (panelPhase.current !== 'loading') return;
      setPanelState({ type: 'error', message: '标签生成请求失败。' });
    }
  }, [entryId]);

  const generate = useCallback(() => {
    void startGeneration();
  }, [startGeneration]);

  const regenerate = useCallback(async () => {
    // Clear DB flag so a fresh generation is treated as new
    try {
      await window.shaleAPI.tag.autoTagClearStatus(entryId);
    } catch {
      // Best-effort; generation will still proceed
    }
    sessionCandidates.delete(entryId);
    void startGeneration();
  }, [entryId, startGeneration]);

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
      // DB flag is already set by AutoTagService.confirmTags()
      sessionCandidates.delete(entryId);
      setPanelState({ type: 'done' });
      onTagsChanged?.();
    } catch {
      setIsConfirming(false);
      setPanelState({ type: 'error', message: '标签确认失败。' });
    }
  }, [entryId, panelState, onTagsChanged]);

  const cancel = useCallback(() => {
    // Keep candidates in session cache in case the user re-opens
    setPanelState({ type: 'idle' });
  }, []);

  // ── Render ──────────────────────────────────────────────

  // Initial check
  if (panelState.type === 'checking') {
    return (
      <div className="auto-tag-panel">
        <p className="tag-floating-suggestion-label">AI标签</p>
        <div className="tag-floating-loading">检查中…</div>
      </div>
    );
  }

  // Done: show "AI标签已生成" with regenerate button
  if (panelState.type === 'done') {
    return (
      <div className="auto-tag-panel">
        <p className="tag-floating-suggestion-label">AI标签</p>
        <p className="auto-tag-done">AI标签已生成</p>
        <button
          type="button"
          className="auto-tag-trigger-pill"
          onClick={regenerate}
        >
          ✨ 重新生成
        </button>
      </div>
    );
  }

  // Idle: show generate button
  if (panelState.type === 'idle') {
    return (
      <div className="auto-tag-panel">
        <p className="tag-floating-suggestion-label">AI标签</p>
        <button
          type="button"
          className="auto-tag-trigger-pill"
          onClick={generate}
        >
          ✨ 生成标签
        </button>
      </div>
    );
  }

  // Loading: show spinner + countdown
  if (panelState.type === 'loading') {
    return (
      <div className="auto-tag-panel">
        <p className="tag-floating-suggestion-label">AI标签</p>
        <div className="tag-floating-loading">
          <span className="auto-tag-spinner" aria-hidden="true" />
          {' '}正在生成…{' '}
          <span className="auto-tag-countdown">{remainingSeconds}s</span>
        </div>
      </div>
    );
  }

  // Timeout: show retry button
  if (panelState.type === 'timeout') {
    return (
      <div className="auto-tag-panel">
        <p className="tag-floating-suggestion-label">AI标签</p>
        <p className="auto-tag-error" role="alert">请求超时。</p>
        <button
          type="button"
          className="auto-tag-trigger-pill"
          onClick={generate}
        >
          ✨ 超时重试
        </button>
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
          onClick={generate}
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
