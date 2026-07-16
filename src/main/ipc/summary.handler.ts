import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import type {
  ProviderConnectionTestResult,
  ProviderProfile,
  SaveProviderRequest,
} from '../../shared/contracts/provider.types';
import {
  SUMMARY_IPC_CHANNELS,
} from '../../shared/contracts/summary.ipc';
import type {
  SummaryGenerateRequest,
  SummaryGenerateResponse,
  SummaryGetRequest,
  SummaryState,
  SummaryStreamEvent,
} from '../../shared/contracts/summary.types';
import {
  SUMMARY_ERROR_CODES,
  SummaryError,
  toSummaryIpcError,
} from '../../shared/errors/summary.errors';
import { ProviderService } from '../ai/ProviderService';
import { SummaryService } from '../ai/SummaryService';

type GetMainWindow = () => BrowserWindow | null;

export interface SummaryServices {
  providerService: ProviderService;
  summaryService: SummaryService;
}

export function registerSummaryIpcHandlers(
  getMainWindow: GetMainWindow,
  services: SummaryServices,
): void {
  const { providerService, summaryService } = services;
  summaryService.subscribe((event) => sendSummaryEvent(getMainWindow, event));

  ipcMain.handle(
    SUMMARY_IPC_CHANNELS.providerGet,
    (event: IpcMainInvokeEvent): IPCResult<ProviderProfile | null> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      return success(providerService.getActiveProfile() ?? null);
    },
  );

  ipcMain.handle(
    SUMMARY_IPC_CHANNELS.providerSave,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<ProviderProfile> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isSaveProviderRequest(request)) return invalidRequest();
      try {
        return success(providerService.save(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    SUMMARY_IPC_CHANNELS.providerTest,
    async (event: IpcMainInvokeEvent): Promise<IPCResult<ProviderConnectionTestResult>> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      try {
        return success(await providerService.testConnection());
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    SUMMARY_IPC_CHANNELS.summaryGet,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<SummaryState> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isSummaryRequest(request)) return invalidRequest();
      try {
        return success(summaryService.getState(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    SUMMARY_IPC_CHANNELS.summaryGenerate,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<SummaryGenerateResponse> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isSummaryRequest(request)) return invalidRequest();
      try {
        return success(summaryService.generate(request));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function sendSummaryEvent(
  getMainWindow: GetMainWindow,
  event: SummaryStreamEvent,
): void {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(SUMMARY_IPC_CHANNELS.summaryStream, event);
  }
}

function isAuthorizedSender(
  event: IpcMainInvokeEvent,
  getMainWindow: GetMainWindow,
): boolean {
  const mainWindow = getMainWindow();
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame,
  );
}

function isSaveProviderRequest(value: unknown): value is SaveProviderRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.baseUrl === 'string'
    && typeof request.model === 'string'
    && (request.apiKey === undefined || typeof request.apiKey === 'string')
  );
}

function isSummaryRequest(value: unknown): value is SummaryGetRequest & SummaryGenerateRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.entryId === 'number'
    && typeof request.targetLanguage === 'string'
    && typeof request.detailLevel === 'string'
  );
}

function success<T>(data: T): IPCResult<T> {
  return { ok: true, data };
}

function failure(error: unknown): IPCResult<never> {
  return { ok: false, error: toSummaryIpcError(error) };
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

function invalidRequest(): IPCResult<never> {
  return failure(
    new SummaryError(
      SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
      'The Summary request is invalid.',
      false,
    ),
  );
}
