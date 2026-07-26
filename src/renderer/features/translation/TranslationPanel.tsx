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
const NOOP_RETRANSLATION_STATUS_CHANGE = (): void => undefined;
const NOOP_TRANSLATION_CONTROL_STATE_CHANGE = (): void => undefined;
const ALLOW_TRANSLATION_START = (): boolean => true;

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
  beforeTranslationStart?: () => boolean | Promise<boolean>;
  onTranslationControlStateChange?: (state: TranslationControlState | null) => void;
  onRetranslationStatusChange?: (status: RetranslationStatus | null) => void;
}

export interface TranslationPanelHandle {
  activate: () => void;
  requestRetranslation: () => Promise<RetranslationRequestResult>;
}

/** The exact current Translation state for the Reader's primary button. */
export interface TranslationControlState {
  entryId: number;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  useTerminology: boolean;
  useSmartContext: boolean;
  expertId: string;
  state: TranslationState['state'];
  runId?: number;
  hasCompleteTranslation: boolean;
}

export type RetranslationRequestResult =
  | 'started'
  | 'content-unavailable'
  | 'no-translation'
  | 'active'
  | 'failed';

/**
 * Renderer-only presentation state for a replacement run. Its scope fields
 * keep the toolbar feedback tied to the same get/generate request identity.
 */
export interface RetranslationStatus {
  entryId: number;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: TranslationTargetLanguage;
  useTerminology: boolean;
  useSmartContext: boolean;
  expertId: string;
  runId: number;
  state: 'running' | 'paused' | 'completed' | 'failed';
}

