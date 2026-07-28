import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import type {
  TerminologyImportPreview,
  TerminologyLibrary,
} from '../../../shared/contracts/translation-terminology.types';
import {
  formatSettingsAuthor,
  SETTINGS_OPTION_PREVIEW_LIMIT,
} from './settingsOptionPresentation';

interface TerminologySettingsSectionProps {
  useTerminology: boolean;
}

export const TerminologySettingsSection = ({
  useTerminology,
}: TerminologySettingsSectionProps) => {
  const [terminologyLibraries, setTerminologyLibraries] =
    useState<TerminologyLibrary[]>([]);
  const [terminologyError, setTerminologyError] = useState('');
  const [terminologyNotice, setTerminologyNotice] = useState('');
  const [terminologyName, setTerminologyName] = useState('');
  const [terminologyCsv, setTerminologyCsv] = useState('');
  const [terminologyPreview, setTerminologyPreview] =
    useState<TerminologyImportPreview | null>(null);
  const [showTerminologyCreator, setShowTerminologyCreator] = useState(false);
  const [showAllTerminologyLibraries, setShowAllTerminologyLibraries] =
    useState(false);
  const [pendingTerminologyLibraryId, setPendingTerminologyLibraryId] =
    useState<string | null>(null);
  const terminologyFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let disposed = false;
    if (!window.shaleAPI) {
      setTerminologyError('当前预览未连接 Electron Main 进程。');
      return () => {
        disposed = true;
      };
    }
    void window.shaleAPI.terminology.list().then((result) => {
      if (disposed) return;
      if (result.ok) setTerminologyLibraries(result.data.libraries);
      else setTerminologyError(result.error.message);
    }).catch(() => {
      if (!disposed) setTerminologyError('无法加载术语库。');
    });
    return () => {
      disposed = true;
    };
  }, []);

  const refreshTerminologyLibraries = async (): Promise<void> => {
    const result = await window.shaleAPI.terminology.list();
    if (!result.ok) throw new Error(result.error.message);
    setTerminologyLibraries(result.data.libraries);
  };

  const setTerminologyLibraryEnabled = async (
    library: TerminologyLibrary,
    enabled: boolean,
  ): Promise<void> => {
    setTerminologyError('');
    setTerminologyNotice('');
    setPendingTerminologyLibraryId(library.id);
    try {
      const result = await window.shaleAPI.terminology.setEnabled({
        id: library.id,
        enabled,
      });
      if (!result.ok) {
        setTerminologyError(result.error.message);
        return;
      }
      await refreshTerminologyLibraries();
      setTerminologyNotice(
        `已${enabled ? '启用' : '停用'}“${library.name}”。`,
      );
    } catch {
      setTerminologyError('无法更新术语库。');
    } finally {
      setPendingTerminologyLibraryId(null);
    }
  };

  const previewTerminologyFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setTerminologyError('');
    setTerminologyNotice('');
    setTerminologyPreview(null);
    try {
      const csv = await file.text();
      const name = terminologyName.trim()
        || file.name.replace(/\.csv$/i, '').trim();
      setTerminologyName(name);
      setTerminologyCsv(csv);
      const result = await window.shaleAPI.terminology.preview({ name, csv });
      if (!result.ok) {
        setTerminologyError(result.error.message);
        return;
      }
      setTerminologyPreview(result.data);
    } catch {
      setTerminologyError('无法读取或校验术语 CSV 文件。');
    }
  };

  const importPreviewedTerminology = async (): Promise<void> => {
    if (!terminologyPreview?.valid) return;
    setTerminologyError('');
    try {
      const result = await window.shaleAPI.terminology.import({
        name: terminologyPreview.name,
        csv: terminologyCsv,
        replace: terminologyPreview.replacesExistingUserLibrary,
      });
      if (!result.ok) {
        setTerminologyError(result.error.message);
        return;
      }
      await refreshTerminologyLibraries();
      setTerminologyNotice(
        `已导入术语库“${terminologyPreview.name}”。`,
      );
      setTerminologyName('');
      setTerminologyCsv('');
      setTerminologyPreview(null);
      setShowTerminologyCreator(false);
    } catch {
      setTerminologyError('无法导入术语库。');
    }
  };

  const removeTerminologyLibrary = async (
    library: TerminologyLibrary,
  ): Promise<void> => {
    if (library.origin !== 'user') return;
    if (!window.confirm(`确定删除用户术语库“${library.name}”吗？`)) return;
    setTerminologyError('');
    try {
      const result = await window.shaleAPI.terminology.remove({ id: library.id });
      if (!result.ok) {
        setTerminologyError(result.error.message);
        return;
      }
      await refreshTerminologyLibraries();
      setTerminologyNotice(`已删除术语库“${library.name}”。`);
    } catch {
      setTerminologyError('无法删除术语库。');
    }
  };

  const displayedTerminologyLibraries = showAllTerminologyLibraries
    ? terminologyLibraries
    : terminologyLibraries.slice(0, SETTINGS_OPTION_PREVIEW_LIMIT);

  return (
    <section
      id="settings-terminology"
      className="settings-section"
      aria-labelledby="terminology-settings-title"
    >
      <div className="settings-section-heading">
        <div>
          <h3 id="terminology-settings-title" className="settings-section-title">术语库</h3>
          <p>按库启用内置术语，也可以导入自己的 CSV 术语库。</p>
        </div>
        <button
          type="button"
          className="settings-section-action"
          onClick={() => {
            setShowTerminologyCreator((current) => !current);
            setTerminologyError('');
            setTerminologyNotice('');
          }}
        >
          {showTerminologyCreator ? '收起导入' : '新建术语库'}
        </button>
      </div>
      {showTerminologyCreator && (
        <div className="settings-card">
          <div className="settings-fields">
            <div className="settings-import-help">
              <h4>术语 CSV 格式</h4>
              <p>
                使用 UTF-8 CSV，首行必须为{' '}
                <code>source,target,tgt_lng</code>。目标词为空时保留源词；
                <code>tgt_lng</code> 为空时应用到所有目标语言。逗号、引号和换行
                需遵循 RFC 4180 引用规则。
              </p>
              <pre>{[
                'source,target,tgt_lng',
                'Large language model,大语言模型,zh-CN',
                'colour,color,en',
                'Shale,,',
                '"term, with comma","译文，含逗号",zh-CN',
              ].join('\n')}</pre>
              <label>
                术语库名称
                <input
                  value={terminologyName}
                  maxLength={120}
                  onChange={(event) => {
                    setTerminologyName(event.target.value);
                    setTerminologyPreview(null);
                  }}
                />
              </label>
              <input
                ref={terminologyFileRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => void previewTerminologyFile(event)}
              />
              <button
                type="button"
                onClick={() => terminologyFileRef.current?.click()}
              >
                选择 CSV 文件
              </button>
              {terminologyPreview && (
                <div className="settings-import-preview">
                  <strong>
                    {terminologyPreview.valid
                      ? `${terminologyPreview.name}：${terminologyPreview.acceptedRowCount} 行`
                      : '该术语库无法导入'}
                  </strong>
                  {terminologyPreview.errors.map((issue) => (
                    <p
                      key={`error-${issue.line}-${issue.code}-${issue.message}`}
                      className="settings-page-error"
                    >
                      第 {issue.line} 行：{issue.message}
                    </p>
                  ))}
                  {terminologyPreview.warnings.map((issue) => (
                    <p key={`warning-${issue.line}-${issue.code}-${issue.message}`}>
                      第 {issue.line} 行：{issue.message}
                    </p>
                  ))}
                  {terminologyPreview.valid && (
                    <button
                      type="button"
                      onClick={() => void importPreviewedTerminology()}
                    >
                      {terminologyPreview.replacesExistingUserLibrary
                        ? '确认并替换术语库'
                        : '导入并启用术语库'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {terminologyLibraries.length > 0 ? (
        <div
          id="settings-terminology-options"
          className="settings-option-grid settings-terminology-grid"
        >
          {displayedTerminologyLibraries.map((library) => {
            const isPending = pendingTerminologyLibraryId === library.id;
            const descriptionId = `terminology-description-${library.id}`;
            return (
              <article
                className={[
                  'settings-option-card',
                  library.enabled ? 'is-active' : '',
                  !useTerminology ? 'is-disabled' : '',
                ].filter(Boolean).join(' ')}
                key={library.id}
              >
                <header className="settings-option-card-header">
                  <div className="settings-option-card-identity">
                    <h4>{library.name}</h4>
                    <span>{formatSettingsAuthor(library.author, library.origin)}</span>
                  </div>
                  <label
                    className="settings-switch"
                    title={useTerminology
                      ? `${library.enabled ? '停用' : '启用'}${library.name}`
                      : '请先打开翻译设置中的“使用术语库”'}
                  >
                    <span className="settings-visually-hidden">
                      {library.enabled ? '停用' : '启用'}{library.name}
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={library.enabled}
                      disabled={!useTerminology || isPending}
                      aria-describedby={descriptionId}
                      onChange={(event) => void setTerminologyLibraryEnabled(
                        library,
                        event.target.checked,
                      )}
                    />
                    <span />
                  </label>
                </header>
                <p id={descriptionId} className="settings-option-card-description">
                  {library.description || '用于翻译时匹配并优先采用指定术语。'}
                </p>
                <footer className="settings-option-card-footer">
                  <span>{library.origin === 'builtin' ? '内置' : '用户'}</span>
                  <span>{library.entryCount.toLocaleString()} 条术语</span>
                  {library.removable && (
                    <button
                      type="button"
                      className="settings-option-delete"
                      onClick={() => void removeTerminologyLibrary(library)}
                    >
                      删除
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="settings-card settings-option-empty">
          暂无可用术语库。
        </div>
      )}
      {terminologyLibraries.length > SETTINGS_OPTION_PREVIEW_LIMIT && (
        <button
          type="button"
          className="settings-section-action settings-option-list-toggle"
          aria-controls="settings-terminology-options"
          aria-expanded={showAllTerminologyLibraries}
          onClick={() => setShowAllTerminologyLibraries((current) => !current)}
        >
          {showAllTerminologyLibraries ? '收起' : '显示更多'}
        </button>
      )}
      {terminologyError && (
        <p className="settings-page-error" role="status">
          {terminologyError}
        </p>
      )}
      {terminologyNotice && (
        <p className="settings-page-notice" role="status">{terminologyNotice}</p>
      )}
    </section>
  );
};
