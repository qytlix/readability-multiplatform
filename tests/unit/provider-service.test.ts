import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderProfileStore } from '../../src/main/ai/ProviderProfileStore';
import { ProviderService } from '../../src/main/ai/ProviderService';
import { SecretStore, type SafeStorageBackend } from '../../src/main/ai/SecretStore';
import type { SummaryProvider } from '../../src/main/ai/SummaryProvider';
import { DatabaseManager } from '../../src/main/database/DatabaseManager';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const encryptedBackend: SafeStorageBackend = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
  getSelectedStorageBackend: () => 'gnome_libsecret',
};

function createService(): {
  databaseManager: DatabaseManager;
  databasePath: string;
  service: ProviderService;
  requestProvider: SummaryProvider;
  secretFilePath: string;
} {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-provider-test-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'shale.db');
  const secretFilePath = path.join(directory, 'ai-secrets.json');
  const databaseManager = new DatabaseManager(databasePath);
  databaseManager.runMigrations();
  const requestProvider: SummaryProvider = {
    async *stream() {
      yield '';
    },
    testConnection: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ProviderService(
    new ProviderProfileStore(databaseManager.getDb()),
    new SecretStore(secretFilePath, encryptedBackend, 'linux'),
    requestProvider,
  );
  return { databaseManager, databasePath, service, requestProvider, secretFilePath };
}

describe('ProviderService', () => {
  it('reloads a securely persisted GPT configuration after reopening the app', async () => {
    const {
      databaseManager,
      databasePath,
      service,
      requestProvider,
      secretFilePath,
    } = createService();
    const saved = service.save({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
      apiKey: 'sk-test-key',
    });

    expect(saved).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
      hasApiKey: true,
      keyStorageMode: 'secure',
    });

    databaseManager.close();
    const reopenedDatabaseManager = new DatabaseManager(databasePath);
    try {
      reopenedDatabaseManager.runMigrations();
      const reopenedService = new ProviderService(
        new ProviderProfileStore(reopenedDatabaseManager.getDb()),
        new SecretStore(secretFilePath, encryptedBackend, 'linux'),
        requestProvider,
      );

      expect(reopenedService.getActiveProfile()).toMatchObject({
        model: 'gpt-5.4-mini',
        hasApiKey: true,
        keyStorageMode: 'secure',
      });

      await reopenedService.testConnection();
      expect(requestProvider.testConnection).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'sk-test-key',
        model: 'gpt-5.4-mini',
      }));
    } finally {
      reopenedDatabaseManager.close();
    }
  });

  it('rejects a model that is not in the GPT Summary allowlist', () => {
    const { databaseManager, service } = createService();

    try {
      expect(() => service.save({
        baseUrl: 'https://api.openai.com/v1',
        model: 'other-provider-model' as never,
        apiKey: 'sk-test-key',
      })).toThrow('Select a supported GPT model.');
    } finally {
      databaseManager.close();
    }
  });
});
