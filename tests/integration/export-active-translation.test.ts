import { describe, expect, it } from 'vitest';
import { TranslationStore } from '../../src/main/ai/stores/TranslationStore';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { ExportService } from '../../src/main/export/ExportService';
import type { ContentService } from '../../src/main/feed/services/ContentService';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('ExportService active Translation selection', () => {
  it('exports exactly the active complete run and keeps it after a replacement fails', () => {
    const { db } = buildTestDbWithData();
    const contentStore = new ContentStore(db);
    contentStore.upsert({
      entryId: 1,
      cleanedHtml: '<h1>Title</h1><p>Body</p>',
      markdown: 'Title\n\nBody',
      pipelineStatus: 'success',
    });
    const profileId = new ProviderProfileStore(db).saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'export-test-model',
      apiKeyRef: 'export-test-secret',
    }).id;
    const translations = new TranslationStore(db);
    const createRun = () => translations.createRun({
      entryId: 1,
      providerProfileId: profileId,
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      sourceContentHash: 'export-content-hash',
      segmenterVersion: 'v1',
      promptVersion: 'translation-v1',
      terminologyPackVersion: 'none',
      segments: [
        { id: 'title', orderIndex: 0, type: 'title', sourceHtml: '<h1>Title</h1>', sourceText: 'Title' },
        { id: 'body', orderIndex: 1, type: 'paragraph', sourceHtml: '<p>Body</p>', sourceText: 'Body' },
      ],
    });
    const complete = (runId: number, marker: string) => {
      translations.markSegmentSucceeded(runId, 'title', `${marker} title`, `<h1>${marker} title</h1>`, []);
      translations.markSegmentSucceeded(runId, 'body', `${marker} body`, `<p>${marker} body</p>`, []);
      return translations.markRunSucceeded(runId);
    };
    const exportService = new ExportService(
      new EntryStore(db),
      contentStore,
      {} as ContentService,
      db,
    );
    const exportOptions = {
      includeSummary: false,
      includeTranslation: true,
      includeNotes: false,
    };

    const original = complete(createRun().id, 'original');
    const failedCandidate = createRun();
    translations.markRunFailed(failedCandidate.id, {
      code: 'TRANSLATION_INVALID_STRUCTURE',
      message: 'Invalid replacement.',
      retryable: true,
    });

    expect(exportService.checkAvailability([1]).articles[0]?.hasTranslation).toBe(true);
    expect(exportService.prepareArticleData(1, exportOptions).translation)
      .toBe('original title\n\noriginal body');

    const replacement = complete(createRun().id, 'replacement');
    expect(replacement.id).not.toBe(original.id);
    expect(exportService.prepareArticleData(1, exportOptions).translation)
      .toBe('replacement title\n\nreplacement body');
    expect(exportService.prepareArticleData(1, exportOptions).translation)
      .not.toContain('original');
  });
});
