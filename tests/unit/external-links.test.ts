import { describe, expect, it, vi } from 'vitest';
import { ExternalLinkService } from '../../src/main/external/ExternalLinkService';
import {
  installMainWindowNavigationGuards,
  isAllowedMainWindowNavigation,
} from '../../src/main/navigation-guards';
import { resolveExternalLink } from '../../src/shared/external-links';

describe('Reader external links', () => {
  it('allows HTTP and HTTPS links', () => {
    expect(resolveExternalLink('http://example.com/story')).toEqual({
      kind: 'external',
      url: 'http://example.com/story',
    });
    expect(resolveExternalLink('https://example.com/story')).toEqual({
      kind: 'external',
      url: 'https://example.com/story',
    });
  });

  it('resolves relative links against the article source URL', () => {
    expect(resolveExternalLink('../next', 'https://example.com/articles/current/')).toEqual({
      kind: 'external',
      url: 'https://example.com/articles/next',
    });
  });

  it('keeps fragment links in the Reader', () => {
    expect(resolveExternalLink('#notes', 'https://example.com/article')).toEqual({
      kind: 'fragment',
    });
  });

  it('blocks malformed URLs and unapproved protocols', () => {
    for (const url of [
      'https://[invalid',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,blocked',
      'mailto:reader@example.com',
    ]) {
      expect(resolveExternalLink(url, 'https://example.com/article')).toEqual({
        kind: 'blocked',
      });
    }
  });

  it('revalidates the resolved URL immediately before opening externally', async () => {
    const openExternal = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const service = new ExternalLinkService(openExternal);

    await expect(service.open({
      url: '/original',
      baseUrl: 'https://example.com/article',
    })).resolves.toEqual({ ok: true, data: undefined });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/original');

    await expect(service.open({ url: 'javascript:alert(1)' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'EXTERNAL_URL_BLOCKED' },
    });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('returns a non-blocking error when the system browser cannot be opened', async () => {
    const service = new ExternalLinkService(async () => {
      throw new Error('system browser unavailable');
    });

    await expect(service.open({ url: 'https://example.com/article' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'EXTERNAL_OPEN_FAILED', retryable: true },
    });
  });
});

describe('main window navigation guards', () => {
  it('allows only the application page in packaged builds', () => {
    const applicationUrl = 'file:///app/renderer/main_window/index.html';
    expect(isAllowedMainWindowNavigation(
      'file:///app/renderer/main_window/index.html#reader',
      applicationUrl,
    )).toBe(true);
    expect(isAllowedMainWindowNavigation('https://example.com/article', applicationUrl)).toBe(false);
    expect(isAllowedMainWindowNavigation('file:///etc/passwd', applicationUrl)).toBe(false);
  });

  it('blocks external navigations and every new-window request', () => {
    const handlers: Record<string, (event: { preventDefault: () => void }, url: string) => void> = {};
    const setWindowOpenHandler = vi.fn();
    const webContents = {
      on: (event: string, handler: (navigationEvent: { preventDefault: () => void }, url: string) => void) => {
        handlers[event] = handler;
      },
      setWindowOpenHandler,
    };
    installMainWindowNavigationGuards(
      webContents as never,
      'http://localhost:5173/',
    );

    const preventDefault = vi.fn();
    handlers['will-navigate']({ preventDefault }, 'https://example.com/article');
    expect(preventDefault).toHaveBeenCalledOnce();

    const preventRedirect = vi.fn();
    handlers['will-redirect']({ preventDefault: preventRedirect }, 'https://example.com/article');
    expect(preventRedirect).toHaveBeenCalledOnce();

    const handler = setWindowOpenHandler.mock.calls[0][0] as () => { action: string };
    expect(handler()).toEqual({ action: 'deny' });
  });
});
