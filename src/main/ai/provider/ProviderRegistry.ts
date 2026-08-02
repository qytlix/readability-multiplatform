import type { ProviderKind } from '../../../shared/contracts/provider.types';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../../shared/errors/summary.errors';
import { CHAT_ERROR_CODES, ChatError } from '../../../shared/errors/chat.errors';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import type {
  TextGenerationConnectionRequest,
  TextGenerationImageConnectionRequest,
  TextGenerationProvider,
  TextGenerationProviderRequest,
} from './TextGenerationProvider';

type ProviderAdapterMap = Record<ProviderKind, TextGenerationProvider>;

/** Routes a persisted provider preset to its protocol adapter. */
export class ProviderRegistry implements TextGenerationProvider {
  private readonly adapters: ProviderAdapterMap;

  constructor(adapters: ProviderAdapterMap = createDefaultAdapters()) {
    this.adapters = adapters;
  }

  async *stream(request: TextGenerationProviderRequest): AsyncIterable<string> {
    yield* this.resolve(request.providerKind).stream(request);
  }

  testConnection(request: TextGenerationConnectionRequest): Promise<void> {
    return this.resolve(request.providerKind).testConnection(request);
  }

  testImageConnection(
    request: TextGenerationImageConnectionRequest,
  ): Promise<void> {
    const adapter = this.resolve(request.providerKind);
    if (!adapter.testImageConnection) {
      throw new ChatError(
        CHAT_ERROR_CODES.CHAT_IMAGE_UNSUPPORTED,
        'The configured Provider adapter cannot test image input.',
        false,
      );
    }
    return adapter.testImageConnection(request);
  }

  resolve(kind: ProviderKind = 'openai'): TextGenerationProvider {
    const adapter = this.adapters[kind];
    if (!adapter) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
        'The configured provider type is not supported.',
        false,
      );
    }
    return adapter;
  }
}

function createDefaultAdapters(): ProviderAdapterMap {
  const openAICompatible = new OpenAICompatibleProvider();
  return {
    openai: openAICompatible,
    deepseek: openAICompatible,
    openrouter: openAICompatible,
    'custom-openai-compatible': openAICompatible,
    anthropic: new AnthropicProvider(),
    gemini: new GeminiProvider(),
  };
}

