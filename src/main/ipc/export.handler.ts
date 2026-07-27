import {
  app,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import type { IPCResult } from '../../shared/contracts/feed.ipc';
import { EXPORT_ERROR_CODES, EXPORT_IPC_CHANNELS } from '../../shared/contracts/export.ipc';
import type {
  CheckAvailabilityRequest,
  CheckAvailabilityResponse,
  CleanSingleRequest,
  CleanProgressEvent,
  ExportSingleRequest,
  ExportSingleResult,
  ExportMultipleRequest,
  ExportMultipleResult,
} from '../../shared/contracts/export.ipc';
import type { PerArticleOptions } from '../../shared/contracts/export.types';
import type { ShaleError } from '../../shared/errors/feed.errors';
import { isAuthorizedSender, type GetMainWindow } from '../ipc';
import type { ExportService } from '../export/ExportService';
import {
  elapsedMarkdownExportMilliseconds,
  getMarkdownExportErrorCode,
  logMarkdownExportCompleted,
  logMarkdownExportFailed,
  type MarkdownExportOperationLogger,
  type MarkdownExportStage,
} from '../export/MarkdownExportLogging';
import { markdownExportFilename } from '../export/safeFilename';
import { serializeSingle, serializeMultiple } from '../export/MarkdownSerializer';

/** Build a successful IPC result. */
function ok<T>(data: T): IPCResult<T> {
  return { ok: true, data };
}

/** Build a failed IPC result. */
function fail(code: string, message: string, retryable = false): IPCResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

/** Build a failed IPC result from a thrown ShaleError. */
function failFromError(error: unknown): IPCResult<never> {
  if (error && typeof error === 'object' && 'code' in error) {
    const shaleError = error as ShaleError;
    return { ok: false, error: shaleError };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code: EXPORT_ERROR_CODES.EXPORT_WRITE_FAILED, message, retryable: true } };
}

