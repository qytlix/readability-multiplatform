import { describe, expect, it } from 'vitest';
import { ExportService } from '../../src/main/export/ExportService';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { TranslationStore } from '../../src/main/ai/stores/TranslationStore';
import { ContentService } from '../../src/main/feed/services/ContentService';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { AnnotationService } from '../../src/main/annotations/AnnotationService';
import { AnnotationStore } from '../../src/main/annotations/AnnotationStore';
import { buildTestDbWithContent } from '../fixtures/databases/feed-fixture';

describe('ExportService Translation aggregation', () => {
  it('exports only the latest successful Translation as ordered Reader segments', () => {
    const { dbManager, db } = buildTestDbWithContent();
    try {
      const entryStore = new EntryStore(db);
      const contentStore = new ContentStore(db);
      const contentService = new ContentService(contentStore, entryStore);
      const provider = new ProviderProfileStore(db).saveActive({
        providerKind: 'openai',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-5.4-mini',
        apiKeyRef: 'test-key-ref',
      });
      const translationStore = new TranslationStore(db);
      const older = translationStore.createRun({
        entryId: 1,
        providerProfileId: provider.id,
        sourceLanguage: 'auto',
        targetLanguage: 'en',
        sourceContentHash: 'older-source',
        segmenterVersion: 'v5',
        promptVersion: 'translation-test',
        terminologyPackVersion: 'none',
        segments: [{
          id: 'older-paragraph',
          orderIndex: 0,
          type: 'paragraph',
          sourceHtml: '<p>cleaned one</p>',
          sourceText: 'cleaned one',
        }],
      });
      translationStore.markSegmentSucceeded(
        older.id,
        'older-paragraph',
        'Older translation',
        '<p>Older translation</p>',
        [],
      );
      translationStore.markRunSucceeded(older.id);

      const latest = translationStore.createRun({
        entryId: 1,
        providerProfileId: provider.id,
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        sourceContentHash: 'latest-source',
        segmenterVersion: 'v5',
        promptVersion: 'translation-test',
        terminologyPackVersion: 'none',
        segments: [
          {
            id: 'latest-title',
            orderIndex: 0,
            type: 'title',
            sourceHtml: '<h2 class="translation-reader-title">First Post</h2>',
            sourceText: 'First Post',
          },
          {
            id: 'latest-paragraph',
            orderIndex: 1,
            type: 'paragraph',
            sourceHtml: '<p>cleaned one</p>',
            sourceText: 'cleaned one',
          },
        ],
      });
      translationStore.markSegmentSucceeded(
        latest.id,
        'latest-title',
        '第一篇',
        '<h2 class="translation-reader-title">第一篇</h2>',
        [],
      );
      translationStore.markSegmentSucceeded(
        latest.id,
        'latest-paragraph',
        '最新翻译',
        '<p>最新翻译</p>',
        [],
      );
      translationStore.markRunSucceeded(latest.id);

      const service = new ExportService(
        entryStore,
        contentStore,
        contentService,
        db,
      );
      const article = service.prepareArticleData(1, {
        includeSummary: false,
        includeTranslation: true,
        includeNotes: false,
      });

      expect(article.cleanedHtml).toBe('<p>cleaned one</p>');
      expect(article.translationSegments?.map((segment) => ({
        id: segment.sourceSegmentId,
        translatedText: segment.translatedText,
      }))).toEqual([
        { id: 'latest-title', translatedText: '第一篇' },
        { id: 'latest-paragraph', translatedText: '最新翻译' },
      ]);
      expect(article.translation).toBe('第一篇\n\n最新翻译');
      expect(article.translation).not.toContain('Older translation');
    } finally {
      dbManager.close();
    }
  });

  it('aggregates highlights even when note text export is disabled', () => {
    const { dbManager, db } = buildTestDbWithContent();
    try {
      const entryStore = new EntryStore(db);
      const contentStore = new ContentStore(db);
      const contentService = new ContentService(contentStore, entryStore);
      const annotationService = new AnnotationService(
        new AnnotationStore(db),
        entryStore,
      );
      const annotation = annotationService.create({
        entryId: 1,
        startOffset: 0,
        endOffset: 7,
        selectedText: 'cleaned',
        prefixText: '',
        suffixText: ' one',
        color: 'pink',
      });
      annotationService.updateNote({
        annotationId: annotation.id,
        noteText: 'private note text',
      });
      const service = new ExportService(
        entryStore,
        contentStore,
        contentService,
        db,
        annotationService,
      );

      const article = service.prepareArticleData(1, {
        includeSummary: false,
        includeTranslation: false,
        includeNotes: false,
      });

      expect(article.annotations).toEqual([
        expect.objectContaining({
          id: annotation.id,
          selectedText: 'cleaned',
          color: 'pink',
        }),
      ]);
      expect(article.notes).toBeUndefined();
    } finally {
      dbManager.close();
    }
  });
});
