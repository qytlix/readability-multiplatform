import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ProviderProfile,
  SaveProviderRequest,
} from '../../../src/shared/contracts/provider.types';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../../src/shared/errors/summary.errors';
import type { SummaryProvider, SummaryProviderRequest } from '../../../src/main/ai/provider/SummaryProvider';
import {
  logProviderConfigFailed,
  PROVIDER_LOG_ERROR_CODES,
  PROVIDER_LOG_EVENTS,
  type ProviderOperationLogger,
} from '../../../src/main/ai/services/ProviderLogging';
import { ProviderService } from '../../../src/main/ai/services/ProviderService';
import type {
  ActiveProviderProfile,
  ProviderProfileStore,
} from '../../../src/main/ai/stores/ProviderProfileStore';
import type { SecretStore, SecretStorageMode } from '../../../src/main/ai/stores/SecretStore';
import { StructuredLogger } from '../../../src/main/logging/StructuredLogger';

interface CapturedProviderLog {
  level: 'info' | 'warn' | 'error';
  event: string;
  component: string;
  context: object;
}

interface SecretStoreDouble {
  save(reference: string, apiKey: string): void;
  read(reference: string): string;
  delete(reference: string): void;
  getStorageMode(): SecretStorageMode;
  has(reference: string): boolean;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRequest(overrides: Partial<SaveProviderRequest> = {}): SaveProviderRequest {
  return {
    baseUrl: 'https://provider.example.test/v1',
    model: 'gpt-5.4-mini',
    apiKey: 'api-key-for-test',
    ...overrides,
  };
}

function createActiveProfile(
  overrides: Partial<ActiveProviderProfile> = {},
): ActiveProviderProfile {
  return {
    id: 41,
    providerKind: 'openai-compatible',
    baseUrl: 'https://provider.example.test/v1',
    model: 'gpt-5.4-mini',
    apiKeyRef: 'stored-secret-reference',
    isActive: true,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  };
}

function createPublicProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  const activeProfile = createActiveProfile();
  return {
    id: activeProfile.id,
    providerKind: activeProfile.providerKind,
    baseUrl: activeProfile.baseUrl,
    model: activeProfile.model,
    isActive: activeProfile.isActive,
    createdAt: activeProfile.createdAt,
    updatedAt: activeProfile.updatedAt,
    ...overrides,
  };
}

function createProfileStore(
  activeProfile: ActiveProviderProfile | undefined,
  saveProfile: () => ProviderProfile = () => createPublicProfile(),
): ProviderProfileStore {
  const double = {
    findActiveWithSecret: vi.fn(() => activeProfile),
    saveActive: vi.fn(() => saveProfile()),
  };
  return double as unknown as ProviderProfileStore;
}

function createSecretStore(
  overrides: Partial<SecretStoreDouble> = {},
): SecretStore {
  const double: SecretStoreDouble = {
    save: () => undefined,
    read: () => 'stored-api-key',
    delete: () => undefined,
    getStorageMode: () => 'secure',
    has: () => true,
    ...overrides,
  };
  return double as unknown as SecretStore;
}

function createProvider(
  testConnection: (request: Omit<SummaryProviderRequest, 'prompt' | 'signal'>) => Promise<void> = async () => undefined,
): SummaryProvider {
  return {
    async *stream(): AsyncIterable<string> {
      yield '';
    },
    testConnection,
  };
}

function createCapturingLogger(logs: CapturedProviderLog[]): ProviderOperationLogger {
  return {
    info(event, component, context) {
      logs.push({ level: 'info', event, component, context: { ...context } });
    },
    warn(event, component, context) {
      logs.push({ level: 'warn', event, component, context: { ...context } });
    },
    error(event, component, context) {
      logs.push({ level: 'error', event, component, context: { ...context } });
    },
  };
}

