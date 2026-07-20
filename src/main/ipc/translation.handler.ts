import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import { TRANSLATION_IPC_CHANNELS } from '../../shared/contracts/translation.ipc';
import type {
  InlineTranslationRequest,
  InlineTranslationResult,
  TranslationGenerateRequest,
  TranslationGenerateResponse,
  TranslationGetRequest,
  TranslationPrioritizeRequest,
  TranslationPrioritizeResponse,
  TerminologyPackInfo,
  TranslationState,
  TranslationStreamEvent,
} from '../../shared/contracts/translation.types';
import {
  TRANSLATION_ERROR_CODES,
  TranslationError,
  toTranslationIpcError,
} from '../../shared/errors/translation.errors';
import type { TranslationServices } from '../services';

type GetMainWindow = () => BrowserWindow | null;

export function registerTranslationIpcHandlers(
  getMainWindow: GetMainWindow,
  services: TranslationServices,
): void {
  const { translationService, inlineTranslationService } = services;
  translationService.subscribe((event) => sendTranslationEvent(getMainWindow, event));

  ipcMain.handle(
    TRANSLATION_IPC_CHANNELS.terminologyInfo,
    (event: IpcMainInvokeEvent): IPCResult<TerminologyPackInfo> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      return success(translationService.getTerminologyInfo());
    },
  );

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

  ipcMain.handle(
    TRANSLATION_IPC_CHANNELS.translationPrioritize,
    (event: IpcMainInvokeEvent, request: unknown): IPCResult<TranslationPrioritizeResponse> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isTranslationPrioritizeRequest(request)) return invalidRequest();
      try {
        return success(translationService.prioritize(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_IPC_CHANNELS.inlineTranslate,
    async (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): Promise<IPCResult<InlineTranslationResult>> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isInlineTranslationRequest(request)) return invalidRequest();
      try {
        return success(await inlineTranslationService.translate(request));
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

function isInlineTranslationRequest(value: unknown): value is InlineTranslationRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return (
    (request.kind === 'selection' || request.kind === 'paragraph')
    && typeof request.sourceText === 'string'
    && (request.context === undefined || typeof request.context === 'string')
    && typeof request.targetLanguage === 'string'
  );
}

function isTranslationPrioritizeRequest(value: unknown): value is TranslationPrioritizeRequest {
  if (!isTranslationRequest(value)) return false;
  const request = value as unknown as Record<string, unknown>;
  return Number.isInteger(request.runId)
    && (request.runId as number) > 0
    && Array.isArray(request.sourceSegmentIds)
    && request.sourceSegmentIds.length <= 100
    && request.sourceSegmentIds.every((segmentId) =>
      typeof segmentId === 'string' && segmentId.length > 0 && segmentId.length <= 256);
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
