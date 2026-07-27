import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SummaryProvider, SummaryProviderRequest } from '../../src/main/ai/provider/SummaryProvider';
import { DiagnosticExportService } from '../../src/main/diagnostics/DiagnosticExportService';
import { StructuredLogger } from '../../src/main/logging/StructuredLogger';
import { TranslationService } from '../../src/main/ai/services/TranslationService';
import { ProviderProfileStore } from '../../src/main/ai/stores/ProviderProfileStore';
import { SecretStore, type SafeStorageBackend } from '../../src/main/ai/stores/SecretStore';
import { TranslationStore } from '../../src/main/ai/stores/TranslationStore';
import { ContentStore } from '../../src/main/feed/stores/ContentStore';
import { TRANSLATION_LOG_EVENTS } from '../../src/main/ai/services/TranslationLogging';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

const temporaryDirectories: string[] = [];
const memorySecrets = new Map<string, string>();
const safeStorage: SafeStorageBackend = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString('utf8'),
  getSelectedStorageBackend: () => 'gnome_libsecret',
};

class TestSecretStore extends SecretStore {
  constructor() {
    super('/tmp/unused-translation-diagnostic-secrets.json', safeStorage, 'linux');
  }

  override read(reference: string): string {
    const value = memorySecrets.get(reference);
    if (!value) throw new Error('Missing test key.');
    return value;
  }
}

interface BatchPromptSegment {
  sourceSegmentId: string;
  sourceHtml: string;
}

interface TextSlotPromptSlot {
  textSlotId: string;
  sourceText: string;
}

