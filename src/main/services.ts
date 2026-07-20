import { safeStorage } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseManager } from './database/DatabaseManager';
import { ContentStore, EntryStore, FeedStore } from './feed/stores';
import {
  ContentService,
  FeedService,
  OPMLExportService,
  OPMLImportService,
  SyncCoordinator,
  SyncScheduler,
} from './feed/services';
import { OpenAICompatibleProvider } from './ai/provider/OpenAICompatibleProvider';
import { ProviderProfileStore } from './ai/stores/ProviderProfileStore';
import { ProviderService } from './ai/services/ProviderService';
import { SecretStore } from './ai/stores/SecretStore';
import { SummaryService } from './ai/services/SummaryService';
import { SummaryStore } from './ai/stores/SummaryStore';
import { TranslationService } from './ai/services/TranslationService';
import { InlineTranslationService } from './ai/services/InlineTranslationService';
import { TranslationStore } from './ai/stores/TranslationStore';
import {
  EmptyTerminologyLookup,
  TerminologyStore,
} from './ai/stores/TerminologyStore';

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

export interface TranslationServices {
  translationService: TranslationService;
  inlineTranslationService: InlineTranslationService;
}

// ── Module-level Singletons ─────────────────────────────

let feedServicesSingleton: FeedServices | null = null;
let summaryServicesSingleton: SummaryServices | null = null;
let translationServicesSingleton: TranslationServices | null = null;

/** Returns the feed services singleton (null before initializeServices). */
export function getFeedServices(): FeedServices | null {
  return feedServicesSingleton;
}

/** Returns the summary services singleton (null before initializeServices). */
export function getSummaryServices(): SummaryServices | null {
  return summaryServicesSingleton;
}

/** Returns the Translation services singleton (null before initializeServices). */
export function getTranslationServices(): TranslationServices | null {
  return translationServicesSingleton;
}

/** Returns the feed sync scheduler for application lifecycle cleanup. */
export function getSyncScheduler(): SyncScheduler | null {
  return feedServicesSingleton?.syncScheduler ?? null;
}

/** Returns the Summary runtime for application shutdown cleanup. */
export function getSummaryService(): SummaryService | null {
  return summaryServicesSingleton?.summaryService ?? null;
}

/** Returns the persisted Translation runtime for application shutdown cleanup. */
export function getTranslationService(): TranslationService | null {
  return translationServicesSingleton?.translationService ?? null;
}

/** Returns the one-shot inline Translation runtime for shutdown cleanup. */
export function getInlineTranslationService(): InlineTranslationService | null {
  return translationServicesSingleton?.inlineTranslationService ?? null;
}

// ── Initialization ──────────────────────────────────────

/**
 * Initialize the database, run migrations, and create service instances.
 * Must be called before registerIpcHandlers.
 */
export function initializeServices(
  dbPath?: string,
  secretStoragePath?: string,
  terminologyDbPath?: string,
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
  const translationStore = new TranslationStore(dbManager.getDb());
  translationStore.reconcileInterruptedRuns();
  const secretStore = new SecretStore(
    secretStoragePath ?? path.join(path.dirname(dbPath ?? '.'), 'ai-secrets.json'),
    safeStorage,
  );
  const provider = new OpenAICompatibleProvider();
  const terminologyLookup = terminologyDbPath && existsSync(terminologyDbPath)
    ? new TerminologyStore(terminologyDbPath)
    : new EmptyTerminologyLookup();
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
  const translationService = new TranslationService(
    contentStore,
    providerProfileStore,
    secretStore,
    translationStore,
    provider,
    undefined,
    terminologyLookup,
  );
  const inlineTranslationService = new InlineTranslationService(
    providerProfileStore,
    secretStore,
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
  translationServicesSingleton = { translationService, inlineTranslationService };
  return feedServicesSingleton;
}
