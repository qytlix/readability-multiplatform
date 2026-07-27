import { type Tag } from '../../../shared/contracts/tag.types';
import { tagColor } from './tagColor';

interface TagBadgeProps {
  tag: Tag;
  onRemove: (tagId: number) => void;
}

export const TagBadge = ({ tag, onRemove }: TagBadgeProps) => {
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(tag.id);
  };

  return (
    <span
      className="tag-badge"
      style={{ backgroundColor: tagColor(tag.name) }}
    >
      <span className="tag-badge-label">{tag.name}</span>
      <button
        type="button"
        className="tag-badge-remove"
        onClick={handleRemove}
        aria-label={`Remove tag "${tag.name}"`}
      >
        ×
      </button>
    </span>
  );
};