import { describe, expect, it, vi } from 'vitest';
import { ProviderModelCatalog } from '../../../src/main/ai/provider/ProviderModelCatalog';

describe('ProviderModelCatalog', () => {
  it('lists the OpenAI chat-capable model families visible to the saved key', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({
      object: 'list',
      data: [
        { id: 'gpt-5.6', owned_by: 'openai' },
        { id: 'gpt-4.1-mini', owned_by: 'openai' },
        { id: 'o3', owned_by: 'openai' },
        { id: 'ft:gpt-4.1-mini:team:reader', owned_by: 'team' },
        { id: 'text-embedding-3-large', owned_by: 'openai' },
        { id: 'gpt-image-2', owned_by: 'openai' },
        { id: 'whisper-1', owned_by: 'openai' },
      ],
    }));
    const catalog = new ProviderModelCatalog(request);

    await expect(catalog.list({
      providerKind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'OPENAI_KEY_CANARY',
    })).resolves.toEqual([
      { id: 'ft:gpt-4.1-mini:team:reader', ownedBy: 'team' },
      { id: 'gpt-4.1-mini', ownedBy: 'openai' },
      { id: 'gpt-5.6', ownedBy: 'openai' },
      { id: 'o3', ownedBy: 'openai' },
    ]);
    expect(request).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer OPENAI_KEY_CANARY',
        }),
      }),
      expect.anything(),
    );
  });

  it('uses the Anthropic model catalog with provider-native authentication', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({
      data: [{
        id: 'claude-sonnet-4-5',
        display_name: 'Claude Sonnet 4.5',
        type: 'model',
      }],
      has_more: false,
    }));
    const catalog = new ProviderModelCatalog(request);

    await expect(catalog.list({
      providerKind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'ANTHROPIC_KEY_CANARY',
    })).resolves.toEqual([{
      id: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5',
    }]);
    expect(request).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models?limit=1000',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'ANTHROPIC_KEY_CANARY',
          'anthropic-version': expect.any(String),
        }),
      }),
      expect.anything(),
    );
  });

  it('keeps only Gemini models that support generateContent', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({
      models: [{
        name: 'models/gemini-3.6-flash',
        displayName: 'Gemini 3.6 Flash',
        description: 'Fast text generation.',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      }, {
        name: 'models/text-embedding-004',
        displayName: 'Text Embedding 004',
        supportedGenerationMethods: ['embedContent'],
      }],
    }));
    const catalog = new ProviderModelCatalog(request);

    await expect(catalog.list({
      providerKind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'GEMINI_KEY_CANARY',
    })).resolves.toEqual([{
      id: 'gemini-3.6-flash',
      displayName: 'Gemini 3.6 Flash',
      description: 'Fast text generation.',
    }]);
    expect(request).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-goog-api-key': 'GEMINI_KEY_CANARY',
        }),
      }),
      expect.anything(),
    );
  });

  it('uses text-output filtering for the OpenRouter catalog', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({
      data: [{
        id: 'openai/gpt-5.6',
        name: 'OpenAI: GPT-5.6',
        description: 'Frontier model',
      }],
    }));
    const catalog = new ProviderModelCatalog(request);

    await expect(catalog.list({
      providerKind: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'OPENROUTER_KEY_CANARY',
    })).resolves.toEqual([{
      id: 'openai/gpt-5.6',
      displayName: 'OpenAI: GPT-5.6',
      description: 'Frontier model',
    }]);
    expect(request).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models?output_modalities=text',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer OPENROUTER_KEY_CANARY',
        }),
      }),
      expect.anything(),
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