type RetranslationTerminalStatus = Pick<RetranslationStatus, 'runId' | 'state'>;
type TranslationStateUpdate = TranslationState | ((current: TranslationState) => TranslationState);

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
  beforeTranslationStart = ALLOW_TRANSLATION_START,
  onTranslationControlStateChange = NOOP_TRANSLATION_CONTROL_STATE_CHANGE,
  onRetranslationStatusChange = NOOP_RETRANSLATION_STATUS_CHANGE,
}, ref) => {
  const [translationState, setTranslationState] = useState<TranslationState>({ state: 'idle' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [showPauseNotice, setShowPauseNotice] = useState(false);
  const [retranslationTerminalStatus, setRetranslationTerminalStatus] =
    useState<RetranslationTerminalStatus | null>(null);
  const activeRunIdRef = useRef<number | null>(null);
  const startInFlightRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const translationStateRef = useRef<TranslationState>(translationState);
  const failureTitleId = useId();
  const failureDescriptionId = useId();

  const updateTranslationState = useCallback((update: TranslationStateUpdate): void => {
    setTranslationState((current) => {
      const next = typeof update === 'function' ? update(current) : update;
      translationStateRef.current = next;
      return next;
    });
  }, []);

  const loadState = useCallback(async (options?: { preserveFeedback?: boolean }) => {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    if (!options?.preserveFeedback) setMessage('');
    if (!isContentReady) {
      updateTranslationState({ state: 'idle' });
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
      updateTranslationState(result.data);
      if (result.data.state === 'running') {
        activeRunIdRef.current = result.data.result.id;
        setIsGenerating(true);
      } else {
        activeRunIdRef.current = null;
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
    updateTranslationState,
  ]);

  useEffect(() => {
    activeRunIdRef.current = null;
    setShowFeedback(false);
    setShowPauseNotice(false);
    setRetranslationTerminalStatus(null);
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
        updateTranslationState((current) => mergeUpdatedSegment(current, event.segment));
        onBilingualChange(true);
        return;
      }
      if (event.type === 'completed') {
        if (isRetranslationRun(translationStateRef.current, event.runId)) {
          setRetranslationTerminalStatus({ state: 'completed', runId: event.runId });
        }
        updateTranslationState({ state: 'succeeded', result: event.result });
        setIsGenerating(false);
        onBilingualChange(true);
        activeRunIdRef.current = null;
        return;
      }
      if (event.type === 'paused') {
        const retranslationPaused = isRetranslationRun(translationStateRef.current, event.runId);
        updateTranslationState((current) => ({
          state: 'paused',
          result: event.result,
          ...(getActiveResult(current) ? { activeResult: getActiveResult(current) } : {}),
        }));
        setIsGenerating(false);
        setShowPauseNotice(!retranslationPaused);
        onBilingualChange(true);
        activeRunIdRef.current = null;
        return;
      }
      if (event.type === 'failed') {
        const retranslationFailed = isRetranslationRun(translationStateRef.current, event.runId);
        updateTranslationState((current) => {
          const currentResult = getResult(current);
          if (!currentResult) return current;
          return {
            state: 'failed',
            result: {
              ...currentResult,
              status: 'failed',
              error: event.error,
            },
            ...(getActiveResult(current) ? { activeResult: getActiveResult(current) } : {}),
          };
        });
        setShowFeedback(true);
        setMessage(retranslationFailed
          ? `重新翻译失败 · 已保留上一版译文：${event.error.message}`
          : event.error.message);
        if (retranslationFailed) {
          setRetranslationTerminalStatus({ state: 'failed', runId: event.runId });
        }
        setIsGenerating(false);
        activeRunIdRef.current = null;
        void loadState({ preserveFeedback: retranslationFailed });
      }
    });
    return unsubscribe;
  }, [entryId, loadState, onBilingualChange, sourceLanguage, targetLanguage, updateTranslationState]);

  const generate = useCallback(async (forceNew = false): Promise<boolean> => {
    if (!isContentReady || startInFlightRef.current) return false;
    startInFlightRef.current = true;
    setShowFeedback(false);
    setShowPauseNotice(false);
    setMessage('');
    setRetranslationTerminalStatus(null);
    try {
      const allowedToStart = await beforeTranslationStart();
      if (!allowedToStart) return false;
      if (!getDisplayedResult(translationStateRef.current)) onBilingualChange(false);
      const result = await window.shaleAPI.translation.generate({
        entryId,
        sourceLanguage,
        targetLanguage,
        useTerminology,
        useSmartContext,
        expertId,
        ...(forceNew ? { forceNew: true } : {}),
      });
      if (!result.ok) {
        setMessage(result.error.message);
        setShowFeedback(true);
        return false;
      }
      loadSequenceRef.current += 1;
      activeRunIdRef.current = result.data.runId;
      updateTranslationState(toTranslationState(result.data.result, result.data.activeResult));
      setIsGenerating(result.data.result.status === 'running');
      setShowFeedback(result.data.result.status === 'failed');
      onBilingualChange(true);
      return result.data.result.status === 'running';
    } catch {
      setMessage('Unable to start Translation generation.');
      setShowFeedback(true);
      return false;
    } finally {
      startInFlightRef.current = false;
    }
  }, [
    beforeTranslationStart,
    entryId,
    expertId,
    isContentReady,
    onBilingualChange,
    sourceLanguage,
    targetLanguage,
    useSmartContext,
    useTerminology,
    updateTranslationState,
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
      const pausedResult = response.data.result;
      const retranslationPaused = isRetranslationRun(translationStateRef.current, runId);
      activeRunIdRef.current = null;
      updateTranslationState((current) => ({
        state: 'paused',
        result: pausedResult,
        ...(getActiveResult(current) ? { activeResult: getActiveResult(current) } : {}),
      }));
      setIsGenerating(false);
      setShowPauseNotice(!retranslationPaused);
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
    updateTranslationState,
  ]);

  const dismissFeedback = useCallback(() => {
    setShowFeedback(false);
    setMessage('');
    setRetranslationTerminalStatus((current) => current?.state === 'failed' ? null : current);
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

  useEffect(() => {
    if (retranslationTerminalStatus?.state !== 'completed') return;
    const dismissTimer = window.setTimeout(() => {
      setRetranslationTerminalStatus((current) =>
        current?.state === 'completed' ? null : current);
    }, 3_000);
    return () => window.clearTimeout(dismissTimer);
  }, [retranslationTerminalStatus]);

  const activate = useCallback((): void => {
    const currentState = translationStateRef.current;
    if (currentState.state === 'running') {
      void pause();
      return;
    }
    if (currentState.state !== 'paused' && hasCompleteTranslation(currentState)) {
      onBilingualChange(!isBilingualVisible);
      return;
    }
    void generate();
  }, [generate, isBilingualVisible, onBilingualChange, pause]);

  const requestRetranslation = useCallback(async (): Promise<RetranslationRequestResult> => {
    if (!isContentReady) return 'content-unavailable';
    if (startInFlightRef.current) return 'active';
    try {
      const stateResult = await window.shaleAPI.translation.get({
        entryId,
        sourceLanguage,
        targetLanguage,
        useTerminology,
        useSmartContext,
        expertId,
      });
      if (!stateResult.ok) {
        setMessage(stateResult.error.message);
        setShowFeedback(true);
        return 'failed';
      }
      const currentState = stateResult.data;
      updateTranslationState(currentState);
      if (currentState.state === 'running') {
        activeRunIdRef.current = currentState.result.id;
        setIsGenerating(true);
        return 'active';
      }
      if (currentState.state === 'paused') {
        activeRunIdRef.current = null;
        setIsGenerating(false);
        return 'active';
      }
      if (!hasCompleteTranslation(currentState)) return 'no-translation';
      return await generate(true) ? 'started' : 'failed';
    } catch {
      setMessage('Unable to load the Translation state.');
      setShowFeedback(true);
      return 'failed';
    }
  }, [
    entryId,
    expertId,
    generate,
    isContentReady,
    sourceLanguage,
    targetLanguage,
    updateTranslationState,
    useSmartContext,
    useTerminology,
  ]);

  useImperativeHandle(ref, () => ({ activate, requestRetranslation }), [
    activate,
    requestRetranslation,
  ]);

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

  const retranslationStatus = getRetranslationStatus(
    translationState,
    retranslationTerminalStatus,
    {
      entryId,
      sourceLanguage,
      targetLanguage,
      useTerminology,
      useSmartContext,
      expertId,
    },
  );

  useEffect(() => {
    onRetranslationStatusChange(retranslationStatus);
  }, [
    entryId,
    expertId,
    onRetranslationStatusChange,
    retranslationStatus?.runId,
    retranslationStatus?.state,
    sourceLanguage,
    targetLanguage,
    useSmartContext,
    useTerminology,
  ]);

  useEffect(() => () => onRetranslationStatusChange(null), [onRetranslationStatusChange]);

  const translationControlState: TranslationControlState = {
    entryId,
    sourceLanguage,
    targetLanguage,
    useTerminology,
    useSmartContext,
    expertId,
    state: translationState.state,
    ...(getResult(translationState) ? { runId: getResult(translationState)?.id } : {}),
    hasCompleteTranslation: hasCompleteTranslation(translationState),
  };

  useEffect(() => {
    onTranslationControlStateChange(translationControlState);
  }, [
    entryId,
    expertId,
    onTranslationControlStateChange,
    sourceLanguage,
    targetLanguage,
    translationControlState.hasCompleteTranslation,
    translationControlState.runId,
    translationControlState.state,
    useSmartContext,
    useTerminology,
  ]);

  useEffect(
    () => () => onTranslationControlStateChange(null),
    [onTranslationControlStateChange],
  );

  const result = getDisplayedResult(translationState);
  const pendingSegmentIds = getPendingSegmentIds(translationState);
  const readerMode: TranslationReaderMode = getRestoredTranslationReaderMode(
    translationState,
    isBilingualVisible,
  );
  const hasTranslation = Boolean(result);
  const retranslationFailed = retranslationTerminalStatus?.state === 'failed';
  const failureFeedback = showFeedback
    ? retranslationFailed
      ? message || '重新翻译失败 · 已保留上一版译文'
      : translationState.state === 'failed'
        ? getTranslationFailureMessage(getResult(translationState))
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
          heading={retranslationFailed
            ? '重新翻译失败'
            : translationState.state === 'failed'
              ? 'Translation paused'
              : 'Translation unavailable'}
          message={failureFeedback}
          canRetry={!retranslationFailed
            && translationState.state === 'failed'
            && getResult(translationState)?.error?.retryable === true}
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

      {/*
       * Keep the original Reader branch mounted while the translated body is shown.
       * It owns the portals for common Reader actions, including annotation, which
       * must continue to target the single shared toolbar.
       */}
      <div hidden={readerMode === 'bilingual' && hasTranslation}>
        {children}
      </div>
      {readerMode === 'bilingual' && hasTranslation && result && (
        <BilingualProjection
          result={result}
          sourceHtml={sourceHtml}
          pendingSegmentIds={pendingSegmentIds}
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
  pendingSegmentIds,
  onVisibleSegmentIds,
  onContentClick,
}: {
  result: TranslationResult;
  sourceHtml: string;
  pendingSegmentIds: ReadonlySet<string>;
  onVisibleSegmentIds: (sourceSegmentIds: string[]) => void;
  onContentClick: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const bodyRoot = document.createElement('div');
  bodyRoot.innerHTML = sourceHtml;
  projectBilingualBody(bodyRoot, result.segments, {
    showPendingIndicators: result.status === 'running',
    pendingSegmentIds,
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

export function mergeUpdatedSegment(
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
    ...(getActiveResult(state) ? { activeResult: getActiveResult(state) } : {}),
  };
}

function toTranslationState(
  result: TranslationResult,
  activeResult?: TranslationResult,
): TranslationState {
  const active = activeResult ? { activeResult } : {};
  if (result.status === 'succeeded') return { state: 'succeeded', result, ...active };
  if (result.status === 'failed') return { state: 'failed', result, ...active };
  return { state: 'running', result, ...active };
}

function getResult(state: TranslationState): TranslationResult | undefined {
  return state.state === 'running' || state.state === 'failed' || state.state === 'succeeded'
    || state.state === 'paused'
    ? state.result
    : undefined;
}

function getActiveResult(state: TranslationState): TranslationResult | undefined {
  return state.state === 'running' || state.state === 'failed' || state.state === 'succeeded'
    || state.state === 'paused'
    ? state.activeResult
    : undefined;
}

function getPendingSegmentIds(state: TranslationState): ReadonlySet<string> {
  const candidate = getResult(state);
  if (candidate?.status !== 'running') return new Set();
  return new Set(candidate.segments
    .filter((segment) => segment.status === 'pending')
    .map((segment) => segment.sourceSegmentId));
}

export function getDisplayedResult(state: TranslationState): TranslationResult | undefined {
  const candidate = getResult(state);
  const activeResult = getActiveResult(state);
  if (!candidate || !activeResult || candidate.id === activeResult.id) {
    return activeResult ?? candidate;
  }

  const replacementSegments = new Map(
    candidate.segments.map((segment) => [segment.sourceSegmentId, segment]),
  );
  return {
    ...activeResult,
    // The candidate is persisted before its event is emitted. Project every
    // successful candidate segment over the active result, while failed and
    // pending candidate segments keep their last known completed translation.
    status: candidate.status,
    error: candidate.error,
    updatedAt: candidate.updatedAt,
    segments: activeResult.segments.map((activeSegment) => {
      const replacement = replacementSegments.get(activeSegment.sourceSegmentId);
      return replacement?.status === 'succeeded' ? replacement : activeSegment;
    }),
  };
}

export function hasCompleteTranslation(state: TranslationState): boolean {
  return [getResult(state), getActiveResult(state)].some((result) =>
    result?.status === 'succeeded'
    && result.segments.length > 0
    && result.segments.every((segment) => segment.status === 'succeeded'),
  );
}

function isRetranslationRun(state: TranslationState, runId?: number): boolean {
  const candidate = getResult(state);
  const activeResult = getActiveResult(state);
  return candidate !== undefined
    && activeResult !== undefined
    && candidate.id !== activeResult.id
    && (runId === undefined || candidate.id === runId);
}

function getRetranslationStatus(
  state: TranslationState,
  terminalStatus: RetranslationTerminalStatus | null,
  scope: Omit<RetranslationStatus, 'runId' | 'state'>,
): RetranslationStatus | null {
  if (terminalStatus) return { ...scope, ...terminalStatus };
  const candidate = getResult(state);
  if (!candidate || !isRetranslationRun(state)) return null;
  if (state.state !== 'running' && state.state !== 'paused') return null;
  return { ...scope, runId: candidate.id, state: state.state };
}

function getTranslationFailureMessage(result: TranslationResult | undefined): string {
  const failureMessage = result?.error?.message ?? 'Translation generation failed.';
  const incompleteSegmentCount = result?.segments.filter((segment) =>
    segment.status !== 'succeeded').length ?? 0;
  if (!incompleteSegmentCount) return failureMessage;
  const segmentLabel = incompleteSegmentCount === 1 ? 'segment remains' : 'segments remain';
  return `${failureMessage} ${incompleteSegmentCount} ${segmentLabel} untranslated.`;
}