afterEach(() => {
  memorySecrets.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-translation-diagnostics-'));
  temporaryDirectories.push(directory);
  return directory;
}

function parseBatchPrompt(prompt: string): BatchPromptSegment[] {
  const serialized = prompt.match(
    /<source-segments-ndjson>\n([\s\S]*?)\n<\/source-segments-ndjson>/,
  )?.[1];
  if (!serialized) throw new Error('Missing source segments in Translation prompt.');
  return serialized.split('\n').filter(Boolean).map((line) =>
    JSON.parse(line) as BatchPromptSegment);
}

function parseTextSlotPrompt(prompt: string): TextSlotPromptSlot[] {
  const serialized = prompt.match(
    /<text-slots-ndjson>\n([\s\S]*?)\n<\/text-slots-ndjson>/,
  )?.[1];
  if (!serialized) throw new Error('Missing text slots in Translation compensation prompt.');
  return serialized.split('\n').filter(Boolean).map((line) =>
    JSON.parse(line) as TextSlotPromptSlot);
}

function validOutput(segment: BatchPromptSegment): Record<string, unknown> {
  return {
    sourceSegmentId: segment.sourceSegmentId,
    translatedHtml: segment.sourceHtml.replace(/>([^<]*)</g, '>已翻译<'),
    appliedTermIds: [],
  };
}

function outputWithExtraElement(
  segment: BatchPromptSegment,
  canary: string,
): Record<string, unknown> {
  return {
    ...validOutput(segment),
    translatedHtml: segment.sourceHtml.replace(
      /(<\/[A-Za-z][^>]*>)\s*$/,
      `<em>${canary}</em>$1`,
    ),
  };
}

describe('Translation diagnostic export', () => {
  it('preserves a missing batch segment and malformed compensation reason through JSONL and final export', async () => {
    const articleCanary = 'ARTICLE_BODY_EXPORT_CANARY';
    const rawResponseCanary = 'RAW_PROVIDER_RESPONSE_EXPORT_CANARY';
    const apiKeyCanary = 'API_KEY_EXPORT_CANARY';
    const logDirectory = createDirectory();
    const outputPath = path.join(logDirectory, 'diagnostics.json');
    const { db } = buildTestDbWithData();
    const prompts: BatchPromptSegment[][] = [];

    try {
      const contentStore = new ContentStore(db);
      contentStore.upsert({
        entryId: 1,
        cleanedHtml: `<p>${articleCanary} first.</p><p>Second.</p>`,
        markdown: `${articleCanary} first.\n\nSecond.`,
        pipelineStatus: 'success',
      });
      const profiles = new ProviderProfileStore(db);
      profiles.saveActive({
        providerKind: 'openai',
        baseUrl: 'https://provider.example/v1',
        model: 'offline-test-model',
        apiKeyRef: 'diagnostic-test-key',
      });
      memorySecrets.set('diagnostic-test-key', apiKeyCanary);

      const provider: SummaryProvider = {
        async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
          const segments = parseBatchPrompt(request.prompt);
          prompts.push(segments);
          request.onUsage?.({ inputTokens: 17, outputTokens: 9, totalTokens: 26 });
          request.onFinishReason?.('stop');
          if (segments.length > 1) {
            for (const segment of segments.slice(0, -1)) {
              yield `${JSON.stringify(validOutput(segment))}\n`;
            }
            return;
          }
          yield `${rawResponseCanary}\n`;
        },
        testConnection: () => Promise.resolve(),
      };
      const logger = new StructuredLogger({
        directory: logDirectory,
        now: () => new Date('2026-07-26T12:00:00.000Z'),
        createSessionId: () => 'translation-diagnostic-export-test',
      });
      const service = new TranslationService(
        contentStore,
        profiles,
        new TestSecretStore(),
        new TranslationStore(db),
        provider,
        undefined,
        undefined,
        undefined,
        undefined,
        logger,
      );
      const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

      const started = service.generate(request);
      await vi.waitFor(() => {
        expect(service.getState(request)).toMatchObject({ state: 'failed' });
      });
      await logger.flush();

      const exporter = new DiagnosticExportService({
        logDirectory,
        runtime: {
          applicationVersion: '0.2.4-test',
          electronVersion: '43.1.0',
          nodeVersion: '24.11.1',
          operatingSystem: 'linux',
          operatingSystemRelease: 'test',
          architecture: 'x64',
          isPackaged: false,
          display: { session: 'wayland', waylandDetected: true, ozonePlatform: 'wayland' },
        },
        now: () => new Date('2026-07-26T12:00:01.000Z'),
        createTemporaryName: () => 'translation-diagnostics-export',
      });
      await exporter.exportToFile(outputPath);
      const report = JSON.parse(readFileSync(outputPath, 'utf8')) as {
        logs: { records: Array<{ event: string; context?: Record<string, unknown> }> };
      };

      expect(prompts.map((segments) => segments.length)).toEqual([3, 1]);
      const omittedBatch = report.logs.records.find((record) =>
        record.event === TRANSLATION_LOG_EVENTS.missingSegmentsDetected
        && record.context?.requestKind === 'batch');
      const malformedCompensation = report.logs.records.find((record) =>
        record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
        && record.context?.requestKind === 'compensation');

      expect(omittedBatch?.context).toMatchObject({
        taskRunId: started.runId,
        requestKind: 'batch',
        reasonCode: 'expected_segment_missing',
        validationStage: 'completion',
        expectedSegmentCount: 3,
        parsedSegmentCount: 2,
        acceptedSegmentCount: 2,
        missingSegmentCount: 1,
        duplicateSegmentCount: 0,
        unexpectedSegmentCount: 0,
        malformedRecordCount: 0,
        emptyTranslationCount: 0,
        finishReason: 'stop',
      });
      expect(malformedCompensation?.context).toMatchObject({
        taskRunId: started.runId,
        providerRequestId: expect.any(Number),
        requestKind: 'compensation',
        errorCode: 'TRANSLATION_INVALID_STRUCTURE',
        reasonCode: 'ndjson_syntax_error',
        validationStage: 'stream',
        finishReason: 'stop',
        expectedSegmentCount: 1,
        parsedSegmentCount: 0,
        acceptedSegmentCount: 0,
        missingSegmentCount: 1,
        duplicateSegmentCount: 0,
        unexpectedSegmentCount: 0,
        malformedRecordCount: 1,
        emptyTranslationCount: 0,
        inputTokens: 17,
        outputTokens: 9,
        affectedSegmentIdHashes: expect.arrayContaining([
          expect.stringMatching(/^[a-f0-9]{16}$/),
        ]),
      });

      const serializedReport = JSON.stringify(report);
      expect(serializedReport).not.toContain(articleCanary);
      expect(serializedReport).not.toContain(rawResponseCanary);
      expect(serializedReport).not.toContain(apiKeyCanary);
      expect(serializedReport).not.toContain('<source-segments-ndjson>');
      expect(omittedBatch?.context?.reasonCode).not.toBe(
        malformedCompensation?.context?.reasonCode,
      );
    } finally {
      db.close();
    }
  });

  it('exports a redacted HTML-validation subreason after successful compensation', async () => {
    const articleCanary = 'ARTICLE_HTML_VALIDATION_CANARY';
    const rawResponseCanary = 'RAW_HTML_VALIDATION_RESPONSE_CANARY';
    const apiKeyCanary = 'API_HTML_VALIDATION_KEY_CANARY';
    const logDirectory = createDirectory();
    const outputPath = path.join(logDirectory, 'html-validation-diagnostics.json');
    const { db } = buildTestDbWithData();
    const prompts: BatchPromptSegment[][] = [];
    const textSlotPrompts: TextSlotPromptSlot[][] = [];

    try {
      const contentStore = new ContentStore(db);
      contentStore.upsert({
        entryId: 1,
        cleanedHtml: `<p>${articleCanary} first.</p><p>Second.</p>`,
        markdown: `${articleCanary} first.\n\nSecond.`,
        pipelineStatus: 'success',
      });
      const profiles = new ProviderProfileStore(db);
      profiles.saveActive({
        providerKind: 'openai',
        baseUrl: 'https://provider.example/v1',
        model: 'offline-test-model',
        apiKeyRef: 'html-validation-test-key',
      });
      memorySecrets.set('html-validation-test-key', apiKeyCanary);

      const provider: SummaryProvider = {
        async *stream(request: SummaryProviderRequest): AsyncIterable<string> {
          if (request.prompt.includes('<text-slots-ndjson>')) {
            const slots = parseTextSlotPrompt(request.prompt);
            textSlotPrompts.push(slots);
            request.onUsage?.({ inputTokens: 17, outputTokens: 9, totalTokens: 26 });
            request.onFinishReason?.('stop');
            for (const slot of slots) {
              yield `${JSON.stringify({
                textSlotId: slot.textSlotId,
                translatedText: '已翻译',
                appliedTermIds: [],
              })}\n`;
            }
            return;
          }
          const segments = parseBatchPrompt(request.prompt);
          prompts.push(segments);
          request.onUsage?.({ inputTokens: 17, outputTokens: 9, totalTokens: 26 });
          request.onFinishReason?.('stop');
          if (segments.length > 1) {
            const first = segments[0];
            const rejected = segments[1];
            if (!first || !rejected) throw new Error('Expected a multi-segment batch.');
            yield `${JSON.stringify(validOutput(first))}\n`;
            yield `${JSON.stringify(outputWithExtraElement(rejected, rawResponseCanary))}\n`;
            return;
          }
          const segment = segments[0];
          if (!segment) throw new Error('Expected a compensation segment.');
          yield `${JSON.stringify(validOutput(segment))}\n`;
        },
        testConnection: () => Promise.resolve(),
      };
      const logger = new StructuredLogger({
        directory: logDirectory,
        now: () => new Date('2026-07-26T12:00:00.000Z'),
        createSessionId: () => 'translation-html-validation-export-test',
      });
      const service = new TranslationService(
        contentStore,
        profiles,
        new TestSecretStore(),
        new TranslationStore(db),
        provider,
        undefined,
        undefined,
        undefined,
        undefined,
        logger,
      );
      const request = { entryId: 1, sourceLanguage: 'auto' as const, targetLanguage: 'zh-CN' as const };

      const started = service.generate(request);
      await vi.waitFor(() => {
        expect(service.getState(request)).toMatchObject({ state: 'succeeded' });
      });
      await logger.flush();

      const exporter = new DiagnosticExportService({
        logDirectory,
        runtime: {
          applicationVersion: '0.2.4-test',
          electronVersion: '43.1.0',
          nodeVersion: '24.11.1',
          operatingSystem: 'linux',
          operatingSystemRelease: 'test',
          architecture: 'x64',
          isPackaged: false,
          display: { session: 'wayland', waylandDetected: true, ozonePlatform: 'wayland' },
        },
        now: () => new Date('2026-07-26T12:00:01.000Z'),
        createTemporaryName: () => 'translation-html-validation-export',
      });
      await exporter.exportToFile(outputPath);
      const report = JSON.parse(readFileSync(outputPath, 'utf8')) as {
        logs: { records: Array<{ event: string; context?: Record<string, unknown> }> };
      };

      expect(prompts.map((segments) => segments.length)).toEqual([3, 1]);
      expect(textSlotPrompts).toHaveLength(1);
      expect(textSlotPrompts[0]).toHaveLength(1);
      const rejectedBatch = report.logs.records.find((record) =>
        record.event === TRANSLATION_LOG_EVENTS.providerRequestFailed
        && record.context?.requestKind === 'batch');
      const omission = report.logs.records.find((record) =>
        record.event === TRANSLATION_LOG_EVENTS.missingSegmentsDetected
        && record.context?.requestKind === 'batch');
      const expectedHtmlDiagnostic = {
        taskRunId: started.runId,
        requestKind: 'batch',
        reasonCode: 'html_structure_invalid',
        validationStage: 'html-validation',
        htmlValidationReason: 'html_element_count_mismatch',
        finishReason: 'stop',
        expectedSegmentCount: 3,
        parsedSegmentCount: 2,
        acceptedSegmentCount: 1,
        missingSegmentCount: 2,
        duplicateSegmentCount: 0,
        unexpectedSegmentCount: 0,
        malformedRecordCount: 0,
        emptyTranslationCount: 0,
        inputTokens: 17,
        outputTokens: 9,
        affectedSegmentIdHashes: expect.arrayContaining([
          expect.stringMatching(/^[a-f0-9]{16}$/),
        ]),
      };
      const expectedHtmlOmissionDiagnostic = {
        taskRunId: started.runId,
        requestKind: 'batch',
        reasonCode: 'html_structure_invalid',
        validationStage: 'html-validation',
        htmlValidationReason: 'html_element_count_mismatch',
        finishReason: 'stop',
        expectedSegmentCount: 3,
        parsedSegmentCount: 2,
        acceptedSegmentCount: 1,
        missingSegmentCount: 2,
        duplicateSegmentCount: 0,
        unexpectedSegmentCount: 0,
        malformedRecordCount: 0,
        emptyTranslationCount: 0,
        affectedSegmentIdHashes: expect.arrayContaining([
          expect.stringMatching(/^[a-f0-9]{16}$/),
        ]),
      };
      expect(rejectedBatch?.context).toMatchObject({
        errorCode: 'TRANSLATION_INVALID_STRUCTURE',
        ...expectedHtmlDiagnostic,
      });
      expect(omission?.context).toMatchObject(expectedHtmlOmissionDiagnostic);

      const serializedReport = JSON.stringify(report);
      expect(serializedReport).not.toContain(articleCanary);
      expect(serializedReport).not.toContain(rawResponseCanary);
      expect(serializedReport).not.toContain(apiKeyCanary);
      expect(serializedReport).not.toContain('<source-segments-ndjson>');
    } finally {
      db.close();
    }
  });
});
