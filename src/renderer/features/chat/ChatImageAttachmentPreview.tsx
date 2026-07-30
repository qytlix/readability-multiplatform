import { useEffect, useState } from 'react';
import type { ChatAttachment } from '../../../shared/contracts/chat.types';

interface ChatImageAttachmentPreviewProps {
  entryId: number;
  attachment: ChatAttachment;
}

export const ChatImageAttachmentPreview = ({
  entryId,
  attachment,
}: ChatImageAttachmentPreviewProps) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (attachment.kind !== 'image') return undefined;
    let disposed = false;
    let objectUrl: string | null = null;
    void window.shaleAPI.chat.previewAttachment({
      entryId,
      attachmentId: attachment.id,
    }).then((result) => {
      if (!result.ok) return;
      const bytes = Uint8Array.from(result.data.bytes);
      objectUrl = URL.createObjectURL(new Blob(
        [bytes.buffer],
        { type: result.data.mimeType },
      ));
      if (disposed) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        return;
      }
      setPreviewUrl(objectUrl);
    }).catch(() => undefined);

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, attachment.kind, entryId]);

  if (!previewUrl) {
    return <span className="article-chat-image-preview-placeholder" aria-hidden="true" />;
  }
  return (
    <img
      className="article-chat-image-preview"
      src={previewUrl}
      alt={attachment.displayName}
      width={attachment.width}
      height={attachment.height}
    />
  );
};
