import { describe, expect, it } from 'vitest';
import {
  formatKeyboardShortcut,
  matchesKeyboardShortcut,
  shortcutFromKeyboardEvent,
} from '../../src/renderer/features/settings/keyboardShortcut';

const ctrlZ = {
  key: 'Z',
  ctrlKey: true,
  altKey: false,
  shiftKey: false,
  metaKey: false,
};

describe('inline translation keyboard shortcut', () => {
  it('records and formats Ctrl+Z', () => {
    expect(shortcutFromKeyboardEvent({ ...ctrlZ, key: 'z' })).toEqual(ctrlZ);
    expect(formatKeyboardShortcut(ctrlZ)).toBe('Ctrl+Z');
  });

  it('requires Ctrl, Alt, or Meta plus a non-modifier key', () => {
    expect(shortcutFromKeyboardEvent({ ...ctrlZ, key: 'z', ctrlKey: false })).toBeNull();
    expect(shortcutFromKeyboardEvent({ ...ctrlZ, key: 'Control' })).toBeNull();
  });

  it('matches the configured key and exact modifier set', () => {
    expect(matchesKeyboardShortcut({ ...ctrlZ, key: 'z' }, ctrlZ)).toBe(true);
    expect(matchesKeyboardShortcut({ ...ctrlZ, shiftKey: true }, ctrlZ)).toBe(false);
    expect(matchesKeyboardShortcut({ ...ctrlZ, key: 'y' }, ctrlZ)).toBe(false);
  });
});
