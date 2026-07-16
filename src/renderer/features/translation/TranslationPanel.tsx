import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  TranslationResult,
  TranslationState,
  TranslationStreamEvent,
  TranslationTargetLanguage,
} from '../../../shared/contracts/translation.types';

interface TranslationPanelProps {
  entryId: number;
  isContentReady: boolean;
  children: ReactNode;
}

type ReaderMode = 'original' | 'bilingual';

const DEFAULT_LANGUAGE: TranslationTargetLanguage = 'zh-CN';

export const TranslationPanel = ({
  entryId,
  isContentReady,
  children,
}: TranslationPanelProps) => {
  const [targetLanguage, setTargetLanguage] = useState<TranslationTargetLanguage>(DEFAULT_LANGUAGE);
  const [translationState, setTranslationState] = useState<TranslationState>({ state: 'idle' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingSegmentText, setStreamingSegmentText] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [readerMode, setReaderMode] = useState<ReaderMode>('original');
  const activeRunIdRef = useRef<number | null>(null);

  const loadState = useCallback(async () => {
    setMessage('');
    if (!isContentReady) {
      setTranslationState({ state: 'idle' });
      setIsGenerating(false);
      return;
    }
    try {
      const result = await window.shaleAPI.translation.get({ entryId, targetLanguage });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setTranslationState(result.data);
      if (result.data.state === 'running') {
        activeRunIdRef.current = result.data.result.id;
        setIsGenerating(true);
      } else {
        setIsGenerating(false);
      }
    } catch {
      setMessage('Unable to load the Translation state.');
    }
  }, [entryId, isContentReady, targetLanguage]);

  useEffect(() => {
    activeRunIdRef.current = null;
    setStreamingSegmentText({});
    setReaderMode('original');
    void loadState();
  }, [loadState]);

  useEffect(() => {
    const unsubscribe = window.shaleAPI.translation.onEvent((event: TranslationStreamEvent) => {
      if (
        event.entryId !== entryId
        || event.targetLanguage !== targetLanguage
        || event.runId !== activeRunIdRef.current
      ) {
        return;
      }
      if (event.type === 'segment-delta') {
        setStreamingSegmentText((current) => ({
          ...current,
          [event.sourceSegmentId]: `${current[event.sourceSegmentId] ?? ''}${event.text}`,
        }));
        return;
      }
      if (event.type === 'completed') {
        setTranslationState({ state: 'succeeded', result: event.result });
        setStreamingSegmentText({});
        setIsGenerating(false);
        setReaderMode('bilingual');
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
  }, [entryId, loadState, targetLanguage]);

  const generate = async (): Promise<void> => {
    setMessage('');
    setStreamingSegmentText({});
    setReaderMode('original');
    try {
      const result = await window.shaleAPI.translation.generate({ entryId, targetLanguage });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      activeRunIdRef.current = result.data.runId;
      if (result.data.reused) {
        await loadState();
        setReaderMode('bilingual');
      } else {
        setIsGenerating(true);
      }
    } catch {
      setMessage('Unable to start Translation generation.');
    }
  };

  const result = getResult(translationState);
  const hasTranslation = translationState.state === 'succeeded';

  return (
    <>
      <section className="translation-panel" aria-labelledby="translation-title">
        <div className="translation-panel-header">
          <div>
            <p className="translation-panel-eyebrow">AI reading aid</p>
            <h3 id="translation-title">Translation</h3>
          </div>
          {hasTranslation && (
            <div className="translation-mode-controls" aria-label="Translation reader mode">
              <button
                type="button"
                className={readerMode === 'original' ? 'is-selected' : ''}
                onClick={() => setReaderMode('original')}
              >
                Original
              </button>
              <button
                type="button"
                className={readerMode === 'bilingual' ? 'is-selected' : ''}
                onClick={() => setReaderMode('bilingual')}
              >
                Bilingual
              </button>
            </div>
          )}
        </div>

        {!isContentReady ? (
          <p className="translation-panel-muted">A Translation becomes available after the article content is ready.</p>
        ) : (
          <>
            <div className="translation-controls">
              <label>
                Language
                <select
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value as TranslationTargetLanguage)}
                  disabled={isGenerating}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              <button
                type="button"
                className="translation-generate-button"
                onClick={() => void generate()}
                disabled={isGenerating || hasTranslation}
              >
                {isGenerating ? 'Translating…' : hasTranslation ? 'Saved' : 'Translate article'}
              </button>
            </div>

            {translationState.state === 'stale' && (
              <p className="translation-panel-stale">The article changed after this Translation was generated. Generate it again to update the bilingual view.</p>
            )}
            {translationState.state === 'failed' && (
              <p className="translation-panel-error">{result?.error?.message ?? 'Translation generation failed.'}</p>
            )}
            {message && <p className="translation-panel-error" role="status">{message}</p>}
            {isGenerating && (
              <p className="translation-panel-muted">
                {Object.keys(streamingSegmentText).length
                  ? 'Translating the current paragraph…'
                  : 'Waiting for the provider…'}
              </p>
            )}
          </>
        )}
      </section>

      {readerMode === 'bilingual' && hasTranslation && result
        ? <BilingualProjection result={result} />
        : children}
    </>
  );
};

function BilingualProjection({ result }: { result: TranslationResult }) {
  return (
    <article className="translation-bilingual-content" aria-label="Bilingual translation">
      {result.segments.map((segment) => (
        <section className="translation-bilingual-segment" key={segment.sourceSegmentId}>
          <p className="translation-bilingual-label">Original</p>
          <p className="translation-bilingual-source">{segment.sourceText}</p>
          <p className="translation-bilingual-label">Translation</p>
          <p className="translation-bilingual-target">{segment.translatedText ?? 'Translation unavailable for this paragraph.'}</p>
        </section>
      ))}
    </article>
  );
}

function getResult(state: TranslationState): TranslationResult | undefined {
  return state.state === 'running' || state.state === 'failed' || state.state === 'succeeded'
    ? state.result
    : undefined;
}
