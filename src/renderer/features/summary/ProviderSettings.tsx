import { useEffect, useRef, useState } from 'react';
import type { ProviderProfile } from '../../../shared/contracts/provider.types';

interface ProviderSettingsProps {
  profile: ProviderProfile | null;
  onClose: () => void;
  onSaved: (profile: ProviderProfile) => void;
}

export const ProviderSettings = ({
  profile,
  onClose,
  onSaved,
}: ProviderSettingsProps) => {
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? 'https://api.openai.com/v1');
  const [model, setModel] = useState(profile?.model ?? 'gpt-4o-mini');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBaseUrl(profile?.baseUrl ?? 'https://api.openai.com/v1');
    setModel(profile?.model ?? 'gpt-4o-mini');
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
        result.data.keyStorageMode === 'session'
          ? 'Saved for this app session. Enter the key again after restarting the app.'
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

  const testConnection = async () => {
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await save();
  };

  const hasApiKey = profile?.hasApiKey ?? false;
  const usesSessionStorage = profile?.keyStorageMode === 'session';

  return (
    <div className="provider-settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="provider-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="provider-settings-header">
          <div>
            <p className="provider-settings-eyebrow">Summary</p>
            <h2 id="provider-settings-title">AI provider</h2>
          </div>
          <button type="button" className="provider-settings-close" onClick={onClose} aria-label="Close settings">
            ×
          </button>
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
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="gpt-4o-mini"
              required
            />
          </label>
          <label>
            API key {hasApiKey ? <span>(leave empty to keep the current key)</span> : null}
            <input
              ref={apiKeyInputRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              required={!hasApiKey}
            />
          </label>
          <p className="provider-settings-note">
            {usesSessionStorage
              ? 'Secure operating-system key storage is unavailable. The key remains only in this app session and is never written to disk.'
              : 'The key is sent only to the Main process. If system encryption is unavailable, it remains only in this app session and is never written to disk.'}
          </p>
          {status && <p className="provider-settings-status" role="status">{status}</p>}
          <footer className="provider-settings-actions">
            <button type="button" onClick={() => void testConnection()} disabled={saving || !hasApiKey}>
              Test connection
            </button>
            <button type="submit" className="provider-settings-save" disabled={saving}>
              {saving ? 'Saving…' : 'Save provider'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};
