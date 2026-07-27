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
  const initialSummaryKind = profile?.providerKind ?? DEFAULT_PROVIDER_KIND;
  const initialSummaryPreset = getProviderPreset(initialSummaryKind);
  const initialTranslationKind = profile?.translationProviderKind ?? initialSummaryKind;
  const initialTranslationPreset = getProviderPreset(initialTranslationKind);
  const [summaryProviderKind, setSummaryProviderKind] =
    useState<ProviderKind>(initialSummaryKind);
  const [summaryBaseUrl, setSummaryBaseUrl] = useState(
    profile?.baseUrl ?? initialSummaryPreset.defaultBaseUrl,
  );
  const [summaryModel, setSummaryModel] = useState(
    profile?.summaryModel ?? initialSummaryPreset.defaultModel,
  );
  const [translationProviderKind, setTranslationProviderKind] =
    useState<ProviderKind>(initialTranslationKind);
  const [translationBaseUrl, setTranslationBaseUrl] = useState(
    profile?.translationBaseUrl ?? initialTranslationPreset.defaultBaseUrl,
  );
  const [translationModel, setTranslationModel] = useState(
    profile?.translationModel ?? initialTranslationPreset.defaultModel,
  );
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [saving, setSaving] = useState(false);
  const summaryApiKeyInputRef = useRef<HTMLInputElement>(null);
  const translationApiKeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const nextSummaryKind = profile?.providerKind ?? DEFAULT_PROVIDER_KIND;
    const nextSummaryPreset = getProviderPreset(nextSummaryKind);
    const nextTranslationKind = profile?.translationProviderKind ?? nextSummaryKind;
    const nextTranslationPreset = getProviderPreset(nextTranslationKind);
    setSummaryProviderKind(nextSummaryKind);
    setSummaryBaseUrl(profile?.baseUrl ?? nextSummaryPreset.defaultBaseUrl);
    setSummaryModel(profile?.summaryModel ?? nextSummaryPreset.defaultModel);
    setTranslationProviderKind(nextTranslationKind);
    setTranslationBaseUrl(
      profile?.translationBaseUrl ?? nextTranslationPreset.defaultBaseUrl,
    );
    setTranslationModel(profile?.translationModel ?? nextTranslationPreset.defaultModel);
  }, [profile]);

  const save = async (): Promise<ProviderProfile | null> => {
    setSaving(true);
    setStatus('');
    setStatusTone('neutral');
    const summaryApiKey = summaryApiKeyInputRef.current?.value.trim();
    const translationApiKey = translationApiKeyInputRef.current?.value.trim();
    try {
      const result = await window.shaleAPI.provider.save({
        summary: {
          providerKind: summaryProviderKind,
          baseUrl: summaryBaseUrl,
          model: summaryModel,
          ...(summaryApiKey ? { apiKey: summaryApiKey } : {}),
        },
        translation: {
          providerKind: translationProviderKind,
          baseUrl: translationBaseUrl,
          model: translationModel,
          ...(translationApiKey ? { apiKey: translationApiKey } : {}),
        },
      });
      if (!result.ok) {
        setStatus(result.error.message);
        setStatusTone('error');
        return null;
      }
      if (summaryApiKeyInputRef.current) summaryApiKeyInputRef.current.value = '';
      if (translationApiKeyInputRef.current) translationApiKeyInputRef.current.value = '';
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

  const hasSummaryApiKey = profile?.hasSummaryApiKey ?? profile?.hasApiKey ?? false;
  const hasTranslationApiKey =
    profile?.hasTranslationApiKey ?? profile?.hasApiKey ?? false;
  const summaryProviderChanged = Boolean(
    profile && profile.providerKind !== summaryProviderKind,
  );
  const summaryEndpointChanged = Boolean(
    profile && safeUrlOrigin(profile.baseUrl) !== safeUrlOrigin(summaryBaseUrl),
  );
  const translationProviderChanged = Boolean(
    profile && profile.translationProviderKind !== translationProviderKind,
  );
  const translationEndpointChanged = Boolean(
    profile
    && safeUrlOrigin(profile.translationBaseUrl) !== safeUrlOrigin(translationBaseUrl),
  );
  const hasUnsavedProfileChanges = Boolean(
    !profile
    || summaryProviderChanged
    || profile.baseUrl !== summaryBaseUrl
    || profile.summaryModel !== summaryModel
    || translationProviderChanged
    || profile.translationBaseUrl !== translationBaseUrl
    || profile.translationModel !== translationModel,
  );
  const routesShareCredentialScope = summaryProviderKind === translationProviderKind
    && safeUrlOrigin(summaryBaseUrl) === safeUrlOrigin(translationBaseUrl);
  const summaryCredentialAvailable =
    hasSummaryApiKey && !summaryProviderChanged && !summaryEndpointChanged;
  const translationCredentialAvailable =
    hasTranslationApiKey && !translationProviderChanged && !translationEndpointChanged;
  const summaryNeedsApiKey = !summaryCredentialAvailable;
  const translationNeedsApiKey = !translationCredentialAvailable;
  const requiresSummaryApiKey =
    summaryNeedsApiKey && !(routesShareCredentialScope && translationCredentialAvailable);
  const requiresTranslationApiKey =
    translationNeedsApiKey
    && !(routesShareCredentialScope && (summaryCredentialAvailable || requiresSummaryApiKey));
  const usesInsecureStorage = profile?.keyStorageMode === 'insecure';

  const handleApiKeyPaste = (event: React.ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    replaceApiKeyInputValue(
      event.currentTarget,
      event.clipboardData.getData('text/plain'),
    );
  };

  const titleId = `provider-settings-title-${mode}`;
  const summaryModelSuggestionsId = `provider-summary-model-suggestions-${mode}`;
  const translationModelSuggestionsId = `provider-translation-model-suggestions-${mode}`;
  const selectedSummaryPreset = getProviderPreset(summaryProviderKind);
  const selectedTranslationPreset = getProviderPreset(translationProviderKind);
  const providerHeader = (
    <header className="provider-settings-header">
      <div>
        <h2 id={titleId}>模型服务</h2>
        {mode === 'embedded' && (
          <p className="provider-settings-description">
            为总结和翻译分别配置 Provider、模型与 API Key。
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
      <fieldset className="provider-route-settings">
        <legend>总结</legend>
        <label>
          Provider 类型
          <select
            value={summaryProviderKind}
            onChange={(event) => {
              const kind = event.target.value as ProviderKind;
              const preset = getProviderPreset(kind);
              setSummaryProviderKind(kind);
              setSummaryBaseUrl(preset.defaultBaseUrl);
              setSummaryModel(preset.defaultModel);
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
            value={summaryBaseUrl}
            onChange={(event) => setSummaryBaseUrl(event.target.value)}
            placeholder={selectedSummaryPreset.defaultBaseUrl}
            inputMode="url"
            required
          />
        </label>
        <label>
          总结模型
          <input
            value={summaryModel}
            onChange={(event) => setSummaryModel(event.target.value)}
            list={summaryModelSuggestionsId}
            placeholder={selectedSummaryPreset.defaultModel}
            spellCheck={false}
            required
          />
          <datalist id={summaryModelSuggestionsId}>
            {selectedSummaryPreset.suggestedModels.map((suggestedModel) => (
              <option key={suggestedModel} value={suggestedModel} />
            ))}
          </datalist>
        </label>
        <label>
          API Key
          <input
            ref={summaryApiKeyInputRef}
            type="password"
            name="summary-provider-api-key"
            placeholder={requiresSummaryApiKey ? '输入总结 Provider API Key' : SAVED_API_KEY_MASK}
            autoComplete="new-password"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            onPaste={handleApiKeyPaste}
            required={requiresSummaryApiKey}
          />
        </label>
      </fieldset>
      <fieldset className="provider-route-settings">
        <legend>翻译</legend>
        <label>
          Provider 类型
          <select
            value={translationProviderKind}
            onChange={(event) => {
              const kind = event.target.value as ProviderKind;
              const preset = getProviderPreset(kind);
              setTranslationProviderKind(kind);
              setTranslationBaseUrl(preset.defaultBaseUrl);
              setTranslationModel(preset.defaultModel);
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
            value={translationBaseUrl}
            onChange={(event) => setTranslationBaseUrl(event.target.value)}
            placeholder={selectedTranslationPreset.defaultBaseUrl}
            inputMode="url"
            required
          />
        </label>
        <label>
          翻译模型
          <input
            value={translationModel}
            onChange={(event) => setTranslationModel(event.target.value)}
            list={translationModelSuggestionsId}
            placeholder={selectedTranslationPreset.defaultModel}
            spellCheck={false}
            required
          />
          <datalist id={translationModelSuggestionsId}>
            {selectedTranslationPreset.suggestedModels.map((suggestedModel) => (
              <option key={suggestedModel} value={suggestedModel} />
            ))}
          </datalist>
        </label>
        <label>
          API Key
          <input
            ref={translationApiKeyInputRef}
            type="password"
            name="translation-provider-api-key"
            placeholder={
              requiresTranslationApiKey ? '输入翻译 Provider API Key' : SAVED_API_KEY_MASK
            }
            autoComplete="new-password"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            onPaste={handleApiKeyPaste}
            required={requiresTranslationApiKey}
          />
        </label>
      </fieldset>
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
            disabled={
              saving
              || !hasSummaryApiKey
              || !hasTranslationApiKey
              || hasUnsavedProfileChanges
            }
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
