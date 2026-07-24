import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
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
  onGeneratingChange,
  onBilingualChange,
  onTitleTranslatingChange,
}, ref) => {
  const [translationState, setTranslationState] = useState<TranslationState>({ state: 'idle' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const activeRunIdRef = useRef<number | null>(null);
  const loadSequenceRef = useRef(0);

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
      if (event.type === 'segment-completed') {
        setTranslationState((current) => mergeCompletedSegment(current, event.segment));
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
      if (event.type === 'failed') {
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
    setShowFeedback(true);
    setMessage('');
    onBilingualChange(false);
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
        return;
      }
      activeRunIdRef.current = result.data.runId;
      setTranslationState(toTranslationState(result.data.result));
      setIsGenerating(result.data.result.status === 'running');
      onBilingualChange(true);
    } catch {
      setMessage('Unable to start Translation generation.');
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

  const activate = useCallback((): void => {
    if (translationState.state === 'succeeded') {
      onBilingualChange(!isBilingualVisible);
      return;
    }
    if (translationState.state === 'running') {
      onBilingualChange(true);
      return;
    }
    void generate();
  }, [generate, isBilingualVisible, onBilingualChange, translationState.state]);

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
      {showFeedback && translationState.state === 'failed' && (
        <p className="entry-detail-ai-error" role="status">
          {result?.error?.message ?? 'Translation generation failed.'}
        </p>
      )}
      {showFeedback && message && (
        <p className="entry-detail-ai-error" role="status">{message}</p>
      )}
      {result?.contextWarning && (
        <p className="entry-detail-ai-warning" role="status">
          {result.contextWarning.message}
        </p>
      )}

      {readerMode === 'bilingual' && hasTranslation && result
        ? <BilingualProjection
            result={result}
            sourceHtml={sourceHtml}
            onVisibleSegmentIds={prioritizeVisibleSegments}
          />
        : children}
    </>
  );
});

TranslationPanel.displayName = 'TranslationPanel';

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
}: {
  result: TranslationResult;
  sourceHtml: string;
  onVisibleSegmentIds: (sourceSegmentIds: string[]) => void;
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

function mergeCompletedSegment(
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
    ? state.result
    : undefined;
}
