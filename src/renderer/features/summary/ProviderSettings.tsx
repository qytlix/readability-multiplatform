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
  const initialTagKind = profile?.tagProviderKind ?? initialSummaryKind;
  const initialTagPreset = getProviderPreset(initialTagKind);
  const [tagProviderKind, setTagProviderKind] =
    useState<ProviderKind>(initialTagKind);
  const [tagBaseUrl, setTagBaseUrl] = useState(
    profile?.tagBaseUrl ?? initialTagPreset.defaultBaseUrl,
  );
  const [tagModel, setTagModel] = useState(
    profile?.tagModel ?? initialTagPreset.defaultModel,
  );
  const initialChatKind = profile?.chatProviderKind ?? initialSummaryKind;
  const initialChatPreset = getProviderPreset(initialChatKind);
  const [chatProviderKind, setChatProviderKind] =
    useState<ProviderKind>(initialChatKind);
  const [chatBaseUrl, setChatBaseUrl] = useState(
    profile?.chatBaseUrl ?? initialChatPreset.defaultBaseUrl,
  );
  const [chatModel, setChatModel] = useState(
    profile?.chatModel ?? initialChatPreset.defaultModel,
  );
  const [chatSupportsImages, setChatSupportsImages] = useState(
    profile?.chatSupportsImages ?? false,
  );
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [saving, setSaving] = useState(false);
  const summaryApiKeyInputRef = useRef<HTMLInputElement>(null);
  const translationApiKeyInputRef = useRef<HTMLInputElement>(null);
  const tagApiKeyInputRef = useRef<HTMLInputElement>(null);
  const chatApiKeyInputRef = useRef<HTMLInputElement>(null);

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
    const nextTagKind = profile?.tagProviderKind ?? nextSummaryKind;
    const nextTagPreset = getProviderPreset(nextTagKind);
    setTagProviderKind(nextTagKind);
    setTagBaseUrl(profile?.tagBaseUrl ?? nextTagPreset.defaultBaseUrl);
    setTagModel(profile?.tagModel ?? nextTagPreset.defaultModel);
    const nextChatKind = profile?.chatProviderKind ?? nextSummaryKind;
    const nextChatPreset = getProviderPreset(nextChatKind);
    setChatProviderKind(nextChatKind);
    setChatBaseUrl(profile?.chatBaseUrl ?? nextChatPreset.defaultBaseUrl);
    setChatModel(profile?.chatModel ?? nextChatPreset.defaultModel);
    setChatSupportsImages(profile?.chatSupportsImages ?? false);
  }, [profile]);

  const save = async (): Promise<ProviderProfile | null> => {
    setSaving(true);
    setStatus('');
    setStatusTone('neutral');
    const summaryApiKey = summaryApiKeyInputRef.current?.value.trim();
    const translationApiKey = translationApiKeyInputRef.current?.value.trim();
    const tagApiKey = tagApiKeyInputRef.current?.value.trim();
    const chatApiKey = chatApiKeyInputRef.current?.value.trim();
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
        tag: {
          providerKind: tagProviderKind,
          baseUrl: tagBaseUrl,
          model: tagModel,
          ...(tagApiKey ? { apiKey: tagApiKey } : {}),
        },
        chat: {
          providerKind: chatProviderKind,
          baseUrl: chatBaseUrl,
          model: chatModel,
          supportsImages: chatSupportsImages,
          ...(chatApiKey ? { apiKey: chatApiKey } : {}),
        },
      });
      if (!result.ok) {
        setStatus(result.error.message);
        setStatusTone('error');
        return null;
      }
      if (summaryApiKeyInputRef.current) summaryApiKeyInputRef.current.value = '';
      if (translationApiKeyInputRef.current) translationApiKeyInputRef.current.value = '';
      if (tagApiKeyInputRef.current) tagApiKeyInputRef.current.value = '';
      if (chatApiKeyInputRef.current) chatApiKeyInputRef.current.value = '';
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

  const testChatConnection = async (): Promise<void> => {
    setSaving(true);
    setStatus('');
    setStatusTone('neutral');
    try {
      const result = await window.shaleAPI.provider.testChat();
      setStatus(result.ok ? result.data.message : result.error.message);
      setStatusTone(result.ok ? 'success' : 'error');
    } catch {
      setStatus('无法测试 AI 问答模型连接。');
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
  const hasTagApiKey = profile?.hasTagApiKey ?? false;
  const hasChatApiKey = profile?.hasChatApiKey ?? profile?.hasSummaryApiKey ?? false;
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
  const tagProviderChanged = Boolean(
    profile && profile.tagProviderKind !== tagProviderKind,
  );
  const tagEndpointChanged = Boolean(
    profile && safeUrlOrigin(profile.tagBaseUrl) !== safeUrlOrigin(tagBaseUrl),
  );
  const chatProviderChanged = Boolean(
    profile && profile.chatProviderKind !== chatProviderKind,
  );
  const chatEndpointChanged = Boolean(
    profile && safeUrlOrigin(profile.chatBaseUrl) !== safeUrlOrigin(chatBaseUrl),
  );
  const hasUnsavedProfileChanges = Boolean(
    !profile
    || summaryProviderChanged
    || profile.baseUrl !== summaryBaseUrl
    || profile.summaryModel !== summaryModel
    || translationProviderChanged
    || profile.translationBaseUrl !== translationBaseUrl
    || profile.translationModel !== translationModel
    || tagProviderChanged
    || profile.tagBaseUrl !== tagBaseUrl
    || profile.tagModel !== tagModel
    || chatProviderChanged
    || profile.chatBaseUrl !== chatBaseUrl
    || profile.chatModel !== chatModel
    || profile.chatSupportsImages !== chatSupportsImages,
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
  const tagCredentialAvailable =
    hasTagApiKey && !tagProviderChanged && !tagEndpointChanged;
  const tagNeedsApiKey = !tagCredentialAvailable;
  const chatCredentialAvailable =
    hasChatApiKey && !chatProviderChanged && !chatEndpointChanged;
  const chatSharesSummaryCredentialScope = chatProviderKind === summaryProviderKind
    && safeUrlOrigin(chatBaseUrl) === safeUrlOrigin(summaryBaseUrl);
  const chatSharesTranslationCredentialScope =
    chatProviderKind === translationProviderKind
    && safeUrlOrigin(chatBaseUrl) === safeUrlOrigin(translationBaseUrl);
  const requiresChatApiKey = !chatCredentialAvailable
    && !(chatSharesSummaryCredentialScope && (summaryCredentialAvailable || requiresSummaryApiKey))
    && !(
      chatSharesTranslationCredentialScope
      && (translationCredentialAvailable || requiresTranslationApiKey)
    );
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
  const tagModelSuggestionsId = `provider-tag-model-suggestions-${mode}`;
  const chatModelSuggestionsId = `provider-chat-model-suggestions-${mode}`;
  const selectedSummaryPreset = getProviderPreset(summaryProviderKind);
  const selectedTranslationPreset = getProviderPreset(translationProviderKind);
  const selectedTagPreset = getProviderPreset(tagProviderKind);
  const selectedChatPreset = getProviderPreset(chatProviderKind);
  const providerHeader = (
    <header className="provider-settings-header">
      <div>
        <h2 id={titleId}>模型服务</h2>
        {mode === 'embedded' && (
          <p className="provider-settings-description">
            为总结、翻译、标签生成和 AI 问答分别配置 Provider、模型与 API Key。
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
        <legend>AI 问答</legend>
        <label>
          Provider 类型
          <select
            value={chatProviderKind}
            onChange={(event) => {
              const kind = event.target.value as ProviderKind;
              const preset = getProviderPreset(kind);
              setChatProviderKind(kind);
              setChatBaseUrl(preset.defaultBaseUrl);
              setChatModel(preset.defaultModel);
              setChatSupportsImages(false);
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
            value={chatBaseUrl}
            onChange={(event) => setChatBaseUrl(event.target.value)}
            placeholder={selectedChatPreset.defaultBaseUrl}
            inputMode="url"
            required
          />
        </label>
        <label>
          问答模型
          <input
            value={chatModel}
            onChange={(event) => setChatModel(event.target.value)}
            list={chatModelSuggestionsId}
            placeholder={selectedChatPreset.defaultModel}
            spellCheck={false}
            required
          />
          <datalist id={chatModelSuggestionsId}>
            {selectedChatPreset.suggestedModels.map((suggestedModel) => (
              <option key={suggestedModel} value={suggestedModel} />
            ))}
          </datalist>
        </label>
        <label>
          API Key
          <input
            ref={chatApiKeyInputRef}
            type="password"
            name="chat-provider-api-key"
            placeholder={requiresChatApiKey ? '输入 AI 问答 Provider API Key' : SAVED_API_KEY_MASK}
            autoComplete="new-password"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            onPaste={handleApiKeyPaste}
            required={requiresChatApiKey}
          />
        </label>
        <label className="provider-capability-option">
          <input
            type="checkbox"
            checked={chatSupportsImages}
            onChange={(event) => setChatSupportsImages(event.target.checked)}
          />
          该模型支持图片输入
        </label>
        <p className="provider-settings-note">
          图片能力不会根据模型名称自动判断。关闭时仍可进行纯文本问答。
        </p>
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
      <fieldset className="provider-route-settings">
        <legend>标签生成</legend>
        <label>
          Provider 类型
          <select
            value={tagProviderKind}
            onChange={(event) => {
              const kind = event.target.value as ProviderKind;
              const preset = getProviderPreset(kind);
              setTagProviderKind(kind);
              setTagBaseUrl(preset.defaultBaseUrl);
              setTagModel(preset.defaultModel);
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
            value={tagBaseUrl}
            onChange={(event) => setTagBaseUrl(event.target.value)}
            placeholder={selectedTagPreset.defaultBaseUrl}
            inputMode="url"
            required
          />
        </label>
        <label>
          标签模型
          <input
            value={tagModel}
            onChange={(event) => setTagModel(event.target.value)}
            list={tagModelSuggestionsId}
            placeholder={selectedTagPreset.defaultModel}
            spellCheck={false}
            required
          />
          <datalist id={tagModelSuggestionsId}>
            {selectedTagPreset.suggestedModels.map((suggestedModel) => (
              <option key={suggestedModel} value={suggestedModel} />
            ))}
          </datalist>
        </label>
        <label>
          API Key
          <input
            ref={tagApiKeyInputRef}
            type="password"
            name="tag-provider-api-key"
            placeholder={tagNeedsApiKey ? '输入标签生成 Provider API Key' : SAVED_API_KEY_MASK}
            autoComplete="new-password"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            onPaste={handleApiKeyPaste}
            required={tagNeedsApiKey}
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
            onClick={() => void testChatConnection()}
            disabled={saving || !hasChatApiKey || hasUnsavedProfileChanges}
          >
            测试问答连接
          </button>
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={
              saving
              || !hasSummaryApiKey
              || !hasTranslationApiKey
              || !hasTagApiKey
              || !hasChatApiKey
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
