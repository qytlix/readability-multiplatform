import type Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import type {
  ArticleAvailability,
  ExportableArticle,
  PerArticleOptions,
} from '../../shared/contracts/export.types';
import { EXPORT_ERROR_CODES } from '../../shared/contracts/export.ipc';
import type { ShaleError } from '../../shared/contracts/feed.ipc';
import type { PipelineStatus } from '../../shared/contracts/content.types';
import { safeFilename } from './safeFilename';
import { serializeSingle, serializeMultiple } from './MarkdownSerializer';
import type { EntryStore } from '../feed/stores/EntryStore';
import type { ContentStore } from '../feed/stores/ContentStore';
import type { ContentService } from '../feed/services/ContentService';
import type { AnnotationService } from '../annotations/AnnotationService';

export class ExportService {
  constructor(
    private entryStore: EntryStore,
    private contentStore: ContentStore,
    private contentService: ContentService,
    private db: Database.Database,
    private annotationService?: AnnotationService,
  ) {}

  // ── 清洗状态检查 ────────────────────────────────────────

  /**
   * 检查多篇文章的可用性：清洗状态、总结/翻译/笔记是否存在。
   */
  checkAvailability(entryIds: number[]): {
    articles: ArticleAvailability[];
    unwashedIds: number[];
  } {
    const articles: ArticleAvailability[] = [];
    const unwashedIds: number[] = [];

    for (const entryId of entryIds) {
      const entry = this.entryStore.findById(entryId);
      const title = entry?.title ?? '(未知文章)';

      // 清洗状态
      const content = this.contentStore.findByEntry(entryId);
      const pipelineStatus: PipelineStatus = content?.pipelineStatus ?? 'pending';

      // 轻量查询：是否有 summary / translation
      const hasSummary = this.hasSummary(entryId);
      const hasTranslation = this.hasTranslation(entryId);

      // 笔记（P1 预留，先检查空笔记）
      const hasNotes = this.hasNotes(entryId);

      articles.push({
        entryId,
        title,
        pipelineStatus,
        hasSummary,
        hasTranslation,
        hasNotes,
      });

      if (pipelineStatus !== 'success') {
        unwashedIds.push(entryId);
      }
    }

    return { articles, unwashedIds };
  }

  // ── 按需清洗 ────────────────────────────────────────────

  /**
   * 清洗单篇文章（用于选项对话框的「现在清洗」）。
   */
  async cleanSingle(entryId: number): Promise<void> {
    try {
      await this.contentService.fetchAndClean(entryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shaleError: ShaleError = {
        code: EXPORT_ERROR_CODES.EXPORT_CLEAN_FAILED,
        message: `清洗文章失败: ${message}`,
        retryable: true,
      };
      throw shaleError;
    }
  }

  // ── 数据聚合 ────────────────────────────────────────────

  /**
   * 聚合单篇文章的导出数据。
   * 按 options 决定是否读取 summary/translation/notes。
   */
  prepareArticleData(
    entryId: number,
    options: PerArticleOptions,
  ): ExportableArticle {
    const entry = this.entryStore.findById(entryId);
    if (!entry) {
      const error: ShaleError = {
        code: EXPORT_ERROR_CODES.EXPORT_ENTRY_NOT_FOUND,
        message: `文章 ${entryId} 不存在`,
        retryable: false,
      };
      throw error;
    }

    const content = this.contentStore.findByEntry(entryId);
    if (!content) {
      const error: ShaleError = {
        code: EXPORT_ERROR_CODES.EXPORT_CONTENT_NOT_FOUND,
        message: `文章 ${entryId} 的清洗内容不存在`,
        retryable: false,
      };
      throw error;
    }

    const result: ExportableArticle = {
      entryId,
      feedTitle: undefined, // hydrated below
      url: entry.url,
      title: entry.title,
      author: entry.author,
      publishedAt: entry.publishedAt,
      cleanedMarkdown: content.markdown || '',
    };

    // Feed title from entry → feed relation
    const feedRow = this.db
      .prepare('SELECT title FROM feed WHERE id = ?')
      .get(entry.feedId) as { title: string | null } | undefined;
    if (feedRow?.title) {
      result.feedTitle = feedRow.title;
    }

    // Summary
    if (options.includeSummary) {
      result.summary = this.findSummaryContent(entryId);
    }

    // Translation
    if (options.includeTranslation) {
      result.translation = this.findTranslationContent(entryId);
    }

    // Notes (P1)
    if (options.includeNotes) {
      result.notes = this.findNotesContent(entryId);
    }

    result.exportOptions = options;
    return result;
  }

  /**
   * 聚合多篇文章的导出数据。
   */
  prepareMultipleArticleData(
    entries: Array<{ entryId: number; options: PerArticleOptions }>,
  ): ExportableArticle[] {
    return entries.map(({ entryId, options }) =>
      this.prepareArticleData(entryId, options),
    );
  }

  // ── 文件写入 ────────────────────────────────────────────

  /**
   * 将 Markdown 字符串写入文件。
   */
  writeFile(filePath: string, markdown: string): void {
    try {
      writeFileSync(filePath, markdown, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shaleError: ShaleError = {
        code: EXPORT_ERROR_CODES.EXPORT_WRITE_FAILED,
        message: `文件写入失败: ${message}`,
        retryable: true,
      };
      throw shaleError;
    }
  }

  // ── 内部帮助方法 ────────────────────────────────────────

  private hasSummary(entryId: number): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM summary_result WHERE entryId = ? LIMIT 1')
      .get(entryId);
    return !!row;
  }

  private hasTranslation(entryId: number): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM translation_result WHERE entryId = ? LIMIT 1')
      .get(entryId);
    return !!row;
  }

  private hasNotes(entryId: number): boolean {
    if (!this.annotationService) return false;
    const annotations = this.annotationService.list(entryId);
    return annotations.length > 0;
  }

  private findSummaryContent(entryId: number): string | undefined {
    const row = this.db
      .prepare(
        'SELECT content FROM summary_result WHERE entryId = ? ORDER BY updatedAt DESC LIMIT 1',
      )
      .get(entryId) as { content: string } | undefined;
    return row?.content;
  }

  private findTranslationContent(entryId: number): string | undefined {
    const rows = this.db
      .prepare(
        `SELECT ts.translatedText
         FROM translation_result tr
         JOIN translation_segment ts ON ts.translationResultId = tr.id
         WHERE tr.entryId = ? AND tr.status = 'succeeded'
         ORDER BY ts.orderIndex ASC`,
      )
      .all(entryId) as Array<{ translatedText: string | null }>;
    if (rows.length === 0) return undefined;
    return rows.map((r) => r.translatedText ?? '').join('\n\n');
  }

  private findNotesContent(entryId: number): string | undefined {
    if (!this.annotationService) return undefined;
    const annotations = this.annotationService.list(entryId);
    if (annotations.length === 0) return undefined;
    return annotations
      .map((a) => a.noteText || a.selectedText)
      .filter(Boolean)
      .join('\n');
  }
}