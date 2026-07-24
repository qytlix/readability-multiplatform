import { randomUUID } from 'node:crypto';
import { readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DIAGNOSTIC_LOG_READ_ISSUE_CODES,
  DIAGNOSTIC_LOG_SCHEMA_VERSION,
  DIAGNOSTIC_REPORT_VERSION,
  type DiagnosticLogReadIssue,
  type DiagnosticLogReadIssueCode,
  type DiagnosticLogRecord,
  type DiagnosticLogs,
  type DiagnosticReportV1,
  type DiagnosticRuntimeInfo,
} from '../../shared/contracts/diagnostics.types';
import {
  STRUCTURED_LOG_SCHEMA_VERSION,
  sanitizeStructuredLogRecord,
} from '../logging/StructuredLogger';

export const MAX_DIAGNOSTIC_LOG_RECORDS = 1_000;

const STRUCTURED_LOG_FILE_PATTERN = /^structured-(\d{4}-\d{2}-\d{2})(?:-([1-9]\d*))?\.jsonl$/;
const MAX_RUNTIME_VALUE_LENGTH = 128;

export interface DiagnosticLogDirectoryEntry {
  name: string;
  isFile(): boolean;
}

export interface DiagnosticExportFileOperations {
  readDirectory(directory: string): Promise<DiagnosticLogDirectoryEntry[]>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
}

export interface DiagnosticExportServiceOptions {
  logDirectory: string;
  runtime: DiagnosticRuntimeInfo;
  now?: () => Date;
  createTemporaryName?: () => string;
  fileOperations?: DiagnosticExportFileOperations;
}

const defaultFileOperations: DiagnosticExportFileOperations = {
  async readDirectory(directory: string): Promise<DiagnosticLogDirectoryEntry[]> {
    return readdir(directory, { withFileTypes: true });
  },
  readFile: (filePath) => readFile(filePath, 'utf8'),
  writeFile: (filePath, content) => writeFile(filePath, content, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  }),
  rename,
  unlink,
};

/**
 * Builds a self-contained diagnostics report from the local structured logs.
 * It intentionally has no Electron, network, database, or business-service
 * dependency. Reading uses only non-mutating filesystem operations.
 */
export class DiagnosticExportService {
  private readonly now: () => Date;
  private readonly createTemporaryName: () => string;
  private readonly fileOperations: DiagnosticExportFileOperations;

  constructor(private readonly options: DiagnosticExportServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.createTemporaryName = options.createTemporaryName ?? randomUUID;
    this.fileOperations = options.fileOperations ?? defaultFileOperations;
  }

  async buildReport(): Promise<DiagnosticReportV1> {
    const generatedAt = toIsoTimestamp(this.now());
    const logs = await this.readLogs();

    return {
      reportVersion: DIAGNOSTIC_REPORT_VERSION,
      generatedAt,
      application: {
        name: 'Shale',
        version: sanitizeRuntimeValue(this.options.runtime.applicationVersion),
        isPackaged: sanitizeBoolean(this.options.runtime.isPackaged),
      },
      runtime: {
        electronVersion: sanitizeRuntimeValue(this.options.runtime.electronVersion),
        nodeVersion: sanitizeRuntimeValue(this.options.runtime.nodeVersion),
        operatingSystem: sanitizeRuntimeValue(this.options.runtime.operatingSystem),
        operatingSystemRelease: sanitizeRuntimeValue(this.options.runtime.operatingSystemRelease),
        architecture: sanitizeRuntimeValue(this.options.runtime.architecture),
        display: sanitizeDisplayEnvironment(this.options.runtime.display),
      },
      logs,
    };
  }

