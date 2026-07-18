import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SecretStore, type SafeStorageBackend } from '../../src/main/ai/stores/SecretStore';

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

function createSecretStore(backend: SafeStorageBackend = encryptedBackend): {
  store: SecretStore;
  filePath: string;
} {
  const directory = mkdtempSync(path.join(tmpdir(), 'shale-summary-test-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'ai-secrets.json');
  return { store: new SecretStore(filePath, backend, 'linux'), filePath };
}

describe('SecretStore', () => {
  it('stores only encrypted key material outside SQLite', () => {
    const { store, filePath } = createSecretStore();
    store.save('profile-1', 'sk-test-key');

    expect(store.read('profile-1')).toBe('sk-test-key');
    expect(readFileSync(filePath, 'utf8')).not.toContain('sk-test-key');
  });

  it('persists plaintext keys when the Linux keyring would fall back to basic_text', () => {
    const basicTextBackend: SafeStorageBackend = {
      ...encryptedBackend,
      getSelectedStorageBackend: () => 'basic_text',
    };
    const { store, filePath } = createSecretStore(basicTextBackend);

    store.save('profile-1', 'sk-test-key');

    expect(store.getStorageMode()).toBe('insecure');
    expect(store.read('profile-1')).toBe('sk-test-key');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toContain('sk-test-key');
    expect(new SecretStore(filePath, basicTextBackend, 'linux').read('profile-1')).toBe('sk-test-key');
  });

  it('uses persistent plaintext storage when system encryption is unavailable', () => {
    const unavailableBackend: SafeStorageBackend = {
      ...encryptedBackend,
      isEncryptionAvailable: () => false,
    };
    const { store, filePath } = createSecretStore(unavailableBackend);

    store.save('profile-1', 'sk-test-key');
    expect(store.getStorageMode()).toBe('insecure');
    expect(store.read('profile-1')).toBe('sk-test-key');
    expect(new SecretStore(filePath, unavailableBackend, 'linux').read('profile-1')).toBe('sk-test-key');
  });

  it('continues to read legacy encrypted key files', () => {
    const { store, filePath } = createSecretStore();
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      secrets: { 'profile-1': Buffer.from('encrypted:sk-test-key').toString('base64') },
    }));

    expect(store.read('profile-1')).toBe('sk-test-key');
  });
});
