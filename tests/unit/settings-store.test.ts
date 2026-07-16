import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsStore } from '../../src/main/feed/SettingsStore';
import { buildTestDb } from '../fixtures/databases/feed-fixture';

describe('SettingsStore', () => {
  let store: SettingsStore;
  let db: ReturnType<typeof buildTestDb>['db'];

  beforeEach(() => {
    const testDb = buildTestDb();
    db = testDb.db;
    store = new SettingsStore(db);
  });

  describe('get/set', () => {
    it('should return default for missing key', () => {
      expect(store.get('nonexistent')).toBeUndefined();
      expect(store.get('nonexistent', 'default')).toBe('default');
    });

    it('should store and retrieve values', () => {
      store.set('theme', 'dark');
      expect(store.get('theme')).toBe('dark');
    });

    it('should update existing values', () => {
      store.set('theme', 'dark');
      store.set('theme', 'light');
      expect(store.get('theme')).toBe('light');
    });
  });

  describe('getInt', () => {
    it('should return integer value', () => {
      store.set('interval', '30');
      expect(store.getInt('interval', 15)).toBe(30);
    });

    it('should return default for missing key', () => {
      expect(store.getInt('nonexistent', 42)).toBe(42);
    });

    it('should return default for non-numeric values', () => {
      store.set('bad', 'not-a-number');
      expect(store.getInt('bad', 10)).toBe(10);
    });
  });

  describe('delete', () => {
    it('should remove a key', () => {
      store.set('temp', 'value');
      expect(store.get('temp')).toBe('value');
      store.delete('temp');
      expect(store.get('temp')).toBeUndefined();
    });

    it('should not throw for missing key', () => {
      store.delete('nonexistent');
    });
  });
});