  async exportToFile(filePath: string): Promise<void> {
    if (!filePath.trim()) throw new DiagnosticExportError('DIAGNOSTIC_EXPORT_WRITE_FAILED');

    const report = await this.buildReport();
    const content = `${JSON.stringify(report, null, 2)}\n`;
    const temporaryPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${this.createSafeTemporaryName()}.tmp`,
    );

    let renameCompleted = false;
    try {
      await this.fileOperations.writeFile(temporaryPath, content);
      await this.fileOperations.rename(temporaryPath, filePath);
      renameCompleted = true;
    } catch {
      if (!renameCompleted) {
        try {
          await this.fileOperations.unlink(temporaryPath);
        } catch {
          // The renderer receives only the stable export failure code below.
        }
      }
      throw new DiagnosticExportError('DIAGNOSTIC_EXPORT_WRITE_FAILED');
    }
  }

  private async readLogs(): Promise<DiagnosticLogs> {
    let entries: DiagnosticLogDirectoryEntry[];
    try {
      entries = await this.fileOperations.readDirectory(this.options.logDirectory);
    } catch {
      return {
        format: 'structured-jsonl',
        schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
        status: 'unavailable',
        omittedValidRecordCount: 0,
        issues: [{ code: DIAGNOSTIC_LOG_READ_ISSUE_CODES.directoryUnavailable, count: 1 }],
        records: [],
      };
    }

    const issueCounts = new Map<DiagnosticLogReadIssueCode, number>();
    const records: Array<{ record: DiagnosticLogRecord; order: number }> = [];
    let order = 0;
    const logFiles = entries
      .filter((entry) => entry.isFile() && STRUCTURED_LOG_FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareStructuredLogFiles);

    for (const fileName of logFiles) {
      let contents: string;
      try {
        contents = await this.fileOperations.readFile(path.join(this.options.logDirectory, fileName));
      } catch {
        incrementIssue(issueCounts, DIAGNOSTIC_LOG_READ_ISSUE_CODES.fileReadFailed);
        continue;
      }

      for (const line of contents.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const record = sanitizeLogLine(line);
        if (!record) {
          incrementIssue(issueCounts, DIAGNOSTIC_LOG_READ_ISSUE_CODES.recordMalformed);
          continue;
        }
        records.push({ record, order });
        order += 1;
      }
    }

    records.sort((left, right) => (
      left.record.timestamp.localeCompare(right.record.timestamp) || left.order - right.order
    ));
    const omittedValidRecordCount = Math.max(0, records.length - MAX_DIAGNOSTIC_LOG_RECORDS);
    const exportedRecords = records
      .slice(-MAX_DIAGNOSTIC_LOG_RECORDS)
      .map(({ record }) => record);
    const issues = toIssueList(issueCounts);

    return {
      format: 'structured-jsonl',
      schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
      status: issues.length > 0 ? 'partial' : 'complete',
      omittedValidRecordCount,
      issues,
      records: exportedRecords,
    };
  }

  private createSafeTemporaryName(): string {
    const candidate = this.createTemporaryName();
    return /^[A-Za-z0-9-]{1,128}$/.test(candidate) ? candidate : randomUUID();
  }
}

export class DiagnosticExportError extends Error {
  constructor(public readonly code: 'DIAGNOSTIC_EXPORT_WRITE_FAILED') {
    super('Unable to save diagnostic information. Choose another location and try again.');
    this.name = 'DiagnosticExportError';
  }
}

export function createDiagnosticFileName(now: Date = new Date()): string {
  const timestamp = toIsoTimestamp(now)
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `shale-diagnostics-${timestamp}.json`;
}

function sanitizeLogLine(line: string): DiagnosticLogRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }

  const record = sanitizeStructuredLogRecord(parsed);
  if (!record || record.schemaVersion !== STRUCTURED_LOG_SCHEMA_VERSION) return undefined;

  return {
    schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
    timestamp: record.timestamp,
    level: record.level,
    event: record.event,
    component: record.component,
    sessionId: record.sessionId,
    ...(record.context ? { context: { ...record.context } } : {}),
  };
}

function compareStructuredLogFiles(left: string, right: string): number {
  const leftMatch = STRUCTURED_LOG_FILE_PATTERN.exec(left);
  const rightMatch = STRUCTURED_LOG_FILE_PATTERN.exec(right);
  if (!leftMatch || !rightMatch) return left.localeCompare(right);

  return leftMatch[1].localeCompare(rightMatch[1])
    || Number(leftMatch[2] ?? 0) - Number(rightMatch[2] ?? 0);
}

function incrementIssue(
  issues: Map<DiagnosticLogReadIssueCode, number>,
  code: DiagnosticLogReadIssueCode,
): void {
  issues.set(code, (issues.get(code) ?? 0) + 1);
}

function toIssueList(
  issueCounts: Map<DiagnosticLogReadIssueCode, number>,
): DiagnosticLogReadIssue[] {
  return Object.values(DIAGNOSTIC_LOG_READ_ISSUE_CODES)
    .flatMap((code) => {
      const count = issueCounts.get(code);
      return count === undefined ? [] : [{ code, count }];
    });
}

function toIsoTimestamp(value: Date): string {
  return Number.isFinite(value.getTime()) ? value.toISOString() : new Date().toISOString();
}

function sanitizeRuntimeValue(value: string | null): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_RUNTIME_VALUE_LENGTH
    || /[\r\n]/.test(value)
  ) {
    return null;
  }
  return value;
}

function sanitizeBoolean(value: boolean | null): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function sanitizeDisplayEnvironment(
  value: DiagnosticRuntimeInfo['display'],
): DiagnosticRuntimeInfo['display'] {
  const session = ['wayland', 'x11', 'unknown', 'not-applicable'].includes(value.session)
    ? value.session
    : 'unknown';
  const ozonePlatform = ['wayland', 'x11', 'default', 'unknown', 'not-applicable']
    .includes(value.ozonePlatform)
    ? value.ozonePlatform
    : 'unknown';

  return {
    session,
    waylandDetected: value.waylandDetected === true,
    ozonePlatform,
  };
}
