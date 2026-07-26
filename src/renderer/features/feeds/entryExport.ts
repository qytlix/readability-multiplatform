import type { IPCResult } from '../../../shared/contracts/feed.ipc';
import type {
  CheckAvailabilityResponse,
  CleanProgressEvent,
  ExportMultipleResult,
  ExportSingleResult,
} from '../../../shared/contracts/export.ipc';
import type {
  PerArticleOptions,
  TranslationLanguage,
} from '../../../shared/contracts/export.types';

declare global {
  interface Window {
    shaleAPI: import('../../../shared/ipc').ShaleAPI;
  }
}

/**
 * 检查多篇文章的可用性：清洗状态、AI 结果是否存在等。
 */
export async function checkAvailability(
  entryIds: number[],
): Promise<IPCResult<CheckAvailabilityResponse>> {
  return window.shaleAPI.export.checkAvailability(entryIds);
}

/**
 * 按需清洗单篇文章。
 * 可传入 onProgress 监听清洗进度事件。
 */
export async function cleanSingle(
  entryId: number,
  onProgress?: (event: CleanProgressEvent) => void,
): Promise<IPCResult<void>> {
  return window.shaleAPI.export.cleanSingle(entryId, onProgress);
}

/**
 * 单篇导出：传入 entryId 和选项，Main 打开保存对话框并写入文件。
 * 可选传入 translationLanguage 启用逐段穿插格式。
 */
export async function exportSingleEntry(
  entryId: number,
  options: PerArticleOptions,
  translationLanguage?: TranslationLanguage,
): Promise<IPCResult<ExportSingleResult>> {
  return window.shaleAPI.export.single(entryId, options, translationLanguage);
}

/**
 * 多篇导出：传入 entryId + options 数组，Main 打开保存对话框并写入文件。
 * 每篇文章可附带 translationLanguage 启用逐段穿插格式。
 */
export async function exportMultipleEntries(
  entries: Array<{
    entryId: number;
    options: PerArticleOptions;
    translationLanguage?: TranslationLanguage;
  }>,
): Promise<IPCResult<ExportMultipleResult>> {
  return window.shaleAPI.export.multiple(entries);
}