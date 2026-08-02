import { beforeEach, describe, expect, it } from 'vitest';
import {
  ArticleContextCacheStore,
  type ArticleContextCacheIdentity,
} from '../../src/main/ai/stores/ArticleContextCacheStore';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('ArticleContextCacheStore', () => {
  let store: ArticleContextCacheStore;
  const identity: ArticleContextCacheIdentity = {
    entryId: 1,
    sourceContentHash: 'content-a',
    promptVersion: 'article-chat-v1',
    compressionVersion: 'article-context-v1',
    analysisModelFamily: 'openai:gpt',
  };

  beforeEach(() => {
    store = new ArticleContextCacheStore(buildTestDbWithData().db);
  });

  it('persists formatted context and structured segment analyses', () => {
    const saved = store.save({
      ...identity,
      formattedContext: '<article-context>Full text</article-context>',
      articleMap: 'Structured article map',
      segmentAnalyses: [{
        segmentId: 'segment-1',
        orderIndex: 0,
        analysis: 'Main claim',
      }],
      estimatedTokens: 42,
    });

    expect(store.find(identity)).toEqual(saved);
    expect(saved).toMatchObject({
      articleMap: 'Structured article map',
      segmentAnalyses: [{ segmentId: 'segment-1', analysis: 'Main claim' }],
      estimatedTokens: 42,
    });
  });

  it('invalidates by content, prompt, compression, and model-family identity', () => {
    store.save({
      ...identity,
      formattedContext: 'cached',
      estimatedTokens: 2,
    });

    for (const changed of [
      { sourceContentHash: 'content-b' },
      { promptVersion: 'article-chat-v2' },
      { compressionVersion: 'article-context-v2' },
      { analysisModelFamily: 'anthropic:claude' },
    ]) {
      expect(store.find({ ...identity, ...changed })).toBeUndefined();
    }
  });

  it('updates one compatible cache row instead of duplicating it', () => {
    const first = store.save({
      ...identity,
      formattedContext: 'first',
      estimatedTokens: 1,
    });
    const second = store.save({
      ...identity,
      formattedContext: 'second',
      estimatedTokens: 2,
    });

    expect(second.id).toBe(first.id);
    expect(second.formattedContext).toBe('second');
  });
});
