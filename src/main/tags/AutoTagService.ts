import { createHash } from 'node:crypto';
import type { CleanedContent } from '../../shared/contracts/content.types';
import type { Tag, TagCandidate } from '../../shared/contracts/tag.types';
import { TAG_ERROR_CODES, TagError } from './shared/tag.errors';
import type { TagStore } from './TagStore';
import type { ProviderProfileStore } from '../ai/stores/ProviderProfileStore';
import type { SecretStore } from '../ai/stores/SecretStore';
import type { TextGenerationProvider } from '../ai/provider/TextGenerationProvider';

export interface ContentLookup {
  findByEntry(entryId: number): CleanedContent | undefined;
}

export interface ExistingTagLookup {
  listAllWithCount(): Array<{ name: string; count: number }>;
}

const MAX_CONTENT_PREVIEW_LENGTH = 2000;

export class AutoTagService {
  constructor(
    private readonly contentLookup: ContentLookup,
    private readonly tagLookup: ExistingTagLookup,
    private readonly profileStore: ProviderProfileStore,
    private readonly secretStore: SecretStore,
    private readonly provider: TextGenerationProvider,
    private readonly tagStore: TagStore,
  ) {}

  /**
   * Generate tag candidates for an entry using the hybrid strategy:
   * 1. Read article content
   * 2. Read all existing tags from the global pool
   * 3. Pass both to AI in a single prompt
   * 4. AI returns `{ matched: [...], new: [...] }`
   * 5. matched = existing tags that match the article
   * 6. new = AI-generated tags not yet in the pool
   *
   * Does NOT persist anything.
   */
  async generateCandidates(
    entryId: number,
    maxCandidates: number,
  ): Promise<TagCandidate[]> {
    // 1. Read article content
    const content = this.contentLookup.findByEntry(entryId);
    if (!content || content.pipelineStatus !== 'success' || !content.markdown.trim()) {
      throw new TagError(
        TAG_ERROR_CODES.CONTENT_UNAVAILABLE,
        'Tag generation needs successfully cleaned article Markdown. Try opening the article again first.',
        true,
      );
    }
    const preview = content.markdown.slice(0, MAX_CONTENT_PREVIEW_LENGTH);

    // 2. Read Tag route provider config
    const profile = this.profileStore.findActiveWithSecret();
    if (!profile || !profile.tagApiKeyRef) {
      throw new TagError(
        TAG_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
        'Configure a Tag Provider in the AI settings before generating tags.',
        false,
      );
    }
    const apiKey = this.secretStore.read(profile.tagApiKeyRef);

    // 3. Read existing tag names for the prompt
    const existingTags = this.tagLookup.listAllWithCount();
    const existingNames = existingTags.map((t) => t.name);

    // 4. Build prompt with hybrid strategy
    const prompt = buildAutoTagPrompt({
      existingTagNames: existingNames,
      maxCandidates,
      articleContent: preview,
    });

    // 5. Call provider (stream, collect all output)
    let output = '';
    try {
      for await (const delta of this.provider.stream({
        providerKind: profile.tagProviderKind,
        baseUrl: profile.tagBaseUrl,
        model: profile.tagModel,
        apiKey,
        prompt,
        signal: new AbortController().signal,
      })) {
        output += delta;
      }
    } catch (error) {
      throw new TagError(
        TAG_ERROR_CODES.UNKNOWN,
        `Tag generation from the provider failed: ${(error as Error).message}`,
        true,
      );
    }

    // 6. Parse JSON response
    const { matched, generated } = parseTagResponse(output.trim(), maxCandidates);

    // 7. For matched names, resolve to TagCandidate[] with tagId
    const matchedCandidates: TagCandidate[] = [];
    const seenNames = new Set<string>();
    for (const name of matched) {
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      const existingTag = this.tagStore.findOrCreate(name);
      matchedCandidates.push({
        name: existingTag.name,
        source: 'matched',
        tagId: existingTag.id,
      });
    }

    // 8. For generated names, just return name (no tagId yet — will create on confirm)
    const generatedCandidates: TagCandidate[] = [];
    for (const name of generated) {
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      generatedCandidates.push({
        name,
        source: 'generated',
      });
    }

    // 9. Combine: matched first (recommended), generated after
    return [...matchedCandidates, ...generatedCandidates];
  }

