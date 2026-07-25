import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ProviderProfile } from '../../../shared/contracts/provider.types';
import type {
  SummaryDetailLevel,
  SummaryTargetLanguage,
} from '../../../shared/contracts/summary.types';
import type {
  TranslationSourceLanguage,
  TranslationTargetLanguage,
} from '../../../shared/contracts/translation.types';
import {
  TRANSLATION_TARGET_LANGUAGES,
} from '../../../shared/contracts/translation.types';
import {
  DEFAULT_TRANSLATION_EXPERT_ID,
  type TranslationExpert,
  type TranslationExpertImportPreview,
} from '../../../shared/contracts/translation-expert.types';
import type {
  TerminologyImportPreview,
  TerminologyLibrary,
} from '../../../shared/contracts/translation-terminology.types';
import { ProviderSettings } from '../summary/ProviderSettings';
import type { AiPreferences } from './aiPreferences';
import {
  areKeyboardShortcutsEqual,
  formatKeyboardShortcut,
  shortcutFromKeyboardEvent,
} from './keyboardShortcut';
import { DiagnosticsSection } from './DiagnosticsSection';

type ShortcutPreferenceKey =
  | 'fullTranslationShortcut'
  | 'paragraphTranslationShortcut'
  | 'selectionTranslationShortcut';

const TRANSLATION_SHORTCUTS: ReadonlyArray<{
  preferenceKey: ShortcutPreferenceKey;
  label: string;
}> = [
  { preferenceKey: 'fullTranslationShortcut', label: '翻译全文' },
  { preferenceKey: 'paragraphTranslationShortcut', label: '翻译段落' },
  { preferenceKey: 'selectionTranslationShortcut', label: '翻译选中内容' },
];

const SETTINGS_TRANSLATION_LANGUAGE_LABELS: Record<TranslationTargetLanguage, string> = {
  'zh-CN': '简体中文',
  'zh-HK': '繁体中文（香港）',
  ja: '日语',
  ko: '韩语',
  de: '德语',
  fr: '法语',
  es: '西班牙语',
  en: '英语',
};

const formatSettingsAuthor = (
  author: string,
  origin: 'builtin' | 'user',
): string => {
  const normalizedAuthor = author.trim().replace(/^@+/, '');
  if (normalizedAuthor) return `@${normalizedAuthor}`;
  return origin === 'builtin' ? '@Shale' : '@我';
};

interface AISettingsPageProps {
  preferences: AiPreferences;
  onPreferencesChange: (preferences: AiPreferences) => void;
  onClose: () => void;
}

