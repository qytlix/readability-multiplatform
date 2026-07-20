import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_GPT_SUMMARY_MODEL,
  GPT_SUMMARY_MODEL_OPTIONS,
  isGptSummaryModel,
  type GptSummaryModel,
  type ProviderProfile,
} from '../../../shared/contracts/provider.types';

interface ProviderSettingsProps {
  profile: ProviderProfile | null;
  onSaved: (profile: ProviderProfile) => void;
  mode?: 'dialog' | 'embedded';
  onClose?: () => void;
}

/**
 * API keys can legitimately end in digits, so do not attempt to strip a
 * numeric suffix. Replacing the complete field on paste prevents a previous
 * value (or an autofill artifact) from being silently kept after the key.
 */
export function replaceApiKeyInputValue(
  input: Pick<HTMLInputElement, 'value'>,
  clipboardText: string,
): void {
  input.value = clipboardText.trim();
}

export const ProviderSettings = ({
  profile,
  onSaved,
  mode = 'dialog',
  onClose,
}: ProviderSettingsProps) => {
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? 'https://api.openai.com/v1');
  const [model, setModel] = useState<GptSummaryModel>(toSelectableModel(profile?.model));
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBaseUrl(profile?.baseUrl ?? 'https://api.openai.com/v1');
    setModel(toSelectableModel(profile?.model));
  }, [profile]);

  const save = async (): Promise<ProviderProfile | null> => {
    setSaving(true);
    setStatus('');
    const apiKey = apiKeyInputRef.current?.value.trim();
    try {
      const result = await window.shaleAPI.provider.save({
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
      if (!result.ok) {
        setStatus(result.error.message);
        return null;
      }
      if (apiKeyInputRef.current) apiKeyInputRef.current.value = '';
      onSaved(result.data);
      setStatus(
        result.data.keyStorageMode === 'insecure'
          ? 'Saved locally without encryption. Anyone with access to this computer can use this API key.'
          : 'Saved securely.',
      );
      return result.data;
    } catch {
      setStatus('Unable to save the provider configuration.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (): Promise<void> => {
    setSaving(true);
    setStatus('');
    try {
      const result = await window.shaleAPI.provider.test();
      setStatus(result.ok ? result.data.message : result.error.message);
    } catch {
      setStatus('Unable to test the provider connection.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await save();
  };

  const hasApiKey = profile?.hasApiKey ?? false;
  const usesInsecureStorage = profile?.keyStorageMode === 'insecure';

  const handleApiKeyPaste = (event: React.ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    replaceApiKeyInputValue(
      event.currentTarget,
      event.clipboardData.getData('text/plain'),
    );
  };

  const titleId = `provider-settings-title-${mode}`;
  const content = (
    <>
      <header className="provider-settings-header">
        <div>
          <p className="provider-settings-eyebrow">AI configuration</p>
          <h2 id={titleId}>Provider</h2>
        </div>
        {mode === 'dialog' && (
          <button
            type="button"
            className="provider-settings-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        )}
      </header>
      <form onSubmit={handleSubmit}>
        <label>
          Provider base URL
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
            inputMode="url"
            required
          />
        </label>
        <label>
          Model
          <select
            value={model}
            onChange={(event) => setModel(event.target.value as GptSummaryModel)}
            required
          >
            {GPT_SUMMARY_MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          API key {hasApiKey ? <span>(leave empty to keep the current key)</span> : null}
          <input
            ref={apiKeyInputRef}
            type="password"
            name="provider-api-key"
            autoComplete="new-password"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            onPaste={handleApiKeyPaste}
            required={!hasApiKey}
          />
        </label>
        <p className="provider-settings-note">
          {usesInsecureStorage
            ? 'Secure operating-system key storage is unavailable. The API key is kept in a local file without encryption.'
            : 'The key is sent only to the Main process and stored using operating-system encryption when available.'}
        </p>
        {status && <p className="provider-settings-status" role="status">{status}</p>}
        <footer className="provider-settings-actions">
          <button type="button" onClick={() => void testConnection()} disabled={saving || !hasApiKey}>
            Test connection
          </button>
          <button type="submit" className="provider-settings-save" disabled={saving}>
            {saving ? 'Saving...' : 'Save provider'}
          </button>
        </footer>
      </form>
    </>
  );

  if (mode === 'embedded') {
    return (
      <section className="settings-card provider-settings-embedded" aria-labelledby={titleId}>
        {content}
      </section>
    );
  }

  return (
    <div className="provider-settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="provider-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {content}
      </section>
    </div>
  );
};

function toSelectableModel(model: string | undefined): GptSummaryModel {
  return model && isGptSummaryModel(model) ? model : DEFAULT_GPT_SUMMARY_MODEL;
}
