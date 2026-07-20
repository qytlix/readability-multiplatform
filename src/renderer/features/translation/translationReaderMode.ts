import type { TranslationState } from '../../../shared/contracts/translation.types';

export type TranslationReaderMode = 'original' | 'bilingual';

export function getRestoredTranslationReaderMode(
  translationState: TranslationState,
): TranslationReaderMode {
  return translationState.state === 'succeeded' ? 'bilingual' : 'original';
}
