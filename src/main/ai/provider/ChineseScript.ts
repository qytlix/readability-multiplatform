import OpenCC from 'opencc-js';
import type {
  TranslationTargetLanguage,
} from '../../../shared/contracts/translation.types';

const toSimplifiedChinese = OpenCC.Converter({ from: 't', to: 'cn' });
const toHongKongTraditionalChinese = OpenCC.Converter({ from: 'cn', to: 'hk' });

/**
 * Makes model-generated Chinese use one writing system before it crosses the
 * Main-process persistence boundary. OpenCC leaves Latin text, numbers, and
 * already-matching Chinese characters unchanged.
 */
export function normalizeChineseTargetText(
  text: string,
  targetLanguage: TranslationTargetLanguage,
): string {
  if (targetLanguage === 'zh-CN') return toSimplifiedChinese(text);
  if (targetLanguage === 'zh-HK') return toHongKongTraditionalChinese(text);
  return text;
}
