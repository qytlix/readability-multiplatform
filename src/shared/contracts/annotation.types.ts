export const ANNOTATION_COLORS = [
  'yellow',
  'green',
  'blue',
  'pink',
] as const;

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

export interface EntryAnnotation {
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

export interface CreateAnnotationRequest {
  entryId: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefixText: string;
  suffixText: string;
  color: AnnotationColor;
}

export interface UpdateAnnotationNoteRequest {
  annotationId: number;
  noteText: string;
}

export interface AnnotationIdRequest {
  annotationId: number;
}

export interface AnnotationListRequest {
  entryId: number;
}
