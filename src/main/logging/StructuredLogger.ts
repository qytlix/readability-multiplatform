import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';

export const STRUCTURED_LOG_SCHEMA_VERSION = 1 as const;
export const DEFAULT_LOG_RETENTION_DAYS = 7;
export const DEFAULT_LOG_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_LOG_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const LOG_FILE_PATTERN = /^structured-(\d{4}-\d{2}-\d{2})(?:-([1-9]\d*))?\.jsonl$/;
const MAX_IDENTIFIER_LENGTH = 96;
const MAX_CONTEXT_STRING_LENGTH = 96;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const FAILURE_NOTICE_PREFIX = 'Structured logger failure [';
const SAFE_IDENTIFIERS_WITH_SENSITIVE_MARKERS = new Set([
  'provider.secret.cleanup.failed',
  'PROVIDER_SECRET_CLEANUP_FAILED',
]);

const LOG_LEVEL_RANK = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

const CONTEXT_FIELD_TYPES = {
  feedId: 'number',
  entryId: 'number',
  taskRunId: 'number',
  providerId: 'number',
  count: 'number',
  successCount: 'number',
  failureCount: 'number',
  newCount: 'number',
  durationMs: 'number',
  httpStatus: 'number',
  errorCode: 'string',
  stage: 'string',
  trigger: 'string',
  outcome: 'string',
  success: 'boolean',
  phase: 'string',
  appVersion: 'string',
  platform: 'string',
  arch: 'string',
  architecture: 'string',
} as const;

type ContextFieldName = keyof typeof CONTEXT_FIELD_TYPES;
type ContextFieldType = (typeof CONTEXT_FIELD_TYPES)[ContextFieldName];

export type LogLevel = keyof typeof LOG_LEVEL_RANK;
export type AppInitializationPhase = 'services' | 'ipc' | 'window' | 'sync';

const APP_INITIALIZATION_PHASES = new Set<AppInitializationPhase>([
  'services',
  'ipc',
  'window',
  'sync',
]);

/**
 * The only context fields accepted by the first logging phase. Values are
 * identifiers or scalar measurements, never free-form user or provider data.
 */
export interface StructuredLogContext {
  feedId?: number;
  entryId?: number;
  taskRunId?: number;
  providerId?: number;
  count?: number;
  successCount?: number;
  failureCount?: number;
  newCount?: number;
  durationMs?: number;
  httpStatus?: number;
  errorCode?: string;
  stage?: string;
  trigger?: string;
  outcome?: string;
  success?: boolean;
  phase?: AppInitializationPhase;
  appVersion?: string;
  platform?: string;
  arch?: string;
  architecture?: string;
}

export interface StructuredLogRecord {
  schemaVersion: typeof STRUCTURED_LOG_SCHEMA_VERSION;
  timestamp: string;
  level: LogLevel;
  event: string;
  component: string;
  sessionId: string;
  context?: StructuredLogContext;
}

export interface StructuredLogRetention {
  maxAgeDays: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export type LogLineWriter = (filePath: string, line: string) => Promise<void>;
export type LogFailureNoticeWriter = (notice: string) => void;

export interface StructuredLoggerOptions {
  directory: string;
  minimumLevel?: LogLevel;
  retention?: Partial<StructuredLogRetention>;
  now?: () => Date;
  createSessionId?: () => string;
  /** Test seam for simulating append failures without weakening production writes. */
  writeLine?: LogLineWriter;
  /** Test seam for observing the otherwise stderr-only failure notice. */
  writeFailureNotice?: LogFailureNoticeWriter;
}

interface ManagedLogFile {
  name: string;
  dateKey: string;
  shard: number;
  size: number;
}

interface ActiveLogFile extends ManagedLogFile {
  filePath: string;
}

/**
 * Main-process-only JSONL logger. It intentionally has no Electron dependency;
 * the application lifecycle supplies a platform-specific directory later.
 */
export class StructuredLogger {
  readonly sessionId: string;

  private readonly minimumLevel: LogLevel;
  private readonly retention: StructuredLogRetention;
  private readonly now: () => Date;
  private readonly writeLine: LogLineWriter;
  private readonly writeFailureNotice: LogFailureNoticeWriter;
  private activeFile: ActiveLogFile | null = null;
  private failureNoticeWritten = false;
  private queue: Promise<void>;

