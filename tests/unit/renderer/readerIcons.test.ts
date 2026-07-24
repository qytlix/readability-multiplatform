import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HighlighterIcon,
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
});
