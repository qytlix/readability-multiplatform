import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createHorizontalFlipKeyframes,
} from '../../../src/renderer/features/reader/layoutTransition';

describe('reader layout transition', () => {
  it('builds a compositor transform from the previous article bounds', () => {
    const keyframes = createHorizontalFlipKeyframes(
      { left: 660, top: 0, width: 900 },
      { left: 272, top: 0, width: 1288 },
    );

    expect(keyframes).toEqual([
      {
        transform: 'translate3d(388px, 0px, 0) scaleX(0.6987577639751553)',
        transformOrigin: 'top left',
      },
      {
        transform: 'translate3d(0, 0, 0) scaleX(1)',
        transformOrigin: 'top left',
      },
    ]);
  });

  it('skips animation for unchanged or collapsed layout boxes', () => {
    expect(createHorizontalFlipKeyframes(
      { left: 272, top: 0, width: 1288 },
      { left: 272, top: 0, width: 1288 },
    )).toBeNull();
    expect(createHorizontalFlipKeyframes(
      { left: 272, top: 0, width: 0 },
      { left: 272, top: 0, width: 1288 },
    )).toBeNull();
  });

  it('does not animate grid track sizing frame by frame', () => {
    const css = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../src/renderer/features/reader/ReaderPage.css',
      ),
      'utf8',
    );

    expect(css).not.toContain('transition: grid-template-columns');
  });
});
