import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseManager } from '../../src/main/database/DatabaseManager';
import { TerminologyStore } from '../../src/main/ai/stores/TerminologyStore';
import { DEFAULT_TERMINOLOGY_LIBRARY_ID } from '../../src/shared/contracts/translation-terminology.types';

const RESOURCE_PATH = path.resolve(
  process.cwd(),
  'resources/terminology/terminology-libraries.sqlite',
);

describe('TerminologyStore', () => {
  let manager: DatabaseManager;
  let store: TerminologyStore;

  beforeEach(() => {
    manager = new DatabaseManager();
    manager.runMigrations();
    store = new TerminologyStore(RESOURCE_PATH, manager.getDb());
  });

  afterEach(() => {
    store.close();
    manager.close();
  });

  it('starts with exactly the aggregate default library enabled', () => {
    const list = store.listLibraries();

    expect(list.libraries).toHaveLength(34);
    expect(list.libraries.filter((library) => library.enabled)).toEqual([
      expect.objectContaining({
        id: DEFAULT_TERMINOLOGY_LIBRARY_ID,
        origin: 'builtin',
      }),
    ]);
    expect(list.enabledSetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.getInfo()).toMatchObject({
      version: list.enabledSetHash,
      sources: [{
        id: 'agrovoc',
        name: 'FAO AGROVOC',
        license: 'CC BY 4.0',
      }],
    });
  });

  it('keeps the existing AGROVOC behavior inside builtin:default', () => {
    const matches = store.findCandidates(
      'Modern AGRICULTURE supports rural communities.',
      'zh-CN',
    );

    expect(matches).toContainEqual(expect.objectContaining({
      libraryId: DEFAULT_TERMINOLOGY_LIBRARY_ID,
      sourceTerm: 'agriculture',
      targetTerm: '农业',
    }));
  });

  it('enables a bundled library persistently and changes the cache identity', () => {
    const before = store.getVersion();
    store.setLibraryEnabled('builtin:twitter', true);
    const after = store.getVersion();

    expect(after).not.toBe(before);
    expect(store.findCandidates('Elon Musk posted an update.', 'zh-CN', before))
      .not.toContainEqual(expect.objectContaining({
        libraryId: 'builtin:twitter',
      }));
    expect(store.findCandidates('Elon Musk posted an update.', 'zh-CN'))
      .toContainEqual(expect.objectContaining({
        libraryId: 'builtin:twitter',
        sourceTerm: 'Elon Musk',
      }));

    store.close();
    store = new TerminologyStore(RESOURCE_PATH, manager.getDb());
    expect(store.listLibraries().libraries.find(
      (library) => library.id === 'builtin:twitter',
    )?.enabled).toBe(true);
    expect(store.getVersion()).toBe(after);
  });

  it('marks zh-TW entries as low-priority zh-HK references', () => {
    store.setLibraryEnabled('builtin:twitter', true);

    expect(store.findCandidates('Elon Musk', 'zh-HK')).toContainEqual(
      expect.objectContaining({
        libraryId: 'builtin:twitter',
        provenanceTargetLanguage: 'zh-TW',
      }),
    );
  });

  it('imports user CSV transactionally and gives user entries precedence', () => {
    const preview = store.previewImport('My terms', [
      'source,target,tgt_lng',
      'agriculture,USER AGRICULTURE,zh-CN',
      'Shale,,',
    ].join('\n'));
    expect(preview).toMatchObject({
      valid: true,
      acceptedRowCount: 2,
      replacesExistingUserLibrary: false,
    });

    const imported = store.importLibrary({
      name: 'My terms',
      csv: [
        'source,target,tgt_lng',
        'agriculture,USER AGRICULTURE,zh-CN',
        'Shale,,',
      ].join('\n'),
    });
    expect(imported.libraryId).toMatch(/^user:/);
    expect(store.findCandidates('agriculture', 'zh-CN')[0]).toMatchObject({
      libraryId: imported.libraryId,
      targetTerm: 'USER AGRICULTURE',
    });
    expect(store.findCandidates('Shale', 'de')[0]).toMatchObject({
      libraryId: imported.libraryId,
      targetTerm: 'Shale',
    });
  });

  it('writes nothing when CSV validation fails and removes user libraries fully', () => {
    expect(() => store.importLibrary({
      name: 'Broken',
      csv: 'source,target,tgt_lng\n,missing,zh-CN',
    })).toThrow();
    expect(store.listLibraries().libraries.some(
      (library) => library.name === 'Broken',
    )).toBe(false);

    const imported = store.importLibrary({
      name: 'Disposable',
      csv: 'source,target,tgt_lng\nterm,value,en',
    });
    store.removeLibrary(imported.libraryId);
    expect(store.listLibraries().libraries.some(
      (library) => library.id === imported.libraryId,
    )).toBe(false);
    expect(manager.getDb().prepare(`
      SELECT COUNT(*) AS count
      FROM terminology_entry_user
      WHERE libraryId = ?
    `).get(imported.libraryId)).toEqual({ count: 0 });
  });
});