export function registerExportIpcHandlers(
  getMainWindow: GetMainWindow,
  exportService: ExportService,
  logger?: MarkdownExportOperationLogger,
): void {
  // ── 清洗状态检查 ──────────────────────────────────────
  ipcMain.handle(
    EXPORT_IPC_CHANNELS.checkAvailability,
    (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): IPCResult<CheckAvailabilityResponse> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return fail('UNAUTHORIZED', 'Unauthorized IPC sender.');
      }
      try {
        const { entryIds } = request as CheckAvailabilityRequest;
        if (!Array.isArray(entryIds) || entryIds.length === 0) {
          return fail(
            EXPORT_ERROR_CODES.EXPORT_ENTRY_NOT_FOUND,
            'entryIds must be a non-empty array',
          );
        }
        const result = exportService.checkAvailability(entryIds);
        return ok(result);
      } catch (error) {
        return failFromError(error);
      }
    },
  );

  // ── 单篇清洗触发 ──────────────────────────────────────
  ipcMain.handle(
    EXPORT_IPC_CHANNELS.cleanSingle,
    async (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): Promise<IPCResult<void>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return fail('UNAUTHORIZED', 'Unauthorized IPC sender.');
      }
      try {
        const { entryId } = request as CleanSingleRequest;
        if (!Number.isInteger(entryId) || entryId <= 0) {
          return fail(
            EXPORT_ERROR_CODES.EXPORT_ENTRY_NOT_FOUND,
            'entryId must be a positive integer',
          );
        }

        // 发送清洗中事件
        const mainWindow = getMainWindow();
        const sendProgress = (progress: CleanProgressEvent) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              EXPORT_IPC_CHANNELS.cleanSingleProgress,
              progress,
            );
          }
        };

        sendProgress({ entryId, status: 'cleaning' });
        await exportService.cleanSingle(entryId);
        sendProgress({ entryId, status: 'success' });
        return ok(undefined);
      } catch (error) {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          const entryId = (request as CleanSingleRequest).entryId;
          const message = error instanceof Error ? error.message : String(error);
          mainWindow.webContents.send(
            EXPORT_IPC_CHANNELS.cleanSingleProgress,
            { entryId, status: 'failed', error: message } satisfies CleanProgressEvent,
          );
        }
        return failFromError(error);
      }
    },
  );

  // ── 单篇导出 ──────────────────────────────────────────
  ipcMain.handle(
    EXPORT_IPC_CHANNELS.exportSingle,
    async (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): Promise<IPCResult<ExportSingleResult>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return fail('UNAUTHORIZED', 'Unauthorized IPC sender.');
      }

      const startedAt = performance.now();
      let stage: MarkdownExportStage = 'validate';
      let count: number | undefined;
      try {
        const { entryId, options } = request as ExportSingleRequest;
        if (!Number.isInteger(entryId) || entryId <= 0) {
          logMarkdownExportFailure(logger, startedAt, stage, count);
          return fail(
            EXPORT_ERROR_CODES.EXPORT_ENTRY_NOT_FOUND,
            'entryId must be a positive integer',
          );
        }
        validateOptions(options);
        count = 1;

        // 聚合数据
        stage = 'prepare';
        const article = exportService.prepareArticleData(entryId, options);

        // 序列化
        stage = 'serialize';
        const markdown = serializeSingle(article, options);

        // 打开保存对话框
        stage = 'dialog';
        const mainWindow = getMainWindow();
        const defaultName = markdownExportFilename(
          article.title ?? 'untitled',
          [options],
        );
        const dialogResult = mainWindow
          ? await dialog.showSaveDialog(mainWindow, {
              title: '导出文章为 Markdown',
              defaultPath: path.join(app.getPath('documents'), defaultName),
              filters: [{ name: 'Markdown', extensions: ['md'] }],
            })
          : await dialog.showSaveDialog({
              title: '导出文章为 Markdown',
              defaultPath: path.join(app.getPath('documents'), defaultName),
              filters: [{ name: 'Markdown', extensions: ['md'] }],
            });

        if (dialogResult.canceled || !dialogResult.filePath) {
          return fail(
            EXPORT_ERROR_CODES.EXPORT_SAVE_CANCELED,
            '用户取消了保存',
          );
        }

        // 下载远程图片并改写为相对路径，然后写入 Markdown。
        stage = 'write';
        const imageResult = await exportService.writeMarkdownExport(
          dialogResult.filePath,
          markdown,
          [article],
        );
        logMarkdownExportCompleted(logger, {
          durationMs: elapsedMarkdownExportMilliseconds(startedAt),
          count,
        });

        return ok({
          filePath: dialogResult.filePath,
          assetDirectory: imageResult.assetDirectory,
          downloadedImageCount: imageResult.downloadedImageCount,
          failedImageCount: imageResult.failedImageCount,
        });
      } catch (error) {
        logMarkdownExportFailure(logger, startedAt, stage, count);
        return failFromError(error);
      }
    },
  );

  // ── 多篇导出 ──────────────────────────────────────────
  ipcMain.handle(
    EXPORT_IPC_CHANNELS.exportMultiple,
    async (
      event: IpcMainInvokeEvent,
      request: unknown,
    ): Promise<IPCResult<ExportMultipleResult>> => {
      if (!isAuthorizedSender(event, getMainWindow)) {
        return fail('UNAUTHORIZED', 'Unauthorized IPC sender.');
      }

      const startedAt = performance.now();
      let stage: MarkdownExportStage = 'validate';
      let count: number | undefined;
      try {
        const { entries } = request as ExportMultipleRequest;

        if (!Array.isArray(entries) || entries.length === 0) {
          logMarkdownExportFailure(logger, startedAt, stage, count);
          return fail(
            EXPORT_ERROR_CODES.EXPORT_ENTRY_NOT_FOUND,
            'entries must be a non-empty array',
          );
        }

        if (entries.length > 100) {
          count = entries.length;
          logMarkdownExportFailure(logger, startedAt, stage, count);
          return fail(
            EXPORT_ERROR_CODES.EXPORT_TOO_MANY_ARTICLES,
            '批量导出文章数过多（超过 100 篇）',
            false,
          );
        }

        // 验证每个 entry
        for (const { entryId, options } of entries) {
          if (!Number.isInteger(entryId) || entryId <= 0) {
            logMarkdownExportFailure(logger, startedAt, stage, count);
            return fail(
              EXPORT_ERROR_CODES.EXPORT_ENTRY_NOT_FOUND,
              `entryId must be a positive integer, got ${entryId}`,
            );
          }
          validateOptions(options);
        }
        count = entries.length;

        // 聚合数据
        stage = 'prepare';
        const articles = exportService.prepareMultipleArticleData(entries);

        // 序列化（每篇使用自己的 exportOptions）
        stage = 'serialize';
        const markdown = serializeMultiple(articles);

        // 打开保存对话框
        const defaultName = markdownExportFilename(
          `文摘-${new Date().toISOString().slice(0, 10)}`,
          entries.map(({ options }) => options),
        );
        stage = 'dialog';
        const mainWindow = getMainWindow();
        const dialogResult = mainWindow
          ? await dialog.showSaveDialog(mainWindow, {
              title: '导出文摘为 Markdown',
              defaultPath: path.join(app.getPath('documents'), defaultName),
              filters: [{ name: 'Markdown', extensions: ['md'] }],
            })
          : await dialog.showSaveDialog({
              title: '导出文摘为 Markdown',
              defaultPath: path.join(app.getPath('documents'), defaultName),
              filters: [{ name: 'Markdown', extensions: ['md'] }],
            });

        if (dialogResult.canceled || !dialogResult.filePath) {
          return fail(
            EXPORT_ERROR_CODES.EXPORT_SAVE_CANCELED,
            '用户取消了保存',
          );
        }

        // 下载远程图片并改写为相对路径，然后写入 Markdown。
        stage = 'write';
        const imageResult = await exportService.writeMarkdownExport(
          dialogResult.filePath,
          markdown,
          articles,
        );
        logMarkdownExportCompleted(logger, {
          durationMs: elapsedMarkdownExportMilliseconds(startedAt),
          count,
        });

        return ok({
          filePath: dialogResult.filePath,
          assetDirectory: imageResult.assetDirectory,
          downloadedImageCount: imageResult.downloadedImageCount,
          failedImageCount: imageResult.failedImageCount,
        });
      } catch (error) {
        logMarkdownExportFailure(logger, startedAt, stage, count);
        return failFromError(error);
      }
    },
  );
}

