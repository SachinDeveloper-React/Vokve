/**
 * Rewrites an `rgba(r, g, b, a)` or `rgb(r, g, b)` colour with a new alpha.
 *
 * Every palette entry in `constants/colors.ts` is authored in that form, which
 * is what makes a tinted wash derivable from an accent rather than needing a
 * second token kept in step with it by hand. Anything it cannot parse is
 * returned untouched, so an unexpected format degrades to the solid colour
 * instead of rendering as nothing.
 */
export function withAlpha(color: string, alpha: number): string {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return color;
  }
  const [r, g, b] = match[1].split(',').map(part => part.trim());
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
