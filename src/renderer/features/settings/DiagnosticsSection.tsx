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
      setErrorMessage('无法保存诊断信息。请选择其他位置后重试。');
    }
  };

  return (
    <section className="settings-section" aria-labelledby="diagnostics-settings-title">
      <div className="settings-section-heading">
        <div>
          <h3 id="diagnostics-settings-title" className="settings-section-title">诊断</h3>
          <p>导出一份由你决定是否在报告问题时分享的诊断文件。</p>
        </div>
      </div>
      <div className="settings-card">
        <p className="diagnostics-summary">
          文件包含 Shale 与运行时版本、有限的显示环境摘要，以及最近最多 1,000 条
          已脱敏结构化日志。它不包含 API Key、凭据、Feed 或文章 URL、文章内容、
          摘要、翻译、笔记或数据库数据。
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
          {status === 'exporting' ? '正在准备诊断信息…' : '导出诊断信息…'}
        </button>
        {status === 'saved' && (
          <p className="diagnostics-status diagnostics-status-success" role="status">
            诊断信息已导出，你可以分享刚才选择保存的文件。
          </p>
        )}
        {status === 'error' && (
          <p className="diagnostics-status diagnostics-status-error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </section>
  );
};
