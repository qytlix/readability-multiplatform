export interface TranslationShortcut {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type InlineTranslationShortcut = TranslationShortcut;

export interface ShortcutKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export const DEFAULT_FULL_TRANSLATION_SHORTCUT: TranslationShortcut = {
  key: 'T',
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
};

export const DEFAULT_PARAGRAPH_TRANSLATION_SHORTCUT: TranslationShortcut = {
  key: 'Z',
  ctrlKey: true,
  altKey: false,
  shiftKey: false,
  metaKey: false,
};

export const DEFAULT_SELECTION_TRANSLATION_SHORTCUT: TranslationShortcut = {
  key: 'S',
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
};

/** @deprecated Use the translation-mode-specific defaults. */
export const DEFAULT_INLINE_TRANSLATION_SHORTCUT = DEFAULT_PARAGRAPH_TRANSLATION_SHORTCUT;

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift']);
const UNSUPPORTED_KEYS = new Set(['Dead', 'Process', 'Unidentified']);

export function shortcutFromKeyboardEvent(
  event: ShortcutKeyboardEvent,
): TranslationShortcut | null {
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
  shortcut: TranslationShortcut,
): boolean {
  return normalizeShortcutKey(event.key) === shortcut.key
    && event.ctrlKey === shortcut.ctrlKey
    && event.altKey === shortcut.altKey
    && event.shiftKey === shortcut.shiftKey
    && event.metaKey === shortcut.metaKey;
}

export function formatKeyboardShortcut(shortcut: TranslationShortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.metaKey) parts.push('Meta');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.shiftKey) parts.push('Shift');
  parts.push(shortcut.key);
  return parts.join('+');
}

export function parseStoredKeyboardShortcut(value: unknown): TranslationShortcut | null {
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

export function areKeyboardShortcutsEqual(
  left: TranslationShortcut,
  right: TranslationShortcut,
): boolean {
  return left.key === right.key
    && left.ctrlKey === right.ctrlKey
    && left.altKey === right.altKey
    && left.shiftKey === right.shiftKey
    && left.metaKey === right.metaKey;
}

function normalizeShortcutKey(key: string): string | null {
  if (MODIFIER_KEYS.has(key) || UNSUPPORTED_KEYS.has(key)) return null;
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function migrateLegacyModifierShortcut(value: string): TranslationShortcut | null {
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
