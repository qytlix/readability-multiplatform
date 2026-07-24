import type { TranslationState } from '../../../shared/contracts/translation.types';

export type TranslationReaderMode = 'original' | 'bilingual';

export function getRestoredTranslationReaderMode(
  translationState: TranslationState,
  wasBilingualVisible: boolean,
): TranslationReaderMode {
  if (!wasBilingualVisible) return 'original';
  return translationState.state === 'running'
    || translationState.state === 'failed'
    || translationState.state === 'succeeded'
    ? 'bilingual'
    : 'original';
}
