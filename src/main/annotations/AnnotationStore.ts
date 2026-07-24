import type Database from 'better-sqlite3';
import type {
  AnnotationColor,
  CreateAnnotationRequest,
  EntryAnnotation,
} from '../../shared/contracts/annotation.types';

interface AnnotationRow {
  id: number;
  entryId: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefixText: string;
  suffixText: string;
  color: AnnotationColor;
  noteText: string;
  createdAt: string;
  updatedAt: string;
}

export class AnnotationStore {
  constructor(private readonly db: Database.Database) {}

  findByEntry(entryId: number): EntryAnnotation[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM entry_annotation
      WHERE entryId = ?
      ORDER BY startOffset ASC, endOffset ASC, id ASC
    `).all(entryId) as AnnotationRow[];
    return rows.map(toAnnotation);
  }

  findById(annotationId: number): EntryAnnotation | undefined {
    const row = this.db.prepare(`
      SELECT * FROM entry_annotation WHERE id = ?
    `).get(annotationId) as AnnotationRow | undefined;
    return row ? toAnnotation(row) : undefined;
  }

  create(request: CreateAnnotationRequest): EntryAnnotation {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO entry_annotation (
        entryId, startOffset, endOffset, selectedText,
        prefixText, suffixText, color, noteText, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
    `).run(
      request.entryId,
      request.startOffset,
      request.endOffset,
      request.selectedText,
      request.prefixText,
      request.suffixText,
      request.color,
      now,
      now,
    );
    const annotation = this.findById(Number(result.lastInsertRowid));
    if (!annotation) throw new Error('Annotation was not persisted.');
    return annotation;
  }

  updateNote(annotationId: number, noteText: string): EntryAnnotation | undefined {
    const result = this.db.prepare(`
      UPDATE entry_annotation
      SET noteText = ?, updatedAt = ?
      WHERE id = ?
    `).run(noteText, new Date().toISOString(), annotationId);
    return result.changes > 0 ? this.findById(annotationId) : undefined;
  }

  delete(annotationId: number): boolean {
    return this.db.prepare(
      'DELETE FROM entry_annotation WHERE id = ?',
    ).run(annotationId).changes > 0;
  }
}

function toAnnotation(row: AnnotationRow): EntryAnnotation {
  return {
    id: row.id,
    entryId: row.entryId,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    selectedText: row.selectedText,
    prefixText: row.prefixText,
    suffixText: row.suffixText,
    color: row.color,
    noteText: row.noteText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
