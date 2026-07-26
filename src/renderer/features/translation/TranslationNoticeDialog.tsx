import {
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';

interface TranslationNoticeDialogProps {
  message: string | null;
  onConfirm: () => void;
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
