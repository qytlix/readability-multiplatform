import type { TranslationTargetLanguage } from '../../shared/contracts/translation.types';

const SIMPLIFIED_CHINESE_HINTS = new Set(Array.from(
  '这为个们来时说过还进发后里从对开关应软体国学写读译简网数据业务优门风书买卖见问题总绍现实与万两并长无电机术设计经线点种样给让将当则边远运选测试标题页荐么装',
));
const ENGLISH_SIGNAL_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was',
  'were', 'what', 'when', 'which', 'with', 'works',
]);

/**
 * Conservatively identifies segments that are already written in the selected
 * target language. False negatives cost one provider call; false positives can
 * skip a needed translation, so mixed or ambiguous text deliberately returns
 * false.
 */
export function isLikelyAlreadyTargetLanguage(
  text: string,
  targetLanguage: TranslationTargetLanguage,
): boolean {
  const normalized = text.normalize('NFKC').trim();
  if (!normalized) return true;
  if (isHttpUrl(normalized)) return true;
  return targetLanguage === 'zh-CN'
    ? isLikelySimplifiedChinese(normalized)
    : isLikelyEnglish(normalized);
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && !/\s/.test(text);
  } catch {
    return false;
  }
}

function isLikelySimplifiedChinese(text: string): boolean {
  const characters = Array.from(text);
  const hanCount = characters.filter((character) => /\p{Script=Han}/u.test(character)).length;
  if (hanCount < 2) return false;
  if (characters.some((character) =>
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character))) {
    return false;
  }

  const letterCount = characters.filter((character) => /\p{L}/u.test(character)).length;
  const simplifiedHintCount = characters.filter((character) =>
    SIMPLIFIED_CHINESE_HINTS.has(character)).length;
  return letterCount > 0
    && hanCount / letterCount >= 0.35
    && simplifiedHintCount > 0;
}

function isLikelyEnglish(text: string): boolean {
  const characters = Array.from(text);
  if (characters.some((character) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character))) {
    return false;
  }

  const letterCount = characters.filter((character) => /\p{L}/u.test(character)).length;
  const latinLetterCount = characters.filter((character) =>
    /\p{Script=Latin}/u.test(character)).length;
  const words = text.toLocaleLowerCase('en-US').match(/[a-z]+(?:['’-][a-z]+)*/g) ?? [];
  const englishSignalCount = words.filter((word) => ENGLISH_SIGNAL_WORDS.has(word)).length;
  return letterCount > 0
    && latinLetterCount / letterCount >= 0.9
    && words.length >= 4
    && englishSignalCount >= 2;
}
