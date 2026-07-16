import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../shared/errors/summary.errors';

export interface SafeStorageBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(cipherText: Buffer): string;
  getSelectedStorageBackend?: () => string;
}

export type SecretStorageMode = 'secure' | 'session';

interface SecretFile {
  version: 1;
  secrets: Record<string, string>;
}

/**
 * Persists only OS-encrypted key material outside SQLite. When an OS keyring
 * is unavailable, keys remain in Main-process memory and are discarded when
 * the app exits; the `basic_text` fallback is never written to disk.
 */
export class SecretStore {
  private readonly sessionSecrets = new Map<string, string>();

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageBackend,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  getStorageMode(): SecretStorageMode {
    return this.isSecureStorageAvailable() ? 'secure' : 'session';
  }

  has(reference: string): boolean {
    if (this.sessionSecrets.has(reference)) return true;
    if (!this.isSecureStorageAvailable()) return false;

    try {
      return Boolean(this.readSecretFile().secrets[reference]);
    } catch {
      return false;
    }
  }

  assertAvailable(): void {
    if (!this.isSecureStorageAvailable()) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_STORAGE_UNAVAILABLE,
        'Secure operating-system key storage is unavailable on this device.',
        false,
      );
    }
  }

  save(reference: string, apiKey: string): void {
    if (!reference || !apiKey.trim()) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_INVALID_REQUEST,
        'An API key is required.',
        false,
      );
    }

    if (!this.isSecureStorageAvailable()) {
      this.sessionSecrets.set(reference, apiKey);
      return;
    }

    const secretFile = this.readSecretFile();
    secretFile.secrets[reference] = this.safeStorage
      .encryptString(apiKey)
      .toString('base64');
    this.writeSecretFile(secretFile);
  }

  read(reference: string): string {
    const sessionSecret = this.sessionSecrets.get(reference);
    if (sessionSecret) return sessionSecret;

    if (!this.isSecureStorageAvailable()) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
        'This device cannot securely save API keys. Enter the API key again for this app session.',
        true,
      );
    }

    const ciphertext = this.readSecretFile().secrets[reference];
    if (!ciphertext) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
        'The configured API key is unavailable. Save the provider configuration again.',
        true,
      );
    }

    try {
      return this.safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
    } catch {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
        'The configured API key can no longer be decrypted. Save it again.',
        true,
      );
    }
  }

  delete(reference: string): void {
    this.sessionSecrets.delete(reference);
    if (!this.isSecureStorageAvailable()) return;

    const secretFile = this.readSecretFile();
    if (secretFile.secrets[reference]) {
      delete secretFile.secrets[reference];
      this.writeSecretFile(secretFile);
    }
  }

  private isSecureStorageAvailable(): boolean {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return false;
    }

    const linuxBackend = this.platform === 'linux'
      ? this.safeStorage.getSelectedStorageBackend?.()
      : undefined;
    if (
      linuxBackend === 'basic_text'
      || linuxBackend === 'unknown'
    ) {
      return false;
    }
    return true;
  }

  private readSecretFile(): SecretFile {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!isSecretFile(parsed)) {
        throw new Error('Invalid secret file');
      }
      return parsed;
    } catch (error) {
      if (isMissingFileError(error)) {
        return { version: 1, secrets: {} };
      }
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_STORAGE_UNAVAILABLE,
        'Secure key storage could not be read.',
        false,
      );
    }
  }

  private writeSecretFile(secretFile: SecretFile): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify(secretFile), {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporaryPath, this.filePath);
    } catch {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_STORAGE_UNAVAILABLE,
        'Secure key storage could not be updated.',
        false,
      );
    }
  }
}

function isSecretFile(value: unknown): value is SecretFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { version?: unknown; secrets?: unknown };
  if (candidate.version !== 1 || !candidate.secrets || typeof candidate.secrets !== 'object') {
    return false;
  }
  return Object.values(candidate.secrets).every((secret) => typeof secret === 'string');
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ENOENT'
  );
}