describe('ProviderService structured logging', () => {
  it('records one completed configuration event and no cleanup warning after a normal replacement', () => {
    const logs: CapturedProviderLog[] = [];
    const service = new ProviderService(
      createProfileStore(createActiveProfile(), () => createPublicProfile({ id: 73 })),
      createSecretStore(),
      createProvider(),
      createCapturingLogger(logs),
    );

    expect(service.save(createRequest())).toMatchObject({ id: 73, hasApiKey: true });
    expect(logs).toEqual([
      {
        level: 'info',
        event: PROVIDER_LOG_EVENTS.configCompleted,
        component: 'provider.service',
        context: expect.objectContaining({ providerId: 73, success: true }),
      },
    ]);
    expectDuration(logs[0]);
  });

  it('records exactly one fixed validation failure without changing the original error', () => {
    const logs: CapturedProviderLog[] = [];
    const service = new ProviderService(
      createProfileStore(undefined),
      createSecretStore(),
      createProvider(),
      createCapturingLogger(logs),
    );

    const error = captureThrown(() => service.save(createRequest({
      baseUrl: 'not-a-url',
    })));
    expect(error).toBeInstanceOf(SummaryError);
    expect((error as SummaryError).code).toBe(SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'error',
      event: PROVIDER_LOG_EVENTS.configFailed,
      context: {
        success: false,
        stage: 'validate',
        errorCode: PROVIDER_LOG_ERROR_CODES.invalidRequest,
      },
    });
    expectDuration(logs[0]);
  });

  it('records one secret failure and one profile persistence failure', () => {
    const secretLogs: CapturedProviderLog[] = [];
    const secretError = new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_KEY_STORAGE_UNAVAILABLE,
      'SECRET_STORAGE_CANARY',
      false,
    );
    const secretService = new ProviderService(
      createProfileStore(undefined),
      createSecretStore({ save: () => { throw secretError; } }),
      createProvider(),
      createCapturingLogger(secretLogs),
    );

    expect(captureThrown(() => secretService.save(createRequest()))).toBe(secretError);
    expect(secretLogs).toHaveLength(1);
    expect(secretLogs[0].context).toMatchObject({
      stage: 'key',
      errorCode: PROVIDER_LOG_ERROR_CODES.keyStorageUnavailable,
    });

    const profileLogs: CapturedProviderLog[] = [];
    const profileError = new Error('PROFILE_PERSIST_CANARY');
    const profileService = new ProviderService(
      createProfileStore(undefined, () => { throw profileError; }),
      createSecretStore(),
      createProvider(),
      createCapturingLogger(profileLogs),
    );

    expect(captureThrown(() => profileService.save(createRequest()))).toBe(profileError);
    expect(profileLogs).toHaveLength(1);
    expect(profileLogs[0].context).toMatchObject({
      stage: 'profile',
      errorCode: PROVIDER_LOG_ERROR_CODES.profileSaveFailed,
    });
  });

  it('warns about old-secret cleanup failure while retaining successful configuration behavior', () => {
    const logs: CapturedProviderLog[] = [];
    const cleanupError = new Error('OLD_SECRET_CLEANUP_CANARY');
    const service = new ProviderService(
      createProfileStore(createActiveProfile(), () => createPublicProfile({ id: 74 })),
      createSecretStore({ delete: () => { throw cleanupError; } }),
      createProvider(),
      createCapturingLogger(logs),
    );

    expect(service.save(createRequest())).toMatchObject({ id: 74, hasApiKey: true });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      level: 'warn',
      event: PROVIDER_LOG_EVENTS.secretCleanupFailed,
      context: {
        providerId: 74,
        stage: 'cleanup',
        errorCode: PROVIDER_LOG_ERROR_CODES.secretCleanupFailed,
      },
    });
    expect(logs[1]).toMatchObject({
      level: 'info',
      event: PROVIDER_LOG_EVENTS.configCompleted,
      context: { providerId: 74, success: true },
    });
  });

  it('records one connection completed event and preserves one fixed failure classification', async () => {
    const successfulLogs: CapturedProviderLog[] = [];
    const successfulService = new ProviderService(
      createProfileStore(createActiveProfile({ id: 81 })),
      createSecretStore(),
      createProvider(),
      createCapturingLogger(successfulLogs),
    );

    await expect(successfulService.testConnection()).resolves.toEqual({
      ok: true,
      message: 'Provider connection succeeded.',
    });
    expect(successfulLogs).toHaveLength(1);
    expect(successfulLogs[0]).toMatchObject({
      level: 'info',
      event: PROVIDER_LOG_EVENTS.connectionCompleted,
      context: { providerId: 81, success: true },
    });

    const requestLogs: CapturedProviderLog[] = [];
    const requestError = new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_AUTH,
      'PROVIDER_AUTH_CANARY',
      false,
    );
    const requestService = new ProviderService(
      createProfileStore(createActiveProfile({ id: 82 })),
      createSecretStore(),
      createProvider(async () => { throw requestError; }),
      createCapturingLogger(requestLogs),
    );

    await expect(requestService.testConnection()).rejects.toBe(requestError);
    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]).toMatchObject({
      level: 'error',
      event: PROVIDER_LOG_EVENTS.connectionFailed,
      context: {
        providerId: 82,
        success: false,
        stage: 'request',
        errorCode: PROVIDER_LOG_ERROR_CODES.providerAuth,
      },
    });
    expectDuration(requestLogs[0]);
  });

  it('distinguishes missing configuration and unavailable secrets without fabricating provider IDs', async () => {
    const missingLogs: CapturedProviderLog[] = [];
    const missingService = new ProviderService(
      createProfileStore(undefined),
      createSecretStore(),
      createProvider(),
      createCapturingLogger(missingLogs),
    );

    await expect(missingService.testConnection()).rejects.toMatchObject({
      code: SUMMARY_ERROR_CODES.SUMMARY_PROVIDER_NOT_CONFIGURED,
    });
    expect(missingLogs).toHaveLength(1);
    expect(missingLogs[0].context).toEqual(expect.objectContaining({
      stage: 'profile',
      errorCode: PROVIDER_LOG_ERROR_CODES.providerNotConfigured,
    }));
    expect(missingLogs[0].context).not.toHaveProperty('providerId');

    const secretLogs: CapturedProviderLog[] = [];
    const missingSecret = new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
      'MISSING_SECRET_CANARY',
      true,
    );
    const secretService = new ProviderService(
      createProfileStore(createActiveProfile({ id: 83 })),
      createSecretStore({ read: () => { throw missingSecret; } }),
      createProvider(),
      createCapturingLogger(secretLogs),
    );

    await expect(secretService.testConnection()).rejects.toBe(missingSecret);
    expect(secretLogs).toHaveLength(1);
    expect(secretLogs[0].context).toMatchObject({
      providerId: 83,
      stage: 'key',
      errorCode: PROVIDER_LOG_ERROR_CODES.keyMissing,
    });
  });

  it('isolates logger exceptions from configuration results and connection exceptions', async () => {
    const throwingLogger: ProviderOperationLogger = {
      info: () => { throw new Error('LOGGER_INFO_CANARY'); },
      warn: () => { throw new Error('LOGGER_WARN_CANARY'); },
      error: () => { throw new Error('LOGGER_ERROR_CANARY'); },
    };
    const saveService = new ProviderService(
      createProfileStore(undefined, () => createPublicProfile({ id: 91 })),
      createSecretStore(),
      createProvider(),
      throwingLogger,
    );

    expect(saveService.save(createRequest())).toMatchObject({ id: 91, hasApiKey: true });

    const providerError = new Error('ORIGINAL_PROVIDER_ERROR_CANARY');
    const connectionService = new ProviderService(
      createProfileStore(createActiveProfile({ id: 92 })),
      createSecretStore(),
      createProvider(async () => { throw providerError; }),
      throwingLogger,
    );

    await expect(connectionService.testConnection()).rejects.toBe(providerError);
  });

  it('drops invalid Provider stage and error-code combinations before invoking the logger', () => {
    const logs: CapturedProviderLog[] = [];
    const logger = createCapturingLogger(logs);

    logProviderConfigFailed(logger, {
      durationMs: 1,
      success: false,
      stage: 'free-text-stage' as never,
      errorCode: PROVIDER_LOG_ERROR_CODES.keyMissing,
    });
    logProviderConfigFailed(logger, {
      durationMs: 1,
      success: false,
      stage: 'validate',
      errorCode: PROVIDER_LOG_ERROR_CODES.keyMissing as never,
    });

    expect(logs).toEqual([]);
  });

  it('keeps Provider privacy canaries out of logger arguments and JSONL', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shale-provider-log-'));
    temporaryDirectories.push(directory);
    const jsonlLogger = new StructuredLogger({
      directory,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
      createSessionId: () => 'provider-log-test-session',
    });
    const logs: CapturedProviderLog[] = [];
    const observingLogger: ProviderOperationLogger = {
      info(event, component, context) {
        logs.push({ level: 'info', event, component, context: { ...context } });
        jsonlLogger.info(event, component, context);
      },
      warn(event, component, context) {
        logs.push({ level: 'warn', event, component, context: { ...context } });
        jsonlLogger.warn(event, component, context);
      },
      error(event, component, context) {
        logs.push({ level: 'error', event, component, context: { ...context } });
        jsonlLogger.error(event, component, context);
      },
    };
    const canaries = [
      'API_KEY_CANARY',
      'provider-private.example.test',
      'MODEL_CANARY',
      'AUTHORIZATION_CANARY',
      'PROMPT_CANARY',
      'RESPONSE_CANARY',
      'PROVIDER_ERROR_CANARY',
    ];
    const service = new ProviderService(
      createProfileStore(createActiveProfile({
        id: 101,
        baseUrl: `https://${canaries[1]}/v1`,
        model: 'MODEL_CANARY',
      }), () => createPublicProfile({
        id: 101,
        baseUrl: `https://${canaries[1]}/v1`,
        model: 'MODEL_CANARY',
      })),
      createSecretStore({ read: () => canaries[0] }),
      createProvider(async () => {
        throw new Error(canaries.slice(3).join('|'));
      }),
      observingLogger,
    );

    service.save(createRequest({
      baseUrl: 'https://safe-provider.example.test/v1',
      model: 'gpt-5.4-mini',
      apiKey: canaries[0],
    }));
    expect(captureThrown(() => service.save(createRequest({
      baseUrl: `https://${canaries[1]}/v1?query=${canaries[0]}`,
    })))).toBeInstanceOf(SummaryError);
    await expect(service.testConnection()).rejects.toThrow(canaries[6]);
    await jsonlLogger.flush();

    const serializedLogs = JSON.stringify(logs);
    const jsonl = readdirSync(directory)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => readFileSync(path.join(directory, name), 'utf8'))
      .join('');
    for (const canary of canaries) {
      expect(serializedLogs).not.toContain(canary);
      expect(jsonl).not.toContain(canary);
    }
    expect(logs.map((log) => log.event)).toEqual([
      PROVIDER_LOG_EVENTS.configCompleted,
      PROVIDER_LOG_EVENTS.configFailed,
      PROVIDER_LOG_EVENTS.connectionFailed,
    ]);
  });
});

function captureThrown(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected action to throw.');
}

function expectDuration(log: CapturedProviderLog | undefined): void {
  expect(log?.context).toHaveProperty('durationMs');
  const duration = (log?.context as { durationMs?: unknown }).durationMs;
  expect(typeof duration).toBe('number');
  if (typeof duration !== 'number') return;
  expect(Number.isSafeInteger(duration)).toBe(true);
  expect(duration).toBeGreaterThanOrEqual(0);
}
