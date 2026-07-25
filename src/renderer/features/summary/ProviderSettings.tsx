import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PROVIDER_KIND,
  getProviderPreset,
  PROVIDER_PRESETS,
  type ProviderKind,
  type ProviderProfile,
} from '../../../shared/contracts/provider.types';

interface ProviderSettingsProps {
  profile: ProviderProfile | null;
  onSaved: (profile: ProviderProfile) => void;
  mode?: 'dialog' | 'embedded';
  onClose?: () => void;
}

export const SAVED_API_KEY_MASK = '••••••••••••••••';

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
  const initialKind = profile?.providerKind ?? DEFAULT_PROVIDER_KIND;
  const initialPreset = getProviderPreset(initialKind);
  const [providerKind, setProviderKind] = useState<ProviderKind>(initialKind);
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? initialPreset.defaultBaseUrl);
  const [model, setModel] = useState(profile?.model ?? initialPreset.defaultModel);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [saving, setSaving] = useState(false);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const kind = profile?.providerKind ?? DEFAULT_PROVIDER_KIND;
    const preset = getProviderPreset(kind);
    setProviderKind(kind);
    setBaseUrl(profile?.baseUrl ?? preset.defaultBaseUrl);
    setModel(profile?.model ?? preset.defaultModel);
  }, [profile]);

  const save = async (): Promise<ProviderProfile | null> => {
    setSaving(true);
    setStatus('');
    setStatusTone('neutral');
    const apiKey = apiKeyInputRef.current?.value.trim();
    try {
      const result = await window.shaleAPI.provider.save({
        providerKind,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
      if (!result.ok) {
        setStatus(result.error.message);
        setStatusTone('error');
        return null;
      }
      if (apiKeyInputRef.current) apiKeyInputRef.current.value = '';
      onSaved(result.data);
      setStatus(
        result.data.keyStorageMode === 'insecure'
          ? '已在本机无加密保存。任何能访问这台电脑的人都可能使用此 API Key。'
          : '已安全保存。',
      );
      return result.data;
    } catch {
      setStatus('无法保存模型服务配置。');
      setStatusTone('error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (): Promise<void> => {
    setSaving(true);
    setStatus('');
    setStatusTone('neutral');
    try {
      const result = await window.shaleAPI.provider.test();
      setStatus(result.ok ? result.data.message : result.error.message);
      setStatusTone(result.ok ? 'success' : 'error');
    } catch {
      setStatus('无法测试模型服务连接。');
      setStatusTone('error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await save();
  };

  const hasApiKey = profile?.hasApiKey ?? false;
  const providerChanged = Boolean(profile && profile.providerKind !== providerKind);
  const endpointChanged = Boolean(
    profile && safeUrlOrigin(profile.baseUrl) !== safeUrlOrigin(baseUrl),
  );
  const hasUnsavedProfileChanges = Boolean(
    !profile
    || providerChanged
    || profile.baseUrl !== baseUrl
    || profile.model !== model,
  );
  const requiresApiKey = !hasApiKey || providerChanged || endpointChanged;
  const usesInsecureStorage = profile?.keyStorageMode === 'insecure';

  const handleApiKeyPaste = (event: React.ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    replaceApiKeyInputValue(
      event.currentTarget,
      event.clipboardData.getData('text/plain'),
    );
  };

  const titleId = `provider-settings-title-${mode}`;
  const modelSuggestionsId = `provider-model-suggestions-${mode}`;
  const selectedPreset = getProviderPreset(providerKind);
  const providerHeader = (
    <header className="provider-settings-header">
      <div>
        <h2 id={titleId}>模型服务</h2>
        {mode === 'embedded' && (
          <p className="provider-settings-description">
            配置生成摘要和翻译所使用的 Provider、模型与 API Key。
          </p>
        )}
      </div>
      {mode === 'dialog' && (
        <button
          type="button"
          className="provider-settings-close"
          onClick={onClose}
          aria-label="关闭设置"
        >
          ×
        </button>
      )}
    </header>
  );
  const providerForm = (
    <form onSubmit={handleSubmit}>
        <label>
          Provider 类型
          <select
            value={providerKind}
            onChange={(event) => {
              const kind = event.target.value as ProviderKind;
              const preset = getProviderPreset(kind);
              setProviderKind(kind);
              setBaseUrl(preset.defaultBaseUrl);
              setModel(preset.defaultModel);
              setStatus('');
              setStatusTone('neutral');
            }}
            required
          >
            {PROVIDER_PRESETS.map((preset) => (
              <option key={preset.kind} value={preset.kind}>{preset.label}</option>
            ))}
          </select>
        </label>
        <label>
          Provider 基础 URL
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={selectedPreset.defaultBaseUrl}
            inputMode="url"
            required
          />
        </label>
        <label>
          模型
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            list={modelSuggestionsId}
            placeholder={selectedPreset.defaultModel}
            spellCheck={false}
            required
          />
          <datalist id={modelSuggestionsId}>
            {selectedPreset.suggestedModels.map((suggestedModel) => (
              <option key={suggestedModel} value={suggestedModel} />
            ))}
          </datalist>
        </label>
        <label>
          API Key
          <input
            ref={apiKeyInputRef}
            type="password"
            name="provider-api-key"
            placeholder={requiresApiKey ? '输入 API Key' : SAVED_API_KEY_MASK}
            autoComplete="new-password"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            onPaste={handleApiKeyPaste}
            required={requiresApiKey}
          />
        </label>
        {usesInsecureStorage && (
          <p className="provider-settings-note">
            操作系统安全密钥存储不可用，API Key 将以未加密方式保存在本地文件中。
          </p>
        )}
        {status && (
          <p
            className={`provider-settings-status is-${statusTone}`}
            role="status"
          >
            {status}
          </p>
        )}
        <footer className="provider-settings-actions">
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={saving || !hasApiKey || hasUnsavedProfileChanges}
          >
            测试连接
          </button>
          <button type="submit" className="provider-settings-save" disabled={saving}>
            {saving ? '正在保存…' : '保存配置'}
          </button>
        </footer>
    </form>
  );

  if (mode === 'embedded') {
    return (
      <section className="settings-section provider-settings-section" aria-labelledby={titleId}>
        {providerHeader}
        <div className="settings-card provider-settings-embedded">
          {providerForm}
        </div>
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
        {providerHeader}
        {providerForm}
      </section>
    </div>
  );
};

function safeUrlOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
