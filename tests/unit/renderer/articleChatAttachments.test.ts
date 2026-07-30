import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ArticleChatComposer } from '../../../src/renderer/features/chat/ArticleChatComposer';

describe('Article Chat attachment chips', () => {
  it('renders only public attachment metadata with an accessible remove action', () => {
    const html = renderToStaticMarkup(createElement(ArticleChatComposer, {
      value: 'question',
      running: false,
      busy: false,
      disabled: false,
      errorMessage: '',
      attachments: [{
        id: 4,
        threadId: 2,
        kind: 'text',
        displayName: 'evidence.pdf',
        mimeType: 'application/pdf',
        byteSize: 1_200,
        contentHash: 'public-hash',
        createdAt: '2026-07-30T00:00:00.000Z',
      }],
      onChange: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
      onPickAttachments: vi.fn(),
      onRemoveAttachment: vi.fn(),
    }));

    expect(html).toContain('evidence.pdf');
    expect(html).toContain('2 KB');
    expect(html).toContain('aria-label="移除附件 evidence.pdf"');
    expect(html).not.toContain('textContent');
    expect(html).not.toContain('storageKey');
  });

  it('disables adding a sixth attachment', () => {
    const attachments = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      threadId: 2,
      kind: 'text' as const,
      displayName: `file-${index + 1}.txt`,
      mimeType: 'text/plain',
      byteSize: 20,
      contentHash: `hash-${index + 1}`,
      createdAt: '2026-07-30T00:00:00.000Z',
    }));
    const html = renderToStaticMarkup(createElement(ArticleChatComposer, {
      value: '',
      running: false,
      busy: false,
      disabled: false,
      errorMessage: '',
      attachments,
      onChange: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
      onPickAttachments: vi.fn(),
      onRemoveAttachment: vi.fn(),
    }));

    expect(html).toMatch(/aria-label="添加附件"[^>]*disabled=""/u);
  });
});
