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

/**
 * Whether black or white reads better on top of `color`.
 *
 * The app's accents are not all the same weight, and they change weight
 * between the themes: the brand orange is `rgb(234, 88, 12)` in light mode
 * and `rgb(251, 146, 60)` in dark, and gold is lighter still. So a banner
 * that fills itself with an accent cannot pick its text colour once and be
 * right — and on a banner the words are the whole point.
 *
 * Decided by contrast rather than from a per-accent table, so a fifth accent
 * added to the server's list needs nothing adding here: the WCAG relative
 * luminance of the fill, then whichever of black or white has the better
 * ratio against it.
 *
 * The gamma step is not optional, which is worth saying because the obvious
 * shortcut is to leave it out. Light-mode gold, `rgb(202, 138, 4)`, reads as
 * 0.56 on the raw channels and 0.31 once they are linearised — the first
 * says white text, the second says black, and the second is the one that can
 * actually be read.
 *
 * Anything unparseable gets the light answer, which is what a saturated
 * accent usually wants.
 */
export function readableOn(color: string): 'light' | 'dark' {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return 'light';
  }
  const parts = match[1].split(',').map(part => Number(part.trim()));
  const [r, g, b] = parts;
  if ([r, g, b].some(part => !Number.isFinite(part))) {
    return 'light';
  }

  /** One sRGB channel, linearised — the step the shortcut leaves out. */
  const linear = (value: number): number => {
    const scaled = Math.min(255, Math.max(0, value)) / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };

  const luminance =
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const againstBlack = (luminance + 0.05) / 0.05;
  const againstWhite = 1.05 / (luminance + 0.05);
  return againstBlack > againstWhite ? 'dark' : 'light';
}
