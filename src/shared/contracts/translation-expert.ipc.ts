import type { IPCResult } from './feed.ipc';
import type {
  TranslationExpertImportPreview,
  TranslationExpertImportRequest,
  TranslationExpertList,
  TranslationExpertMutationResult,
  TranslationExpertPreviewRequest,
  TranslationExpertRemoveRequest,
} from './translation-expert.types';

export const TRANSLATION_EXPERT_IPC_CHANNELS = {
  list: 'expert:list',
  preview: 'expert:preview',
  import: 'expert:import',
  remove: 'expert:remove',
} as const;

export interface TranslationExpertAPI {
  list: () => Promise<IPCResult<TranslationExpertList>>;
  preview: (
    request: TranslationExpertPreviewRequest,
  ) => Promise<IPCResult<TranslationExpertImportPreview>>;
  import: (
    request: TranslationExpertImportRequest,
  ) => Promise<IPCResult<TranslationExpertMutationResult>>;
  remove: (
    request: TranslationExpertRemoveRequest,
  ) => Promise<IPCResult<TranslationExpertMutationResult>>;
}
