const AUTHOR_PATH_PATTERN = /\/(?:authors?|contributors?|profiles?)(?:\/|$)/i;
const AUTHOR_CLASS_PATTERN = /(?:^|[-_\s])(?:author|byline|contributor|profile|bio)(?:$|[-_\s])/i;
const COMMENT_CLASS_PATTERN = /(?:^|[-_\s])(?:comment|discussion|response)(?:$|[-_\s])/i;
const SHARE_CLASS_PATTERN = /(?:^|[-_\s])(?:share|sharing|social)(?:$|[-_\s])/i;
const TOOL_CLASS_PATTERN = /(?:^|[-_\s])(?:action|toolbar|tools?)(?:$|[-_\s])/i;
const RELATED_CLASS_PATTERN =
  /(?:^|[-_\s])(?:related|recommended|recommendations|more-stories|read-next)(?:$|[-_\s])/i;
const COMMENT_TEXT_PATTERN =
  /^(?:\d+\s*)?(?:comments?|responses?|replies|讨论|评论|查看评论)$/i;
const FOLLOW_TEXT_PATTERN = /^(?:follow|关注)(?:\s+.+)?$/i;

/**
 * 移除正文抽取器容易误收的页面组件。
 *
 * 这里不依赖文章标题或站点域名，而是组合使用链接语义、控件标签、
 * 头像和紧凑布局等证据，避免把正文中的普通图片和链接误删。
 */
export function removeArticleBoilerplate(
  root: ParentNode,
  readabilityByline?: string,
): void {
  removeCommentControls(root);
  removeShareControls(root);
  removeAuthorProfiles(root, readabilityByline);
  removeRelatedSections(root);
  removeEmptyComponentShells(root);
}

function removeCommentControls(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll('a, button'))) {
    const href = element.getAttribute('href') ?? '';
    const label = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.textContent,
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const semanticName = componentSemanticName(element);
    if (
      !isCommentHref(href)
      && !COMMENT_CLASS_PATTERN.test(semanticName)
      && !COMMENT_TEXT_PATTERN.test(label)
    ) {
      continue;
    }
    removeCompactControlRoot(element, root, COMMENT_CLASS_PATTERN);
  }

  for (const element of root.querySelectorAll(
    '[data-testid*="comment" i], [id*="comment-count" i], '
      + '[class*="comments-title" i], [class~="view-comments"]',
  )) {
    removeCompactControlRoot(element, root, COMMENT_CLASS_PATTERN);
  }
}

function removeShareControls(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll('a, button'))) {
    const label = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
    ].filter(Boolean).join(' ');
    const semanticName = componentSemanticName(element);
    if (
      !/^share(?:\s|$)/i.test(label)
      && !SHARE_CLASS_PATTERN.test(semanticName)
      && !isShareHref(element.getAttribute('href') ?? '')
    ) {
      continue;
    }
    removeCompactControlRoot(element, root, SHARE_CLASS_PATTERN);
  }
}

function removeAuthorProfiles(
  root: ParentNode,
  readabilityByline?: string,
): void {
  const normalizedByline = normalizeText(readabilityByline);
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'));

  for (const link of links) {
    if (!link.isConnected || !isAuthorLink(link)) continue;

    const authorName = normalizeText(link.textContent)
      || normalizeText(link.querySelector('img')?.getAttribute('alt'));
    let current: HTMLElement | null = link.parentElement;
    let component: HTMLElement | null = null;

    for (let depth = 0; current && depth < 6; depth += 1) {
      if (current === root || !isCompactComponent(current, 1_600, 5)) break;
      if (isSupportedAuthorComponent(current, authorName, normalizedByline)) {
        component = current;
      }
      current = current.parentElement;
    }

    component?.remove();
  }

  for (const element of root.querySelectorAll<HTMLElement>(
    '[data-testid*="author" i], [class*="author-card" i], '
      + '[class*="author-profile" i], [class*="author-bio" i]',
  )) {
    if (!element.isConnected || !isCompactComponent(element, 1_600, 5)) {
      continue;
    }
    element.remove();
  }
}

