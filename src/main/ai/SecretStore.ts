import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SUMMARY_ERROR_CODES, SummaryError } from '../../shared/errors/summary.errors';

export interface SafeStorageBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(cipherText: Buffer): string;
  getSelectedStorageBackend?: () => string;
}

export type SecretStorageMode = 'secure' | 'insecure';

interface SecretFile {
  version: 2;
  secrets: Record<string, StoredSecret>;
}

interface StoredSecret {
  storageMode: SecretStorageMode;
  value: string;
}

interface LegacySecretFile {
  version: 1;
  secrets: Record<string, string>;
}

/**
 * Persists key material outside SQLite. Secure operating-system encryption is
 * used when available; otherwise the user-approved fallback writes the key to
 * the local secret file without encryption and reports that mode to Renderer.
 */
export class SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageBackend,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  getStorageMode(): SecretStorageMode {
    return this.isSecureStorageAvailable() ? 'secure' : 'insecure';
  }

  has(reference: string): boolean {
    try {
      const secret = this.readSecretFile().secrets[reference];
      return Boolean(secret) && (
        secret.storageMode === 'insecure' || this.isSecureStorageAvailable()
      );
    } catch {
      return false;
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

    const secretFile = this.readSecretFile();
    const storageMode = this.getStorageMode();
    secretFile.secrets[reference] = storageMode === 'secure'
      ? {
        storageMode,
        value: this.safeStorage.encryptString(apiKey).toString('base64'),
      }
      : { storageMode, value: apiKey };
    this.writeSecretFile(secretFile);
  }

  read(reference: string): string {
    const secret = this.readSecretFile().secrets[reference];
    if (!secret) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
        'The configured API key is unavailable. Save the provider configuration again.',
        true,
      );
    }

    if (secret.storageMode === 'insecure') return secret.value;

    if (!this.isSecureStorageAvailable()) {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
        'The configured API key requires secure operating-system storage that is unavailable.',
        true,
      );
    }

    try {
      return this.safeStorage.decryptString(Buffer.from(secret.value, 'base64'));
    } catch {
      throw new SummaryError(
        SUMMARY_ERROR_CODES.SUMMARY_KEY_MISSING,
        'The configured API key can no longer be decrypted. Save it again.',
        true,
      );
    }
  }

  delete(reference: string): void {
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
      if (isSecretFile(parsed)) return parsed;
      if (isLegacySecretFile(parsed)) {
        return {
          version: 2,
          secrets: Object.fromEntries(
            Object.entries(parsed.secrets).map(([reference, value]) => [
              reference,
              { storageMode: 'secure', value },
            ]),
          ),
        };
      }
      throw new Error('Invalid secret file');
    } catch (error) {
      if (isMissingFileError(error)) {
        return { version: 2, secrets: {} };
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
  if (candidate.version !== 2 || !candidate.secrets || typeof candidate.secrets !== 'object') {
    return false;
  }
  return Object.values(candidate.secrets).every(isStoredSecret);
}

function isStoredSecret(value: unknown): value is StoredSecret {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { storageMode?: unknown; value?: unknown };
  return (
    (candidate.storageMode === 'secure' || candidate.storageMode === 'insecure')
    && typeof candidate.value === 'string'
  );
}

function isLegacySecretFile(value: unknown): value is LegacySecretFile {
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
