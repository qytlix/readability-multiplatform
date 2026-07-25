import { describe, expect, it, vi } from 'vitest';
import type { ProviderKind } from '../../../src/shared/contracts/provider.types';
import { ProviderRegistry } from '../../../src/main/ai/provider/ProviderRegistry';
import type {
  TextGenerationProvider,
  TextGenerationProviderRequest,
} from '../../../src/main/ai/provider/TextGenerationProvider';

describe('ProviderRegistry', () => {
  it.each<ProviderKind>([
    'openai',
    'anthropic',
    'deepseek',
    'gemini',
    'openrouter',
    'custom-openai-compatible',
  ])('routes %s requests to the configured adapter', async (providerKind) => {
    const calls: ProviderKind[] = [];
    const adapters = Object.fromEntries([
      'openai',
      'anthropic',
      'deepseek',
      'gemini',
      'openrouter',
      'custom-openai-compatible',
    ].map((kind) => [
      kind,
      createAdapter(kind as ProviderKind, calls),
    ])) as Record<ProviderKind, TextGenerationProvider>;
    const registry = new ProviderRegistry(adapters);
    const output: string[] = [];

    for await (const chunk of registry.stream(request(providerKind))) output.push(chunk);

    expect(output).toEqual([providerKind]);
    expect(calls).toEqual([providerKind]);
  });

  it('routes connection tests with the same provider kind', async () => {
    const anthropic = createAdapter('anthropic', []);
    const testConnection = vi.spyOn(anthropic, 'testConnection');
    const fallback = createAdapter('openai', []);
    const registry = new ProviderRegistry({
      openai: fallback,
      anthropic,
      deepseek: fallback,
      gemini: fallback,
      openrouter: fallback,
      'custom-openai-compatible': fallback,
    });

    await registry.testConnection({
      providerKind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      apiKey: 'test-key',
    });

    expect(testConnection).toHaveBeenCalledOnce();
  });
});

function createAdapter(
  kind: ProviderKind,
  calls: ProviderKind[],
): TextGenerationProvider {
  return {
    async *stream() {
      calls.push(kind);
      yield kind;
    },
    async testConnection() {
      return undefined;
    },
  };
}

function request(providerKind: ProviderKind): TextGenerationProviderRequest {
  return {
    providerKind,
    baseUrl: 'https://provider.example/v1',
    model: 'test-model',
    apiKey: 'test-key',
    prompt: 'Test.',
    signal: new AbortController().signal,
  };
}

