export interface ChatClipboardImageInput {
  bytes: Uint8Array;
  suggestedDisplayName: string;
  declaredMimeType: string;
}

export interface ChatClipboardPastePlan {
  handled: boolean;
  nextValue: string;
  imageFiles: File[];
}

export const createChatClipboardPastePlan = (
  clipboardData: Pick<DataTransfer, 'items' | 'getData'>,
  currentValue: string,
  selectionStart: number,
  selectionEnd: number,
): ChatClipboardPastePlan => {
  const imageFiles = Array.from(clipboardData.items)
    .filter((item) => (
      item.kind === 'file'
      && item.type.toLowerCase().startsWith('image/')
    ))
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
  if (imageFiles.length === 0) {
    return { handled: false, nextValue: currentValue, imageFiles: [] };
  }

  const pastedText = clipboardData.getData('text/plain');
  return {
    handled: true,
    nextValue: pastedText
      ? insertChatClipboardText(
        currentValue,
        pastedText,
        selectionStart,
        selectionEnd,
      )
      : currentValue,
    imageFiles,
  };
};

export const insertChatClipboardText = (
  currentValue: string,
  pastedText: string,
  selectionStart: number,
  selectionEnd: number,
): string => {
  const safeStart = Math.max(0, Math.min(currentValue.length, selectionStart));
  const safeEnd = Math.max(safeStart, Math.min(currentValue.length, selectionEnd));
  return `${currentValue.slice(0, safeStart)}${pastedText}${currentValue.slice(safeEnd)}`;
};

export const readChatClipboardImages = async (
  imageFiles: readonly File[],
): Promise<ChatClipboardImageInput[]> => Promise.all(imageFiles.map(
  async (file, index) => ({
    bytes: new Uint8Array(await file.arrayBuffer()),
    suggestedDisplayName: file.name || `clipboard-image-${index + 1}`,
    declaredMimeType: file.type,
  }),
));
