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
  formatKeyboardShortcut,
  shortcutFromKeyboardEvent,
} from './keyboardShortcut';
import { DiagnosticsSection } from './DiagnosticsSection';

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
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  const [shortcutError, setShortcutError] = useState('');

  useEffect(() => {
    let disposed = false;
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

  const recordShortcut = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!isRecordingShortcut) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setIsRecordingShortcut(false);
      setShortcutError('');
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) {
      setShortcutError('Press Ctrl, Alt, or Meta together with another key.');
      return;
    }
    updatePreferences({ inlineTranslationShortcut: shortcut });
    setIsRecordingShortcut(false);
    setShortcutError('');
  };

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <p className="settings-page-eyebrow">Shale</p>
        <h2>Settings</h2>
        <p>AI reading preferences are saved automatically on this device.</p>
      </header>

      <div className="settings-page-content">
        <section className="settings-card" aria-labelledby="summary-settings-title">
          <div className="settings-card-heading">
            <h3 id="summary-settings-title">Summary</h3>
            <p>Defaults used by the Summary button in the Reader.</p>
          </div>
          <div className="settings-fields settings-fields-two-column">
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
        </section>

        <section className="settings-card" aria-labelledby="translation-settings-title">
          <div className="settings-card-heading">
            <h3 id="translation-settings-title">Translation</h3>
            <p>Default language used by the Translate button in the Reader.</p>
          </div>
          <div className="settings-fields settings-fields-two-column">
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
            <div className="settings-field">
              <span>Inline shortcut</span>
              <button
                type="button"
                className={`shortcut-recorder${isRecordingShortcut ? ' is-recording' : ''}`}
                aria-pressed={isRecordingShortcut}
                onClick={() => {
                  setIsRecordingShortcut(true);
                  setShortcutError('');
                }}
                onKeyDown={recordShortcut}
                onBlur={() => setIsRecordingShortcut(false)}
              >
                {isRecordingShortcut
                  ? 'Press shortcut…'
                  : formatKeyboardShortcut(preferences.inlineTranslationShortcut)}
              </button>
            </div>
          </div>
          <p className="settings-inline-help">
            Select text and press {formatKeyboardShortcut(preferences.inlineTranslationShortcut)}
            {' '}to translate it. Without a selection, hover over a paragraph and press the
            same shortcut. Click the shortcut field to record a different combination.
          </p>
          {shortcutError && <p className="settings-shortcut-error" role="status">{shortcutError}</p>}
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
