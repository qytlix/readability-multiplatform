import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIAGNOSTICS_IPC_CHANNELS } from '../../../src/shared/contracts/diagnostics.ipc';

const captured = vi.hoisted(() => ({
  handler: undefined as undefined | ((event: unknown) => Promise<unknown>),
  authorized: true,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (_channel: string, handler: (event: unknown) => Promise<unknown>) => {
      captured.handler = handler;
    },
  },
  dialog: {},
}));

vi.mock('../../../src/main/ipc', () => ({
  isAuthorizedSender: () => captured.authorized,
}));

import {
  registerDiagnosticsIpcHandlers,
  type ShowDiagnosticSaveDialog,
} from '../../../src/main/ipc/diagnostics.handler';
import type { DiagnosticExportService } from '../../../src/main/diagnostics/DiagnosticExportService';

function register(
  exportToFile: (filePath: string) => Promise<void>,
  showSaveDialog: ShowDiagnosticSaveDialog,
): void {
  registerDiagnosticsIpcHandlers(
    () => null,
    { exportToFile } as unknown as DiagnosticExportService,
    showSaveDialog,
  );
}

async function invokeHandler(): Promise<unknown> {
  if (!captured.handler) throw new Error('Expected diagnostics IPC handler');
  return captured.handler({});
}

beforeEach(() => {
  captured.handler = undefined;
  captured.authorized = true;
});

describe('diagnostics IPC handler', () => {
  it('returns cancelled without creating a file when the user closes the save dialog', async () => {
    const exportToFile = vi.fn(async () => undefined);
    const showSaveDialog = vi.fn<ShowDiagnosticSaveDialog>(async () => ({ canceled: true }));
    register(exportToFile, showSaveDialog);

    await expect(invokeHandler()).resolves.toEqual({
      ok: true,
      data: { status: 'cancelled' },
    });
    expect(exportToFile).not.toHaveBeenCalled();
    expect(showSaveDialog).toHaveBeenCalledWith(null, expect.objectContaining({
      title: 'Export Diagnostic Information',
      defaultPath: expect.stringMatching(/^shale-diagnostics-\d{8}T\d{6}Z\.json$/),
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    }));
  });

  it('keeps the selected path in Main and returns only the saved status', async () => {
    const selectedPath = '/private/tmp/shale-diagnostics.json';
    const exportToFile = vi.fn(async () => undefined);
    const showSaveDialog: ShowDiagnosticSaveDialog = async () => ({
      canceled: false,
      filePath: selectedPath,
    });
    register(exportToFile, showSaveDialog);

    const result = await invokeHandler();

    expect(exportToFile).toHaveBeenCalledWith(selectedPath);
    expect(result).toEqual({ ok: true, data: { status: 'saved' } });
    expect(JSON.stringify(result)).not.toContain(selectedPath);
  });

  it('returns a stable error without the write failure text or selected path', async () => {
    const selectedPath = '/Users/alice/Desktop/diagnostic.json';
    const writeFailure = '无法写入\nTOKEN_CANARY\n/Users/alice/private';
    const showSaveDialog: ShowDiagnosticSaveDialog = async () => ({
      canceled: false,
      filePath: selectedPath,
    });
    register(async () => { throw new Error(writeFailure); }, showSaveDialog);

    const result = await invokeHandler();

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'DIAGNOSTIC_EXPORT_FAILED',
        message: 'Unable to save diagnostic information. Choose another location and try again.',
        retryable: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain(writeFailure);
    expect(JSON.stringify(result)).not.toContain(selectedPath);
  });

  it('rejects an unauthorized sender without opening a dialog', async () => {
    captured.authorized = false;
    const showSaveDialog = vi.fn<ShowDiagnosticSaveDialog>(async () => ({ canceled: true }));
    register(async () => undefined, showSaveDialog);

    await expect(invokeHandler()).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized IPC sender.',
        retryable: false,
      },
    });
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('registers only the diagnostics channel', () => {
    const showSaveDialog: ShowDiagnosticSaveDialog = async () => ({ canceled: true });
    register(async () => undefined, showSaveDialog);

    expect(captured.handler).toBeTypeOf('function');
    expect(DIAGNOSTICS_IPC_CHANNELS.export).toBe('diagnostics:export');
  });
});
