import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InlineTranslationService } from '../../src/main/ai/services/InlineTranslationService';
import {
  TRANSLATION_INLINE_FAILURE_ERROR_CODES,
  TRANSLATION_LOG_EVENTS,
} from '../../src/main/ai/services/TranslationLogging';
import type { TextGenerationProvider } from '../../src/main/ai/provider/TextGenerationProvider';
import { DiagnosticExportService } from '../../src/main/diagnostics/DiagnosticExportService';
import { StructuredLogger } from '../../src/main/logging/StructuredLogger';
import type { InlineTranslationRequest } from '../../src/shared/contracts/translation.types';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../src/shared/errors/summary.errors';
import { TRANSLATION_ERROR_CODES, TranslationError } from '../../src/shared/errors/translation.errors';

const temporaryDirectories: string[] = [];
const SOURCE_CANARY = 'INLINE_SOURCE_CANARY_MUST_NOT_BE_LOGGED';
const CONTEXT_CANARY = 'INLINE_CONTEXT_CANARY_MUST_NOT_BE_LOGGED';
const TRANSLATION_CANARY = 'INLINE_TRANSLATION_CANARY_MUST_NOT_BE_LOGGED';
const MODEL_CANARY = 'INLINE_MODEL_CANARY_MUST_NOT_BE_LOGGED';
const EXPERT_CANARY = 'INLINE_EXPERT_CANARY_MUST_NOT_BE_LOGGED';
const API_KEY_CANARY = 'INLINE_API_KEY_CANARY_MUST_NOT_BE_LOGGED';
const PROVIDER_ERROR_CANARY = 'INLINE_PROVIDER_ERROR_CANARY_MUST_NOT_BE_LOGGED';

const request: InlineTranslationRequest = {
  kind: 'selection',
  sourceText: SOURCE_CANARY,
  context: CONTEXT_CANARY,
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  expertId: EXPERT_CANARY,
  useTerminology: false,
};

function createDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-inline-translation-log-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createLogger(directory: string): StructuredLogger {
  return new StructuredLogger({
    directory,
    now: () => new Date('2026-07-27T12:00:00.000Z'),
    createSessionId: () => 'inline-translation-log-test',
  });
}

function readRecords(directory: string): Array<Record<string, unknown>> {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => readFileSync(path.join(directory, name), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>));
}

function createService(
  provider: TextGenerationProvider,
  logger: StructuredLogger,
  profileAvailable = true,
): InlineTranslationService {
  return new InlineTranslationService(
    {
      findActiveWithSecret: () => (profileAvailable ? {
        id: 1,
        providerKind: 'openai',
        baseUrl: 'https://inline-provider-canary.example.test/v1',
        model: MODEL_CANARY,
        summaryModel: MODEL_CANARY,
        translationProviderKind: 'openai',
        translationBaseUrl: 'https://inline-provider-canary.example.test/v1',
        translationModel: MODEL_CANARY,
        tagProviderKind: 'openai',
        tagBaseUrl: 'https://inline-provider-canary.example.test/v1',
        tagModel: MODEL_CANARY,
        apiKeyRef: 'inline-key-ref',
        translationApiKeyRef: 'inline-key-ref',
        tagApiKeyRef: 'inline-tag-key-ref',
        chatProviderKind: 'openai',
        chatBaseUrl: 'https://inline-provider-canary.example.test/v1',
        chatModel: MODEL_CANARY,
        chatApiKeyRef: 'inline-key-ref',
        isActive: true,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
      } : undefined),
    },
    { read: () => API_KEY_CANARY },
    provider,
    undefined,
    {
      resolve: () => ({
        id: EXPERT_CANARY,
        contentHash: EXPERT_CANARY,
      }),
    },
    logger,
  );
}

function createDiagnosticExport(directory: string): DiagnosticExportService {
  return new DiagnosticExportService({
    logDirectory: directory,
    runtime: {
      applicationVersion: '0.3.0-test',
      electronVersion: '43.0.0-test',
      nodeVersion: '24.0.0-test',
      operatingSystem: 'linux',
      operatingSystemRelease: 'test',
      architecture: 'x64',
      isPackaged: false,
      display: { session: 'wayland', waylandDetected: true, ozonePlatform: 'wayland' },
    },
    now: () => new Date('2026-07-27T12:00:01.000Z'),
    createTemporaryName: () => 'inline-translation-diagnostics',
  });
}

