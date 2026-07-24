import { useState } from 'react';

type DiagnosticExportStatus = 'idle' | 'exporting' | 'saved' | 'error';

export const DiagnosticsSection = () => {
  const [status, setStatus] = useState<DiagnosticExportStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const exportDiagnostics = async (): Promise<void> => {
    setStatus('exporting');
    setErrorMessage('');

    try {
      const result = await window.shaleAPI.diagnostics.export();
      if (!result.ok) {
        setStatus('error');
        setErrorMessage(result.error.message);
        return;
      }

      if (result.data.status === 'cancelled') {
        setStatus('idle');
        return;
      }

      setStatus('saved');
    } catch {
      setStatus('error');
      setErrorMessage('Unable to save diagnostic information. Choose another location and try again.');
    }
  };

  return (
    <section className="settings-card" aria-labelledby="diagnostics-settings-title">
      <div className="settings-card-heading">
        <h3 id="diagnostics-settings-title">Diagnostics</h3>
        <p>Create a file you can choose to share when reporting a problem.</p>
      </div>
      <p className="diagnostics-summary">
        The file includes Shale and runtime versions, a limited display-environment
        summary, and up to the latest 1,000 redacted structured log records. It does
        not include API keys, credentials, Feed or article URLs, article content,
        summaries, translations, notes, or database data.
      </p>
      <button
        type="button"
        className="diagnostics-export-button"
        onClick={() => {
          void exportDiagnostics();
        }}
        disabled={status === 'exporting'}
        aria-busy={status === 'exporting'}
      >
        {status === 'exporting' ? 'Preparing diagnostics…' : 'Export Diagnostic Information…'}
      </button>
      {status === 'saved' && (
        <p className="diagnostics-status diagnostics-status-success" role="status">
          Diagnostic information was exported. You can share the file you selected.
        </p>
      )}
      {status === 'error' && (
        <p className="diagnostics-status diagnostics-status-error" role="alert">
          {errorMessage}
        </p>
      )}
    </section>
  );
};
