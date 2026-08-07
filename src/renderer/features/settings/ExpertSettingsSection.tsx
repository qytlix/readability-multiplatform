import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  DEFAULT_TRANSLATION_EXPERT_ID,
  type TranslationExpert,
  type TranslationExpertImportPreview,
} from '../../../shared/contracts/translation-expert.types';
import type { AiPreferences } from './aiPreferences';
import {
  formatSettingsAuthor,
  SETTINGS_OPTION_PREVIEW_LIMIT,
} from './settingsOptionPresentation';

interface ExpertSettingsSectionProps {
  preferences: AiPreferences;
  onPreferencesChange: (preferences: AiPreferences) => void;
}

export const ExpertSettingsSection = ({
  preferences,
  onPreferencesChange,
}: ExpertSettingsSectionProps) => {
  const [experts, setExperts] = useState<TranslationExpert[]>([]);
  const [expertError, setExpertError] = useState('');
  const [expertNotice, setExpertNotice] = useState('');
  const [expertYaml, setExpertYaml] = useState('');
  const [expertPreview, setExpertPreview] =
    useState<TranslationExpertImportPreview | null>(null);
  const [showExpertCreator, setShowExpertCreator] = useState(false);
  const [showAllExperts, setShowAllExperts] = useState(false);
  const expertFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let disposed = false;
    if (!window.shaleAPI) {
      setExpertError('当前预览未连接 Electron Main 进程。');
      return () => {
        disposed = true;
      };
    }
    void window.shaleAPI.expert.list().then((result) => {
      if (disposed) return;
      if (result.ok) setExperts(result.data.experts);
      else setExpertError(result.error.message);
    }).catch(() => {
      if (!disposed) setExpertError('无法加载 AI 专家。');
    });
    return () => {
      disposed = true;
    };
  }, []);

  const updatePreferences = (update: Partial<AiPreferences>): void => {
    onPreferencesChange({ ...preferences, ...update });
  };

  const refreshExperts = async (): Promise<void> => {
    const result = await window.shaleAPI.expert.list();
    if (!result.ok) throw new Error(result.error.message);
    setExperts(result.data.experts);
  };

  const previewExpertFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setExpertError('');
    setExpertNotice('');
    setExpertPreview(null);
    try {
      const yaml = await file.text();
      setExpertYaml(yaml);
      const result = await window.shaleAPI.expert.preview({ yaml });
      if (!result.ok) {
        setExpertError(result.error.message);
        return;
      }
      setExpertPreview(result.data);
    } catch {
      setExpertError('无法读取或校验 AI 专家文件。');
    }
  };

  const importPreviewedExpert = async (): Promise<void> => {
    if (!expertPreview?.valid || !expertPreview.expert) return;
    setExpertError('');
    try {
      const result = await window.shaleAPI.expert.import({
        yaml: expertYaml,
        replace: expertPreview.replacesExistingUserExpert,
      });
      if (!result.ok) {
        setExpertError(result.error.message);
        return;
      }
      await refreshExperts();
      updatePreferences({ translationExpertId: result.data.expertId });
      setExpertNotice(`已导入 AI 专家“${expertPreview.expert.name}”。`);
      setExpertPreview(null);
      setExpertYaml('');
      setShowExpertCreator(false);
    } catch {
      setExpertError('无法导入 AI 专家。');
    }
  };

  const removeExpert = async (expert: TranslationExpert): Promise<void> => {
    if (expert.origin !== 'user') return;
    if (!window.confirm(`确定删除用户 AI 专家“${expert.name}”吗？`)) return;
    setExpertError('');
    try {
      const result = await window.shaleAPI.expert.remove({ id: expert.id });
      if (!result.ok) {
        setExpertError(result.error.message);
        return;
      }
      await refreshExperts();
      if (preferences.translationExpertId === expert.id) {
        updatePreferences({ translationExpertId: DEFAULT_TRANSLATION_EXPERT_ID });
      }
      setExpertNotice(`已删除 AI 专家“${expert.name}”。`);
    } catch {
      setExpertError('无法删除 AI 专家。');
    }
  };

  const displayedExperts = showAllExperts
    ? experts
    : experts.slice(0, SETTINGS_OPTION_PREVIEW_LIMIT);

  return (
    <section
      id="settings-experts"
      className="settings-section"
      aria-labelledby="expert-settings-title"
    >
      <div className="settings-section-heading">
        <div>
          <h3 id="expert-settings-title" className="settings-section-title">AI 专家</h3>
          <p>选择领域翻译专家，或从受限 YAML 文件导入自定义专家。</p>
        </div>
        <button
          type="button"
          className="settings-section-action"
          onClick={() => {
            setShowExpertCreator((current) => !current);
            setExpertError('');
            setExpertNotice('');
          }}
        >
          {showExpertCreator ? '收起导入' : '新建 AI 专家'}
        </button>
      </div>
      {showExpertCreator && (
        <div className="settings-card">
          <div className="settings-fields">
            <div className="settings-import-help">
              <h4>AI 专家 YAML 格式</h4>
              <p>
                保存 UTF-8 <code>.yml</code> 或 <code>.yaml</code> 文件，
                其中包含 ID、版本、名称以及领域或文体指令。可选变量为{' '}
                <code>{'{{sourceLanguage}}'}</code> 和{' '}
                <code>{'{{targetLanguage}}'}</code>。
              </p>
              <pre>{[
                'id: my-medical-expert',
                'version: 1.0.0',
                'name: Medical translation',
                'author: Me',
                'description: Preserve clinical terminology.',
                'instruction: |',
                '  Use standard {{targetLanguage}} clinical terminology.',
                '  Preserve drug names and units exactly.',
                'matches:',
                '  - medical',
              ].join('\n')}</pre>
              <p>
                文件会在本地校验。自定义 YAML 标签、别名、未知变量，以及试图替换
                输出格式的指令会被拒绝或移除。
              </p>
              <input
                ref={expertFileRef}
                type="file"
                accept=".yml,.yaml,text/yaml,application/yaml"
                hidden
                onChange={(event) => void previewExpertFile(event)}
              />
              <button type="button" onClick={() => expertFileRef.current?.click()}>
                选择 YAML 文件
              </button>
              {expertPreview && (
                <div className="settings-import-preview">
                  <strong>
                    {expertPreview.valid && expertPreview.expert
                      ? `${expertPreview.expert.name} (${expertPreview.expert.id})`
                      : '该专家无法导入'}
                  </strong>
                  {expertPreview.errors.map((error) => (
                    <p key={error} className="settings-page-error">{error}</p>
                  ))}
                  {expertPreview.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                  {expertPreview.valid && expertPreview.expert && (
                    <button type="button" onClick={() => void importPreviewedExpert()}>
                      {expertPreview.replacesExistingUserExpert
                        ? '确认并替换用户专家'
                        : '导入专家'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {experts.length > 0 ? (
        <div
          id="settings-expert-options"
          className="settings-option-grid settings-expert-grid"
        >
          {displayedExperts.map((expert) => {
            const isSelected = preferences.translationExpertId === expert.id;
            const descriptionId = `expert-description-${expert.id}`;
            return (
              <article
                className={`settings-option-card${isSelected ? ' is-active' : ''}`}
                key={expert.id}
              >
                <header className="settings-option-card-header">
                  <div className="settings-option-card-identity">
                    <h4>{expert.name}</h4>
                    <span>{formatSettingsAuthor(expert.author, expert.origin)}</span>
                  </div>
                  <label
                    className="settings-switch"
                    title={`${isSelected ? '停用' : '启用'}${expert.name}`}
                  >
                    <span className="settings-visually-hidden">
                      {isSelected ? '停用' : '启用'}{expert.name}
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={isSelected}
                      aria-describedby={descriptionId}
                      onChange={(event) => updatePreferences({
                        translationExpertId: event.target.checked
                          ? expert.id
                          : DEFAULT_TRANSLATION_EXPERT_ID,
                      })}
                    />
                    <span />
                  </label>
                </header>
                <p id={descriptionId} className="settings-option-card-description">
                  {expert.description || expert.details || '为翻译提供领域和文体指导。'}
                </p>
                <footer className="settings-option-card-footer">
                  <span>{expert.origin === 'builtin' ? '内置' : '用户'}</span>
                  <span>v{expert.version}</span>
                  {expert.origin === 'user' && (
                    <button
                      type="button"
                      className="settings-option-delete"
                      onClick={() => void removeExpert(expert)}
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
          暂无可用 AI 专家。
        </div>
      )}
      {experts.length > SETTINGS_OPTION_PREVIEW_LIMIT && (
        <button
          type="button"
          className="settings-section-action settings-option-list-toggle"
          aria-controls="settings-expert-options"
          aria-expanded={showAllExperts}
          onClick={() => setShowAllExperts((current) => !current)}
        >
          {showAllExperts ? '收起' : '显示更多'}
        </button>
      )}
      {preferences.translationExpertId !== DEFAULT_TRANSLATION_EXPERT_ID
        && !experts.some((expert) => expert.id === preferences.translationExpertId)
        && (
          <p className="settings-page-error" role="status">
            当前选择的 AI 专家已不可用，请选择其他专家。
          </p>
        )}
      {expertError && <p className="settings-page-error" role="status">{expertError}</p>}
      {expertNotice && <p className="settings-page-notice" role="status">{expertNotice}</p>}
    </section>
  );
};
