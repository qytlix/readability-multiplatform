import type {
  CreateAnnotationRequest,
  EntryAnnotation,
  UpdateAnnotationNoteRequest,
} from '../../shared/contracts/annotation.types';
import { ANNOTATION_COLORS } from '../../shared/contracts/annotation.types';
import {
  ANNOTATION_ERROR_CODES,
  AnnotationError,
} from '../../shared/errors/annotation.errors';
import type { EntryStore } from '../feed/stores/EntryStore';
import type { AnnotationStore } from './AnnotationStore';

const MAX_SELECTED_TEXT_LENGTH = 10_000;
const MAX_CONTEXT_LENGTH = 256;
const MAX_NOTE_LENGTH = 20_000;

export class AnnotationService {
  constructor(
    private readonly annotationStore: AnnotationStore,
    private readonly entryStore: EntryStore,
  ) {}

  list(entryId: number): EntryAnnotation[] {
    this.assertEntryExists(entryId);
    return this.annotationStore.findByEntry(entryId);
  }

  create(request: CreateAnnotationRequest): EntryAnnotation {
    this.assertEntryExists(request.entryId);
    assertCreateRequest(request);
    const overlaps = this.annotationStore.findByEntry(request.entryId).some(
      (annotation) => (
        request.startOffset < annotation.endOffset
        && request.endOffset > annotation.startOffset
      ),
    );
    if (overlaps) {
      throw new AnnotationError(
        ANNOTATION_ERROR_CODES.OVERLAP,
        'The selected text overlaps an existing annotation.',
      );
    }
    return this.annotationStore.create(request);
  }

  updateNote(request: UpdateAnnotationNoteRequest): EntryAnnotation {
    if (!Number.isInteger(request.annotationId) || request.annotationId <= 0) {
      throw invalidRequest('The annotation identity is invalid.');
    }
    if (request.noteText.length > MAX_NOTE_LENGTH) {
      throw invalidRequest('The annotation note is too long.');
    }
    const annotation = this.annotationStore.updateNote(
      request.annotationId,
      request.noteText,
    );
    if (!annotation) throw annotationNotFound();
    return annotation;
  }

  delete(annotationId: number): void {
    if (!Number.isInteger(annotationId) || annotationId <= 0) {
      throw invalidRequest('The annotation identity is invalid.');
    }
    if (!this.annotationStore.delete(annotationId)) {
      throw annotationNotFound();
    }
  }

  private assertEntryExists(entryId: number): void {
    if (!this.entryStore.findById(entryId)) {
      throw new AnnotationError(
        ANNOTATION_ERROR_CODES.ENTRY_NOT_FOUND,
        'The article for this annotation no longer exists.',
      );
    }
  }
}

function assertCreateRequest(request: CreateAnnotationRequest): void {
  if (
    !Number.isInteger(request.entryId)
    || request.entryId <= 0
    || !Number.isInteger(request.startOffset)
    || !Number.isInteger(request.endOffset)
    || request.startOffset < 0
    || request.endOffset <= request.startOffset
    || request.endOffset - request.startOffset !== request.selectedText.length
    || request.selectedText.length === 0
    || request.selectedText.length > MAX_SELECTED_TEXT_LENGTH
    || request.selectedText.trim().length === 0
    || request.prefixText.length > MAX_CONTEXT_LENGTH
    || request.suffixText.length > MAX_CONTEXT_LENGTH
    || !ANNOTATION_COLORS.some((color) => color === request.color)
  ) {
    throw invalidRequest('The selected text range is invalid.');
  }
}

function invalidRequest(message: string): AnnotationError {
  return new AnnotationError(ANNOTATION_ERROR_CODES.INVALID_REQUEST, message);
}

function annotationNotFound(): AnnotationError {
  return new AnnotationError(
    ANNOTATION_ERROR_CODES.NOT_FOUND,
    'The annotation no longer exists.',
  );
}
