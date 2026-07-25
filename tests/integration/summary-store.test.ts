import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { SummaryStore } from '../../src/main/ai/stores/SummaryStore';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('SummaryStore', () => {
  let summaryStore: SummaryStore;
  let providerId: number;

  beforeEach(() => {
    const { db } = buildTestDbWithData();
    const profiles = new ProviderProfileStore(db);
    providerId = profiles.saveActive({
      providerKind: 'openai',
      baseUrl: 'https://provider.example/v1',
      model: 'example-model',
      apiKeyRef: 'secret-reference',
    }).id;
    summaryStore = new SummaryStore(db);
  });

  it('atomically persists a successful run and its result slot', () => {
    const run = summaryStore.createRun({
      entryId: 1,
      providerProfileId: providerId,
      targetLanguage: 'en',
      detailLevel: 'medium',
      inputMarkdownHash: 'hash-a',
    });
    const result = summaryStore.markRunSucceededWithResult({
      runId: run.id,
      entryId: 1,
      targetLanguage: 'en',
      detailLevel: 'medium',
      inputMarkdownHash: 'hash-a',
      promptVersion: 'summary-v1',
      content: 'First result',
    });

    expect(result.content).toBe('First result');
    expect(summaryStore.findRunningRun(1, 'en', 'medium')).toBeUndefined();
    expect(summaryStore.findResult(1, 'en', 'medium')?.runId).toBe(run.id);
  });

  it('reconciles abandoned running rows as retryable failures', () => {
    summaryStore.createRun({
      entryId: 1,
      providerProfileId: providerId,
      targetLanguage: 'zh-CN',
      detailLevel: 'short',
      inputMarkdownHash: 'hash-b',
    });

    summaryStore.reconcileInterruptedRuns();

    const failed = summaryStore.findLatestFailedRun(1, 'zh-CN', 'short');
    expect(failed?.error).toMatchObject({
      code: 'SUMMARY_INTERRUPTED',
      retryable: true,
    });
  });
});
