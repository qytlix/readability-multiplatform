import type { ChatContextMode } from '../../../shared/contracts/chat.types';
import { CHAT_ERROR_CODES, ChatError } from '../../../shared/errors/chat.errors';

export interface ArticleContextBudgetInput {
  contextWindowTokens: number;
  responseReserveTokens: number;
  systemInstruction: string;
  fullArticleContext: string;
  fullHistoryText: string;
  compressedHistoryText: string;
  currentQuestion: string;
  selectionText?: string;
  currentAttachmentText?: string;
}

export interface ArticleContextBudgetDecision {
  mode: ChatContextMode;
  promptBudgetTokens: number;
  estimatedPromptTokens: number;
  fullArticleTokens: number;
  fullHistoryTokens: number;
}

export const DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS = 32_000;
export const DEFAULT_CHAT_RESPONSE_RESERVE_TOKENS = 4_096;

export function chooseArticleContextMode(
  input: ArticleContextBudgetInput,
): ArticleContextBudgetDecision {
  const contextWindowTokens = normalizePositiveInteger(
    input.contextWindowTokens,
    DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS,
  );
  const responseReserveTokens = normalizePositiveInteger(
    input.responseReserveTokens,
    DEFAULT_CHAT_RESPONSE_RESERVE_TOKENS,
  );
  const promptBudgetTokens = contextWindowTokens - responseReserveTokens;
  if (promptBudgetTokens <= 0) {
    throw contextTooLarge('The configured response reserve leaves no room for context.');
  }

  const systemTokens = estimateChatTokens(input.systemInstruction);
  const questionTokens = estimateChatTokens(input.currentQuestion);
  const selectionTokens = estimateChatTokens(input.selectionText ?? '');
  const attachmentTokens = estimateChatTokens(input.currentAttachmentText ?? '');
  const requiredTokens =
    systemTokens + questionTokens + selectionTokens + attachmentTokens;
  if (requiredTokens > promptBudgetTokens) {
    throw contextTooLarge(
      'The question, selection, and current attachments exceed the model context window.',
    );
  }

  const fullArticleTokens = estimateChatTokens(input.fullArticleContext);
  const fullHistoryTokens = estimateChatTokens(input.fullHistoryText);
  const completeTokens = requiredTokens + fullArticleTokens + fullHistoryTokens;
  if (completeTokens <= promptBudgetTokens) {
    return {
      mode: 'full',
      promptBudgetTokens,
      estimatedPromptTokens: completeTokens,
      fullArticleTokens,
      fullHistoryTokens,
    };
  }

  const compressedHistoryTokens = estimateChatTokens(input.compressedHistoryText);
  const compressedTokens =
    requiredTokens + fullArticleTokens + compressedHistoryTokens;
  if (compressedTokens <= promptBudgetTokens) {
    return {
      mode: 'history-compressed',
      promptBudgetTokens,
      estimatedPromptTokens: compressedTokens,
      fullArticleTokens,
      fullHistoryTokens,
    };
  }

  return {
    mode: 'article-map',
    promptBudgetTokens,
    // The article-map service must calculate and assert its final exact estimate.
    estimatedPromptTokens: requiredTokens,
    fullArticleTokens,
    fullHistoryTokens,
  };
}

export function assertArticleMapContextFits(
  context: string,
  fixedInput: Pick<
    ArticleContextBudgetInput,
    | 'contextWindowTokens'
    | 'responseReserveTokens'
    | 'systemInstruction'
    | 'currentQuestion'
    | 'selectionText'
    | 'currentAttachmentText'
  >,
): number {
  const promptBudgetTokens =
    normalizePositiveInteger(
      fixedInput.contextWindowTokens,
      DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS,
    )
    - normalizePositiveInteger(
      fixedInput.responseReserveTokens,
      DEFAULT_CHAT_RESPONSE_RESERVE_TOKENS,
    );
  const estimatedTokens = estimateChatTokens([
    fixedInput.systemInstruction,
    context,
    fixedInput.currentQuestion,
    fixedInput.selectionText ?? '',
    fixedInput.currentAttachmentText ?? '',
  ].join('\n'));
  if (estimatedTokens > promptBudgetTokens) {
    throw contextTooLarge(
      'The article map, relevant passages, question, and attachments still exceed the model context window.',
    );
  }
  return estimatedTokens;
}

/**
 * Deterministic conservative estimate. ASCII-heavy model text is estimated at
 * four characters/token; non-ASCII text is estimated at 1.5 characters/token.
 */
export function estimateChatTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4) + Math.ceil(nonAscii / 1.5);
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function contextTooLarge(message: string): ChatError {
  return new ChatError(
    CHAT_ERROR_CODES.CHAT_CONTEXT_TOO_LARGE,
    message,
    false,
  );
}
