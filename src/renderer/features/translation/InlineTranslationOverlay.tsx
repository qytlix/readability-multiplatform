import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type {
  InlineTranslationKind,
  InlineTranslationRequest,
  InlineTranslationResult,
  TranslationTargetLanguage,
} from '../../../shared/contracts/translation.types';
import {
  matchesKeyboardShortcut,
  type InlineTranslationShortcut,
} from '../settings/keyboardShortcut';

interface InlineTranslationOverlayProps {
  containerRef: RefObject<HTMLElement | null>;
  shortcut: InlineTranslationShortcut;
  targetLanguage: TranslationTargetLanguage;
}

interface TranslationTarget {
  kind: InlineTranslationKind;
  sourceText: string;
  context?: string;
  rect: DOMRect;
  element?: HTMLElement;
}

type OverlayState =
  | { state: 'closed' }
  | { state: 'loading'; target: TranslationTarget }
  | { state: 'error'; target: TranslationTarget; message: string }
  | { state: 'success'; target: TranslationTarget; result: InlineTranslationResult };

const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, pre';
const TRANSLATABLE_ROOT_SELECTOR = [
  '.entry-detail-header h2',
  '.entry-detail-html',
  '.translation-bilingual-content',
].join(', ');

export const InlineTranslationOverlay = ({
  containerRef,
  shortcut,
  targetLanguage,
}: InlineTranslationOverlayProps) => {
  const [overlay, setOverlay] = useState<OverlayState>({ state: 'closed' });
  const [copied, setCopied] = useState(false);
  const hoveredBlockRef = useRef<HTMLElement | null>(null);
  const requestSequenceRef = useRef(0);
  const activeTargetKindRef = useRef<InlineTranslationKind | null>(null);
  const pendingParagraphRef = useRef<HTMLElement | null>(null);
  const paragraphOutputsRef = useRef(new Map<HTMLElement, HTMLElement>());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rememberHoveredBlock = (event: globalThis.MouseEvent): void => {
      hoveredBlockRef.current = findHoveredTranslationBlock(event.target, container);
    };
    const clearHoveredBlock = (): void => {
      hoveredBlockRef.current = null;
    };
    container.addEventListener('mousemove', rememberHoveredBlock);
    container.addEventListener('mouseleave', clearHoveredBlock);
    return () => {
      container.removeEventListener('mousemove', rememberHoveredBlock);
      container.removeEventListener('mouseleave', clearHoveredBlock);
    };
  }, [containerRef]);

  useEffect(() => () => {
    paragraphOutputsRef.current.forEach((output) => output.remove());
    paragraphOutputsRef.current.clear();
    pendingParagraphRef.current = null;
  }, [containerRef, targetLanguage]);

  useEffect(() => {
    const translateTarget = async (target: TranslationTarget): Promise<void> => {
      const sequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = sequence;
      activeTargetKindRef.current = target.kind;
      pendingParagraphRef.current?.remove();
      pendingParagraphRef.current = null;
      setCopied(false);
      if (target.kind === 'paragraph' && target.element) {
        setOverlay({ state: 'closed' });
        pendingParagraphRef.current = updateParagraphTranslation(
          paragraphOutputsRef.current,
          target.element,
          'loading',
          'Translating...',
        );
      } else {
        setOverlay({ state: 'loading', target });
      }
      const request: InlineTranslationRequest = {
        kind: target.kind,
        sourceText: target.sourceText,
        targetLanguage,
        ...(target.context ? { context: target.context } : {}),
      };
      try {
        const response = await window.shaleAPI.translation.translateInline(request);
        if (requestSequenceRef.current !== sequence) return;
        activeTargetKindRef.current = null;
        pendingParagraphRef.current = null;
        if (!response.ok) {
          if (target.kind === 'paragraph' && target.element) {
            updateParagraphTranslation(
              paragraphOutputsRef.current,
              target.element,
              'error',
              response.error.message,
            );
          } else {
            setOverlay({ state: 'error', target, message: response.error.message });
          }
          return;
        }
        if (target.kind === 'paragraph' && target.element) {
          updateParagraphTranslation(
            paragraphOutputsRef.current,
            target.element,
            'success',
            response.data.translation,
          );
        } else {
          setOverlay({ state: 'success', target, result: response.data });
        }
      } catch {
        if (requestSequenceRef.current === sequence) {
          activeTargetKindRef.current = null;
          pendingParagraphRef.current = null;
          const message = target.kind === 'paragraph'
            ? 'Unable to translate this paragraph.'
            : 'Unable to translate the selected text.';
          if (target.kind === 'paragraph' && target.element) {
            updateParagraphTranslation(
              paragraphOutputsRef.current,
              target.element,
              'error',
              message,
            );
          } else {
            setOverlay({ state: 'error', target, message });
          }
        }
      }
    };

    const handleShortcut = (event: KeyboardEvent): void => {
      if (event.repeat || !matchesKeyboardShortcut(event, shortcut) || isEditableTarget(event.target)) {
        return;
      }
      const container = containerRef.current;
      if (!container) return;
      const target = getSelectionTranslationTarget(window.getSelection(), container)
        ?? getParagraphTranslationTarget(hoveredBlockRef.current, container);
      if (!target) return;
      event.preventDefault();
      void translateTarget(target);
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (activeTargetKindRef.current === 'selection') {
          requestSequenceRef.current += 1;
          activeTargetKindRef.current = null;
        }
        setOverlay({ state: 'closed' });
      }
    };

    window.addEventListener('keydown', handleShortcut);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [containerRef, shortcut, targetLanguage]);

  useEffect(() => {
    const close = (): void => {
      if (activeTargetKindRef.current === 'selection') {
        requestSequenceRef.current += 1;
        activeTargetKindRef.current = null;
      }
      setOverlay({ state: 'closed' });
    };
    const container = containerRef.current;
    container?.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      container?.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [containerRef]);

  if (overlay.state === 'closed') return null;

  const style = getOverlayPosition(overlay.target.rect);
  const close = (): void => {
    requestSequenceRef.current += 1;
    activeTargetKindRef.current = null;
    setOverlay({ state: 'closed' });
  };

  const copyTranslation = async (): Promise<void> => {
    if (overlay.state !== 'success') return;
    try {
      await navigator.clipboard.writeText(overlay.result.translation);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside
      className="inline-translation-card"
      style={style}
      role="dialog"
      aria-label="Inline translation"
      aria-live="polite"
    >
      <header className="inline-translation-header">
        <div>
          <p className="inline-translation-kind">
            {overlay.target.kind === 'selection' ? 'Selection' : 'Paragraph'}
          </p>
          <p className="inline-translation-source" title={overlay.target.sourceText}>
            {overlay.target.sourceText}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Close inline translation">×</button>
      </header>

      {overlay.state === 'loading' && (
        <div className="inline-translation-loading">
          <span aria-hidden="true" />
          Translating...
        </div>
      )}

      {overlay.state === 'error' && (
        <p className="inline-translation-error">{overlay.message}</p>
      )}

      {overlay.state === 'success' && (
        <div className="inline-translation-result">
          <div className="inline-translation-translation-row">
            <h3>{overlay.result.translation}</h3>
            {overlay.result.pronunciation && <span>{overlay.result.pronunciation}</span>}
          </div>
          {overlay.result.partOfSpeech && (
            <p className="inline-translation-part-of-speech">{overlay.result.partOfSpeech}</p>
          )}
          {overlay.result.explanation && (
            <p className="inline-translation-explanation">{overlay.result.explanation}</p>
          )}
          {overlay.result.examples.length > 0 && (
            <div className="inline-translation-examples">
              {overlay.result.examples.map((example, index) => (
                <div key={`${example.source}-${index}`}>
                  <p>{example.source}</p>
                  <p>{example.target}</p>
                </div>
              ))}
            </div>
          )}
          <footer className="inline-translation-actions">
            <button type="button" onClick={() => void copyTranslation()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </footer>
        </div>
      )}
    </aside>
  );
};

export function findHoveredTranslationBlock(
  target: EventTarget | null,
  container: HTMLElement,
): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const block = target.closest<HTMLElement>(BLOCK_SELECTOR);
  if (!block || !container.contains(block) || !block.closest(TRANSLATABLE_ROOT_SELECTOR)) {
    return null;
  }
  return block;
}

export function getSelectionTranslationTarget(
  selection: Selection | null,
  container: HTMLElement,
): TranslationTarget | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const sourceText = selection.toString().replace(/\s+/g, ' ').trim();
  if (!sourceText) return null;
  const range = selection.getRangeAt(0);
  const root = closestElement(range.commonAncestorContainer)?.closest(TRANSLATABLE_ROOT_SELECTOR);
  if (!root || !container.contains(root)) return null;
  const contextBlock = closestElement(range.startContainer)?.closest<HTMLElement>(BLOCK_SELECTOR);
  const context = contextBlock?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 4_000);
  return {
    kind: 'selection',
    sourceText,
    ...(context && context !== sourceText ? { context } : {}),
    rect: range.getBoundingClientRect(),
  };
}

