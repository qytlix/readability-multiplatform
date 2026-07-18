import { safeStorage } from 'electron';
import path from 'node:path';
import { DatabaseManager } from './database/DatabaseManager';
import { FeedStore } from './feed/FeedStore';
import { EntryStore } from './feed/EntryStore';
import { ContentStore } from './feed/ContentStore';
import { FeedService } from './feed/FeedService';
import { ContentService } from './feed/ContentService';
import { SyncCoordinator } from './feed/SyncCoordinator';
import { SyncScheduler } from './feed/SyncScheduler';
import { OPMLImportService } from './feed/OPMLImportService';
import { OPMLExportService } from './feed/OPMLExportService';
import { OpenAICompatibleProvider } from './ai/OpenAICompatibleProvider';
import { ProviderProfileStore } from './ai/ProviderProfileStore';
import { ProviderService } from './ai/ProviderService';
import { SecretStore } from './ai/SecretStore';
import { SummaryService } from './ai/SummaryService';
import { SummaryStore } from './ai/SummaryStore';

// ── Service Interfaces ──────────────────────────────────

export interface FeedServices {
  feedService: FeedService;
  contentService: ContentService;
  entryStore: EntryStore;
  contentStore: ContentStore;
  feedStore: FeedStore;
  syncCoordinator: SyncCoordinator;
  syncScheduler: SyncScheduler;
  opmlImportService: OPMLImportService;
  opmlExportService: OPMLExportService;
}

export interface SummaryServices {
  providerService: ProviderService;
  summaryService: SummaryService;
}

// ── Module-level Singletons ─────────────────────────────

let feedServicesSingleton: FeedServices | null = null;
let summaryServicesSingleton: SummaryServices | null = null;

/** Returns the feed services singleton (null before initializeServices). */
export function getFeedServices(): FeedServices | null {
  return feedServicesSingleton;
}

/** Returns the summary services singleton (null before initializeServices). */
export function getSummaryServices(): SummaryServices | null {
  return summaryServicesSingleton;
}

/** Returns the feed sync scheduler for application lifecycle cleanup. */
export function getSyncScheduler(): SyncScheduler | null {
  return feedServicesSingleton?.syncScheduler ?? null;
}

/** Returns the Summary runtime for application shutdown cleanup. */
export function getSummaryService(): SummaryService | null {
  return summaryServicesSingleton?.summaryService ?? null;
}

// ── Initialization ──────────────────────────────────────

/**
 * Initialize the database, run migrations, and create service instances.
 * Must be called before registerIpcHandlers.
 */
export function initializeServices(
  dbPath?: string,
  secretStoragePath?: string,
): FeedServices {
  const dbManager = new DatabaseManager(dbPath);
  dbManager.runMigrations();

  const feedStore = new FeedStore(dbManager.getDb());
  const entryStore = new EntryStore(dbManager.getDb());
  const contentStore = new ContentStore(dbManager.getDb());

  const feedService = new FeedService(feedStore, entryStore);
  const contentService = new ContentService(contentStore, entryStore);
  const providerProfileStore = new ProviderProfileStore(dbManager.getDb());
  const summaryStore = new SummaryStore(dbManager.getDb());
  summaryStore.reconcileInterruptedRuns();
  const secretStore = new SecretStore(
    secretStoragePath ?? path.join(path.dirname(dbPath ?? '.'), 'ai-secrets.json'),
    safeStorage,
  );
  const provider = new OpenAICompatibleProvider();
  const providerService = new ProviderService(
    providerProfileStore,
    secretStore,
    provider,
  );
  const summaryService = new SummaryService(
    contentStore,
    providerProfileStore,
    secretStore,
    summaryStore,
    provider,
  );

  feedServicesSingleton = {
    feedService,
    contentService,
    entryStore,
    contentStore,
    feedStore,
    syncCoordinator: null as unknown as SyncCoordinator,
    syncScheduler: null as unknown as SyncScheduler,
    opmlImportService: new OPMLImportService(feedStore),
    opmlExportService: new OPMLExportService(feedStore),
  };
  summaryServicesSingleton = { providerService, summaryService };
  return feedServicesSingleton;
}