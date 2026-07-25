import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { AnnotationService } from '../../src/main/annotations/AnnotationService';
import { AnnotationStore } from '../../src/main/annotations/AnnotationStore';
import { EntryStore } from '../../src/main/feed/stores/EntryStore';
import { ANNOTATION_ERROR_CODES } from '../../src/shared/errors/annotation.errors';
import { buildTestDbWithData } from '../fixtures/databases/feed-fixture';

describe('AnnotationStore and AnnotationService', () => {
  let annotationStore: AnnotationStore;
  let annotationService: AnnotationService;
  let entryStore: EntryStore;
  let db: Database.Database;

  beforeEach(() => {
    ({ db } = buildTestDbWithData());
    annotationStore = new AnnotationStore(db);
    entryStore = new EntryStore(db);
    annotationService = new AnnotationService(annotationStore, entryStore);
  });

  it('persists, lists, edits, and deletes a range annotation', () => {
    const created = annotationService.create({
      entryId: 1,
      startOffset: 6,
      endOffset: 11,
      selectedText: 'world',
      prefixText: 'Hello ',
      suffixText: ' from Shale',
      color: 'yellow',
    });

    expect(annotationService.list(1)).toEqual([created]);
    expect(annotationService.updateNote({
      annotationId: created.id,
      noteText: 'A useful detail.',
    })).toMatchObject({
      id: created.id,
      noteText: 'A useful detail.',
      color: 'yellow',
    });

    annotationService.delete(created.id);
    expect(annotationService.list(1)).toEqual([]);
  });

  it('rejects overlapping highlights but permits adjacent ranges', () => {
    annotationService.create({
      entryId: 1,
      startOffset: 0,
      endOffset: 5,
      selectedText: 'First',
      prefixText: '',
      suffixText: ' second',
      color: 'green',
    });

    expect(() => annotationService.create({
      entryId: 1,
      startOffset: 4,
      endOffset: 10,
      selectedText: 't seco',
      prefixText: 'Firs',
      suffixText: 'nd',
      color: 'pink',
    })).toThrow(expect.objectContaining({
      code: ANNOTATION_ERROR_CODES.OVERLAP,
    }));

    expect(() => annotationService.create({
      entryId: 1,
      startOffset: 5,
      endOffset: 12,
      selectedText: ' second',
      prefixText: 'First',
      suffixText: '',
      color: 'blue',
    })).not.toThrow();
  });

  it('validates text offsets and article identity at the service boundary', () => {
    expect(() => annotationService.create({
      entryId: 1,
      startOffset: 0,
      endOffset: 4,
      selectedText: 'three',
      prefixText: '',
      suffixText: '',
      color: 'yellow',
    })).toThrow(expect.objectContaining({
      code: ANNOTATION_ERROR_CODES.INVALID_REQUEST,
    }));

    expect(() => annotationService.list(999)).toThrow(expect.objectContaining({
      code: ANNOTATION_ERROR_CODES.ENTRY_NOT_FOUND,
    }));
  });

  it('deletes annotations when their article is deleted', () => {
    const annotation = annotationService.create({
      entryId: 1,
      startOffset: 0,
      endOffset: 5,
      selectedText: 'First',
      prefixText: '',
      suffixText: '',
      color: 'yellow',
    });

    db.prepare('DELETE FROM entry WHERE id = 1').run();

    expect(annotationStore.findById(annotation.id)).toBeUndefined();
  });
});
