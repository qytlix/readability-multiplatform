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
  type ContentOperationLogger,
  type FeedOperationLogger,
  type OPMLOperationLogger,
} from './feed/services';
import { OpenAICompatibleProvider } from './ai/provider/OpenAICompatibleProvider';
import { ProviderProfileStore } from './ai/stores/ProviderProfileStore';
import { ProviderService } from './ai/services/ProviderService';
import type { ProviderOperationLogger } from './ai/services/ProviderLogging';
import { SecretStore } from './ai/stores/SecretStore';
import { SummaryService } from './ai/services/SummaryService';
import type { SummaryOperationLogger } from './ai/services/SummaryLogging';
import { SummaryStore } from './ai/stores/SummaryStore';
import { TranslationService } from './ai/services/TranslationService';
import { InlineTranslationService } from './ai/services/InlineTranslationService';
import { TranslationStore } from './ai/stores/TranslationStore';
import {
  EmptyTerminologyLookup,
  TerminologyStore,
} from './ai/stores/TerminologyStore';
import { AnnotationStore } from './annotations/AnnotationStore';
import { AnnotationService } from './annotations/AnnotationService';

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

export interface AnnotationServices {
  annotationService: AnnotationService;
}

// ── Module-level Singletons ─────────────────────────────

let feedServicesSingleton: FeedServices | null = null;
let summaryServicesSingleton: SummaryServices | null = null;
let translationServicesSingleton: TranslationServices | null = null;
let annotationServicesSingleton: AnnotationServices | null = null;

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

export function getAnnotationServices(): AnnotationServices | null {
  return annotationServicesSingleton;
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
  dbPath: string | undefined,
  secretStoragePath: string | undefined,
  operationLogger: FeedOperationLogger
    & ContentOperationLogger
    & OPMLOperationLogger
    & ProviderOperationLogger
    & SummaryOperationLogger,
  terminologyDbPath?: string,
): FeedServices {
  const dbManager = new DatabaseManager(dbPath);
  dbManager.runMigrations();

  const feedStore = new FeedStore(dbManager.getDb());
  const entryStore = new EntryStore(dbManager.getDb());
  const contentStore = new ContentStore(dbManager.getDb());

  const feedService = new FeedService(feedStore, entryStore, operationLogger);
  const contentService = new ContentService(
    contentStore,
    entryStore,
    undefined,
    undefined,
    undefined,
    operationLogger,
  );
  const providerProfileStore = new ProviderProfileStore(dbManager.getDb());
  const summaryStore = new SummaryStore(dbManager.getDb());
  const translationStore = new TranslationStore(dbManager.getDb());
  const annotationStore = new AnnotationStore(dbManager.getDb());
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
    operationLogger,
  );
  const summaryService = new SummaryService(
    contentStore,
    providerProfileStore,
    secretStore,
    summaryStore,
    provider,
    operationLogger,
  );
  summaryService.reconcileInterruptedRuns();
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
    terminologyLookup,
  );
  const annotationService = new AnnotationService(annotationStore, entryStore);

  feedServicesSingleton = {
    feedService,
    contentService,
    entryStore,
    contentStore,
    feedStore,
    syncCoordinator: null as unknown as SyncCoordinator,
    syncScheduler: null as unknown as SyncScheduler,
    opmlImportService: new OPMLImportService(feedStore, operationLogger),
    opmlExportService: new OPMLExportService(feedStore, operationLogger),
  };
  summaryServicesSingleton = { providerService, summaryService };
  translationServicesSingleton = { translationService, inlineTranslationService };
  annotationServicesSingleton = { annotationService };
  return feedServicesSingleton;
}