function logMarkdownExportFailure(
  logger: MarkdownExportOperationLogger | undefined,
  startedAt: number,
  stage: MarkdownExportStage,
  count: number | undefined,
): void {
  logMarkdownExportFailed(logger, {
    durationMs: elapsedMarkdownExportMilliseconds(startedAt),
    stage,
    errorCode: getMarkdownExportErrorCode(stage),
    ...(count === undefined ? {} : { count }),
  });
}

/**
 * Validate PerArticleOptions fields.
 */
function validateOptions(options: unknown): asserts options is PerArticleOptions {
  if (!options || typeof options !== 'object') {
    throwObject({ code: 'EXPORT_INVALID_OPTIONS', message: 'options must be an object', retryable: false });
  }
  const opts = options as Record<string, unknown>;
  if (typeof opts.includeSummary !== 'boolean') {
    throwObject({ code: 'EXPORT_INVALID_OPTIONS', message: 'includeSummary must be a boolean', retryable: false });
  }
  if (typeof opts.includeTranslation !== 'boolean') {
    throwObject({ code: 'EXPORT_INVALID_OPTIONS', message: 'includeTranslation must be a boolean', retryable: false });
  }
  if (typeof opts.includeNotes !== 'boolean') {
    throwObject({ code: 'EXPORT_INVALID_OPTIONS', message: 'includeNotes must be a boolean', retryable: false });
  }
}

function throwObject(error: ShaleError): never {
  throw error;
}
