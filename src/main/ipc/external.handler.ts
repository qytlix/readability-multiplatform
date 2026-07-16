import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { ExternalLinkService } from '../external/ExternalLinkService';
import { EXTERNAL_IPC_CHANNELS, type ExternalOpenRequest } from '../../shared/contracts/external.ipc';
import { isAuthorizedSender, type GetMainWindow } from '../ipc';

const externalLinkService = new ExternalLinkService((url) => shell.openExternal(url));

const isExternalOpenRequest = (value: unknown): value is ExternalOpenRequest => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const request = value as Record<string, unknown>;
  return typeof request.url === 'string'
    && (request.baseUrl === undefined || typeof request.baseUrl === 'string');
};

export const registerExternalIpcHandlers = (getMainWindow: GetMainWindow): void => {
  ipcMain.handle(
    EXTERNAL_IPC_CHANNELS.open,
    async (event: IpcMainInvokeEvent, request: unknown) => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return {
          ok: false as const,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized IPC sender.',
            retryable: false,
          },
        };
      }

      if (!isExternalOpenRequest(request)) {
        return {
          ok: false as const,
          error: {
            code: 'EXTERNAL_URL_BLOCKED',
            message: 'This link cannot be opened.',
            retryable: false,
          },
        };
      }

      return externalLinkService.open(request);
    },
  );
};
