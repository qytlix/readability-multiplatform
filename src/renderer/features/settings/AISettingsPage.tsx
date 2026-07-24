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
  TRANSLATION_LANGUAGE_LABELS,
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
  { preferenceKey: 'fullTranslationShortcut', label: 'Translate full article' },
  { preferenceKey: 'paragraphTranslationShortcut', label: 'Translate paragraph' },
  { preferenceKey: 'selectionTranslationShortcut', label: 'Translate selection' },
];

interface AISettingsPageProps {
  preferences: AiPreferences;
  onPreferencesChange: (preferences: AiPreferences) => void;
}

export const AISettingsPage = ({
  preferences,
  onPreferencesChange,
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
      if (!disposed) setProviderError('Unable to load the provider configuration.');
    });
    void window.shaleAPI.expert.list().then((result) => {
      if (disposed) return;
      if (result.ok) setExperts(result.data.experts);
      else setExpertError(result.error.message);
    }).catch(() => {
      if (!disposed) setExpertError('Unable to load AI experts.');
    });
    void window.shaleAPI.terminology.list().then((result) => {
      if (disposed) return;
      if (result.ok) setTerminologyLibraries(result.data.libraries);
      else setTerminologyError(result.error.message);
    }).catch(() => {
      if (!disposed) setTerminologyError('Unable to load terminology libraries.');
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
        `${enabled ? 'Enabled' : 'Disabled'} “${library.name}”.`,
      );
    } catch {
      setTerminologyError('Unable to update the terminology library.');
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
      setTerminologyError('Unable to read or validate the terminology CSV.');
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
        `Imported terminology library “${terminologyPreview.name}”.`,
      );
      setTerminologyName('');
      setTerminologyCsv('');
      setTerminologyPreview(null);
      setShowTerminologyCreator(false);
    } catch {
      setTerminologyError('Unable to import the terminology library.');
    }
  };

  const removeTerminologyLibrary = async (
    library: TerminologyLibrary,
  ): Promise<void> => {
    if (library.origin !== 'user') return;
    if (!window.confirm(`Delete user terminology library “${library.name}”?`)) return;
    setTerminologyError('');
    try {
      const result = await window.shaleAPI.terminology.remove({ id: library.id });
      if (!result.ok) {
        setTerminologyError(result.error.message);
        return;
      }
      await refreshTerminologyLibraries();
      setTerminologyNotice(`Deleted terminology library “${library.name}”.`);
    } catch {
      setTerminologyError('Unable to delete the terminology library.');
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
      setExpertError('Unable to read or validate the AI expert file.');
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
      setExpertNotice(`Imported AI expert “${expertPreview.expert.name}”.`);
      setExpertPreview(null);
      setExpertYaml('');
      setShowExpertCreator(false);
    } catch {
      setExpertError('Unable to import the AI expert.');
    }
  };

  const removeExpert = async (expert: TranslationExpert): Promise<void> => {
    if (expert.origin !== 'user') return;
    if (!window.confirm(`Delete user AI expert “${expert.name}”?`)) return;
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
      setExpertNotice(`Deleted AI expert “${expert.name}”.`);
    } catch {
      setExpertError('Unable to delete the AI expert.');
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
      setShortcutError('Press Ctrl, Alt, or Meta together with another key.');
      return;
    }
    const conflict = TRANSLATION_SHORTCUTS.find(({ preferenceKey: otherKey }) =>
      otherKey !== preferenceKey
      && areKeyboardShortcutsEqual(preferences[otherKey], shortcut));
    if (conflict) {
      setShortcutError(`This shortcut is already assigned to “${conflict.label}”.`);
      return;
    }
    updatePreferences({ [preferenceKey]: shortcut });
    setRecordingShortcut(null);
    setShortcutError('');
  };

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h2>Settings</h2>
      </header>

      <div className="settings-page-content">
        <section className="settings-section" aria-labelledby="summary-settings-title">
          <h3 id="summary-settings-title" className="settings-section-title">Summary</h3>
          <div className="settings-card">
            <div className="settings-fields">
              <label>
                Language
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
                Detail
                <select
                  value={preferences.summaryDetailLevel}
                  onChange={(event) => updatePreferences({
                    summaryDetailLevel: event.target.value as SummaryDetailLevel,
                  })}
                >
                  <option value="short">Brief</option>
                  <option value="medium">Medium</option>
                  <option value="detailed">Detailed</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="translation-settings-title">
          <h3 id="translation-settings-title" className="settings-section-title">Translation</h3>
          <div className="settings-card">
            <div className="settings-fields">
              <label>
                Source language
                <select
                  value={preferences.translationSourceLanguage}
                  onChange={(event) => updatePreferences({
                    translationSourceLanguage: event.target.value as TranslationSourceLanguage,
                  })}
                >
                  <option value="auto">Detect automatically</option>
                  {TRANSLATION_TARGET_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {TRANSLATION_LANGUAGE_LABELS[language]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target language
                <select
                  value={preferences.translationTargetLanguage}
                  onChange={(event) => updatePreferences({
                    translationTargetLanguage: event.target.value as TranslationTargetLanguage,
                  })}
                >
                  {TRANSLATION_TARGET_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {TRANSLATION_LANGUAGE_LABELS[language]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={preferences.useTerminology}
                  onChange={(event) => updatePreferences({
                    useTerminology: event.target.checked,
                  })}
                />
                <span>
                  <strong>Use terminology library</strong>
                  <small>Apply local terminology candidates to every translation mode.</small>
                </span>
              </label>
              <div className="settings-field">
                <span>Terminology libraries</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowTerminologyCreator((current) => !current);
                    setTerminologyError('');
                    setTerminologyNotice('');
                  }}
                >
                  New terminology library
                </button>
              </div>
              {showTerminologyCreator && (
                <div className="settings-import-help">
                  <h4>Terminology CSV format</h4>
                  <p>
                    Create a UTF-8 CSV whose first row is exactly{' '}
                    <code>source,target,tgt_lng</code>. Empty target preserves the
                    source spelling. Empty <code>tgt_lng</code> applies to every
                    target language. Commas, quotes, and newlines must use RFC 4180
                    quoting.
                  </p>
                  <pre>{[
                    'source,target,tgt_lng',
                    'Large language model,大语言模型,zh-CN',
                    'colour,color,en',
                    'Shale,,',
                    '"term, with comma","译文，含逗号",zh-CN',
                  ].join('\n')}</pre>
                  <label>
                    Library name
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
                    Choose CSV file
                  </button>
                  {terminologyPreview && (
                    <div className="settings-import-preview">
                      <strong>
                        {terminologyPreview.valid
                          ? `${terminologyPreview.name}: ${terminologyPreview.acceptedRowCount} rows`
                          : 'This terminology library cannot be imported'}
                      </strong>
                      {terminologyPreview.errors.map((issue) => (
                        <p
                          key={`error-${issue.line}-${issue.code}-${issue.message}`}
                          className="settings-page-error"
                        >
                          Line {issue.line}: {issue.message}
                        </p>
                      ))}
                      {terminologyPreview.warnings.map((issue) => (
                        <p key={`warning-${issue.line}-${issue.code}-${issue.message}`}>
                          Line {issue.line}: {issue.message}
                        </p>
                      ))}
                      {terminologyPreview.valid && (
                        <button
                          type="button"
                          onClick={() => void importPreviewedTerminology()}
                        >
                          {terminologyPreview.replacesExistingUserLibrary
                            ? 'Confirm and replace library'
                            : 'Import and enable library'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {terminologyLibraries.map((library) => (
                <div className="settings-field" key={library.id}>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={library.enabled}
                      disabled={!preferences.useTerminology}
                      onChange={(event) => void setTerminologyLibraryEnabled(
                        library,
                        event.target.checked,
                      )}
                    />
                    <span>
                      <strong>{library.name}</strong>
                      <small>
                        {library.origin === 'builtin' ? 'Built-in' : 'User'} ·
                        {' '}{library.entryCount.toLocaleString()} entries
                        {library.description ? ` · ${library.description}` : ''}
                      </small>
                      {library.usesTraditionalChineseFallback && (
                        <small>
                          Traditional Chinese entries are Taiwan references, not a
                          native Hong Kong glossary; zh-HK terms take priority.
                        </small>
                      )}
                    </span>
                  </label>
                  {library.removable && (
                    <button
                      type="button"
                      onClick={() => void removeTerminologyLibrary(library)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
              {terminologyError && (
                <p className="settings-page-error" role="status">
                  {terminologyError}
                </p>
              )}
              {terminologyNotice && <p role="status">{terminologyNotice}</p>}
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={preferences.useSmartContext}
                  onChange={(event) => updatePreferences({
                    useSmartContext: event.target.checked,
                  })}
                />
                <span>
                  <strong>AI smart context</strong>
                  <small>
                    Analyze the whole article and professional terms before translating.
                    This uses one or more additional model requests.
                  </small>
                </span>
              </label>
              <label>
                AI expert
                <select
                  value={preferences.translationExpertId}
                  onChange={(event) => updatePreferences({
                    translationExpertId: event.target.value,
                  })}
                >
                  <option value={DEFAULT_TRANSLATION_EXPERT_ID}>No expert</option>
                  <optgroup label="Built-in experts">
                    {experts.filter((expert) => expert.origin === 'builtin').map((expert) => (
                      <option key={expert.id} value={expert.id}>{expert.name}</option>
                    ))}
                  </optgroup>
                  {experts.some((expert) => expert.origin === 'user') && (
                    <optgroup label="My experts">
                      {experts.filter((expert) => expert.origin === 'user').map((expert) => (
                        <option key={expert.id} value={expert.id}>{expert.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              {preferences.translationExpertId !== DEFAULT_TRANSLATION_EXPERT_ID && (() => {
                const selectedExpert = experts.find((expert) =>
                  expert.id === preferences.translationExpertId);
                return selectedExpert ? (
                  <div className="settings-import-preview">
                    <strong>{selectedExpert.name}</strong>
                    <p>{selectedExpert.description || selectedExpert.details}</p>
                    <small>
                      {selectedExpert.origin === 'builtin' ? 'Built-in' : 'User'} ·
                      {' '}v{selectedExpert.version} · {selectedExpert.author}
                    </small>
                    {selectedExpert.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : (
                  <p className="settings-page-error" role="status">
                    The selected AI expert is no longer available. Choose another expert.
                  </p>
                );
              })()}
              <div className="settings-field">
                <span>Custom AI experts</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowExpertCreator((current) => !current);
                    setExpertError('');
                    setExpertNotice('');
                  }}
                >
                  New AI expert
                </button>
              </div>
              {showExpertCreator && (
                <div className="settings-import-help">
                  <h4>AI expert YAML format</h4>
                  <p>
                    Save a UTF-8 <code>.yml</code> or <code>.yaml</code> file with
                    an ID, version, name, and domain/style instruction. The optional
                    variables are <code>{'{{sourceLanguage}}'}</code> and{' '}
                    <code>{'{{targetLanguage}}'}</code>.
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
                    Files are validated locally. Custom YAML tags, aliases, unknown
                    variables, and instructions that replace the output format are rejected
                    or removed before import.
                  </p>
                  <input
                    ref={expertFileRef}
                    type="file"
                    accept=".yml,.yaml,text/yaml,application/yaml"
                    hidden
                    onChange={(event) => void previewExpertFile(event)}
                  />
                  <button type="button" onClick={() => expertFileRef.current?.click()}>
                    Choose YAML file
                  </button>
                  {expertPreview && (
                    <div className="settings-import-preview">
                      <strong>
                        {expertPreview.valid && expertPreview.expert
                          ? `${expertPreview.expert.name} (${expertPreview.expert.id})`
                          : 'This expert cannot be imported'}
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
                            ? 'Confirm and replace user expert'
                            : 'Import expert'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {experts.filter((expert) => expert.origin === 'user').map((expert) => (
                <div className="settings-field" key={`manage-${expert.id}`}>
                  <span>{expert.name}</span>
                  <button type="button" onClick={() => void removeExpert(expert)}>
                    Delete
                  </button>
                </div>
              ))}
              {expertError && <p className="settings-page-error" role="status">{expertError}</p>}
              {expertNotice && <p role="status">{expertNotice}</p>}
            </div>
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
                        ? 'Press shortcut…'
                        : formatKeyboardShortcut(preferences[preferenceKey])}
                    </button>
                  </div>
                );
              })}
            </div>
            {shortcutError && <p className="settings-shortcut-error" role="status">{shortcutError}</p>}
          </div>
        </section>

        <DiagnosticsSection />

        {providerError && <p className="settings-page-error" role="status">{providerError}</p>}
        <ProviderSettings
          mode="embedded"
          profile={profile}
          onSaved={setProfile}
        />
      </div>
    </div>
  );
};
