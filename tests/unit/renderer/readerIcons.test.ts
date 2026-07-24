import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HighlighterIcon,
  LockIcon,
  ReadIcon,
  TranslateIcon,
} from '../../../src/renderer/features/reader/ReaderIcons';

describe('reader toolbar icons', () => {
  it('renders the translation action as a centered bidirectional symbol', () => {
    const markup = renderToStaticMarkup(createElement(TranslateIcon));

    expect(markup).toContain('class="reader-icon translate-icon"');
    expect(markup).toContain('width="19"');
    expect(markup).toContain('height="19"');
    expect(markup).toContain('d="M5 7.5h13"');
    expect(markup).toContain('d="M19 16.5H6"');
    expect(markup).not.toContain('m14 11 4 10');
  });

  it('renders the mark-as-read action as a check inside a circle', () => {
    const markup = renderToStaticMarkup(createElement(ReadIcon));

    expect(markup).toContain('width="19"');
    expect(markup).toContain('height="19"');
    expect(markup).toContain('<circle cx="12" cy="12" r="8.25"');
    expect(markup).toContain('d="m8.2 12.1 2.5 2.5 5.2-5.4"');
  });

  it('renders the annotation action as a highlighter nib', () => {
    const markup = renderToStaticMarkup(createElement(HighlighterIcon));

    expect(markup).toContain('width="19"');
    expect(markup).toContain('d="m7 15 7.8-7.8 3 3L10 18H7z"');
    expect(markup).toContain('d="M4 20h12"');
  });

  it('renders distinct locked and unlocked annotation states', () => {
    const locked = renderToStaticMarkup(createElement(LockIcon, { locked: true }));
    const unlocked = renderToStaticMarkup(createElement(LockIcon, { locked: false }));

    expect(locked).toContain('<rect x="6" y="10" width="12" height="10" rx="2"');
    expect(locked).toContain('d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"');
    expect(unlocked).toContain('d="M9 10V7.5a3.5 3.5 0 0 1 6.8-1.2"');
  });
});
