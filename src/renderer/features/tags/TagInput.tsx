import { useCallback, useState, type KeyboardEvent } from 'react';

interface TagInputProps {
  onAdd: (tagName: string) => void;
  disabled?: boolean;
  /** Called on every input change with the current raw value (for parent filtering). */
  onInputChange?: (value: string) => void;
}

const MAX_TAG_LENGTH = 50;

export const TagInput = ({ onAdd, disabled = false, onInputChange }: TagInputProps) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Tag name cannot be empty.');
      return;
    }
    if (trimmed.length > MAX_TAG_LENGTH) {
      setError(`Tag name must not exceed ${MAX_TAG_LENGTH} characters.`);
      return;
    }
    setError('');
    setValue('');
    onAdd(trimmed);
  }, [value, onAdd]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setValue(next);
      onInputChange?.(next);
      if (error) setError('');
    },
    [error, onInputChange],
  );

  return (
    <div className="tag-input-wrapper">
      <input
        type="text"
        className="tag-input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="输入标签名，回车添加..."
        disabled={disabled}
        maxLength={MAX_TAG_LENGTH + 10}
      />
      {error && <span className="tag-input-error" role="alert">{error}</span>}
    </div>
  );
};