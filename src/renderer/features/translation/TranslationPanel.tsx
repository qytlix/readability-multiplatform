import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  TranslationResult,
  TranslationSegment,
  TranslationSourceLanguage,
  TranslationState,
  TranslationStreamEvent,
  TranslationTargetLanguage,
} from '../../../shared/contracts/translation.types';
import { projectBilingualBody } from './bilingualProjection';
import {
  getRestoredTranslationReaderMode,
  type TranslationReaderMode,
} from './translationReaderMode';
import {
  matchesKeyboardShortcut,
  type TranslationShortcut,
} from '../settings/keyboardShortcut';

const PAUSE_SESSION_RESTART_MESSAGE =
  'Pause controls are not active in this app session. Restart Shale and try again.';

interface TranslationPanelProps {
  entryId: number;
  isContentReady: boolean;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  useTerminology: boolean;
  useSmartContext: boolean;
  expertId: string;
  shortcut: TranslationShortcut;
  sourceHtml: string;
  titleTarget: HTMLDivElement | null;
  isBilingualVisible: boolean;
  children: ReactNode;
  onContentClick: (event: MouseEvent<HTMLDivElement>) => void;
  onGeneratingChange: (isGenerating: boolean) => void;
  onBilingualChange: (isBilingual: boolean) => void;
  onTitleTranslatingChange: (isTranslating: boolean) => void;
}

export interface TranslationPanelHandle {
  activate: () => void;
}

