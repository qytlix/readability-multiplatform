import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import { TRANSLATION_IPC_CHANNELS } from '../../shared/contracts/translation.ipc';
import { TRANSLATION_EXPERT_IPC_CHANNELS } from '../../shared/contracts/translation-expert.ipc';
import { TRANSLATION_TERMINOLOGY_IPC_CHANNELS } from '../../shared/contracts/translation-terminology.ipc';
import type {
  TranslationExpertImportPreview,
  TranslationExpertList,
  TranslationExpertMutationResult,
} from '../../shared/contracts/translation-expert.types';
import type {
  InlineTranslationRequest,
  InlineTranslationCancelResult,
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
import type {
  TerminologyImportPreview,
  TerminologyLibraryList,
  TerminologyLibraryMutationResult,
} from '../../shared/contracts/translation-terminology.types';
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
  const {
    translationService,
    inlineTranslationService,
    expertService,
    terminologyStore,
  } = services;
  translationService.subscribe((event) => sendTranslationEvent(getMainWindow, event));

  ipcMain.handle(
    TRANSLATION_IPC_CHANNELS.terminologyInfo,
    (event: IpcMainInvokeEvent): IPCResult<TerminologyPackInfo> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      return success(translationService.getTerminologyInfo());
    },
  );

  ipcMain.handle(
    TRANSLATION_TERMINOLOGY_IPC_CHANNELS.list,
    (event: IpcMainInvokeEvent): IPCResult<TerminologyLibraryList> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!terminologyStore) return terminologyUnavailable();
      try {
        return success(terminologyStore.listLibraries());
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_TERMINOLOGY_IPC_CHANNELS.setEnabled,
    (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): IPCResult<TerminologyLibraryMutationResult> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!terminologyStore) return terminologyUnavailable();
      if (!isTerminologySetEnabledRequest(request)) return invalidRequest();
      try {
        return success(terminologyStore.setLibraryEnabled(
          request.id,
          request.enabled,
        ));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_TERMINOLOGY_IPC_CHANNELS.preview,
    (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): IPCResult<TerminologyImportPreview> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!terminologyStore) return terminologyUnavailable();
      if (!isTerminologyCsvRequest(request, false)) return invalidRequest();
      try {
        return success(terminologyStore.previewImport(request.name, request.csv));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_TERMINOLOGY_IPC_CHANNELS.import,
    (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): IPCResult<TerminologyLibraryMutationResult> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!terminologyStore) return terminologyUnavailable();
      if (!isTerminologyCsvRequest(request, true)) return invalidRequest();
      try {
        return success(terminologyStore.importLibrary(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_TERMINOLOGY_IPC_CHANNELS.remove,
    (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): IPCResult<TerminologyLibraryMutationResult> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!terminologyStore) return terminologyUnavailable();
      if (!isTerminologyRemoveRequest(request)) return invalidRequest();
      try {
        return success(terminologyStore.removeLibrary(request.id));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_EXPERT_IPC_CHANNELS.list,
    (event: IpcMainInvokeEvent): IPCResult<TranslationExpertList> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      try {
        return success(expertService.list());
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_EXPERT_IPC_CHANNELS.preview,
    (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): IPCResult<TranslationExpertImportPreview> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isExpertYamlRequest(request, false)) return invalidRequest();
      try {
        return success(expertService.preview(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_EXPERT_IPC_CHANNELS.import,
    (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): IPCResult<TranslationExpertMutationResult> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isExpertYamlRequest(request, true)) return invalidRequest();
      try {
        return success(expertService.import(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    TRANSLATION_EXPERT_IPC_CHANNELS.remove,
    (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): IPCResult<TranslationExpertMutationResult> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      if (!isExpertRemoveRequest(request)) return invalidRequest();
      try {
        return success(expertService.remove(request));
      } catch (error) {
        return failure(error);
      }
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

  ipcMain.handle(
    TRANSLATION_IPC_CHANNELS.inlineCancel,
    (
      event: IpcMainInvokeEvent,
    ): IPCResult<InlineTranslationCancelResult> => {
      if (!isAuthorizedSender(event, getMainWindow)) return unauthorized();
      return success({ cancelled: inlineTranslationService.cancel() });
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
  return typeof request.entryId === 'number'
    && typeof request.sourceLanguage === 'string'
    && typeof request.targetLanguage === 'string'
    && (request.useTerminology === undefined || typeof request.useTerminology === 'boolean')
    && (request.useSmartContext === undefined || typeof request.useSmartContext === 'boolean')
    && (request.expertId === undefined || (
      typeof request.expertId === 'string'
      && request.expertId.length > 0
      && request.expertId.length <= 64
    ));
}

function isExpertYamlRequest(
  value: unknown,
  allowReplace: boolean,
): value is { yaml: string; replace?: boolean } {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return typeof request.yaml === 'string'
    && request.yaml.length > 0
    && request.yaml.length <= 100_000
    && (!allowReplace || request.replace === undefined || typeof request.replace === 'boolean');
}

function isExpertRemoveRequest(value: unknown): value is { id: string } {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return typeof request.id === 'string'
    && request.id.length > 0
    && request.id.length <= 64;
}

function isTerminologySetEnabledRequest(
  value: unknown,
): value is { id: string; enabled: boolean } {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return typeof request.id === 'string'
    && request.id.length > 0
    && request.id.length <= 128
    && typeof request.enabled === 'boolean';
}

function isTerminologyCsvRequest(
  value: unknown,
  allowReplace: boolean,
): value is { name: string; csv: string; replace?: boolean } {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return typeof request.name === 'string'
    && request.name.length > 0
    && request.name.length <= 120
    && typeof request.csv === 'string'
    && request.csv.length <= 2_000_000
    && (!allowReplace
      || request.replace === undefined
      || typeof request.replace === 'boolean');
}

function isTerminologyRemoveRequest(value: unknown): value is { id: string } {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return typeof request.id === 'string'
    && request.id.startsWith('user:')
    && request.id.length <= 128;
}

function isInlineTranslationRequest(value: unknown): value is InlineTranslationRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return (
    (request.kind === 'selection' || request.kind === 'paragraph')
    && typeof request.sourceText === 'string'
    && (request.context === undefined || typeof request.context === 'string')
    && typeof request.sourceLanguage === 'string'
    && typeof request.targetLanguage === 'string'
    && (request.useTerminology === undefined || typeof request.useTerminology === 'boolean')
    && (request.expertId === undefined || (
      typeof request.expertId === 'string'
      && request.expertId.length > 0
      && request.expertId.length <= 64
    ))
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

function terminologyUnavailable(): IPCResult<never> {
  return failure(new TranslationError(
    TRANSLATION_ERROR_CODES.TRANSLATION_TERMINOLOGY_UNAVAILABLE,
    'The local terminology resource is unavailable.',
    false,
  ));
}
