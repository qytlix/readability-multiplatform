import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ContentOperationLogger,
  FeedOperationLogger,
  OPMLOperationLogger,
} from '../../../src/main/feed/services';

const capturedLoggers = vi.hoisted(() => ({
  content: undefined as unknown,
  feed: undefined as unknown,
  opmlExport: undefined as unknown,
  opmlImport: undefined as unknown,
}));

vi.mock('electron', () => ({ safeStorage: {} }));

vi.mock('../../../src/main/database/DatabaseManager', () => ({
  DatabaseManager: class {
    runMigrations(): void {
      return undefined;
    }

    getDb(): object {
      return {};
    }
  },
}));

vi.mock('../../../src/main/feed/stores', () => ({
  ContentStore: class {},
  EntryStore: class {},
  FeedStore: class {},
}));

vi.mock('../../../src/main/feed/services', () => ({
  ContentService: class {
    constructor(...arguments_: unknown[]) {
      capturedLoggers.content = arguments_[5];
    }
  },
  FeedService: class {
    constructor(...arguments_: unknown[]) {
      capturedLoggers.feed = arguments_[2];
    }
  },
  OPMLExportService: class {
    constructor(...arguments_: unknown[]) {
      capturedLoggers.opmlExport = arguments_[1];
    }
  },
  OPMLImportService: class {
    constructor(...arguments_: unknown[]) {
      capturedLoggers.opmlImport = arguments_[1];
    }
  },
  SyncCoordinator: class {},
  SyncScheduler: class {},
}));

vi.mock('../../../src/main/ai/provider/OpenAICompatibleProvider', () => ({
  OpenAICompatibleProvider: class {},
}));
vi.mock('../../../src/main/ai/stores/ProviderProfileStore', () => ({
  ProviderProfileStore: class {},
}));
vi.mock('../../../src/main/ai/services/ProviderService', () => ({
  ProviderService: class {},
}));
vi.mock('../../../src/main/ai/stores/SecretStore', () => ({
  SecretStore: class {},
}));
vi.mock('../../../src/main/ai/services/SummaryService', () => ({
  SummaryService: class {},
}));
vi.mock('../../../src/main/ai/stores/SummaryStore', () => ({
  SummaryStore: class {
    reconcileInterruptedRuns(): void {
      return undefined;
    }
  },
}));

import { initializeServices } from '../../../src/main/services';

describe('Content logger service assembly', () => {
  beforeEach(() => {
  capturedLoggers.content = undefined;
  capturedLoggers.feed = undefined;
  capturedLoggers.opmlExport = undefined;
  capturedLoggers.opmlImport = undefined;
  });

  it('passes the same Main operation logger to Feed, Content, and OPML services', () => {
    const operationLogger: FeedOperationLogger & ContentOperationLogger & OPMLOperationLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };

    initializeServices('/tmp/shale-test.db', '/tmp/shale-test-secrets.json', operationLogger);

    expect(capturedLoggers.feed).toBe(operationLogger);
    expect(capturedLoggers.content).toBe(operationLogger);
    expect(capturedLoggers.opmlImport).toBe(operationLogger);
    expect(capturedLoggers.opmlExport).toBe(operationLogger);
  });
});
