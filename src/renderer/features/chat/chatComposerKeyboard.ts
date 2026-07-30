export interface ChatComposerKeyInput {
  key: string;
  shiftKey: boolean;
  composing: boolean;
  nativeComposing: boolean;
}

export type ChatComposerKeyAction = 'submit' | 'line-break' | 'ignore';

export const getChatComposerKeyAction = ({
  key,
  shiftKey,
  composing,
  nativeComposing,
}: ChatComposerKeyInput): ChatComposerKeyAction => {
  if (key !== 'Enter') return 'ignore';
  if (shiftKey || composing || nativeComposing) return 'line-break';
  return 'submit';
};
