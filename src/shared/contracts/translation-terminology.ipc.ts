import type { IPCResult } from './feed.ipc';
import type {
  TerminologyImportPreview,
  TerminologyImportPreviewRequest,
  TerminologyImportRequest,
  TerminologyLibraryList,
  TerminologyLibraryMutationResult,
  TerminologyLibraryRemoveRequest,
  TerminologyLibrarySetEnabledRequest,
} from './translation-terminology.types';

export const TRANSLATION_TERMINOLOGY_IPC_CHANNELS = {
  list: 'terminology:list',
  setEnabled: 'terminology:set-enabled',
  preview: 'terminology:preview',
  import: 'terminology:import',
  remove: 'terminology:remove',
} as const;

export interface TranslationTerminologyAPI {
  list: () => Promise<IPCResult<TerminologyLibraryList>>;
  setEnabled: (
    request: TerminologyLibrarySetEnabledRequest,
  ) => Promise<IPCResult<TerminologyLibraryMutationResult>>;
  preview: (
    request: TerminologyImportPreviewRequest,
  ) => Promise<IPCResult<TerminologyImportPreview>>;
  import: (
    request: TerminologyImportRequest,
  ) => Promise<IPCResult<TerminologyLibraryMutationResult>>;
  remove: (
    request: TerminologyLibraryRemoveRequest,
  ) => Promise<IPCResult<TerminologyLibraryMutationResult>>;
}
