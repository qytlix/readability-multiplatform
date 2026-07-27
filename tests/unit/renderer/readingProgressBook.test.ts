// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ReadingProgressBook } from '../../../src/renderer/features/feeds/ReadingProgressBook';
import type { ReadingBookTurnMotion } from '../../../src/renderer/features/feeds/readingProgressBookMotion';

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe('ReadingProgressBook', () => {
  afterEach(() => {
    delete reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
  });

  it('runs one 3D page turn at a time and coalesces burst updates', () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const firstTurn: ReadingBookTurnMotion = {
      id: 1,
      direction: 'left',
      durationMs: 620,
      variant: 'single',
    };
    const latestTurn: ReadingBookTurnMotion = {
      id: 2,
      direction: 'right',
      durationMs: 170,
      variant: 'stack',
    };
    const render = (turnMotion: ReadingBookTurnMotion | null): void => {
      root.render(createElement(ReadingProgressBook, {
        readingProgress: 0.5,
        turnMotion,
        jumpTarget: 'end',
        onJump: () => undefined,
      }));
    };

    act(() => render(firstTurn));
    expect(container.querySelectorAll(
      '.reading-progress-book-single-page.is-turning-left',
    )).toHaveLength(1);

    act(() => render(latestTurn));
    expect(container.querySelectorAll(
      '.reading-progress-book-single-page.is-turning-left',
    )).toHaveLength(1);
    expect(container.querySelectorAll(
      '.reading-progress-book-flips:not(.is-resting)',
    )).toHaveLength(0);

    act(() => {
      container.querySelector<HTMLElement>(
        '.reading-progress-book-single-page.is-turning-left',
      )?.dispatchEvent(new window.Event('webkitAnimationEnd', { bubbles: true }));
    });

    expect(container.querySelectorAll(
      '.reading-progress-book-single-page',
    )).toHaveLength(0);
    expect(container.querySelectorAll(
      '.reading-progress-book-flips.is-turning-right',
    )).toHaveLength(1);
    expect(container.querySelectorAll(
      '.reading-progress-book-flips.is-turning-right .reading-progress-book-flip',
    )).toHaveLength(7);

    act(() => render(null));
    expect(container.querySelectorAll(
      '.reading-progress-book-flips:not(.is-resting), .reading-progress-book-single-page',
    )).toHaveLength(0);

    act(() => root.unmount());
    container.remove();
  });
});
