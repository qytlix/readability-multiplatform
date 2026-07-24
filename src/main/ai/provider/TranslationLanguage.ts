import type { TranslationTargetLanguage } from '../../../shared/contracts/translation.types';

const SIMPLIFIED_CHINESE_HINTS = new Set(Array.from(
  '这为个们来时说过还进发后里从对开关应软体国学写读译简网数据业务优门风书买卖见问题总绍现实与万两并长无电机术设计经线点种样给让将当则边远运选测试标题页荐么装',
));
const ENGLISH_SIGNAL_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was',
  'were', 'what', 'when', 'which', 'with', 'works',
]);
const GERMAN_SIGNAL_WORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines',
  'und', 'ist', 'sind', 'für', 'mit', 'von', 'zum', 'zur', 'nicht',
]);
const FRENCH_SIGNAL_WORDS = new Set([
  'le', 'les', 'un', 'une', 'des', 'du', 'au', 'aux', 'et', 'est', 'sont',
  'pour', 'avec', 'dans', 'qui', 'pas',
]);
const SPANISH_SIGNAL_WORDS = new Set([
  'el', 'los', 'las', 'un', 'una', 'del', 'al', 'y', 'es', 'son', 'para',
  'con', 'en', 'por', 'que', 'no',
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
  switch (targetLanguage) {
    case 'zh-CN':
      return isLikelySimplifiedChinese(normalized);
    case 'ja':
      return isLikelyJapanese(normalized);
    case 'ko':
      return isLikelyKorean(normalized);
    case 'en':
      return isLikelyLatinLanguage(normalized, ENGLISH_SIGNAL_WORDS, 'en-US');
    case 'de':
      return isLikelyLatinLanguage(normalized, GERMAN_SIGNAL_WORDS, 'de-DE');
    case 'fr':
      return isLikelyLatinLanguage(normalized, FRENCH_SIGNAL_WORDS, 'fr-FR');
    case 'es':
      return isLikelyLatinLanguage(normalized, SPANISH_SIGNAL_WORDS, 'es-ES');
    case 'zh-HK':
      // Script alone cannot distinguish Hong Kong usage from Taiwan usage.
      return false;
  }
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

function isLikelyJapanese(text: string): boolean {
  const characters = Array.from(text);
  const kanaCount = characters.filter((character) =>
    /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)).length;
  const letterCount = characters.filter((character) => /\p{L}/u.test(character)).length;
  return kanaCount >= 2 && letterCount > 0 && kanaCount / letterCount >= 0.15;
}

function isLikelyKorean(text: string): boolean {
  const characters = Array.from(text);
  const hangulCount = characters.filter((character) =>
    /\p{Script=Hangul}/u.test(character)).length;
  const letterCount = characters.filter((character) => /\p{L}/u.test(character)).length;
  return hangulCount >= 2 && letterCount > 0 && hangulCount / letterCount >= 0.35;
}

function isLikelyLatinLanguage(
  text: string,
  signalWords: ReadonlySet<string>,
  locale: string,
): boolean {
  const characters = Array.from(text);
  if (characters.some((character) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character))) {
    return false;
  }

  const letterCount = characters.filter((character) => /\p{L}/u.test(character)).length;
  const latinLetterCount = characters.filter((character) =>
    /\p{Script=Latin}/u.test(character)).length;
  const words = text.toLocaleLowerCase(locale).match(/\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu)
    ?? [];
  const signalCount = words.filter((word) => signalWords.has(word)).length;
  return letterCount > 0
    && latinLetterCount / letterCount >= 0.9
    && words.length >= 4
    && signalCount >= 2;
}
