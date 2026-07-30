import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import {
  isProviderKind,
  type ProviderConnectionTestResult,
  type ProviderProfile,
  type SaveProviderRequest,
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
import type { SummaryServices } from '../services';

type GetMainWindow = () => BrowserWindow | null;

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
    SUMMARY_IPC_CHANNELS.providerTestChat,
    async (event: IpcMainInvokeEvent): Promise<IPCResult<ProviderConnectionTestResult>> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      try {
        return success(await providerService.testChatConnection());
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
  // Task-route shape: { summary, translation, tag, chat? }
  if (typeof request.summary === 'object' && request.summary !== null) {
    const taskRoutesValid = (
      typeof request.translation === 'object' && request.translation !== null
      && typeof request.tag === 'object' && request.tag !== null
    );
    if (!taskRoutesValid || request.chat === undefined) return taskRoutesValid;
    if (typeof request.chat !== 'object' || request.chat === null) return false;
    const chat = request.chat as Record<string, unknown>;
    return (
      typeof chat.providerKind === 'string'
      && isProviderKind(chat.providerKind)
      && typeof chat.baseUrl === 'string'
      && typeof chat.model === 'string'
      && typeof chat.supportsImages === 'boolean'
      && (chat.apiKey === undefined || typeof chat.apiKey === 'string')
    );
  }
  // Legacy single-route shape: { providerKind, baseUrl, model, apiKey? }
  return (
    typeof request.providerKind === 'string'
    && isProviderKind(request.providerKind)
    && typeof request.baseUrl === 'string'
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
