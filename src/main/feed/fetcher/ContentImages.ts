const LAZY_SOURCE_ATTRIBUTES = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-original-src',
  'data-url',
  'data-image',
  'data-fallback-src',
] as const;

const SRCSET_ATTRIBUTES = [
  'data-srcset',
  'data-lazy-srcset',
  'data-original-srcset',
  'srcset',
] as const;

interface NormalizedSrcsetCandidate {
  url: string;
  descriptor?: string;
  score: number;
}

/**
 * 将正文图片统一为可持久化的安全绝对地址。
 *
 * 即使浏览器最终使用 picture/source 或 srcset，也为 img 写入一个稳定的
 * src 回退，这样 Reader、Markdown 和导出链路会引用同一张可解释的图片。
 */
export function normalizeReaderImages(
  container: HTMLElement,
  baseUrl: string,
): void {
  for (const source of container.querySelectorAll('picture source')) {
    const candidates = normalizeElementSrcset(source, baseUrl);
    if (candidates.length === 0) {
      source.removeAttribute('srcset');
    }
    removeSourceAttributes(source);
  }

  for (const image of container.querySelectorAll('img')) {
    const ownSrcset = normalizeElementSrcset(image, baseUrl);
    const lazySource = firstSafeAttributeUrl(
      image,
      LAZY_SOURCE_ATTRIBUTES,
      baseUrl,
    );
    const regularSource = safeNonPlaceholderUrl(
      image.getAttribute('src'),
      baseUrl,
    );
    const pictureSource = bestPictureSource(image, baseUrl);
    const fallbackSource = lazySource
      ?? regularSource
      ?? bestSrcsetCandidate(ownSrcset)?.url
      ?? pictureSource;

    if (fallbackSource) {
      image.setAttribute('src', fallbackSource);
      image.setAttribute('loading', 'lazy');
      image.setAttribute('decoding', 'async');
      image.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    } else {
      image.removeAttribute('src');
    }

    removeSourceAttributes(image);
    if (!fallbackSource && ownSrcset.length === 0 && !pictureSource) {
      image.remove();
    }
  }

  for (const picture of container.querySelectorAll('picture')) {
    if (!picture.querySelector('img')) {
      picture.remove();
    }
  }
}

function normalizeElementSrcset(
  element: Element,
  baseUrl: string,
): NormalizedSrcsetCandidate[] {
  const raw = firstAttributeValue(element, SRCSET_ATTRIBUTES);
  const candidates = raw ? parseAndNormalizeSrcset(raw, baseUrl) : [];
  if (candidates.length > 0) {
    element.setAttribute(
      'srcset',
      candidates
        .map(({ url, descriptor }) => (
          descriptor ? `${url} ${descriptor}` : url
        ))
        .join(', '),
    );
  } else {
    element.removeAttribute('srcset');
  }
  return candidates;
}

function parseAndNormalizeSrcset(
  value: string,
  baseUrl: string,
): NormalizedSrcsetCandidate[] {
  const candidates: NormalizedSrcsetCandidate[] = [];
  for (const rawCandidate of value.split(',')) {
    const [urlCandidate, descriptor, ...extra] =
      rawCandidate.trim().split(/\s+/);
    if (
      !urlCandidate
      || extra.length > 0
      || (descriptor && !/^(?:\d+w|\d+(?:\.\d+)?x)$/.test(descriptor))
    ) {
      continue;
    }
    const url = resolveSafeMediaUrl(urlCandidate, baseUrl);
    if (!url || isPlaceholderImageUrl(url, baseUrl)) continue;
    candidates.push({
      url,
      descriptor,
      score: srcsetDescriptorScore(descriptor),
    });
  }
  return candidates;
}

function bestPictureSource(
  image: HTMLImageElement,
  baseUrl: string,
): string | null {
  const picture = image.closest('picture');
  if (!picture) return null;
  const candidates = Array.from(picture.querySelectorAll('source'))
    .flatMap((source) => {
      const srcset = source.getAttribute('srcset');
      return srcset ? parseAndNormalizeSrcset(srcset, baseUrl) : [];
    });
  return bestSrcsetCandidate(candidates)?.url ?? null;
}

function bestSrcsetCandidate(
  candidates: NormalizedSrcsetCandidate[],
): NormalizedSrcsetCandidate | undefined {
  return candidates.reduce<NormalizedSrcsetCandidate | undefined>(
    (best, candidate) => (
      !best || candidate.score > best.score ? candidate : best
    ),
    undefined,
  );
}

function srcsetDescriptorScore(descriptor?: string): number {
  if (!descriptor) return 1;
  if (descriptor.endsWith('w')) return Number(descriptor.slice(0, -1));
  if (descriptor.endsWith('x')) {
    return Number(descriptor.slice(0, -1)) * 10_000;
  }
  return 0;
}

function firstSafeAttributeUrl(
  element: Element,
  attributes: readonly string[],
  baseUrl: string,
): string | null {
  for (const attribute of attributes) {
    const resolved = safeNonPlaceholderUrl(
      element.getAttribute(attribute),
      baseUrl,
    );
    if (resolved) return resolved;
  }
  return null;
}

function safeNonPlaceholderUrl(
  candidate: string | null,
  baseUrl: string,
): string | null {
  if (!candidate || isPlaceholderImageUrl(candidate, baseUrl)) return null;
  return resolveSafeMediaUrl(candidate, baseUrl);
}

function firstAttributeValue(
  element: Element,
  attributes: readonly string[],
): string | null {
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute)?.trim();
    if (value) return value;
  }
  return null;
}

function removeSourceAttributes(element: Element): void {
  for (const attribute of [...LAZY_SOURCE_ATTRIBUTES, ...SRCSET_ATTRIBUTES]) {
    if (attribute !== 'srcset') element.removeAttribute(attribute);
  }
}

function isPlaceholderImageUrl(candidate: string, baseUrl: string): boolean {
  const resolved = resolveSafeMediaUrl(candidate, baseUrl);
  if (!resolved) return false;
  const pathname = new URL(resolved).pathname.toLocaleLowerCase();
  const filename = pathname.split('/').pop() ?? '';
  return /^(?:img|image)[-_]placeholder(?:[.@_-]|$)/.test(filename)
    || /^placeholder(?:[.@_-]|$)/.test(filename);
}

function resolveSafeMediaUrl(candidate: string, baseUrl: string): string | null {
  try {
    const url = new URL(candidate.trim(), baseUrl);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