  constructor(private readonly options: StructuredLoggerOptions) {
    this.minimumLevel = options.minimumLevel ?? 'info';
    this.retention = normalizeRetention(options.retention);
    this.now = options.now ?? (() => new Date());
    this.sessionId = createSafeSessionId(options.createSessionId);
    this.writeLine = options.writeLine ?? defaultWriteLine;
    this.writeFailureNotice = options.writeFailureNotice ?? defaultWriteFailureNotice;
    this.queue = Promise.resolve();
    this.enqueue(() => this.initialize());
  }

  debug(event: string, component: string, context?: StructuredLogContext): void {
    this.log('debug', event, component, context);
  }

  info(event: string, component: string, context?: StructuredLogContext): void {
    this.log('info', event, component, context);
  }

  warn(event: string, component: string, context?: StructuredLogContext): void {
    this.log('warn', event, component, context);
  }

  error(event: string, component: string, context?: StructuredLogContext): void {
    this.log('error', event, component, context);
  }

  /** Adds a record to the serial write queue. This method never throws. */
  log(
    level: LogLevel,
    event: string,
    component: string,
    context?: StructuredLogContext,
  ): void {
    if (!this.shouldWrite(level)) return;

    const record = this.buildRecord(level, event, component, context);
    if (!record) return;

    this.enqueue(() => this.writeRecord(record));
  }

  /** Resolves after all records queued before this call have been handled. */
  async flush(): Promise<void> {
    await this.queue;
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue
      .then(operation)
      .catch((error: unknown) => this.reportFailure(error));
  }

  private async initialize(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true });
    await this.selectActiveFile(getDateKey(this.safeNow()));
    await this.applyRetention();
  }

  private shouldWrite(level: LogLevel): boolean {
    return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[this.minimumLevel];
  }

  private buildRecord(
    level: LogLevel,
    event: string,
    component: string,
    context: StructuredLogContext | undefined,
  ): StructuredLogRecord | undefined {
    const safeEvent = sanitizeEventOrComponent(event);
    const safeComponent = sanitizeEventOrComponent(component);
    if (!safeEvent || !safeComponent) return undefined;

    const safeContext = sanitizeContext(context);
    return {
      schemaVersion: STRUCTURED_LOG_SCHEMA_VERSION,
      timestamp: this.safeNow().toISOString(),
      level,
      event: safeEvent,
      component: safeComponent,
      sessionId: this.sessionId,
      ...(safeContext ? { context: safeContext } : {}),
    };
  }

  private async writeRecord(record: StructuredLogRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const dateKey = getDateKey(new Date(record.timestamp));

    await this.ensureActiveFile(dateKey);
    if (!this.activeFile) return;

    if (
      this.activeFile.size > 0
      && this.activeFile.size + lineBytes > this.retention.maxFileBytes
    ) {
      await this.rotate(dateKey);
    }

    if (!this.activeFile) return;

    try {
      await this.writeLine(this.activeFile.filePath, line);
      this.activeFile.size += lineBytes;
    } catch (error: unknown) {
      // Logging failures are deliberately isolated from all application work.
      this.reportFailure(error);
      return;
    }
  }

  private async ensureActiveFile(dateKey: string): Promise<void> {
    if (this.activeFile?.dateKey === dateKey) return;

    await this.selectActiveFile(dateKey);
    await this.applyRetention();
  }

  private async selectActiveFile(dateKey: string): Promise<void> {
    const files = await this.listManagedFiles();
    const matchingFiles = files
      .filter((file) => file.dateKey === dateKey)
      .sort(compareManagedFiles);
    const latest = matchingFiles.at(-1);

    if (latest) {
      this.activeFile = {
        ...latest,
        filePath: path.join(this.options.directory, latest.name),
      };
      return;
    }

    const name = getLogFileName(dateKey, 0);
    this.activeFile = {
      name,
      dateKey,
      shard: 0,
      size: 0,
      filePath: path.join(this.options.directory, name),
    };
  }

  private async rotate(dateKey: string): Promise<void> {
    const currentShard = this.activeFile?.dateKey === dateKey
      ? this.activeFile.shard
      : -1;
    const nextShard = currentShard + 1;
    const name = getLogFileName(dateKey, nextShard);
    this.activeFile = {
      name,
      dateKey,
      shard: nextShard,
      size: 0,
      filePath: path.join(this.options.directory, name),
    };
    await this.applyRetention();
  }

  private async applyRetention(): Promise<void> {
    const activeFileName = this.activeFile?.name;
    const cutoffTime = this.safeNow().getTime()
      - this.retention.maxAgeDays * MILLISECONDS_PER_DAY;

    for (const file of await this.listManagedFiles()) {
      if (file.name === activeFileName || getDateStartTime(file.dateKey) >= cutoffTime) {
        continue;
      }
      await this.deleteManagedFile(file);
    }

    await this.enforceTotalCapacity();
  }

  private async enforceTotalCapacity(): Promise<void> {
    const activeFileName = this.activeFile?.name;
    const files = await this.listManagedFiles();
    let totalSize = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort(compareManagedFiles)) {
      if (totalSize <= this.retention.maxTotalBytes) break;
      if (file.name === activeFileName) continue;
      if (await this.deleteManagedFile(file)) {
        totalSize -= file.size;
      }
    }
  }

  private async listManagedFiles(): Promise<ManagedLogFile[]> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(this.options.directory, { withFileTypes: true });
    } catch (error: unknown) {
      this.reportFailure(error);
      return [];
    }

    const files: ManagedLogFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parsed = parseManagedLogFileName(entry.name);
      if (!parsed) continue;

      try {
        const metadata = await stat(path.join(this.options.directory, entry.name));
        files.push({ ...parsed, size: metadata.size });
      } catch (error: unknown) {
        // A concurrent removal is harmless, but the one-time notice still
        // makes a broader filesystem fault observable without exposing data.
        this.reportFailure(error);
      }
    }
    return files;
  }

  private async deleteManagedFile(file: ManagedLogFile): Promise<boolean> {
    try {
      await unlink(path.join(this.options.directory, file.name));
      return true;
    } catch (error: unknown) {
      this.reportFailure(error);
      return false;
    }
  }

  private reportFailure(error: unknown): void {
    if (this.failureNoticeWritten) return;

    this.failureNoticeWritten = true;
    try {
      this.writeFailureNotice(
        `${FAILURE_NOTICE_PREFIX}${getSafeSystemErrorCode(error)}]\n`,
      );
    } catch {
      // The fallback must never make a logging fault observable to the app.
    }
  }

  private safeNow(): Date {
    try {
      const value = this.now();
      return Number.isFinite(value.getTime()) ? value : new Date();
    } catch {
      return new Date();
    }
  }
}

