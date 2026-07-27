/**
 * Compute a stable hue from a tag name.
 * Returns the hue as a CSS custom property value so themes can control
 * lightness and text contrast independently.
 */
export function tagColor(name: string): { hue: number } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return { hue };
}

/**
 * @deprecated Use tagColor().hue with CSS — kept for backend compat.
 */
export function tagColorHsl(name: string): string {
  const { hue } = tagColor(name);
  return `hsl(${hue}, 55%, 72%)`;
}