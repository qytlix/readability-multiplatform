import type { IPCResult } from './feed.ipc';
import type {
  TranslationGenerateRequest,
  TranslationGenerateResponse,
  TranslationGetRequest,
  TranslationState,
  TranslationStreamEvent,
} from './translation.types';

export const TRANSLATION_IPC_CHANNELS = {
  translationGet: 'translation:get',
  translationGenerate: 'translation:generate',
  translationStream: 'translation:stream',
} as const;

export interface TranslationAPI {
  get: (request: TranslationGetRequest) => Promise<IPCResult<TranslationState>>;
  generate: (
    request: TranslationGenerateRequest,
  ) => Promise<IPCResult<TranslationGenerateResponse>>;
  onEvent: (listener: (event: TranslationStreamEvent) => void) => () => void;
}