export function getParagraphTranslationTarget(
  block: HTMLElement | null,
  container: HTMLElement,
): TranslationTarget | null {
  if (!block || !container.contains(block)) return null;
  const sourceText = block.textContent?.replace(/\s+/g, ' ').trim();
  if (!sourceText) return null;
  return {
    kind: 'paragraph',
    sourceText,
    rect: block.getBoundingClientRect(),
    element: block,
  };
}

export function updateParagraphTranslation(
  outputs: Map<HTMLElement, HTMLElement>,
  source: HTMLElement,
  state: 'loading' | 'success' | 'error',
  text: string,
): HTMLElement {
  let output = outputs.get(source);
  if (!output?.isConnected) {
    output = source.ownerDocument.createElement('div');
    source.insertAdjacentElement('afterend', output);
    outputs.set(source, output);
  }
  output.className = `translation-bilingual-target inline-paragraph-translation is-${state}`;
  output.textContent = text;
  output.setAttribute('role', state === 'error' ? 'alert' : 'status');
  return output;
}

function closestElement(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || target.matches('input, textarea, select')
  );
}

function getOverlayPosition(rect: DOMRect): CSSProperties {
  const cardWidth = Math.min(460, window.innerWidth - 32);
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - cardWidth - 16));
  const showAbove = rect.bottom > window.innerHeight * 0.62;
  return showAbove
    ? { left, top: Math.max(16, rect.top - 10), transform: 'translateY(-100%)' }
    : { left, top: Math.min(window.innerHeight - 80, rect.bottom + 10) };
}
