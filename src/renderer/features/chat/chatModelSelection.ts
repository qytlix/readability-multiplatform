import {
  getProviderPreset,
  type ProviderChatModel,
  type ProviderProfile,
  type SaveProviderRequest,
} from '../../../shared/contracts/provider.types';

export type ChatModelCatalogStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ChatModelOption {
  value: string;
  label: string;
  description: string;
  current: boolean;
  recommended: boolean;
}

const MODEL_LABELS: Record<string, string> = {
  'gpt-5.6': 'GPT-5.6',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.4-nano': 'GPT-5.4 Nano',
  'gpt-4o-mini': 'GPT-4o Mini',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'openai/gpt-5.4-mini': 'GPT-5.4 Mini',
  'anthropic/claude-sonnet-4.5': 'Claude Sonnet 4.5',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
  'local-model': 'Local Model',
};

export const formatChatModelLabel = (model: string): string => (
  MODEL_LABELS[model]
  ?? model
    .split('/')
    .at(-1)
    ?.replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
  ?? model
);

const describeChatModel = (model: string, custom: boolean): string => {
  if (custom) return '当前设置中的自定义问答模型';

  const normalized = model.toLowerCase();
  if (/(nano|lite|haiku|flash|luna)/.test(normalized)) {
    return '快速响应，适合日常问答';
  }
  if (/(mini|terra|sonnet)/.test(normalized)) {
    return '速度与能力平衡';
  }
  if (/(pro|sol|reason|gpt-5\.6$|gpt-5\.5$|gpt-5\.4$)/.test(normalized)) {
    return '复杂问题与深入分析';
  }
  return '用于文章理解与问答';
};

export const getChatModelOptions = (
  profile: ProviderProfile,
  discoveredModels: ProviderChatModel[] = [],
): ChatModelOption[] => {
  const preset = getProviderPreset(profile.chatProviderKind);
  if (discoveredModels.length > 0) {
    const models = discoveredModels.some(({ id }) => id === profile.chatModel)
      ? discoveredModels
      : [{ id: profile.chatModel }, ...discoveredModels];
    return models.map((model) => ({
      value: model.id,
      label: model.displayName?.trim() || formatChatModelLabel(model.id),
      description: model.description?.trim()
        || (model.ownedBy?.trim()
          ? `由 ${model.ownedBy.trim()} 提供`
          : describeChatModel(model.id, false)),
      current: model.id === profile.chatModel,
      recommended: model.id === preset.defaultModel,
    }));
  }

  const suggestedModels = [...preset.suggestedModels];
  const currentIsCustom = !suggestedModels.includes(profile.chatModel);
  const models = currentIsCustom
    ? [profile.chatModel, ...suggestedModels]
    : suggestedModels;

  return models.map((model) => ({
    value: model,
    label: formatChatModelLabel(model),
    description: describeChatModel(model, currentIsCustom && model === profile.chatModel),
    current: model === profile.chatModel,
    recommended: model === preset.defaultModel,
  }));
};

export const buildProviderRequestWithChatModel = (
  profile: ProviderProfile,
  chatModel: string,
): SaveProviderRequest => ({
  summary: {
    providerKind: profile.providerKind,
    baseUrl: profile.baseUrl,
    model: profile.summaryModel,
  },
  translation: {
    providerKind: profile.translationProviderKind,
    baseUrl: profile.translationBaseUrl,
    model: profile.translationModel,
  },
  tag: {
    providerKind: profile.tagProviderKind,
    baseUrl: profile.tagBaseUrl,
    model: profile.tagModel,
  },
  chat: {
    providerKind: profile.chatProviderKind,
    baseUrl: profile.chatBaseUrl,
    model: chatModel,
    supportsImages: profile.chatSupportsImages,
  },
});
