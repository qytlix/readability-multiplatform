// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createChatClipboardPastePlan } from '../../../src/renderer/features/chat/chatClipboard';

describe('Article Chat clipboard planning', () => {
  it('leaves a text-only paste to the textarea default behavior', () => {
    const plan = createChatClipboardPastePlan(
      createClipboardData([], 'plain text'),
      'draft',
      5,
      5,
    );

    expect(plan).toEqual({
      handled: false,
      nextValue: 'draft',
      imageFiles: [],
    });
  });

  it('handles an image-only paste without changing the draft', () => {
    const image = createFile('shot.png', 'image/png');
    const plan = createChatClipboardPastePlan(
      createClipboardData([image], ''),
      'draft',
      2,
      2,
    );

    expect(plan.handled).toBe(true);
    expect(plan.nextValue).toBe('draft');
    expect(plan.imageFiles).toEqual([image]);
  });

  it('preserves mixed clipboard text at the current selection', () => {
    const image = createFile('shot.webp', 'image/webp');
    const plan = createChatClipboardPastePlan(
      createClipboardData([image], 'evidence'),
      'ask [] now',
      4,
      6,
    );

    expect(plan.handled).toBe(true);
    expect(plan.nextValue).toBe('ask evidence now');
    expect(plan.imageFiles).toEqual([image]);
  });

  it('preserves the clipboard order for multiple images', () => {
    const first = createFile('one.png', 'image/png');
    const second = createFile('two.jpg', 'image/jpeg');
    const plan = createChatClipboardPastePlan(
      createClipboardData([first, second], ''),
      '',
      0,
      0,
    );

    expect(plan.imageFiles).toEqual([first, second]);
  });
});

function createFile(name: string, type: string): File {
  return new File([Uint8Array.from([1, 2, 3])], name, { type });
}

function createClipboardData(
  files: File[],
  text: string,
): Pick<DataTransfer, 'items' | 'getData'> {
  const items = files.map((file) => ({
    kind: 'file',
    type: file.type,
    getAsFile: () => file,
  }));
  return {
    items: items as unknown as DataTransferItemList,
    getData: (format: string) => format === 'text/plain' ? text : '',
  };
}
