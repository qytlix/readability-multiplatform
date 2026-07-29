import type {
  Feed,
  ParsedEntry,
} from '../../../shared/contracts/feed.types';
import type { SuspectedFeedDuplicate } from '../../../shared/contracts/feed.ipc';
import type { EntryStore } from '../stores';

const COMPARISON_LIMIT = 20;
const MINIMUM_SAMPLE_SIZE = 5;
const MINIMUM_OVERLAP_RATIO = 0.8;

export class FeedDuplicateDetector {
  constructor(private readonly entryStore: EntryStore) {}

  findSuspectedDuplicate(
    candidate: { title?: string; feedURL: string; entries: ParsedEntry[] },
    existingFeeds: Feed[],
  ): SuspectedFeedDuplicate | undefined {
    const candidateIdentities = buildEntryIdentities(
      candidate.entries.slice(0, COMPARISON_LIMIT),
    );
    if (candidateIdentities.length < MINIMUM_SAMPLE_SIZE) return undefined;

    let strongestMatch: SuspectedFeedDuplicate | undefined;
    for (const existingFeed of existingFeeds) {
      const existingEntries = this.entryStore.findRecentIdentityEntries(
        existingFeed.id,
        COMPARISON_LIMIT,
      );
      const existingIdentities = buildEntryIdentities(existingEntries);
      if (existingIdentities.length < MINIMUM_SAMPLE_SIZE) continue;
      const existingKeys = new Set(existingIdentities.flatMap((keys) => [...keys]));
      const overlapCount = candidateIdentities
        .filter((keys) => [...keys].some((key) => existingKeys.has(key))).length;
      const comparedCount = Math.min(
        candidateIdentities.length,
        existingIdentities.length,
      );
      const overlapRatio = overlapCount / comparedCount;
      if (
        overlapCount < MINIMUM_SAMPLE_SIZE
        || overlapRatio < MINIMUM_OVERLAP_RATIO
      ) {
        continue;
      }

      const match: SuspectedFeedDuplicate = {
        candidate: {
          title: candidate.title,
          feedURL: candidate.feedURL,
        },
        existing: {
          id: existingFeed.id,
          title: existingFeed.title,
          feedURL: existingFeed.feedURL,
        },
        overlapCount,
        comparedCount,
        reason: `最近 ${comparedCount} 篇文章中有 ${overlapCount} 篇链接或稳定 ID 相同`,
      };
      if (!strongestMatch || match.overlapCount > strongestMatch.overlapCount) {
        strongestMatch = match;
      }
    }
    return strongestMatch;
  }
}

function buildEntryIdentities(entries: Array<{
  guid?: string;
  url?: string;
}>): Array<Set<string>> {
  return entries.flatMap((entry) => {
    const keys = new Set<string>();
    const normalizedUrl = normalizeArticleUrl(entry.url);
    if (normalizedUrl) keys.add(`url:${normalizedUrl}`);
    if (entry.guid?.trim()) keys.add(`guid:${entry.guid.trim()}`);
    return keys.size > 0 ? [keys] : [];
  });
}

function normalizeArticleUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === 'http:' && url.port === '80')
      || (url.protocol === 'https:' && url.port === '443')
    ) {
      url.port = '';
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return undefined;
  }
}