export const AISettingsPage = ({
  preferences,
  onPreferencesChange,
  onClose,
}: AISettingsPageProps) => {
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [providerError, setProviderError] = useState('');
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutPreferenceKey | null>(null);
  const [shortcutError, setShortcutError] = useState('');
  const [experts, setExperts] = useState<TranslationExpert[]>([]);
  const [expertError, setExpertError] = useState('');
  const [expertNotice, setExpertNotice] = useState('');
  const [expertYaml, setExpertYaml] = useState('');
  const [expertPreview, setExpertPreview] =
    useState<TranslationExpertImportPreview | null>(null);
  const [showExpertCreator, setShowExpertCreator] = useState(false);
  const expertFileRef = useRef<HTMLInputElement>(null);
  const [terminologyLibraries, setTerminologyLibraries] =
    useState<TerminologyLibrary[]>([]);
  const [terminologyError, setTerminologyError] = useState('');
  const [terminologyNotice, setTerminologyNotice] = useState('');
  const [terminologyName, setTerminologyName] = useState('');
  const [terminologyCsv, setTerminologyCsv] = useState('');
  const [terminologyPreview, setTerminologyPreview] =
    useState<TerminologyImportPreview | null>(null);
  const [showTerminologyCreator, setShowTerminologyCreator] = useState(false);
  const [pendingTerminologyLibraryId, setPendingTerminologyLibraryId] =
    useState<string | null>(null);
  const terminologyFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let disposed = false;
    if (!window.shaleAPI) {
      setProviderError('当前预览未连接 Electron Main 进程。');
      return () => {
        disposed = true;
      };
    }
    void window.shaleAPI.provider.get().then((result) => {
      if (disposed) return;
      if (result.ok) setProfile(result.data);
      else setProviderError(result.error.message);
    }).catch(() => {
      if (!disposed) setProviderError('无法加载模型服务配置。');
    });
    void window.shaleAPI.expert.list().then((result) => {
      if (disposed) return;
      if (result.ok) setExperts(result.data.experts);
      else setExpertError(result.error.message);
    }).catch(() => {
      if (!disposed) setExpertError('无法加载 AI 专家。');
    });
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

  const updatePreferences = (update: Partial<AiPreferences>): void => {
    onPreferencesChange({ ...preferences, ...update });
  };

  const refreshExperts = async (): Promise<void> => {
    const result = await window.shaleAPI.expert.list();
    if (!result.ok) throw new Error(result.error.message);
    setExperts(result.data.experts);
  };

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

  const previewExpertFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
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

  const recordShortcut = (
    preferenceKey: ShortcutPreferenceKey,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (recordingShortcut !== preferenceKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecordingShortcut(null);
      setShortcutError('');
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) {
      setShortcutError('请同时按下 Ctrl、Alt 或 Meta 与另一个按键。');
      return;
    }
    const conflict = TRANSLATION_SHORTCUTS.find(({ preferenceKey: otherKey }) =>
      otherKey !== preferenceKey
      && areKeyboardShortcutsEqual(preferences[otherKey], shortcut));
    if (conflict) {
      setShortcutError(`该快捷键已分配给“${conflict.label}”。`);
      return;
    }
    updatePreferences({ [preferenceKey]: shortcut });
    setRecordingShortcut(null);
    setShortcutError('');
  };

  return (
    <div className="settings-page">
      <aside className="settings-navigation" aria-label="设置分类">
        <div className="settings-navigation-header">
          <button type="button" className="settings-back-button" onClick={onClose}>
            <span aria-hidden="true">←</span>
            返回阅读
          </button>
          <div>
            <span className="settings-product-name">Shale</span>
            <h1>设置</h1>
          </div>
        </div>
        <nav className="settings-navigation-links">
          <a href="#settings-summary">摘要</a>
          <a href="#settings-translation">翻译</a>
          <a href="#settings-terminology">术语库</a>
          <a href="#settings-experts">AI 专家</a>
          <a href="#settings-shortcuts">快捷键</a>
          <a href="#settings-provider">模型服务</a>
          <a href="#settings-diagnostics">诊断</a>
        </nav>
        <p className="settings-navigation-note">
          阅读偏好会自动保存在本机。
        </p>
      </aside>

      <main className="settings-page-main">
        <header className="settings-page-header">
          <span className="settings-page-kicker">阅读体验</span>
          <h2>设置</h2>
          <p>配置摘要、翻译和模型服务。所有选项均服务于本地阅读流程。</p>
        </header>

        <div className="settings-page-content">
          <section
            id="settings-summary"
            className="settings-section"
            aria-labelledby="summary-settings-title"
          >
            <div className="settings-section-heading">
              <div>
                <h3 id="summary-settings-title" className="settings-section-title">摘要</h3>
                <p>选择摘要的输出语言和信息密度。</p>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-fields settings-fields-two-columns">
                <label>
                  摘要语言
                  <select
                    value={preferences.summaryTargetLanguage}
                    onChange={(event) => updatePreferences({
                      summaryTargetLanguage: event.target.value as SummaryTargetLanguage,
                    })}
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label>
                  详细程度
                  <select
                    value={preferences.summaryDetailLevel}
                    onChange={(event) => updatePreferences({
                      summaryDetailLevel: event.target.value as SummaryDetailLevel,
                    })}
                  >
                    <option value="short">简短</option>
                    <option value="medium">适中</option>
                    <option value="detailed">详细</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section
            id="settings-translation"
            className="settings-section"
            aria-labelledby="translation-settings-title"
          >
            <div className="settings-section-heading">
              <div>
                <h3 id="translation-settings-title" className="settings-section-title">翻译</h3>
                <p>设置翻译方向，并决定是否使用术语和全文智能上下文。</p>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-fields settings-fields-two-columns">
                <label>
                  源语言
                  <select
                    value={preferences.translationSourceLanguage}
                    onChange={(event) => updatePreferences({
                      translationSourceLanguage: event.target.value as TranslationSourceLanguage,
                    })}
                  >
                    <option value="auto">自动检测</option>
                    {TRANSLATION_TARGET_LANGUAGES.map((language) => (
                      <option key={language} value={language}>
                        {SETTINGS_TRANSLATION_LANGUAGE_LABELS[language]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  目标语言
                  <select
                    value={preferences.translationTargetLanguage}
                    onChange={(event) => updatePreferences({
                      translationTargetLanguage: event.target.value as TranslationTargetLanguage,
                    })}
                  >
                    {TRANSLATION_TARGET_LANGUAGES.map((language) => (
                      <option key={language} value={language}>
                        {SETTINGS_TRANSLATION_LANGUAGE_LABELS[language]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="settings-toggle-grid">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={preferences.useTerminology}
                    onChange={(event) => updatePreferences({
                      useTerminology: event.target.checked,
                    })}
                  />
                  <span>
                    <strong>使用术语库</strong>
                    <small>在所有翻译模式中应用本地术语候选。</small>
                  </span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={preferences.useSmartContext}
                    onChange={(event) => updatePreferences({
                      useSmartContext: event.target.checked,
                    })}
                  />
                  <span>
                    <strong>AI 智能上下文</strong>
                    <small>翻译前分析全文、专业术语和文体，会增加一次或多次模型请求。</small>
                  </span>
                </label>
              </div>
            </div>
          </section>

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
              <div className="settings-option-grid settings-terminology-grid">
                {terminologyLibraries.map((library) => {
                  const isPending = pendingTerminologyLibraryId === library.id;
                  const descriptionId = `terminology-description-${library.id}`;
                  return (
                    <article
                      className={[
                        'settings-option-card',
                        library.enabled ? 'is-active' : '',
                        !preferences.useTerminology ? 'is-disabled' : '',
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
                          title={preferences.useTerminology
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
                            disabled={!preferences.useTerminology || isPending}
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
            {terminologyError && (
              <p className="settings-page-error" role="status">
                {terminologyError}
              </p>
            )}
            {terminologyNotice && <p className="settings-page-notice" role="status">{terminologyNotice}</p>}
          </section>

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
              <div className="settings-option-grid settings-expert-grid">
                {experts.map((expert) => {
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

          <section
            id="settings-shortcuts"
            className="settings-section"
            aria-labelledby="shortcut-settings-title"
          >
            <div className="settings-section-heading">
              <div>
                <h3 id="shortcut-settings-title" className="settings-section-title">快捷键</h3>
                <p>点击按键框后录入组合键；按 Esc 可取消录入。</p>
              </div>
            </div>
            <div className="settings-card">
              <div className="translation-shortcut-grid">
                {TRANSLATION_SHORTCUTS.map(({ preferenceKey, label }) => {
                  const isRecording = recordingShortcut === preferenceKey;
                  return (
                    <div className="settings-field" key={preferenceKey}>
                      <span>{label}</span>
                      <button
                        type="button"
                        className={`shortcut-recorder${isRecording ? ' is-recording' : ''}`}
                        aria-pressed={isRecording}
                        onClick={() => {
                          setRecordingShortcut(preferenceKey);
                          setShortcutError('');
                        }}
                        onKeyDown={(event) => recordShortcut(preferenceKey, event)}
                        onBlur={() => {
                          if (recordingShortcut === preferenceKey) setRecordingShortcut(null);
                        }}
                      >
                        {isRecording
                          ? '请按下快捷键…'
                          : formatKeyboardShortcut(preferences[preferenceKey])}
                      </button>
                    </div>
                  );
                })}
              </div>
              {shortcutError && (
                <p className="settings-shortcut-error" role="status">{shortcutError}</p>
              )}
            </div>
          </section>

          <div id="settings-provider" className="settings-section-anchor">
            {providerError && <p className="settings-page-error" role="status">{providerError}</p>}
            <ProviderSettings
              mode="embedded"
              profile={profile}
              onSaved={setProfile}
            />
          </div>

          <div id="settings-diagnostics" className="settings-section-anchor">
            <DiagnosticsSection />
          </div>
        </div>
      </main>
    </div>
  );
};
