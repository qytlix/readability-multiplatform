import type { IPCResult } from './feed.ipc';
import type { DiagnosticExportResult } from './diagnostics.types';

export const DIAGNOSTICS_IPC_CHANNELS = {
  export: 'diagnostics:export',
} as const;

export interface DiagnosticsAPI {
  export: () => Promise<IPCResult<DiagnosticExportResult>>;
}
