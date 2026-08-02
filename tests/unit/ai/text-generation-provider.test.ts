import { describe, expect, it } from 'vitest';
import {
  validateProviderConversation,
} from '../../../src/main/ai/provider/TextGenerationProvider';

describe('validateProviderConversation', () => {
  it('keeps legacy prompt requests compatible', () => {
    expect(validateProviderConversation({ prompt: 'Summarize this.' })).toEqual({
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Summarize this.' }],
      }],
    });
  });

  it('accepts multi-turn text and bounded image content', () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    expect(validateProviderConversation({
      systemInstruction: 'Use the article.',
      prompt: '',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'What is this?' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'A chart.' }] },
        {
          role: 'user',
          content: [{ type: 'image', mimeType: 'image/png', bytes }],
        },
      ],
    })).toMatchObject({
      systemInstruction: 'Use the article.',
      messages: expect.any(Array),
    });
  });

  it('rejects ambiguous, empty, and unsafe requests before transport', () => {
    expect(() => validateProviderConversation({
      prompt: 'legacy',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'chat' }] }],
    })).toThrow('either a legacy prompt or Chat messages');
    expect(() => validateProviderConversation({ prompt: '', messages: [] }))
      .toThrow('At least one Chat message');
    expect(() => validateProviderConversation({
      prompt: '',
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          mimeType: 'image/png',
          bytes: new Uint8Array(5 * 1024 * 1024 + 1),
        }],
      }],
    })).toThrow('invalid or too large');
  });
});