function isSupportedAuthorComponent(
  element: HTMLElement,
  authorName: string,
  normalizedByline: string,
): boolean {
  const semanticName = componentSemanticName(element);
  const text = normalizeText(element.textContent);
  const hasProfileLink = Array.from(
    element.querySelectorAll<HTMLAnchorElement>('a[href]'),
  ).some(isAuthorLink);
  const hasAvatar = element.querySelector('img') !== null;
  const hasFollowControl = Array.from(
    element.querySelectorAll('a, button, [role="button"]'),
  ).some((control) => FOLLOW_TEXT_PATTERN.test(normalizeText(
    control.getAttribute('aria-label') ?? control.textContent,
  )));
  const matchesKnownByline = Boolean(
    normalizedByline
    && (
      text.includes(normalizedByline)
      || normalizedByline.includes(authorName)
      || authorName.includes(normalizedByline)
    )
  );

  return hasProfileLink
    && (
      hasAvatar
      || hasFollowControl
      || AUTHOR_CLASS_PATTERN.test(semanticName)
      || matchesKnownByline
    );
}

function removeRelatedSections(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>(
    '[data-testid*="related" i], [data-testid*="recommended" i], '
      + '[class*="related-content" i], [class*="related-articles" i], '
      + '[class*="recommended" i], [class*="read-next" i]',
  )) {
    if (!element.isConnected) continue;
    const semanticName = componentSemanticName(element);
    if (
      RELATED_CLASS_PATTERN.test(semanticName)
      && isCompactComponent(element, 4_000, 8)
    ) {
      element.remove();
    }
  }
}

function removeCompactControlRoot(
  element: Element,
  root: ParentNode,
  preferredPattern: RegExp,
): void {
  let current: HTMLElement | null = element as HTMLElement;
  let component: HTMLElement = current;

  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current === root || !isCompactComponent(current, 600, 3)) break;
    const semanticName = componentSemanticName(current);
    if (
      current === element
      || preferredPattern.test(semanticName)
      || TOOL_CLASS_PATTERN.test(semanticName)
      || current.matches('aside, nav, [role="toolbar"]')
    ) {
      component = current;
    }
    current = current.parentElement;
  }

  component.remove();
}

function removeEmptyComponentShells(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(
    'aside, nav, [role="toolbar"], [class*="story-tools" i]',
  )).reverse()) {
    if (
      !element.textContent?.trim()
      && !element.querySelector('img, video, audio, figure')
    ) {
      element.remove();
    }
  }
}

function isCompactComponent(
  element: HTMLElement,
  maxTextLength: number,
  maxParagraphs: number,
): boolean {
  const textLength = element.textContent?.replace(/\s+/g, ' ').trim().length ?? 0;
  return !element.matches('article, main, body, html')
    && textLength <= maxTextLength
    && element.querySelectorAll('p').length <= maxParagraphs
    && element.querySelectorAll('article, main').length === 0;
}

function isAuthorLink(link: HTMLAnchorElement): boolean {
  if (link.getAttribute('rel')?.split(/\s+/).includes('author')) return true;
  const href = link.getAttribute('href');
  if (!href) return false;
  try {
    return AUTHOR_PATH_PATTERN.test(new URL(href, 'https://reader.invalid').pathname);
  } catch {
    return false;
  }
}

function isCommentHref(href: string): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, 'https://reader.invalid');
    return /^(?:comments?|discussion|responses?)$/i.test(
      url.hash.replace(/^#/, ''),
    );
  } catch {
    return false;
  }
}

function isShareHref(href: string): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, 'https://reader.invalid');
    return /(?:facebook|twitter|x|linkedin|reddit)\.com$/i.test(url.hostname)
      && /\/(?:share|intent|submit)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function componentSemanticName(element: Element): string {
  return [
    element.id,
    element.getAttribute('class'),
    element.getAttribute('role'),
    element.getAttribute('data-testid'),
  ].filter(Boolean).join(' ');
}

function normalizeText(value?: string | null): string {
  return value?.replace(/\s+/g, ' ').trim().toLocaleLowerCase() ?? '';
}
