import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ProviderProfile } from '../../../shared/contracts/provider.types';
import type {
  SummaryDetailLevel,
  SummaryTargetLanguage,
} from '../../../shared/contracts/summary.types';
import type { TranslationTargetLanguage } from '../../../shared/contracts/translation.types';
import { ProviderSettings } from '../summary/ProviderSettings';
import type { AiPreferences } from './aiPreferences';
import {
  areKeyboardShortcutsEqual,
  formatKeyboardShortcut,
  shortcutFromKeyboardEvent,
} from './keyboardShortcut';

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
    return () => {
      disposed = true;
    };
  }, []);

  const updatePreferences = (update: Partial<AiPreferences>): void => {
    onPreferencesChange({ ...preferences, ...update });
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
                Language
                <select
                  value={preferences.translationTargetLanguage}
                  onChange={(event) => updatePreferences({
                    translationTargetLanguage: event.target.value as TranslationTargetLanguage,
                  })}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
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
