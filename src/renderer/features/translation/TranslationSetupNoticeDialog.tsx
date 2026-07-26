import {
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';

interface TranslationSetupNoticeDialogProps {
  open: boolean;
  onConfirm: () => void;
}

/**
 * The first full-translation reminder is intentionally acknowledgement-only:
 * users must make an explicit choice before the pending Translation can start.
 */
export const TranslationSetupNoticeDialog = ({
  open,
  onConfirm,
}: TranslationSetupNoticeDialogProps) => {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    confirmButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const dialog = (
    <div className="dialog-overlay translation-setup-notice-overlay">
      <section
        className="dialog translation-setup-notice-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.preventDefault();
        }}
      >
        <h2 id={titleId}>翻译设置提示</h2>
        <p id={descriptionId}>
          你可以点击左下角的「设置」，前往设置页选择术语库和 AI 翻译专家。
        </p>
        <div className="dialog-actions">
          <button
            ref={confirmButtonRef}
            type="submit"
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
