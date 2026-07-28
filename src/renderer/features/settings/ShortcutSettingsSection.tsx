import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
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
  { preferenceKey: 'fullTranslationShortcut', label: '翻译全文' },
  { preferenceKey: 'paragraphTranslationShortcut', label: '翻译段落' },
  { preferenceKey: 'selectionTranslationShortcut', label: '翻译选中内容' },
];

interface ShortcutSettingsSectionProps {
  preferences: AiPreferences;
  onPreferencesChange: (preferences: AiPreferences) => void;
}

export const ShortcutSettingsSection = ({
  preferences,
  onPreferencesChange,
}: ShortcutSettingsSectionProps) => {
  const [recordingShortcut, setRecordingShortcut] =
    useState<ShortcutPreferenceKey | null>(null);
  const [shortcutError, setShortcutError] = useState('');

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
    onPreferencesChange({ ...preferences, [preferenceKey]: shortcut });
    setRecordingShortcut(null);
    setShortcutError('');
  };

  return (
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
  );
};
