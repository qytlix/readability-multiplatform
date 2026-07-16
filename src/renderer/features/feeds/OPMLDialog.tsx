import { useState } from 'react';
import type { OPMLImportResult } from '../../../shared/contracts/feed.ipc';

interface OPMLDialogProps {
  onImport: (filePath: string, mode: 'merge' | 'replace') => Promise<OPMLImportResult>;
  onExport: (filePath: string) => Promise<void>;
  onClose: () => void;
}

/**
 * OPML Import/Export dialog with native file dialogs via IPC.
 */
export const OPMLDialog = ({ onImport, onExport, onClose }: OPMLDialogProps) => {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle');
  const [importResult, setImportResult] = useState<OPMLImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle');
  const [exportError, setExportError] = useState('');

  const handleFileImport = async () => {
    // Native file open dialog
    const dialogResult = await window.shaleAPI.dialog.openFile({
      title: 'Select OPML file to import',
      filters: [
        { name: 'OPML Files', extensions: ['opml', 'xml'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (dialogResult.canceled || dialogResult.filePaths.length === 0) return;

    const filePath = dialogResult.filePaths[0];

    setImportStatus('importing');
    setImportError('');

    try {
      const result = await onImport(filePath, mode);
      setImportResult(result);
      setImportStatus('success');
    } catch (err: any) {
      setImportStatus('error');
      setImportError(err?.message ?? 'Import failed');
    }
  };

  const handleExport = async () => {
    // Native file save dialog
    const dialogResult = await window.shaleAPI.dialog.saveFile({
      title: 'Export OPML file',
      filters: [
        { name: 'OPML Files', extensions: ['opml'] },
        { name: 'XML Files', extensions: ['xml'] },
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
    } catch (err: any) {
      setExportStatus('error');
      setExportError(err?.message ?? 'Export failed');
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog opml-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>OPML</h2>

        {/* Import Section */}
        <section className="opml-section">
          <h3>Import</h3>
          <div className="form-group">
            <label htmlFor="opml-import-mode">Import Mode</label>
            <select
              id="opml-import-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}
              disabled={importStatus === 'importing'}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '14px',
              }}
            >
              <option value="merge">Merge — add new feeds, keep existing</option>
              <option value="replace">Replace — remove feeds not in OPML</option>
            </select>
          </div>

          <button
            type="button"
            className="opml-action-btn"
            onClick={handleFileImport}
            disabled={importStatus === 'importing'}
          >
            {importStatus === 'importing' ? 'Importing...' : 'Import from File...'}
          </button>

          {importStatus === 'success' && importResult && (
            <div className="opml-result">
              <p className="opml-result-success">
                ✓ Imported {importResult.successCount} feed{importResult.successCount !== 1 ? 's' : ''}
                {importResult.skipCount > 0 && ` (${importResult.skipCount} skipped)`}
              </p>
              {importResult.failures.length > 0 && (
                <div className="opml-result-failures">
                  <p>{importResult.failures.length} failure{importResult.failures.length !== 1 ? 's' : ''}:</p>
                  <ul>
                    {importResult.failures.slice(0, 5).map((f, i) => (
                      <li key={i}>{f.title || f.xmlUrl || 'unknown'}: {f.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {importStatus === 'error' && (
            <p className="error-message" role="alert">{importError}</p>
          )}
        </section>

        {/* Export Section */}
        <section className="opml-section" style={{ marginTop: '24px' }}>
          <h3>Export</h3>
          <button
            type="button"
            className="opml-action-btn"
            onClick={handleExport}
            disabled={exportStatus === 'exporting'}
          >
            {exportStatus === 'exporting' ? 'Exporting...' : 'Export to File...'}
          </button>

          {exportStatus === 'success' && (
            <p className="opml-result-success">✓ Exported successfully</p>
          )}

          {exportStatus === 'error' && (
            <p className="error-message" role="alert">{exportError}</p>
          )}
        </section>

        <div className="dialog-actions" style={{ marginTop: '24px' }}>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};