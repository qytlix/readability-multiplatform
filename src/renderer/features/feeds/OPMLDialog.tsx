import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { OPMLImportResult } from '../../../shared/contracts/feed.ipc';
import {
  CheckIcon,
  CloseIcon,
  DocumentIcon,
  ImportIcon,
} from '../reader/ReaderIcons';

interface OPMLDialogProps {
  onImport: (
    filePath: string,
    mode: 'merge' | 'replace',
    suspectedDuplicatePolicy?: 'warn' | 'keep' | 'skip',
  ) => Promise<OPMLImportResult>;
  onExport: (filePath: string) => Promise<void>;
  onClose: () => void;
}

const getErrorMessage = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback
);

/**
 * OPML Import/Export dialog with native file dialogs via IPC.
 */
export const OPMLDialog = ({ onImport, onExport, onClose }: OPMLDialogProps) => {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle');
  const [importResult, setImportResult] = useState<OPMLImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [lastImportPath, setLastImportPath] = useState('');
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle');
  const [exportError, setExportError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const isBusy = importStatus === 'importing' || exportStatus === 'exporting';

  useEffect(() => {
    importButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || isBusy) return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isBusy, onClose]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), '
        + 'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusableElements || focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isBusy) {
      onClose();
    }
  };

  const handleFileImport = async () => {
    const dialogResult = await window.shaleAPI.dialog.openFile({
      title: '选择要导入的 OPML 文件',
      filters: [
        { name: 'OPML 文件', extensions: ['opml', 'xml'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (dialogResult.canceled || dialogResult.filePaths.length === 0) return;

    const filePath = dialogResult.filePaths[0];
    setLastImportPath(filePath);

    setImportStatus('importing');
    setImportError('');

    try {
      const result = await onImport(filePath, mode);
      setImportResult(result);
      setImportStatus('success');
    } catch (error: unknown) {
      setImportStatus('error');
      setImportError(getErrorMessage(error, '导入失败，请检查文件后重试。'));
    }
  };

  const resolveSuspectedDuplicates = async (
    policy: 'keep' | 'skip',
  ): Promise<void> => {
    if (!lastImportPath) return;
    setImportStatus('importing');
    try {
      const result = await onImport(lastImportPath, mode, policy);
      setImportResult(result);
      setImportStatus('success');
    } catch (error: unknown) {
      setImportStatus('error');
      setImportError(getErrorMessage(error, '无法处理疑似重复订阅。'));
    }
  };

  const handleExport = async () => {
    const dialogResult = await window.shaleAPI.dialog.saveFile({
      title: '导出 OPML 文件',
      filters: [
        { name: 'OPML 文件', extensions: ['opml'] },
        { name: 'XML 文件', extensions: ['xml'] },
      ],
      defaultPath: 'shale-subscriptions.opml',
    });

    if (dialogResult.canceled || !dialogResult.filePath) return;

    const filePath = dialogResult.filePath;

    setExportStatus('exporting');
    setExportError('');

    try {
      await onExport(filePath);
      setExportStatus('success');
    } catch (error: unknown) {
      setExportStatus('error');
      setExportError(getErrorMessage(error, '导出失败，请稍后重试。'));
    }
  };

  const dialog = (
    <div
      className="dialog-overlay opml-overlay"
      onClick={handleOverlayClick}
    >
      <div
        ref={dialogRef}
        className="dialog opml-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isBusy}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="opml-dialog-header">
          <div className="opml-dialog-mark" aria-hidden="true">
            <DocumentIcon />
          </div>
          <div className="opml-dialog-heading">
            <span>订阅管理</span>
            <h2 id={titleId}>导入 / 导出 OPML</h2>
            <p id={descriptionId}>
              从其他阅读器迁移订阅，或将当前订阅保存为一份本地备份。
            </p>
          </div>
          <button
            type="button"
            className="opml-close-button"
            aria-label="关闭"
            title="关闭"
            disabled={isBusy}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="opml-content">
          <section className="opml-import-panel">
            <div className="opml-section-heading">
              <span className="opml-section-icon" aria-hidden="true">
                <ImportIcon />
              </span>
              <div>
                <h3>导入订阅</h3>
                <p>支持来自主流 RSS 阅读器的 .opml 和 .xml 文件。</p>
              </div>
            </div>

            <fieldset className="opml-mode-fieldset" disabled={isBusy}>
              <legend>导入方式</legend>
              <div className="opml-mode-grid">
                <label className={`opml-mode-card${mode === 'merge' ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="opml-import-mode"
                    value="merge"
                    checked={mode === 'merge'}
                    onChange={() => setMode('merge')}
                  />
                  <span className="opml-mode-indicator" aria-hidden="true" />
                  <span className="opml-mode-copy">
                    <span className="opml-mode-title">
                      合并
                      <span className="opml-recommended">推荐</span>
                    </span>
                    <span>加入新订阅，保留你当前的订阅和文章。</span>
                  </span>
                </label>

                <label className={`opml-mode-card${mode === 'replace' ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="opml-import-mode"
                    value="replace"
                    checked={mode === 'replace'}
                    onChange={() => setMode('replace')}
                  />
                  <span className="opml-mode-indicator" aria-hidden="true" />
                  <span className="opml-mode-copy">
                    <span className="opml-mode-title">替换</span>
                    <span>以文件为准，移除文件中不存在的订阅。</span>
                  </span>
                </label>
              </div>
            </fieldset>

            {mode === 'replace' && (
              <p className="opml-replace-notice">
                替换会移除未包含在文件中的订阅及其本地文章，请确认已备份。
              </p>
            )}

            <button
              ref={importButtonRef}
              type="button"
              className="opml-primary-action"
              onClick={() => void handleFileImport()}
              disabled={isBusy}
            >
              {importStatus === 'importing' ? (
                <span className="mini-spinner" aria-hidden="true" />
              ) : (
                <ImportIcon />
              )}
              {importStatus === 'importing' ? '正在导入…' : '选择 OPML 文件'}
            </button>

            {importStatus === 'success' && importResult && (
              <div className="opml-result opml-result-success" role="status">
                <span className="opml-result-icon" aria-hidden="true">
                  <CheckIcon />
                </span>
                <div>
                  <strong>导入完成</strong>
                  <p>
                    已加入 {importResult.successCount} 个订阅
                    {importResult.skipCount > 0 && `，跳过 ${importResult.skipCount} 个重复项`}
                    {importResult.failures.length > 0 && `，${importResult.failures.length} 个失败`}
                    。
                  </p>
                  {importResult.failures.length > 0 && (
                    <ul className="opml-result-failures">
                      {importResult.failures.slice(0, 5).map((failure, index) => (
                        <li key={`${index}-${failure.xmlUrl ?? ''}-${failure.title ?? ''}`}>
                          {failure.title || failure.xmlUrl || '未知订阅'}：{failure.error}
                        </li>
                      ))}
                    </ul>
                  )}
                  {Boolean(importResult.suspectedDuplicates?.length) && (
                    <div className="opml-duplicate-warning">
                      <strong>
                        发现 {importResult.suspectedDuplicates?.length} 个疑似重复订阅
                      </strong>
                      <ul>
                        {importResult.suspectedDuplicates?.map((warning) => (
                          <li key={warning.candidate.feedURL}>
                            {warning.candidate.title ?? warning.candidate.feedURL}
                            {'：'}{warning.reason}
                          </li>
                        ))}
                      </ul>
                      <div className="opml-duplicate-actions">
                        <button
                          type="button"
                          onClick={() => void resolveSuspectedDuplicates('skip')}
                        >
                          跳过这些订阅
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolveSuspectedDuplicates('keep')}
                        >
                          全部保留
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {importStatus === 'error' && (
              <p className="opml-inline-error" role="alert">{importError}</p>
            )}
          </section>

          <section className="opml-export-panel">
            <div className="opml-export-copy">
              <span className="opml-section-icon is-secondary" aria-hidden="true">
                <DocumentIcon />
              </span>
              <div>
                <h3>导出当前订阅</h3>
                <p>生成一份 OPML 备份，可在其他阅读器中继续使用。</p>
              </div>
            </div>
            <button
              type="button"
              className="opml-secondary-action"
              onClick={() => void handleExport()}
              disabled={isBusy}
            >
              {exportStatus === 'exporting' && (
                <span className="mini-spinner" aria-hidden="true" />
              )}
              {exportStatus === 'exporting' ? '正在导出…' : '导出文件'}
            </button>
          </section>

          {exportStatus === 'success' && (
            <p className="opml-export-status" role="status">
              <CheckIcon />
              已导出当前订阅。
            </p>
          )}

          {exportStatus === 'error' && (
            <p className="opml-inline-error" role="alert">{exportError}</p>
          )}
        </div>

        <footer className="opml-dialog-footer">
          <span>OPML 文件只包含订阅信息，不包含文章与阅读进度。</span>
          <button type="button" disabled={isBusy} onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>
  );

  const pageRoot = document.querySelector<HTMLElement>('.reader-page');
  return createPortal(dialog, pageRoot ?? document.body);
};
