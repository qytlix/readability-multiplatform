import { describe, expect, it, vi } from 'vitest';
import type { ContentSegment } from '../../src/shared/contracts/content.types';
import { ArticleContextCacheStore } from '../../src/main/ai/stores/ArticleContextCacheStore';
import {
  ArticleContextService,
  selectRelevantSegments,
} from '../../src/main/ai/services/ArticleContextService';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

const segments: ContentSegment[] = [
  {
    id: 's-1',
    orderIndex: 0,
    type: 'paragraph',
    sourceHtml: '<p>Opening context.</p>',
    sourceText: 'Opening context.',
  },
  {
    id: 's-2',
    orderIndex: 1,
    type: 'paragraph',
    sourceHtml: '<p>Solar battery evidence and data.</p>',
    sourceText: 'Solar battery evidence and data.',
  },
  {
    id: 's-3',
    orderIndex: 2,
    type: 'paragraph',
    sourceHtml: '<p>Limits of the battery claim.</p>',
    sourceText: 'Limits of the battery claim.',
  },
  {
    id: 's-4',
    orderIndex: 3,
    type: 'paragraph',
    sourceHtml: '<p>Unrelated conclusion.</p>',
    sourceText: 'Unrelated conclusion.',
  },
];

describe('ArticleContextService', () => {
  it('uses complete article context while it fits', async () => {
    const analyze = vi.fn();
    const service = new ArticleContextService(
      new ArticleContextCacheStore(buildTestDbWithData().db),
      { analyze },
    );
    const prepared = await service.prepare({
      source: {
        entryId: 1,
        title: 'Article',
        markdown: 'Complete article body.',
        sourceContentHash: 'hash-full',
        segments,
      },
      history: [],
      question: 'What is the claim?',
      textAttachments: [],
      analysisModelFamily: 'mock:model',
      contextWindowTokens: 8_000,
      responseReserveTokens: 1_000,
    });

    expect(prepared.mode).toBe('full');
    expect(prepared.articleReference).toContain('Complete article body.');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('analyses every segment once and reuses the article-map cache', async () => {
    const { db } = buildTestDbWithData();
    const analyze = vi.fn(async (segment: ContentSegment) =>
      `Analysis for ${segment.id}`);
    const service = new ArticleContextService(
      new ArticleContextCacheStore(db),
      { analyze },
    );
    const request = {
      source: {
        entryId: 1,
        title: 'Very long article',
        markdown: 'Long article '.repeat(5_000),
        sourceContentHash: 'hash-map',
        segments,
      },
      history: [],
      question: 'What battery evidence is given?',
      textAttachments: [],
      analysisModelFamily: 'mock:model',
      contextWindowTokens: 2_000,
      responseReserveTokens: 500,
    };

    const first = await service.prepare(request);
    const second = await service.prepare(request);

    expect(first.mode).toBe('article-map');
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(segments.length);
    expect(first.relatedSegmentIds).toEqual(['s-1', 's-2', 's-3', 's-4']);
    expect(first.articleReference).toContain('Analysis for s-4');
    expect(first.articleReference).toContain('Solar battery evidence and data.');
  });

  it('selects matching segments and adjacent original context deterministically', () => {
    expect(selectRelevantSegments(
      segments,
      'battery evidence',
    ).map(({ id }) => id)).toEqual(['s-1', 's-2', 's-3', 's-4']);
    expect(selectRelevantSegments(
      segments,
      'no matching phrase',
      's-3',
    ).map(({ id }) => id)).toEqual(['s-2', 's-3', 's-4']);
  });
});