export const TranslationPanel = forwardRef<TranslationPanelHandle, TranslationPanelProps>(({
  entryId,
  isContentReady,
  sourceLanguage,
  targetLanguage,
  useTerminology,
  useSmartContext,
  expertId,
  shortcut,
  sourceHtml,
  titleTarget,
  isBilingualVisible,
  children,
  onContentClick,
  onGeneratingChange,
  onBilingualChange,
  onTitleTranslatingChange,
}, ref) => {
  const [translationState, setTranslationState] = useState<TranslationState>({ state: 'idle' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [showPauseNotice, setShowPauseNotice] = useState(false);
  const activeRunIdRef = useRef<number | null>(null);
  const loadSequenceRef = useRef(0);
  const failureTitleId = useId();
  const failureDescriptionId = useId();

  const loadState = useCallback(async () => {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    setMessage('');
    if (!isContentReady) {
      setTranslationState({ state: 'idle' });
      setIsGenerating(false);
      return;
    }
    try {
      const result = await window.shaleAPI.translation.get({
        entryId,
        sourceLanguage,
        targetLanguage,
        useTerminology,
        useSmartContext,
        expertId,
      });
      if (loadSequenceRef.current !== loadSequence) return;
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
      if (loadSequenceRef.current !== loadSequence) return;
      setMessage('Unable to load the Translation state.');
    }
  }, [
    entryId,
    expertId,
    isContentReady,
    sourceLanguage,
    targetLanguage,
    useSmartContext,
    useTerminology,
  ]);

  useEffect(() => {
    activeRunIdRef.current = null;
    setShowFeedback(false);
    setShowPauseNotice(false);
    void loadState();
  }, [loadState]);

  useEffect(() => {
    const unsubscribe = window.shaleAPI.translation.onEvent((event: TranslationStreamEvent) => {
      if (
        event.entryId !== entryId
        || event.sourceLanguage !== sourceLanguage
        || event.targetLanguage !== targetLanguage
        || event.runId !== activeRunIdRef.current
      ) {
        return;
      }
      if (event.type === 'segment-completed' || event.type === 'segment-failed') {
        setTranslationState((current) => mergeUpdatedSegment(current, event.segment));
        onBilingualChange(true);
        return;
      }
      if (event.type === 'completed') {
        setTranslationState({ state: 'succeeded', result: event.result });
        setIsGenerating(false);
        onBilingualChange(true);
        activeRunIdRef.current = null;
        return;
      }
      if (event.type === 'paused') {
        setTranslationState({ state: 'paused', result: event.result });
        setIsGenerating(false);
        setShowPauseNotice(true);
        onBilingualChange(true);
        activeRunIdRef.current = null;
        return;
      }
      if (event.type === 'failed') {
        setTranslationState((current) => {
          const currentResult = getResult(current);
          if (!currentResult) return current;
          return {
            state: 'failed',
            result: {
              ...currentResult,
              status: 'failed',
              error: event.error,
            },
          };
        });
        setShowFeedback(true);
        setMessage(event.error.message);
        setIsGenerating(false);
        activeRunIdRef.current = null;
        void loadState();
      }
    });
    return unsubscribe;
  }, [entryId, loadState, onBilingualChange, sourceLanguage, targetLanguage]);

  const generate = useCallback(async (): Promise<void> => {
    setShowFeedback(false);
    setShowPauseNotice(false);
    setMessage('');
    if (!getResult(translationState)) onBilingualChange(false);
    try {
      const result = await window.shaleAPI.translation.generate({
        entryId,
        sourceLanguage,
        targetLanguage,
        useTerminology,
        useSmartContext,
        expertId,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        setShowFeedback(true);
        return;
      }
      activeRunIdRef.current = result.data.runId;
      setTranslationState(toTranslationState(result.data.result));
      setIsGenerating(result.data.result.status === 'running');
      setShowFeedback(result.data.result.status === 'failed');
      onBilingualChange(true);
    } catch {
      setMessage('Unable to start Translation generation.');
      setShowFeedback(true);
    }
  }, [
    entryId,
    expertId,
    onBilingualChange,
    sourceLanguage,
    targetLanguage,
    useSmartContext,
    useTerminology,
  ]);

  const pause = useCallback(async (): Promise<void> => {
    const runId = activeRunIdRef.current;
    if (runId === null) {
      await loadState();
      return;
    }
    setShowFeedback(false);
    setMessage('');
    const pauseTranslation = window.shaleAPI.translation.pause;
    if (typeof pauseTranslation !== 'function') {
      setMessage(PAUSE_SESSION_RESTART_MESSAGE);
      setShowFeedback(true);
      return;
    }
    try {
      const response = await pauseTranslation({
        runId,
        entryId,
        sourceLanguage,
        targetLanguage,
        useTerminology,
        useSmartContext,
        expertId,
      });
      if (!response.ok) {
        setMessage(response.error.message);
        setShowFeedback(true);
        return;
      }
      if (!response.data.paused) {
        await loadState();
        return;
      }
      activeRunIdRef.current = null;
      setTranslationState({ state: 'paused', result: response.data.result });
      setIsGenerating(false);
      setShowPauseNotice(true);
      onBilingualChange(true);
    } catch {
      setMessage(PAUSE_SESSION_RESTART_MESSAGE);
      setShowFeedback(true);
    }
  }, [
    entryId,
    expertId,
    loadState,
    onBilingualChange,
    sourceLanguage,
    targetLanguage,
    translationState,
    useSmartContext,
    useTerminology,
  ]);

  const dismissFeedback = useCallback(() => {
    setShowFeedback(false);
    setMessage('');
  }, []);

  useEffect(() => {
    if (!showFeedback) return;
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      dismissFeedback();
    };
    window.addEventListener('keydown', dismissOnEscape);
    return () => window.removeEventListener('keydown', dismissOnEscape);
  }, [dismissFeedback, showFeedback]);

  useEffect(() => {
    if (!showPauseNotice) return;
    const dismissTimer = window.setTimeout(() => {
      setShowPauseNotice(false);
    }, 3_000);
    return () => window.clearTimeout(dismissTimer);
  }, [showPauseNotice]);

  const activate = useCallback((): void => {
    if (translationState.state === 'succeeded') {
      onBilingualChange(!isBilingualVisible);
      return;
    }
    if (translationState.state === 'running') {
      void pause();
      return;
    }
    void generate();
  }, [generate, isBilingualVisible, onBilingualChange, pause, translationState.state]);

  useImperativeHandle(ref, () => ({ activate }), [activate]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (
        event.repeat
        || !isContentReady
        || !matchesKeyboardShortcut(event, shortcut)
        || isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      activate();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [activate, isContentReady, shortcut]);

  useEffect(() => {
    onGeneratingChange(isGenerating);
  }, [isGenerating, onGeneratingChange]);

  const result = getResult(translationState);
  const readerMode: TranslationReaderMode = getRestoredTranslationReaderMode(
    translationState,
    isBilingualVisible,
  );
  const hasTranslation = Boolean(result);
  const failureFeedback = showFeedback
    ? translationState.state === 'failed'
      ? getTranslationFailureMessage(result)
      : message
    : '';
  const readerPageTarget = document.querySelector<HTMLElement>('.reader-page');
  const pauseNotice = showPauseNotice
    ? (
        <div
          className="reader-toast translation-pause-toast"
          role="status"
          aria-live="polite"
        >
          翻译已暂停，再次点击翻译按钮可继续。
        </div>
      )
    : null;
  const failurePopup = failureFeedback
    ? (
        <TranslationErrorPopup
          titleId={failureTitleId}
          descriptionId={failureDescriptionId}
          heading={translationState.state === 'failed'
            ? 'Translation paused'
            : 'Translation unavailable'}
          message={failureFeedback}
          canRetry={translationState.state === 'failed' && result?.error?.retryable === true}
          onDismiss={dismissFeedback}
          onRetry={() => void generate()}
        />
      )
    : null;
  const translatedTitle = getTranslatedTitleSegment(result, readerMode);
  const titleIsPending = readerMode === 'bilingual'
    && result?.status === 'running'
    && result.segments.some((segment) =>
      segment.sourceType === 'title' && segment.status === 'pending');

  useEffect(() => {
    onTitleTranslatingChange(titleIsPending);
  }, [onTitleTranslatingChange, titleIsPending]);

  useEffect(() => () => onTitleTranslatingChange(false), [onTitleTranslatingChange]);

  const prioritizeVisibleSegments = useCallback((sourceSegmentIds: string[]) => {
    const runId = activeRunIdRef.current;
    if (runId === null || sourceSegmentIds.length === 0) return;
    void window.shaleAPI.translation.prioritize({
      runId,
      entryId,
      sourceLanguage,
      targetLanguage,
      useTerminology,
      useSmartContext,
      expertId,
      sourceSegmentIds,
    }).catch(() => undefined);
  }, [
    entryId,
    expertId,
    sourceLanguage,
    targetLanguage,
    useSmartContext,
    useTerminology,
  ]);

  return (
    <>
      {titleTarget && translatedTitle && createPortal(
        <section
          className="translation-bilingual-segment translation-segment-title"
          data-segment-id={translatedTitle.sourceSegmentId}
        >
          <div
            className="translation-bilingual-target entry-detail-html"
            dangerouslySetInnerHTML={{ __html: translatedTitle.translatedHtml ?? '' }}
          />
        </section>,
        titleTarget,
      )}
      {failurePopup && readerPageTarget
        ? createPortal(failurePopup, readerPageTarget)
        : failurePopup}
      {pauseNotice && readerPageTarget
        ? createPortal(pauseNotice, readerPageTarget)
        : pauseNotice}
      {result?.contextWarning && (
        <p className="entry-detail-ai-warning" role="status">
          {result.contextWarning.message}
        </p>
      )}

      <div hidden={readerMode === 'bilingual' && hasTranslation}>
        {children}
      </div>
      {readerMode === 'bilingual' && hasTranslation && result && (
        <BilingualProjection
          result={result}
          sourceHtml={sourceHtml}
          onVisibleSegmentIds={prioritizeVisibleSegments}
          onContentClick={onContentClick}
        />
      )}
    </>
  );
});

TranslationPanel.displayName = 'TranslationPanel';

function TranslationErrorPopup({
  titleId,
  descriptionId,
  heading,
  message,
  canRetry,
  onDismiss,
  onRetry,
}: {
  titleId: string;
  descriptionId: string;
  heading: string;
  message: string;
  canRetry: boolean;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  return (
    <aside
      className="translation-error-popup"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="translation-error-popup-header">
        <span className="translation-error-popup-mark" aria-hidden="true">!</span>
        <div className="translation-error-popup-heading">
          <span>Translation interrupted</span>
          <h2 id={titleId}>{heading}</h2>
        </div>
        <button
          type="button"
          className="translation-error-popup-close"
          aria-label="Dismiss Translation error"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
      <p id={descriptionId} className="translation-error-popup-message">{message}</p>
      <div className="translation-error-popup-actions">
        <button
          type="button"
          className="translation-error-popup-dismiss"
          onClick={onDismiss}
        >
          Dismiss
        </button>
        {canRetry && (
          <button
            type="button"
            className="translation-error-popup-retry"
            onClick={onRetry}
          >
            Retry remaining
          </button>
        )}
      </div>
    </aside>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || target.matches('input, textarea, select')
  );
}

function BilingualProjection({
  result,
  sourceHtml,
  onVisibleSegmentIds,
  onContentClick,
}: {
  result: TranslationResult;
  sourceHtml: string;
  onVisibleSegmentIds: (sourceSegmentIds: string[]) => void;
  onContentClick: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const bodyRoot = document.createElement('div');
  bodyRoot.innerHTML = sourceHtml;
  projectBilingualBody(bodyRoot, result.segments, {
    showPendingIndicators: result.status === 'running',
  });
  const bodyHtml = bodyRoot.innerHTML;

  useEffect(() => {
    const article = articleRef.current;
    if (!article || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const sourceSegmentId = (entry.target as HTMLElement).dataset.segmentId;
        if (!sourceSegmentId) return;
        if (entry.isIntersecting) visible.add(sourceSegmentId);
        else visible.delete(sourceSegmentId);
      });
      const orderedVisible = result.segments
        .map((segment) => segment.sourceSegmentId)
        .filter((sourceSegmentId) => visible.has(sourceSegmentId));
      onVisibleSegmentIds(orderedVisible);
    }, { rootMargin: '100% 0px 100% 0px' });
    article.querySelectorAll<HTMLElement>('[data-segment-id]').forEach((element) => {
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, [onVisibleSegmentIds, result.id, result.segments]);

  return (
    <article
      ref={articleRef}
      className="translation-bilingual-content"
      aria-label="Bilingual translation"
      aria-busy={result.status === 'running'}
    >
      <div
        className="translation-bilingual-body entry-detail-html"
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
        onClick={onContentClick}
      />
    </article>
  );
}

export function getTranslatedTitleSegment(
  result: TranslationResult | undefined,
  readerMode: TranslationReaderMode,
): TranslationSegment | undefined {
  if (readerMode !== 'bilingual') return undefined;
  return result?.segments.find((segment) =>
    segment.sourceType === 'title'
    && segment.status === 'succeeded'
    && Boolean(segment.translatedHtml));
}

function mergeUpdatedSegment(
  state: TranslationState,
  completedSegment: TranslationResult['segments'][number],
): TranslationState {
  const result = getResult(state);
  if (!result || result.id <= 0) return state;
  return {
    state: 'running',
    result: {
      ...result,
      segments: result.segments.map((segment) =>
        segment.sourceSegmentId === completedSegment.sourceSegmentId
          ? completedSegment
          : segment),
    },
  };
}

function toTranslationState(result: TranslationResult): TranslationState {
  if (result.status === 'succeeded') return { state: 'succeeded', result };
  if (result.status === 'failed') return { state: 'failed', result };
  return { state: 'running', result };
}

function getResult(state: TranslationState): TranslationResult | undefined {
  return state.state === 'running' || state.state === 'failed' || state.state === 'succeeded'
    || state.state === 'paused'
    ? state.result
    : undefined;
}

function getTranslationFailureMessage(result: TranslationResult | undefined): string {
  const failureMessage = result?.error?.message ?? 'Translation generation failed.';
  const incompleteSegmentCount = result?.segments.filter((segment) =>
    segment.status !== 'succeeded').length ?? 0;
  if (!incompleteSegmentCount) return failureMessage;
  const segmentLabel = incompleteSegmentCount === 1 ? 'segment remains' : 'segments remain';
  return `${failureMessage} ${incompleteSegmentCount} ${segmentLabel} untranslated.`;
}
