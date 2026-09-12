import { Platform, TextStyle } from 'react-native';
import { moderateScale } from './responsive';

/**
 * A 4pt spacing grid, authored at the 375pt baseline and scaled per device.
 *
 * `moderateScale` rather than a straight proportional scale: padding should
 * grow a little on a bigger screen, not in lockstep with it. A 16pt gutter
 * that becomes 22pt on a tablet reads generous; one that becomes 44pt reads
 * broken.
 */
export const spacing = {
  none: 0,
  xxs: moderateScale(2),
  xs: moderateScale(4),
  sm: moderateScale(8),
  md: moderateScale(12),
  base: moderateScale(16),
  lg: moderateScale(20),
  xl: moderateScale(24),
  xxl: moderateScale(32),
  xxxl: moderateScale(40),
  huge: moderateScale(56),
} as const;

export const radius = {
  none: 0,
  sm: moderateScale(6),
  md: moderateScale(10),
  lg: moderateScale(14),
  xl: moderateScale(20),
  xxl: moderateScale(28),
  // Not scaled: this is the "fully rounded" sentinel, not a real measurement.
  pill: 999,
} as const;

/**
 * Font weights as literal types — React Native rejects plain `string` here.
 */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} satisfies Record<string, TextStyle['fontWeight']>;

/**
 * Type scale. `display` and `metric` are tuned for the large numeric readouts
 * a fitness app leans on (weight lifted, calories, streak days) — tabular
 * figures keep digits from shifting as values animate.
 */
export const typography = {
  display: {
    fontSize: moderateScale(40),
    lineHeight: moderateScale(46),
    fontWeight: fontWeight.heavy,
    letterSpacing: -0.8,
  },
  metric: {
    fontSize: moderateScale(30),
    lineHeight: moderateScale(34),
    fontWeight: fontWeight.bold,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  h1: {
    fontSize: moderateScale(26),
    lineHeight: moderateScale(32),
    fontWeight: fontWeight.bold,
    letterSpacing: -0.4,
  },
  h2: {
    fontSize: moderateScale(21),
    lineHeight: moderateScale(27),
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
  },
  h3: {
    fontSize: moderateScale(17),
    lineHeight: moderateScale(23),
    fontWeight: fontWeight.semibold,
  },
  body: {
    fontSize: moderateScale(15),
    lineHeight: moderateScale(22),
    fontWeight: fontWeight.regular,
  },
  bodyStrong: {
    fontSize: moderateScale(15),
    lineHeight: moderateScale(22),
    fontWeight: fontWeight.semibold,
  },
  /**
   * The smallest readable size that is not upper-cased. `label` is the only
   * other step this small and it transforms its text, which is wrong for a
   * value or a weekday. Reserved for dense readouts — axis ticks, bar values.
   */
  micro: {
    fontSize: moderateScale(11),
    lineHeight: moderateScale(15),
    fontWeight: fontWeight.medium,
    fontVariant: ['tabular-nums'],
  },
  miniMicro: {
    fontSize: moderateScale(8),
    lineHeight: moderateScale(10),
    fontWeight: fontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  caption: {
    fontSize: moderateScale(13),
    lineHeight: moderateScale(18),
    fontWeight: fontWeight.regular,
  },
  label: {
    fontSize: moderateScale(11),
    lineHeight: moderateScale(15),
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  /**
   * `label` for a tile that is only a quarter of the screen wide.
   *
   * Upper case buys legibility at small sizes but costs width, and a word like
   * "achievements" at the 11pt `label` step is wider than a four-across card.
   * The smaller step with tighter tracking is what lets all four shortcut
   * labels be read at once instead of one of them ending in an ellipsis.
   */
  labelMicro: {
    fontSize: moderateScale(9),
    lineHeight: moderateScale(13),
    fontWeight: fontWeight.bold,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

/**
 * Elevation. iOS gets real shadows, Android uses the native elevation prop —
 * shadow* properties are ignored there, so both have to be specified.
 */
export const elevation = {
  none: Platform.select({
    ios: { shadowOpacity: 0 },
    android: { elevation: 0 },
    default: {},
  }),
  low: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 2 },
    default: {},
  }),
  medium: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 6 },
    default: {},
  }),
  high: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
    },
    android: { elevation: 12 },
    default: {},
  }),
} as const;

/**
 * Minimum touch target, in both axes. Deliberately *not* scaled: 44pt is an
 * absolute accessibility floor set by a fingertip, which is the same size on
 * every device.
 */
export const HIT_SLOP_MIN = 44;

export const duration = {
  instant: 100,
  fast: 180,
  normal: 260,
  slow: 400,
} as const;
