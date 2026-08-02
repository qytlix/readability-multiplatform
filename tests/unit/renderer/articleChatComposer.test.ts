import { describe, expect, it } from 'vitest';
import { getChatComposerKeyAction } from '../../../src/renderer/features/chat/chatComposerKeyboard';

describe('Article Chat composer keyboard behavior', () => {
  it('submits a plain Enter key', () => {
    expect(getChatComposerKeyAction({
      key: 'Enter',
      shiftKey: false,
      composing: false,
      nativeComposing: false,
    })).toBe('submit');
  });

  it('keeps Shift+Enter as a line break', () => {
    expect(getChatComposerKeyAction({
      key: 'Enter',
      shiftKey: true,
      composing: false,
      nativeComposing: false,
    })).toBe('line-break');
  });

  it.each([
    ['React composition state', true, false],
    ['native composition state', false, true],
  ])('does not submit Enter during %s', (_label, composing, nativeComposing) => {
    expect(getChatComposerKeyAction({
      key: 'Enter',
      shiftKey: false,
      composing,
      nativeComposing,
    })).toBe('line-break');
  });

  it('ignores unrelated keys', () => {
    expect(getChatComposerKeyAction({
      key: 'a',
      shiftKey: false,
      composing: false,
      nativeComposing: false,
    })).toBe('ignore');
  });
});
