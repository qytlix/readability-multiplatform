/** Token values explicitly returned by a Provider response. */
export interface ProviderTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type UsageAvailability = 'reported' | 'partial' | 'missing';

/**
 * Normalizes OpenAI-compatible usage payloads without estimating absent values.
 * Chat Completions names (`prompt_tokens` / `completion_tokens`) take precedence
 * over the alternative input/output names when both are present.
 */
export function normalizeProviderTokenUsage(value: unknown): ProviderTokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const inputTokens = toSafeTokenCount(usage.prompt_tokens) ?? toSafeTokenCount(usage.input_tokens);
  const outputTokens = toSafeTokenCount(usage.completion_tokens)
    ?? toSafeTokenCount(usage.output_tokens);
  const totalTokens = toSafeTokenCount(usage.total_tokens);
  return buildUsage(inputTokens, outputTokens, totalTokens);
}

/** Defensively validates a usage object received through the Provider callback. */
export function sanitizeProviderTokenUsage(
  usage: ProviderTokenUsage | undefined,
): ProviderTokenUsage | undefined {
  if (!usage) return undefined;
  return buildUsage(
    toSafeTokenCount(usage.inputTokens),
    toSafeTokenCount(usage.outputTokens),
    toSafeTokenCount(usage.totalTokens),
  );
}

export function getUsageAvailability(usage: ProviderTokenUsage | undefined): UsageAvailability {
  if (!usage) return 'missing';
  const reportedCount = [usage.inputTokens, usage.outputTokens, usage.totalTokens]
    .filter((value) => value !== undefined).length;
  if (reportedCount === 3) return 'reported';
  return reportedCount > 0 ? 'partial' : 'missing';
}

function buildUsage(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  totalTokens: number | undefined,
): ProviderTokenUsage | undefined {
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function toSafeTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
