import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderProfile } from '../../../shared/contracts/provider.types';
import type {
  SummaryDetailLevel,
  SummaryState,
  SummaryStreamEvent,
  SummaryTargetLanguage,
} from '../../../shared/contracts/summary.types';
import { ProviderSettings } from './ProviderSettings';

interface SummaryPanelProps {
  entryId: number;
  isContentReady: boolean;
}

const DEFAULT_LANGUAGE: SummaryTargetLanguage = 'zh-CN';
const DEFAULT_DETAIL_LEVEL: SummaryDetailLevel = 'medium';

export const SummaryPanel = ({ entryId, isContentReady }: SummaryPanelProps) => {
  const [targetLanguage, setTargetLanguage] = useState<SummaryTargetLanguage>(DEFAULT_LANGUAGE);
  const [detailLevel, setDetailLevel] = useState<SummaryDetailLevel>(DEFAULT_DETAIL_LEVEL);
  const [summaryState, setSummaryState] = useState<SummaryState>({ state: 'idle' });
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [streamedText, setStreamedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
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

  const generate = async () => {
    if (!profile || !profile.hasApiKey) {
      setShowSettings(true);
      return;
    }
    setMessage('');
    setStreamedText('');
    try {
      const result = await window.shaleAPI.summary.generate({
        entryId,
        targetLanguage,
        detailLevel,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      activeRunIdRef.current = result.data.runId;
      if (result.data.reused) {
        await loadState();
      } else {
        setIsGenerating(true);
      }
    } catch {
      setMessage('Unable to start Summary generation.');
    }
  };

  const hasFreshSummary = summaryState.state === 'succeeded' && summaryState.freshness === 'fresh';
  const summaryText = isGenerating
    ? streamedText
    : summaryState.state === 'succeeded'
      ? summaryState.result.content
      : '';

  return (
    <>
      <section className="summary-panel" aria-labelledby="summary-title">
        <div className="summary-panel-header">
          <div>
            <p className="summary-panel-eyebrow">AI reading aid</p>
            <h3 id="summary-title">Summary</h3>
          </div>
          <button type="button" className="summary-settings-button" onClick={() => setShowSettings(true)}>
            Provider settings
          </button>
        </div>

        {!isContentReady ? (
          <p className="summary-panel-muted">A Summary becomes available after the article content is ready.</p>
        ) : (
          <>
            <div className="summary-controls">
              <label>
                Language
                <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value as SummaryTargetLanguage)} disabled={isGenerating}>
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label>
                Detail
                <select value={detailLevel} onChange={(event) => setDetailLevel(event.target.value as SummaryDetailLevel)} disabled={isGenerating}>
                  <option value="short">Brief</option>
                  <option value="medium">Medium</option>
                  <option value="detailed">Detailed</option>
                </select>
              </label>
              <button type="button" className="summary-generate-button" onClick={() => void generate()} disabled={isGenerating || hasFreshSummary}>
                {isGenerating ? 'Generating…' : hasFreshSummary ? 'Saved' : summaryState.state === 'succeeded' ? 'Regenerate' : 'Generate summary'}
              </button>
            </div>

            {summaryState.state === 'failed' && (
              <p className="summary-panel-error">{summaryState.run.error?.message ?? 'Summary generation failed.'}</p>
            )}
            {summaryState.state === 'succeeded' && summaryState.freshness === 'stale' && (
              <p className="summary-panel-stale">The article changed after this Summary was generated. Regenerate to update it.</p>
            )}
            {message && <p className="summary-panel-error" role="status">{message}</p>}
            {isGenerating && !streamedText && <p className="summary-panel-muted">Waiting for the provider…</p>}
            {summaryText && <div className="summary-panel-content">{summaryText}</div>}
          </>
        )}
      </section>

      {showSettings && (
        <ProviderSettings
          profile={profile}
          onClose={() => setShowSettings(false)}
          onSaved={(savedProfile) => {
            setProfile(savedProfile);
          }}
        />
      )}
    </>
  );
};
