import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import { TRANSLATION_IPC_CHANNELS } from '../../shared/contracts/translation.ipc';
import type {
  TranslationGenerateRequest,
  TranslationGenerateResponse,
  TranslationGetRequest,
  TranslationState,
  TranslationStreamEvent,
} from '../../shared/contracts/translation.types';
import {
  TRANSLATION_ERROR_CODES,
  TranslationError,
  toTranslationIpcError,
} from '../../shared/errors/translation.errors';
import { TranslationService } from '../ai/TranslationService';

type GetMainWindow = () => BrowserWindow | null;

export interface TranslationServices {
  translationService: TranslationService;
}

export function registerTranslationIpcHandlers(
  getMainWindow: GetMainWindow,
  services: TranslationServices,
): void {
  const { translationService } = services;
  translationService.subscribe((event) => sendTranslationEvent(getMainWindow, event));

  ipcMain.handle(
    TRANSLATION_IPC_CHANNELS.translationGet,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<TranslationState> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isTranslationRequest(request)) return invalidRequest();
      try {
        return success(translationService.getState(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_IPC_CHANNELS.translationGenerate,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<TranslationGenerateResponse> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isTranslationRequest(request)) return invalidRequest();
      try {
        return success(translationService.generate(request));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function sendTranslationEvent(
  getMainWindow: GetMainWindow,
  event: TranslationStreamEvent,
): void {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(TRANSLATION_IPC_CHANNELS.translationStream, event);
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

function isTranslationRequest(value: unknown): value is TranslationGetRequest & TranslationGenerateRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return typeof request.entryId === 'number' && typeof request.targetLanguage === 'string';
}

function success<T>(data: T): IPCResult<T> {
  return { ok: true, data };
}

function failure(error: unknown): IPCResult<never> {
  return { ok: false, error: toTranslationIpcError(error) };
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
  return failure(new TranslationError(
    TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_REQUEST,
    'The Translation request is invalid.',
    false,
  ));
}
