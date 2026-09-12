import { Dimensions, PixelRatio } from 'react-native';

/**
 * Design baseline: a 375 × 812 logical-point screen (iPhone 11 Pro / 13 mini,
 * and close to the median Android phone). Every size in the token scale is
 * authored at this width and scaled from here.
 */
export const BASE_WIDTH = 375;
export const BASE_HEIGHT = 812;

/**
 * The *screen*, not the window.
 *
 * Window dimensions change with orientation, iPad Split View and foldables,
 * so scaling off them would resize all the type when a user rotates the phone.
 * Screen dimensions describe the physical device and stay put, which is what a
 * size scale should be anchored to.
 */
const screen = Dimensions.get('screen');
const shortestSide = Math.min(screen.width, screen.height);
const longestSide = Math.max(screen.width, screen.height);

/**
 * Clamped so the extremes stay usable: a 320pt phone should not shrink text
 * below legibility, and a 1024pt tablet should not render a 60pt body font.
 */
const MIN_FACTOR = 0.85;
const MAX_FACTOR = 1.3;

const rawFactor = shortestSide / BASE_WIDTH;
export const scaleFactor = Math.min(
  MAX_FACTOR,
  Math.max(MIN_FACTOR, rawFactor),
);

/** Rounds to a whole device pixel so edges and hairlines stay crisp. */
const round = (value: number) => PixelRatio.roundToNearestPixel(value);

/** Scales a size proportionally to screen width. Use for layout dimensions. */
export function scale(size: number): number {
  return round(size * scaleFactor);
}

/**
 * Scales with the width but only partway, so the difference between a small
 * phone and a tablet is felt without becoming cartoonish. This is the right
 * default for padding, radii and font sizes — a 16pt gap wants to grow a
 * little on a big screen, not by 30%.
 */
export function moderateScale(size: number, factor = 0.5): number {
  return round(size + (size * scaleFactor - size) * factor);
}

/** Scales against screen height. Use sparingly — mostly for hero sections. */
export function verticalScale(size: number): number {
  return round((size * longestSide) / BASE_HEIGHT);
}

/** Percentage of the shortest screen edge, in points. */
export function widthPercent(percent: number): number {
  return round((shortestSide * percent) / 100);
}

export const deviceInfo = {
  shortestSide,
  longestSide,
  /** 600pt is the conventional phone/tablet split on both platforms. */
  isTablet: shortestSide >= 600,
  isSmallPhone: shortestSide < 360,
} as const;