const successfulProvider: TextGenerationProvider = {
  async *stream() {
    yield JSON.stringify({
      inputKind: 'word',
      detectedSourceLanguage: 'en',
      translation: TRANSLATION_CANARY,
      pronunciation: '',
      pronunciationSystem: '',
      senses: [],
    });
  },
  testConnection: () => Promise.resolve(),
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('inline Translation structured failure logging', () => {
  it('does not record successful inline translations or confirmed cancellation', async () => {
    const directory = createDirectory();
    const logger = createLogger(directory);
    const service = createService(successfulProvider, logger);

    await expect(service.translate(request)).resolves.toMatchObject({
      translation: TRANSLATION_CANARY,
    });

    let streamStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      streamStarted = resolve;
    });
    const cancelledService = createService({
      async *stream(providerRequest) {
        streamStarted();
        await new Promise<void>((_resolve, reject) => {
          providerRequest.signal.addEventListener('abort', () => {
            reject(new TranslationError(
              TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED,
              PROVIDER_ERROR_CANARY,
              true,
            ));
          }, { once: true });
        });
        yield '';
      },
      testConnection: () => Promise.resolve(),
    }, logger);
    const pending = cancelledService.translate(request);
    await started;
    expect(cancelledService.cancel()).toBe(true);
    await expect(pending).rejects.toMatchObject({
      code: TRANSLATION_ERROR_CODES.TRANSLATION_INTERRUPTED,
    });

    await logger.flush();
    expect(readRecords(directory)).toEqual([]);
  });

  it('keeps a real Provider failure when it races with cancellation', async () => {
    const directory = createDirectory();
    const logger = createLogger(directory);
    let streamStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      streamStarted = resolve;
    });
    const service = createService({
      async *stream(providerRequest) {
        streamStarted();
        await new Promise<void>((_resolve, reject) => {
          providerRequest.signal.addEventListener('abort', () => {
            reject(new SummaryError(
              SUMMARY_ERROR_CODES.SUMMARY_NETWORK_ERROR,
              PROVIDER_ERROR_CANARY,
              true,
            ));
          }, { once: true });
        });
        yield '';
      },
      testConnection: () => Promise.resolve(),
    }, logger);

    const pending = service.translate(request);
    await started;
    expect(service.cancel()).toBe(true);
    await expect(pending).rejects.toMatchObject({
      code: SUMMARY_ERROR_CODES.SUMMARY_NETWORK_ERROR,
    });

    await logger.flush();
    expect(readRecords(directory)).toEqual([
      expect.objectContaining({
        event: TRANSLATION_LOG_EVENTS.inlineFailed,
        context: {
          stage: 'provider',
          errorCode: TRANSLATION_INLINE_FAILURE_ERROR_CODES.networkError,
          durationMs: expect.any(Number),
          success: false,
        },
      }),
    ]);
  });

  it('writes one safe final record for each configuration, Provider, and parse failure', async () => {
    const directory = createDirectory();
    const logger = createLogger(directory);

    const unavailable = createService(successfulProvider, logger, false);
    await expect(unavailable.translate(request)).rejects.toMatchObject({
      code: TRANSLATION_ERROR_CODES.TRANSLATION_PROVIDER_NOT_CONFIGURED,
    });

    const providerFailure = createService({
      async *stream() {
        throw new SummaryError(
          SUMMARY_ERROR_CODES.SUMMARY_NETWORK_ERROR,
          PROVIDER_ERROR_CANARY,
          true,
        );
        yield '';
      },
      testConnection: () => Promise.resolve(),
    }, logger);
    await expect(providerFailure.translate(request)).rejects.toMatchObject({
      code: SUMMARY_ERROR_CODES.SUMMARY_NETWORK_ERROR,
    });

    const parseFailure = createService({
      async *stream() {
        yield '';
      },
      testConnection: () => Promise.resolve(),
    }, logger);
    await expect(parseFailure.translate(request)).rejects.toMatchObject({
      code: TRANSLATION_ERROR_CODES.TRANSLATION_EMPTY_OUTPUT,
    });

    await logger.flush();
    const records = readRecords(directory);
    expect(records).toHaveLength(3);
    expect(records.map((record) => ({
      level: record.level,
      event: record.event,
      component: record.component,
      context: record.context,
    }))).toEqual([
      {
        level: 'error',
        event: TRANSLATION_LOG_EVENTS.inlineFailed,
        component: 'translation.inline',
        context: {
          stage: 'configuration',
          errorCode: TRANSLATION_INLINE_FAILURE_ERROR_CODES.providerNotConfigured,
          durationMs: expect.any(Number),
          success: false,
        },
      },
      {
        level: 'error',
        event: TRANSLATION_LOG_EVENTS.inlineFailed,
        component: 'translation.inline',
        context: {
          stage: 'provider',
          errorCode: TRANSLATION_INLINE_FAILURE_ERROR_CODES.networkError,
          durationMs: expect.any(Number),
          success: false,
        },
      },
      {
        level: 'error',
        event: TRANSLATION_LOG_EVENTS.inlineFailed,
        component: 'translation.inline',
        context: {
          stage: 'parse',
          errorCode: TRANSLATION_INLINE_FAILURE_ERROR_CODES.emptyOutput,
          durationMs: expect.any(Number),
          success: false,
        },
      },
    ]);

    const report = await createDiagnosticExport(directory).buildReport();
    expect(report.logs.records).toHaveLength(3);
    expect(report.logs.records.map((record) => record.context)).toEqual([
      {
        stage: 'configuration',
        errorCode: TRANSLATION_INLINE_FAILURE_ERROR_CODES.providerNotConfigured,
        durationMs: expect.any(Number),
        success: false,
      },
      {
        stage: 'provider',
        errorCode: TRANSLATION_INLINE_FAILURE_ERROR_CODES.networkError,
        durationMs: expect.any(Number),
        success: false,
      },
      {
        stage: 'parse',
        errorCode: TRANSLATION_INLINE_FAILURE_ERROR_CODES.emptyOutput,
        durationMs: expect.any(Number),
        success: false,
      },
    ]);

    const serialized = JSON.stringify({ records, report });
    for (const canary of [
      SOURCE_CANARY,
      CONTEXT_CANARY,
      TRANSLATION_CANARY,
      MODEL_CANARY,
      EXPERT_CANARY,
      API_KEY_CANARY,
      PROVIDER_ERROR_CANARY,
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });
});
