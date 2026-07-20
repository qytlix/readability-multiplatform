import type Database from 'better-sqlite3';

/**
 * Simple key-value settings store backed by the settings table.
 */
export class SettingsStore {
  constructor(private db: Database.Database) {}

  get(key: string, defaultValue?: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? defaultValue;
  }

  getInt(key: string, defaultValue: number): number {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
}