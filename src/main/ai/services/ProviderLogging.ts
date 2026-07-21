import { performance } from 'node:perf_hooks';

export const PROVIDER_LOG_EVENTS = {
  configCompleted: 'provider.config.completed',
  configFailed: 'provider.config.failed',
  connectionCompleted: 'provider.connection.completed',
  connectionFailed: 'provider.connection.failed',
  secretCleanupFailed: 'provider.secret.cleanup.failed',
} as const;

export const PROVIDER_LOG_COMPONENT = 'provider.service';

export const PROVIDER_CONFIG_STAGES = [
  'validate',
  'profileLookup',
  'profileSave',
  'key',
] as const;

export const PROVIDER_CONNECTION_STAGES = [
  'profile',
  'key',
  'request',
] as const;

export const PROVIDER_LOG_ERROR_CODES = {
  invalidRequest: 'SUMMARY_INVALID_REQUEST',
  keyMissing: 'SUMMARY_KEY_MISSING',
  keyStorageUnavailable: 'SUMMARY_KEY_STORAGE_UNAVAILABLE',
  profileSaveFailed: 'PROVIDER_PROFILE_SAVE_FAILED',
  providerNotConfigured: 'SUMMARY_PROVIDER_NOT_CONFIGURED',
  profileLookupFailed: 'PROVIDER_PROFILE_LOOKUP_FAILED',
  providerAuth: 'SUMMARY_PROVIDER_AUTH',
  providerRequestFailed: 'SUMMARY_PROVIDER_REQUEST_FAILED',
  providerTimeout: 'SUMMARY_PROVIDER_TIMEOUT',
  providerInterrupted: 'SUMMARY_INTERRUPTED',
  networkError: 'SUMMARY_NETWORK_ERROR',
  unknownError: 'SUMMARY_UNKNOWN_ERROR',
  secretCleanupFailed: 'PROVIDER_SECRET_CLEANUP_FAILED',
} as const;

export type ProviderConfigStage = (typeof PROVIDER_CONFIG_STAGES)[number];
export type ProviderConnectionStage = (typeof PROVIDER_CONNECTION_STAGES)[number];
export type ProviderLogErrorCode = (
  typeof PROVIDER_LOG_ERROR_CODES
)[keyof typeof PROVIDER_LOG_ERROR_CODES];

export interface ProviderCompletedLogContext {
  providerId: number;
  durationMs: number;
  success: true;
}

export interface ProviderConfigFailedLogContext {
  durationMs: number;
  success: false;
  stage: ProviderConfigStage;
  errorCode: ProviderLogErrorCode;
}

export interface ProviderConnectionFailedLogContext {
  providerId?: number;
  durationMs: number;
  success: false;
  stage: ProviderConnectionStage;
  errorCode: ProviderLogErrorCode;
}

export interface ProviderSecretCleanupFailedLogContext {
  providerId: number;
  durationMs: number;
  stage: 'cleanup';
  errorCode: typeof PROVIDER_LOG_ERROR_CODES.secretCleanupFailed;
}

const PROVIDER_CONFIG_ERROR_CODES_BY_STAGE = {
  validate: [PROVIDER_LOG_ERROR_CODES.invalidRequest],
  profileLookup: [PROVIDER_LOG_ERROR_CODES.profileLookupFailed],
  profileSave: [PROVIDER_LOG_ERROR_CODES.profileSaveFailed],
  key: [
    PROVIDER_LOG_ERROR_CODES.keyMissing,
    PROVIDER_LOG_ERROR_CODES.keyStorageUnavailable,
  ],
} as const satisfies Record<ProviderConfigStage, readonly ProviderLogErrorCode[]>;

const PROVIDER_CONNECTION_ERROR_CODES_BY_STAGE = {
  profile: [
    PROVIDER_LOG_ERROR_CODES.providerNotConfigured,
    PROVIDER_LOG_ERROR_CODES.profileLookupFailed,
  ],
  key: [
    PROVIDER_LOG_ERROR_CODES.keyMissing,
    PROVIDER_LOG_ERROR_CODES.keyStorageUnavailable,
  ],
  request: [
    PROVIDER_LOG_ERROR_CODES.providerAuth,
    PROVIDER_LOG_ERROR_CODES.providerRequestFailed,
    PROVIDER_LOG_ERROR_CODES.providerTimeout,
    PROVIDER_LOG_ERROR_CODES.providerInterrupted,
    PROVIDER_LOG_ERROR_CODES.networkError,
    PROVIDER_LOG_ERROR_CODES.unknownError,
  ],
} as const satisfies Record<ProviderConnectionStage, readonly ProviderLogErrorCode[]>;

