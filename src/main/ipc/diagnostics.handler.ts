import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type SaveDialogOptions,
} from 'electron';
import {
  DIAGNOSTICS_IPC_CHANNELS,
} from '../../shared/contracts/diagnostics.ipc';
import type { DiagnosticExportResult } from '../../shared/contracts/diagnostics.types';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import {
  DiagnosticExportError,
  DiagnosticExportService,
  createDiagnosticFileName,
} from '../diagnostics/DiagnosticExportService';
import { isAuthorizedSender, type GetMainWindow } from '../ipc';

export interface DiagnosticSaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

export type ShowDiagnosticSaveDialog = (
  parentWindow: BrowserWindow | null,
  options: SaveDialogOptions,
) => Promise<DiagnosticSaveDialogResult>;

const defaultShowSaveDialog: ShowDiagnosticSaveDialog = async (
  parentWindow,
  options,
) => {
  return parentWindow
    ? dialog.showSaveDialog(parentWindow, options)
    : dialog.showSaveDialog(options);
};

export function registerDiagnosticsIpcHandlers(
  getMainWindow: GetMainWindow,
  diagnosticExportService: DiagnosticExportService,
  showSaveDialog: ShowDiagnosticSaveDialog = defaultShowSaveDialog,
): void {
  ipcMain.handle(
    DIAGNOSTICS_IPC_CHANNELS.export,
    async (event: IpcMainInvokeEvent): Promise<IPCResult<DiagnosticExportResult>> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();

      try {
        const dialogResult = await showSaveDialog(getMainWindow(), {
          title: 'Export Diagnostic Information',
          defaultPath: createDiagnosticFileName(),
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
        });
        if (dialogResult.canceled || !dialogResult.filePath) {
          return success({ status: 'cancelled' });
        }

        await diagnosticExportService.exportToFile(dialogResult.filePath);
        return success({ status: 'saved' });
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function success(data: DiagnosticExportResult): IPCResult<DiagnosticExportResult> {
  return { ok: true, data };
}

function failure(error: unknown): IPCResult<never> {
  return {
    ok: false,
    error: {
      code: error instanceof DiagnosticExportError
        ? error.code
        : 'DIAGNOSTIC_EXPORT_FAILED',
      message: 'Unable to save diagnostic information. Choose another location and try again.',
      retryable: true,
    },
  };
}

function unauthorized(): IPCResult<never> {
  return {
    ok: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Unauthorized IPC sender.',
      retryable: false,
    },
  };
}
