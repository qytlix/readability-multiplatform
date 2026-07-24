export const DIAGNOSTIC_REPORT_VERSION = 1 as const;
export const DIAGNOSTIC_LOG_SCHEMA_VERSION = 1 as const;

export type DiagnosticDisplaySession =
  | 'wayland'
  | 'x11'
  | 'unknown'
  | 'not-applicable';

export type DiagnosticOzonePlatform =
  | 'wayland'
  | 'x11'
  | 'default'
  | 'unknown'
  | 'not-applicable';

export interface DiagnosticDisplayEnvironment {
  session: DiagnosticDisplaySession;
  waylandDetected: boolean;
  ozonePlatform: DiagnosticOzonePlatform;
}

export interface DiagnosticRuntimeInfo {
  applicationVersion: string | null;
  electronVersion: string | null;
  nodeVersion: string | null;
  operatingSystem: string | null;
  operatingSystemRelease: string | null;
  architecture: string | null;
  isPackaged: boolean | null;
  display: DiagnosticDisplayEnvironment;
}

export interface DiagnosticLogContext {
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
  phase?: 'services' | 'ipc' | 'window' | 'sync';
  appVersion?: string;
  platform?: string;
  arch?: string;
  architecture?: string;
}

export interface DiagnosticLogRecord {
  schemaVersion: typeof DIAGNOSTIC_LOG_SCHEMA_VERSION;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  component: string;
  sessionId: string;
  context?: DiagnosticLogContext;
}

export const DIAGNOSTIC_LOG_READ_ISSUE_CODES = {
  directoryUnavailable: 'LOG_DIRECTORY_UNAVAILABLE',
  fileReadFailed: 'LOG_FILE_READ_FAILED',
  recordMalformed: 'LOG_RECORD_MALFORMED',
} as const;

export type DiagnosticLogReadIssueCode = (
  typeof DIAGNOSTIC_LOG_READ_ISSUE_CODES
)[keyof typeof DIAGNOSTIC_LOG_READ_ISSUE_CODES];

export interface DiagnosticLogReadIssue {
  code: DiagnosticLogReadIssueCode;
  count: number;
}

export interface DiagnosticLogs {
  format: 'structured-jsonl';
  schemaVersion: typeof DIAGNOSTIC_LOG_SCHEMA_VERSION;
  status: 'complete' | 'partial' | 'unavailable';
  omittedValidRecordCount: number;
  issues: DiagnosticLogReadIssue[];
  records: DiagnosticLogRecord[];
}

export interface DiagnosticReportV1 {
  reportVersion: typeof DIAGNOSTIC_REPORT_VERSION;
  generatedAt: string;
  application: {
    name: 'Shale';
    version: string | null;
    isPackaged: boolean | null;
  };
  runtime: {
    electronVersion: string | null;
    nodeVersion: string | null;
    operatingSystem: string | null;
    operatingSystemRelease: string | null;
    architecture: string | null;
    display: DiagnosticDisplayEnvironment;
  };
  logs: DiagnosticLogs;
}

export type DiagnosticExportResult =
  | { status: 'saved' }
  | { status: 'cancelled' };