/** The limited logging surface required by Provider configuration operations. */
export interface ProviderOperationLogger {
  info(
    event:
      | typeof PROVIDER_LOG_EVENTS.configCompleted
      | typeof PROVIDER_LOG_EVENTS.connectionCompleted,
    component: typeof PROVIDER_LOG_COMPONENT,
    context: ProviderCompletedLogContext,
  ): void;
  warn(
    event: typeof PROVIDER_LOG_EVENTS.secretCleanupFailed,
    component: typeof PROVIDER_LOG_COMPONENT,
    context: ProviderSecretCleanupFailedLogContext,
  ): void;
  error(
    event:
      | typeof PROVIDER_LOG_EVENTS.configFailed
      | typeof PROVIDER_LOG_EVENTS.connectionFailed,
    component: typeof PROVIDER_LOG_COMPONENT,
    context: ProviderConfigFailedLogContext | ProviderConnectionFailedLogContext,
  ): void;
}

export function elapsedProviderMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function logProviderConfigCompleted(
  logger: ProviderOperationLogger | undefined,
  context: ProviderCompletedLogContext,
): void {
  if (!isCompletedContext(context)) return;

  try {
    logger?.info(PROVIDER_LOG_EVENTS.configCompleted, PROVIDER_LOG_COMPONENT, {
      providerId: context.providerId,
      durationMs: context.durationMs,
      success: true,
    });
  } catch {
    // Logging is observational and must not change Provider configuration behavior.
  }
}

export function logProviderConfigFailed(
  logger: ProviderOperationLogger | undefined,
  context: ProviderConfigFailedLogContext,
): void {
  if (
    !isSafeDuration(context.durationMs)
    || !isAllowedConfigFailure(context.stage, context.errorCode)
  ) {
    return;
  }

  try {
    logger?.error(PROVIDER_LOG_EVENTS.configFailed, PROVIDER_LOG_COMPONENT, {
      durationMs: context.durationMs,
      success: false,
      stage: context.stage,
      errorCode: context.errorCode,
    });
  } catch {
    // Logging is observational and must not change Provider configuration behavior.
  }
}

export function logProviderConnectionCompleted(
  logger: ProviderOperationLogger | undefined,
  context: ProviderCompletedLogContext,
): void {
  if (!isCompletedContext(context)) return;

  try {
    logger?.info(PROVIDER_LOG_EVENTS.connectionCompleted, PROVIDER_LOG_COMPONENT, {
      providerId: context.providerId,
      durationMs: context.durationMs,
      success: true,
    });
  } catch {
    // Logging is observational and must not change Provider connection behavior.
  }
}

export function logProviderConnectionFailed(
  logger: ProviderOperationLogger | undefined,
  context: ProviderConnectionFailedLogContext,
): void {
  if (
    !isSafeDuration(context.durationMs)
    || !isAllowedConnectionFailure(context.stage, context.errorCode)
    || (context.providerId !== undefined && !isSafeProviderId(context.providerId))
  ) {
    return;
  }

  try {
    logger?.error(PROVIDER_LOG_EVENTS.connectionFailed, PROVIDER_LOG_COMPONENT, {
      durationMs: context.durationMs,
      success: false,
      stage: context.stage,
      errorCode: context.errorCode,
      ...(context.providerId === undefined ? {} : { providerId: context.providerId }),
    });
  } catch {
    // Logging is observational and must not change Provider connection behavior.
  }
}

export function logProviderSecretCleanupFailed(
  logger: ProviderOperationLogger | undefined,
  context: ProviderSecretCleanupFailedLogContext,
): void {
  if (
    context.stage !== 'cleanup'
    || context.errorCode !== PROVIDER_LOG_ERROR_CODES.secretCleanupFailed
    || !isSafeProviderId(context.providerId)
    || !isSafeDuration(context.durationMs)
  ) {
    return;
  }

  try {
    logger?.warn(PROVIDER_LOG_EVENTS.secretCleanupFailed, PROVIDER_LOG_COMPONENT, {
      providerId: context.providerId,
      durationMs: context.durationMs,
      stage: 'cleanup',
      errorCode: PROVIDER_LOG_ERROR_CODES.secretCleanupFailed,
    });
  } catch {
    // Logging is observational and must not change Provider configuration behavior.
  }
}

function isCompletedContext(context: ProviderCompletedLogContext): boolean {
  return isSafeProviderId(context.providerId)
    && isSafeDuration(context.durationMs)
    && context.success === true;
}

function isAllowedConfigFailure(
  stage: unknown,
  errorCode: unknown,
): stage is ProviderConfigStage {
  if (!PROVIDER_CONFIG_STAGES.includes(stage as ProviderConfigStage)) return false;

  return PROVIDER_CONFIG_ERROR_CODES_BY_STAGE[stage as ProviderConfigStage].includes(
    errorCode as never,
  );
}

function isAllowedConnectionFailure(
  stage: unknown,
  errorCode: unknown,
): stage is ProviderConnectionStage {
  if (!PROVIDER_CONNECTION_STAGES.includes(stage as ProviderConnectionStage)) return false;

  return PROVIDER_CONNECTION_ERROR_CODES_BY_STAGE[
    stage as ProviderConnectionStage
  ].includes(errorCode as never);
}

function isSafeProviderId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSafeDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
