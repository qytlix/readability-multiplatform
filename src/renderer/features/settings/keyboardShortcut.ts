export interface InlineTranslationShortcut {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface ShortcutKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export const DEFAULT_INLINE_TRANSLATION_SHORTCUT: InlineTranslationShortcut = {
  key: 'Z',
  ctrlKey: true,
  altKey: false,
  shiftKey: false,
  metaKey: false,
};

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift']);
const UNSUPPORTED_KEYS = new Set(['Dead', 'Process', 'Unidentified']);

export function shortcutFromKeyboardEvent(
  event: ShortcutKeyboardEvent,
): InlineTranslationShortcut | null {
  const key = normalizeShortcutKey(event.key);
  if (!key || (!event.ctrlKey && !event.altKey && !event.metaKey)) return null;
  return {
    key,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
  };
}

export function matchesKeyboardShortcut(
  event: ShortcutKeyboardEvent,
  shortcut: InlineTranslationShortcut,
): boolean {
  return normalizeShortcutKey(event.key) === shortcut.key
    && event.ctrlKey === shortcut.ctrlKey
    && event.altKey === shortcut.altKey
    && event.shiftKey === shortcut.shiftKey
    && event.metaKey === shortcut.metaKey;
}

export function formatKeyboardShortcut(shortcut: InlineTranslationShortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.metaKey) parts.push('Meta');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.shiftKey) parts.push('Shift');
  parts.push(shortcut.key);
  return parts.join('+');
}

export function parseStoredKeyboardShortcut(value: unknown): InlineTranslationShortcut | null {
  if (typeof value === 'string') return migrateLegacyModifierShortcut(value);
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<InlineTranslationShortcut>;
  if (
    typeof candidate.key !== 'string'
    || typeof candidate.ctrlKey !== 'boolean'
    || typeof candidate.altKey !== 'boolean'
    || typeof candidate.shiftKey !== 'boolean'
    || typeof candidate.metaKey !== 'boolean'
  ) {
    return null;
  }
  return shortcutFromKeyboardEvent({
    key: candidate.key,
    ctrlKey: candidate.ctrlKey,
    altKey: candidate.altKey,
    shiftKey: candidate.shiftKey,
    metaKey: candidate.metaKey,
  });
}

function normalizeShortcutKey(key: string): string | null {
  if (MODIFIER_KEYS.has(key) || UNSUPPORTED_KEYS.has(key)) return null;
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function migrateLegacyModifierShortcut(value: string): InlineTranslationShortcut | null {
  if (value === 'Control') {
    return { ...DEFAULT_INLINE_TRANSLATION_SHORTCUT };
  }
  if (value === 'Alt') {
    return { ...DEFAULT_INLINE_TRANSLATION_SHORTCUT, ctrlKey: false, altKey: true };
  }
  if (value === 'Shift') {
    return {
      ...DEFAULT_INLINE_TRANSLATION_SHORTCUT,
      ctrlKey: true,
      shiftKey: true,
    };
  }
  return null;
}
