import {
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import type { RetranslationRequestResult } from './TranslationPanel';

interface TranslationNoticeDialogProps {
  message: string | null;
  onConfirm: () => void;
}

export function getRetranslationNoticeMessage(
  result: RetranslationRequestResult,
): string | null {
  switch (result) {
    case 'content-unavailable':
      return '当前文章尚未拉取成功';
    case 'no-translation':
      return '当前文章还没有翻译';
    case 'active':
      return '当前文章的翻译任务正在进行，请使用主翻译按钮暂停或继续。';
    case 'active-deep':
      return '当前文章的深度翻译任务正在进行，请等待任务完成或失败。';
    default:
      return null;
  }
}

/** Compact acknowledgement dialog for an unavailable article Translation action. */
export const TranslationNoticeDialog = ({
  message,
  onConfirm,
}: TranslationNoticeDialogProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!message) return;
    buttonRef.current?.focus();
  }, [message]);

  if (!message) return null;

  const dialog = (
    <div className="dialog-overlay translation-notice-overlay">
      <section
        className="dialog translation-notice-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId}>重新翻译</h2>
        <p id={descriptionId}>{message}</p>
        <div className="dialog-actions">
          <button
            ref={buttonRef}
            type="submit"
            className="translation-notice-confirm"
            onClick={onConfirm}
          >
            确认
          </button>
        </div>
      </section>
    </div>
  );
  const pageRoot = document.querySelector<HTMLElement>('.reader-page');
  return createPortal(dialog, pageRoot ?? document.body);
};
