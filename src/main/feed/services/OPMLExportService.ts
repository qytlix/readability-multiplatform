import { FeedStore } from '../stores';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import {
  elapsedOPMLMilliseconds,
  logOPMLExportCompleted,
  logOPMLExportFailed,
  logOPMLExportTempCleanupFailed,
  OPML_LOG_ERROR_CODES,
  type OPMLOperationLogger,
  type OPMLExportStage,
} from './OPMLLogging';

export interface OPMLExportFileOperations {
  writeFile(filePath: string, content: string, encoding: 'utf-8'): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
}

const defaultFileOperations: OPMLExportFileOperations = {
  writeFile,
  rename,
  unlink,
};

/**
 * Export feeds to OPML 2.0 format.
 * Uses atomic write pattern: write to temp file, then rename.
 */
export class OPMLExportService {
  private feedStore: FeedStore;

  constructor(
    feedStore: FeedStore,
    private readonly logger?: OPMLOperationLogger,
    private readonly fileOperations: OPMLExportFileOperations = defaultFileOperations,
  ) {
    this.feedStore = feedStore;
  }

  /**
   * Generate OPML 2.0 XML content from all active feeds.
   */
  async exportToContent(): Promise<string> {
    return generateOPML(this.feedStore.findAll());
  }

  /**
   * Export OPML to a file using atomic rename.
   */
  async exportToFile(filePath: string): Promise<void> {
    const startedAt = performance.now();
    let stage: OPMLExportStage = 'serialize';
    let feedCount: number | undefined;
    let tmpPath: string | undefined;

    try {
      const feeds = this.feedStore.findAll();
      feedCount = feeds.length;
      const content = generateOPML(feeds);

      // Write to temp file first, then atomic rename
      tmpPath = path.join(
        tmpdir(),
        `shale-opml-${Date.now()}-${Math.random().toString(36).slice(2)}.opml`,
      );

      stage = 'write';
      await this.fileOperations.writeFile(tmpPath, content, 'utf-8');
      stage = 'rename';
      await this.fileOperations.rename(tmpPath, filePath);
      logOPMLExportCompleted(this.logger, {
        durationMs: elapsedOPMLMilliseconds(startedAt),
        count: feedCount,
      });
    } catch (error) {
      this.logFailed(startedAt, stage, feedCount);
      if (tmpPath) {
        // Clean up temp file on failure
        try {
          await this.fileOperations.unlink(tmpPath);
        } catch {
          logOPMLExportTempCleanupFailed(this.logger, {
            durationMs: elapsedOPMLMilliseconds(startedAt),
            stage: 'cleanup',
            errorCode: OPML_LOG_ERROR_CODES.exportTempCleanupFailed,
          });
        }
      }
      throw error;
    }
  }

  private logFailed(
    startedAt: number,
    stage: Exclude<OPMLExportStage, 'cleanup'>,
    feedCount: number | undefined,
  ): void {
    const errorCode = {
      serialize: OPML_LOG_ERROR_CODES.exportSerializeFailed,
      write: OPML_LOG_ERROR_CODES.exportWriteFailed,
      rename: OPML_LOG_ERROR_CODES.exportRenameFailed,
    }[stage];
    logOPMLExportFailed(this.logger, {
      durationMs: elapsedOPMLMilliseconds(startedAt),
      stage,
      errorCode,
      ...(feedCount === undefined ? {} : { count: feedCount }),
    });
  }
}

/**
 * Generate OPML 2.0 XML from feed list.
 */
function generateOPML(
  feeds: Array<{ title?: string; feedURL: string; siteURL?: string }>,
): string {
  const escaped = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const date = new Date().toUTCString();

  const outlines = feeds
    .map((feed) => {
      const title = feed.title ? escaped(feed.title) : escaped(feed.feedURL);
      const xmlUrl = escaped(feed.feedURL);
      const htmlUrl = feed.siteURL ? escaped(feed.siteURL) : '';

      return htmlUrl
        ? `    <outline title="${title}" xmlUrl="${xmlUrl}" htmlUrl="${htmlUrl}"/>`
        : `    <outline title="${title}" xmlUrl="${xmlUrl}"/>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Shale Subscriptions</title>
    <dateCreated>${date}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
}
