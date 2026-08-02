import { describe, expect, it } from 'vitest';
import {
  assertArticleMapContextFits,
  chooseArticleContextMode,
  estimateChatTokens,
} from '../../../src/main/ai/services/ArticleContextBudget';

const baseInput = {
  contextWindowTokens: 1_000,
  responseReserveTokens: 100,
  systemInstruction: 'system',
  currentQuestion: 'question',
  compressedHistoryText: 'summary',
};

describe('ArticleContextBudget', () => {
  it('keeps complete article and history when both fit', () => {
    expect(chooseArticleContextMode({
      ...baseInput,
      fullArticleContext: 'article'.repeat(100),
      fullHistoryText: 'history'.repeat(20),
    }).mode).toBe('full');
  });

  it('compresses history before replacing the complete article', () => {
    const decision = chooseArticleContextMode({
      ...baseInput,
      fullArticleContext: 'article'.repeat(300),
      fullHistoryText: 'history'.repeat(300),
    });

    expect(decision.mode).toBe('history-compressed');
    expect(decision.fullArticleTokens).toBeGreaterThan(0);
  });

  it('selects article-map mode instead of silently truncating a long article', () => {
    const decision = chooseArticleContextMode({
      ...baseInput,
      fullArticleContext: 'article'.repeat(2_000),
      fullHistoryText: '',
    });

    expect(decision.mode).toBe('article-map');
    expect(decision.fullArticleTokens).toBe(3_500);
  });

  it('fails before transport when required or article-map context is too large', () => {
    expect(() => chooseArticleContextMode({
      ...baseInput,
      fullArticleContext: '',
      fullHistoryText: '',
      currentQuestion: 'q'.repeat(4_000),
    })).toThrow('question, selection, and current attachments');

    expect(() => assertArticleMapContextFits('map'.repeat(2_000), {
      ...baseInput,
      currentAttachmentText: 'attachment',
    })).toThrow('article map');
  });

  it('uses a more conservative estimate for non-ASCII article text', () => {
    expect(estimateChatTokens('文章内容')).toBeGreaterThan(estimateChatTokens('text'));
  });
});
