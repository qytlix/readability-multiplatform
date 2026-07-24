import type { IPCResult } from './feed.ipc';
import type {
  TranslationGenerateRequest,
  TranslationGenerateResponse,
  TranslationGetRequest,
  InlineTranslationCancelResult,
  InlineTranslationRequest,
  InlineTranslationResult,
  TranslationPrioritizeRequest,
  TranslationPrioritizeResponse,
  TerminologyPackInfo,
  TranslationState,
  TranslationStreamEvent,
} from './translation.types';

export const TRANSLATION_IPC_CHANNELS = {
  translationGet: 'translation:get',
  translationGenerate: 'translation:generate',
  inlineTranslate: 'translation:inline',
  inlineCancel: 'translation:inline-cancel',
  translationPrioritize: 'translation:prioritize',
  terminologyInfo: 'translation:terminology-info',
  translationStream: 'translation:stream',
} as const;

export interface TranslationAPI {
  get: (request: TranslationGetRequest) => Promise<IPCResult<TranslationState>>;
  generate: (
    request: TranslationGenerateRequest,
  ) => Promise<IPCResult<TranslationGenerateResponse>>;
  translateInline: (
    request: InlineTranslationRequest,
  ) => Promise<IPCResult<InlineTranslationResult>>;
  cancelInline: () => Promise<IPCResult<InlineTranslationCancelResult>>;
  prioritize: (
    request: TranslationPrioritizeRequest,
  ) => Promise<IPCResult<TranslationPrioritizeResponse>>;
  getTerminologyInfo: () => Promise<IPCResult<TerminologyPackInfo>>;
  onEvent: (listener: (event: TranslationStreamEvent) => void) => () => void;
}