  /**
   * Persist confirmed tag names for an entry. Each tag is created if it
   * doesn't already exist.
   */
  confirmTags(entryId: number, tagNames: string[]): Tag[] {
    return tagNames.map((name) => {
      const tag = this.tagStore.findOrCreate(name.trim());
      this.tagStore.tagEntry(entryId, tag.id, 'auto');
      return tag;
    });
  }

  /**
   * Hash the markdown for freshness comparison (shared with SummaryService pattern).
   * Not currently used by AutoTagService but kept for future cache invalidation.
   */
  static hashMarkdown(markdown: string): string {
    return createHash('sha256').update(markdown, 'utf8').digest('hex');
  }
}

// ── Prompt Builder ─────────────────────────────────────────

interface AutoTagPromptParams {
  existingTagNames: string[];
  maxCandidates: number;
  articleContent: string;
}

function buildAutoTagPrompt(params: AutoTagPromptParams): string {
  const existingList = params.existingTagNames.length > 0
    ? `\n既有标签：${params.existingTagNames.join('、')}`
    : '';

  return `你是一个文章标签生成助手。请为以下文章内容推荐标签。

首先，从以下「既有标签」中选择匹配的（如果有的话）：
${existingList || '（暂无既有标签）'}

如果既有标签不足以覆盖文章主题，再补充新的标签。

要求：
- 尽可能优先使用既有标签，保持标签体系一致
- 标签应准确反映文章的核心主题、领域或关键词
- 标签语言与文章语言一致
- 每个标签 1~4 个中文/英文词汇
- 总共推荐最多 ${params.maxCandidates} 个标签
- 返回 JSON 格式：{"matched": ["标签1", "标签2"], "new": ["标签3", "标签4"]}
- matched 中的名称必须严格从既有标签中选择
- 如果既有标签都不匹配，matched 返回空数组

文章内容：
${params.articleContent}`;
}

// ── Response Parser ────────────────────────────────────────

interface ParsedTagResponse {
  matched: string[];
  generated: string[];
}

function parseTagResponse(text: string, maxCandidates: number): ParsedTagResponse {
  // Try to extract JSON from the response text
  const jsonMatch = text.match(/\{[^{}]*"matched"\s*:\s*\[.*?\]\s*,\s*"new"\s*:\s*\[.*?\]\s*\}/s);
  if (!jsonMatch) {
    // Fallback: try to parse the whole text as JSON
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        return normalizeParsed(parsed, maxCandidates);
      }
    } catch {
      // Not valid JSON — return empty
    }
    return { matched: [], generated: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeParsed(parsed, maxCandidates);
  } catch {
    return { matched: [], generated: [] };
  }
}

function normalizeParsed(
  parsed: Record<string, unknown>,
  maxCandidates: number,
): ParsedTagResponse {
  const matched = normalizeTagArray(parsed.matched);
  const generated = normalizeTagArray(parsed.new ?? parsed.generated);
  const all = [...matched, ...generated];
  // Deduplicate across matched and generated
  const seen = new Set<string>();
  const dedupedMatched: string[] = [];
  const dedupedGenerated: string[] = [];
  for (const name of [...matched, ...generated]) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (dedupedMatched.length < matched.length && matched.includes(name)) {
      dedupedMatched.push(name);
    } else {
      dedupedGenerated.push(name);
    }
  }
  // Limit total
  const total = [...dedupedMatched, ...dedupedGenerated].slice(0, maxCandidates);
  const finalMatched = total.filter((name) => matched.includes(name));
  const finalGenerated = total.filter((name) => !matched.includes(name));
  return { matched: finalMatched, generated: finalGenerated };
}

function normalizeTagArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
