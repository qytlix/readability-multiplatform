import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TerminologyStore } from '../../src/main/ai/stores/TerminologyStore';

describe('TerminologyStore', () => {
  let store: TerminologyStore;

  beforeAll(() => {
    store = new TerminologyStore(path.resolve(
      process.cwd(),
      'resources/terminology/terminology.sqlite',
    ));
  });

  afterAll(() => {
    store.close();
  });

  it('opens the packaged database read-only and exposes its source version', () => {
    expect(store.getVersion()).toMatch(/^agrovoc@\d{4}-\d{2}-\d{2}$/);
    expect(store.getInfo()).toMatchObject({
      version: store.getVersion(),
      sources: [{
        id: 'agrovoc',
        name: 'FAO AGROVOC',
        license: 'CC BY 4.0',
      }],
    });
  });

  it('matches normalized preferred terms without a network request', () => {
    const matches = store.findCandidates(
      'Modern AGRICULTURE supports rural communities.',
      'zh-CN',
    );

    expect(matches).toContainEqual(expect.objectContaining({
      sourceId: 'agrovoc',
      sourceTerm: 'agriculture',
      targetTerm: '农业',
    }));
  });

  it('resolves an alternative source label to the preferred target label', () => {
    const matches = store.findCandidates(
      'Integrated crop protection can reduce avoidable losses.',
      'zh-CN',
    );

    expect(matches).toContainEqual(expect.objectContaining({
      sourceId: 'agrovoc',
      sourceTerm: 'crop protection',
      targetTerm: '植物保护',
    }));
  });
});
