import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ProviderProfile } from '../../../shared/contracts/provider.types';
import type {
  SummaryDetailLevel,
  SummaryState,
  SummaryStreamEvent,
  SummaryTargetLanguage,
} from '../../../shared/contracts/summary.types';

interface SummaryPanelProps {
  entryId: number;
  isContentReady: boolean;
  isVisible: boolean;
  targetLanguage: SummaryTargetLanguage;
  detailLevel: SummaryDetailLevel;
  onGeneratingChange: (isGenerating: boolean) => void;
  onVisibleChange: (isVisible: boolean) => void;
}

export interface SummaryPanelHandle {
  activate: () => void;
}

export const SummaryPanel = forwardRef<SummaryPanelHandle, SummaryPanelProps>(({
  entryId,
  isContentReady,
  isVisible,
  targetLanguage,
  detailLevel,
  onGeneratingChange,
  onVisibleChange,
}, ref) => {
  const [summaryState, setSummaryState] = useState<SummaryState>({ state: 'idle' });
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [streamedText, setStreamedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const activeRunIdRef = useRef<number | null>(null);

  const loadState = useCallback(async () => {
    setMessage('');
    try {
      const profileResult = await window.shaleAPI.provider.get();
      if (profileResult.ok) setProfile(profileResult.data);

      if (!isContentReady) {
        setSummaryState({ state: 'idle' });
        return;
      }

      const summaryResult = await window.shaleAPI.summary.get({
        entryId,
        targetLanguage,
        detailLevel,
      });
      if (summaryResult.ok) {
        setSummaryState(summaryResult.data);
        if (summaryResult.data.state === 'running') {
          activeRunIdRef.current = summaryResult.data.run.id;
          setIsGenerating(true);
        } else {
          setIsGenerating(false);
        }
      } else {
        setMessage(summaryResult.error.message);
      }
    } catch {
      setMessage('Unable to load the Summary state.');
    }
  }, [detailLevel, entryId, isContentReady, targetLanguage]);

  useEffect(() => {
    activeRunIdRef.current = null;
    setStreamedText('');
    setIsGenerating(false);
    void loadState();
  }, [loadState]);

  useEffect(() => {
    const unsubscribe = window.shaleAPI.summary.onEvent((event: SummaryStreamEvent) => {
      if (
        event.entryId !== entryId
        || event.targetLanguage !== targetLanguage
        || event.detailLevel !== detailLevel
        || event.runId !== activeRunIdRef.current
      ) {
        return;
      }
      if (event.type === 'delta') {
        setStreamedText((current) => current + event.text);
        return;
      }
      if (event.type === 'completed') {
        setSummaryState({ state: 'succeeded', result: event.result, freshness: 'fresh' });
        setStreamedText('');
        setIsGenerating(false);
        activeRunIdRef.current = null;
        return;
      }
      if (event.type === 'failed') {
        setMessage(event.error.message);
        setIsGenerating(false);
        activeRunIdRef.current = null;
        void loadState();
      }
    });
    return unsubscribe;
  }, [detailLevel, entryId, loadState, targetLanguage]);

  const generate = useCallback(async (): Promise<void> => {
    if (!profile || !profile.hasApiKey) {
      onVisibleChange(true);
      setMessage('Configure an AI provider in Settings before generating a Summary.');
      return;
    }
    onVisibleChange(true);
    setMessage('');
    setStreamedText('');
    setIsGenerating(true);
    try {
      const result = await window.shaleAPI.summary.generate({
        entryId,
        targetLanguage,
        detailLevel,
      });
      if (!result.ok) {
        setIsGenerating(false);
        setMessage(result.error.message);
        return;
      }
      activeRunIdRef.current = result.data.runId;
      if (result.data.reused) {
        await loadState();
      }
    } catch {
      setIsGenerating(false);
      setMessage('Unable to start Summary generation.');
    }
  }, [
    detailLevel,
    entryId,
    loadState,
    onVisibleChange,
    profile,
    targetLanguage,
  ]);

  const hasFreshSummary = summaryState.state === 'succeeded'
    && summaryState.freshness === 'fresh';

  const activate = useCallback((): void => {
    if (hasFreshSummary) {
      onVisibleChange(!isVisible);
      return;
    }
    void generate();
  }, [generate, hasFreshSummary, isVisible, onVisibleChange]);

  useImperativeHandle(ref, () => ({ activate }), [activate]);

  useEffect(() => {
    onGeneratingChange(isGenerating);
  }, [isGenerating, onGeneratingChange]);

  const summaryText = isGenerating
    ? streamedText
    : summaryState.state === 'succeeded'
      ? summaryState.result.content
      : '';

  return (
    <>
      {isVisible && (
        isGenerating
        || summaryText
        || message
        || summaryState.state === 'failed'
      ) && (
        <section id="summary-result" className="summary-result" aria-label="Summary" aria-live="polite">
          <h2 className="summary-result-title">AI SUMMARY</h2>
          {summaryState.state === 'failed' && (
            <p className="entry-detail-ai-error">
              {summaryState.run.error?.message ?? 'Summary generation failed.'}
            </p>
          )}
          {message && <p className="entry-detail-ai-error" role="status">{message}</p>}
          {summaryText && <div className="summary-result-content">{summaryText}</div>}
          {isGenerating && (
            <div
              className="summary-loading-dots"
              role="status"
              aria-label="正在生成摘要"
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </div>
          )}
        </section>
      )}

    </>
  );
});

SummaryPanel.displayName = 'SummaryPanel';
