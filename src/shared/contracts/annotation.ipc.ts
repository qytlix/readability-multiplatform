import type { IPCResult } from './feed.ipc';
import type {
  AnnotationIdRequest,
  AnnotationListRequest,
  CreateAnnotationRequest,
  EntryAnnotation,
  UpdateAnnotationNoteRequest,
} from './annotation.types';

export const ANNOTATION_IPC_CHANNELS = {
  list: 'annotation:list',
  create: 'annotation:create',
  updateNote: 'annotation:update-note',
  delete: 'annotation:delete',
} as const;

export interface AnnotationAPI {
  list: (
    request: AnnotationListRequest,
  ) => Promise<IPCResult<EntryAnnotation[]>>;
  create: (
    request: CreateAnnotationRequest,
  ) => Promise<IPCResult<EntryAnnotation>>;
  updateNote: (
    request: UpdateAnnotationNoteRequest,
  ) => Promise<IPCResult<EntryAnnotation>>;
  delete: (request: AnnotationIdRequest) => Promise<IPCResult<void>>;
}