function defaultWriteLine(filePath: string, line: string): Promise<void> {
  return appendFile(filePath, line, 'utf8');
}

function defaultWriteFailureNotice(notice: string): void {
  process.stderr.write(notice);
}

function normalizeRetention(
  value: Partial<StructuredLogRetention> | undefined,
): StructuredLogRetention {
  return {
    maxAgeDays: normalizePositiveInteger(value?.maxAgeDays, DEFAULT_LOG_RETENTION_DAYS),
    maxFileBytes: normalizePositiveInteger(value?.maxFileBytes, DEFAULT_LOG_MAX_FILE_BYTES),
    maxTotalBytes: normalizePositiveInteger(value?.maxTotalBytes, DEFAULT_LOG_MAX_TOTAL_BYTES),
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.floor(value)
    : fallback;
}

function createSafeSessionId(createSessionId: (() => string) | undefined): string {
  try {
    const candidate = createSessionId?.() ?? randomUUID();
    return sanitizeIdentifier(candidate, MAX_IDENTIFIER_LENGTH) ?? randomUUID();
  } catch {
    return randomUUID();
  }
}

function sanitizeEventOrComponent(value: unknown): string | undefined {
  return sanitizeIdentifier(value, MAX_IDENTIFIER_LENGTH, /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/);
}

function sanitizeContext(value: unknown): StructuredLogContext | undefined {
  if (!isRecord(value)) return undefined;

  const context: Partial<StructuredLogContext> = {};
  for (const field of Object.keys(CONTEXT_FIELD_TYPES) as ContextFieldName[]) {
    const sanitized = sanitizeContextValue(
      field,
      value[field],
      CONTEXT_FIELD_TYPES[field],
    );
    if (sanitized !== undefined) {
      assignContextField(context, field, sanitized);
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

function sanitizeContextValue(
  field: ContextFieldName,
  value: unknown,
  expectedType: ContextFieldType,
): string | number | boolean | undefined {
  if (expectedType === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (expectedType === 'number') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : undefined;
  }
  if (field === 'phase') {
    return isAppInitializationPhase(value) ? value : undefined;
  }
  return typeof value === 'string'
    ? sanitizeIdentifier(value, MAX_CONTEXT_STRING_LENGTH)
    : undefined;
}

function assignContextField(
  context: Partial<StructuredLogContext>,
  field: ContextFieldName,
  value: string | number | boolean,
): void {
  switch (field) {
    case 'feedId':
      if (typeof value === 'number') context.feedId = value;
      return;
    case 'entryId':
      if (typeof value === 'number') context.entryId = value;
      return;
    case 'taskRunId':
      if (typeof value === 'number') context.taskRunId = value;
      return;
    case 'providerId':
      if (typeof value === 'number') context.providerId = value;
      return;
    case 'count':
      if (typeof value === 'number') context.count = value;
      return;
    case 'successCount':
      if (typeof value === 'number') context.successCount = value;
      return;
    case 'failureCount':
      if (typeof value === 'number') context.failureCount = value;
      return;
    case 'newCount':
      if (typeof value === 'number') context.newCount = value;
      return;
    case 'durationMs':
      if (typeof value === 'number') context.durationMs = value;
      return;
    case 'httpStatus':
      if (typeof value === 'number') context.httpStatus = value;
      return;
    case 'errorCode':
      if (typeof value === 'string') context.errorCode = value;
      return;
    case 'stage':
      if (typeof value === 'string') context.stage = value;
      return;
    case 'trigger':
      if (typeof value === 'string') context.trigger = value;
      return;
    case 'outcome':
      if (typeof value === 'string') context.outcome = value;
      return;
    case 'success':
      if (typeof value === 'boolean') context.success = value;
      return;
    case 'phase':
      if (isAppInitializationPhase(value)) context.phase = value;
      return;
    case 'appVersion':
      if (typeof value === 'string') context.appVersion = value;
      return;
    case 'platform':
      if (typeof value === 'string') context.platform = value;
      return;
    case 'arch':
      if (typeof value === 'string') context.arch = value;
      return;
    case 'architecture':
      if (typeof value === 'string') context.architecture = value;
  }
}

function sanitizeIdentifier(
  value: unknown,
  maxLength: number,
  pattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
): string | undefined {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxLength
    || !pattern.test(value)
    || (
      containsSensitiveMarker(value)
      && !SAFE_IDENTIFIERS_WITH_SENSITIVE_MARKERS.has(value)
    )
  ) {
    return undefined;
  }
  return value;
}

function containsSensitiveMarker(value: string): boolean {
  return /(api[_-]?key|authorization|bearer|token|secret|password|canary|sk-[A-Za-z0-9])/i.test(value);
}

function isAppInitializationPhase(value: unknown): value is AppInitializationPhase {
  return typeof value === 'string' && APP_INITIALIZATION_PHASES.has(value as AppInitializationPhase);
}

function getSafeSystemErrorCode(error: unknown): string {
  if (!isRecord(error)) return 'UNKNOWN';

  try {
    const code = error.code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(code)
      ? code
      : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDateStartTime(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00.000Z`);
}

function getLogFileName(dateKey: string, shard: number): string {
  return shard === 0
    ? `structured-${dateKey}.jsonl`
    : `structured-${dateKey}-${shard}.jsonl`;
}

function parseManagedLogFileName(name: string): Omit<ManagedLogFile, 'size'> | undefined {
  const match = LOG_FILE_PATTERN.exec(name);
  if (!match) return undefined;

  const dateKey = match[1];
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || getDateKey(date) !== dateKey) return undefined;

  const shard = match[2] ? Number(match[2]) : 0;
  if (!Number.isSafeInteger(shard)) return undefined;
  return { name, dateKey, shard };
}

function compareManagedFiles(left: ManagedLogFile, right: ManagedLogFile): number {
  return left.dateKey.localeCompare(right.dateKey) || left.shard - right.shard;
}
