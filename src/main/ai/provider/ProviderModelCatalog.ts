import {
  isValidProviderModel,
  type ProviderChatModel,
  type ProviderKind,
} from '../../../shared/contracts/provider.types';
import {
  createProviderAbortScope,
  fetchProviderResponse,
  providerProtocolError,
  type ProviderAbortScope,
} from './ProviderTransport';

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_MODELS = 1_000;
const MAX_DISPLAY_NAME_CHARACTERS = 200;
const MAX_DESCRIPTION_CHARACTERS = 500;

export interface ProviderModelCatalogRequest {
  providerKind: ProviderKind;
  baseUrl: string;
  apiKey: string;
}

type ProviderModelRequest = (
  url: string,
  init: Omit<RequestInit, 'signal'>,
  scope: ProviderAbortScope,
) => Promise<Response>;

export class ProviderModelCatalog {
  constructor(
    private readonly request: ProviderModelRequest = fetchProviderResponse,
  ) {}

  async list(
    request: ProviderModelCatalogRequest,
  ): Promise<ProviderChatModel[]> {
    const scope = createProviderAbortScope();
    try {
      const response = await this.request(
        buildModelListUrl(request.providerKind, request.baseUrl),
        {
          method: 'GET',
          headers: buildModelListHeaders(request.providerKind, request.apiKey),
        },
        scope,
      );
      const payload = await parseJsonResponse(response);
      return parseProviderModels(request.providerKind, payload);
    } finally {
      scope.dispose();
    }
  }
}

function buildModelListHeaders(
  providerKind: ProviderKind,
  apiKey: string,
): Record<string, string> {
  if (providerKind === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }
  if (providerKind === 'gemini') {
    return { 'x-goog-api-key': apiKey };
  }
  return { authorization: `Bearer ${apiKey}` };
}

function buildModelListUrl(
  providerKind: ProviderKind,
  baseUrl: string,
): string {
  if (providerKind === 'anthropic') {
    const url = buildPathUrl(baseUrl, 'models', 'v1');
    url.searchParams.set('limit', String(MAX_MODELS));
    return url.toString();
  }
  if (providerKind === 'gemini') {
    const url = buildPathUrl(baseUrl, 'models', 'v1beta');
    url.searchParams.set('pageSize', String(MAX_MODELS));
    return url.toString();
  }

  const url = buildPathUrl(baseUrl, 'models');
  if (providerKind === 'openrouter') {
    url.searchParams.set('output_modalities', 'text');
  }
  return url.toString();
}

function buildPathUrl(
  baseUrl: string,
  resource: string,
  defaultVersion?: string,
): URL {
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = '';
  let path = url.pathname.replace(/\/+$/, '');
  path = path
    .replace(/\/chat\/completions$/, '')
    .replace(/\/messages$/, '');
  if (path.endsWith(`/${resource}`)) {
    url.pathname = path;
    return url;
  }
  if (
    defaultVersion
    && !path.endsWith('/v1')
    && !path.endsWith('/v1beta')
  ) {
    path = `${path}/${defaultVersion}`;
  }
  url.pathname = `${path}/${resource}`.replace(/\/{2,}/g, '/');
  return url;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw providerProtocolError(
      'The provider returned an invalid model catalog.',
    );
  }
}

function parseProviderModels(
  providerKind: ProviderKind,
  payload: unknown,
): ProviderChatModel[] {
  if (!isRecord(payload)) {
    throw providerProtocolError('The provider returned an invalid model catalog.');
  }

  if (providerKind === 'gemini') {
    if (!Array.isArray(payload.models)) {
      throw providerProtocolError('Gemini returned an invalid model catalog.');
    }
    return normalizeModels(payload.models.flatMap((value) => {
      if (!isRecord(value)) return [];
      const supportedMethods = value.supportedGenerationMethods;
      if (
        !Array.isArray(supportedMethods)
        || !supportedMethods.includes('generateContent')
      ) {
        return [];
      }
      const id = typeof value.name === 'string'
        ? value.name.replace(/^models\//, '')
        : '';
      return [toSafeModel(
        id,
        value.displayName,
        value.description,
      )];
    }));
  }

  if (!Array.isArray(payload.data)) {
    throw providerProtocolError('The provider returned an invalid model catalog.');
  }
  return normalizeModels(payload.data.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== 'string') return [];
    if (
      providerKind === 'openai'
      && !isOpenAIChatModelId(value.id)
    ) {
      return [];
    }
    return [toSafeModel(
      value.id,
      providerKind === 'anthropic' ? value.display_name : value.name,
      value.description,
      value.owned_by,
    )];
  }));
}

function toSafeModel(
  id: string,
  displayName?: unknown,
  description?: unknown,
  ownedBy?: unknown,
): ProviderChatModel {
  return {
    id: id.trim(),
    ...toOptionalText(
      displayName,
      'displayName',
      MAX_DISPLAY_NAME_CHARACTERS,
    ),
    ...toOptionalText(
      description,
      'description',
      MAX_DESCRIPTION_CHARACTERS,
    ),
    ...toOptionalText(ownedBy, 'ownedBy', MAX_DISPLAY_NAME_CHARACTERS),
  };
}

function toOptionalText<Key extends 'displayName' | 'description' | 'ownedBy'>(
  value: unknown,
  key: Key,
  maxCharacters: number,
): Partial<Record<Key, string>> {
  if (typeof value !== 'string') return {};
  const normalized = value.trim().slice(0, maxCharacters);
  return normalized ? { [key]: normalized } as Partial<Record<Key, string>> : {};
}

function normalizeModels(models: ProviderChatModel[]): ProviderChatModel[] {
  const uniqueModels = new Map<string, ProviderChatModel>();
  for (const model of models.slice(0, MAX_MODELS)) {
    if (!isValidProviderModel(model.id)) continue;
    uniqueModels.set(model.id, model);
  }
  return [...uniqueModels.values()].sort((first, second) =>
    first.id.localeCompare(second.id));
}

function isOpenAIChatModelId(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  const chatFamily = /^(?:gpt-|chatgpt-|o\d(?:-|$)|ft:(?:gpt-|chatgpt-|o\d))/;
  if (!chatFamily.test(normalized)) return false;
  return !/(?:^|[-/:])(audio|embedding|image|moderation|realtime|transcrib|tts|whisper)(?:[-/:]|$)/.test(
    normalized,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
