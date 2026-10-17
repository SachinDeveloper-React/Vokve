import React, { memo } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import type { ThemeColors } from '../../constants/colors';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type IconColor = Extract<
  keyof ThemeColors,
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'primary'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'primaryForeground'
  | 'gold'
>;

/**
 * Which ink each colour token draws an icon in.
 *
 * The names are the text tokens callers already reach for, but an icon is not
 * text: a 2px stroke lays down a fraction of the ink a letterform does, so the
 * same grey that reads as "secondary" on a caption reads as "disabled" on a
 * glyph. The three text tokens therefore land on the two icon tokens — which
 * is why darkening every quiet icon in the app is this table and nothing else.
 * A caller that wants an exact colour still passes `tint`.
 */
const INK: Record<IconColor, keyof ThemeColors> = {
  text: 'icon',
  textSecondary: 'iconMuted',
  textTertiary: 'iconMuted',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  destructive: 'destructive',
  primaryForeground: 'primaryForeground',
  gold: 'gold',
};

const SIZES: Record<IconSize, number> = {
  xs: moderateScale(14),
  sm: moderateScale(16),
  md: moderateScale(20),
  lg: moderateScale(24),
  xl: moderateScale(32),
};

interface Props {
  /** The lucide icon component itself, e.g. `as={Flame}`. */
  as: LucideIcon;
  size?: IconSize | number;
  color?: IconColor;
  /** Overrides the token colour — for icons on a gradient, for instance. */
  tint?: string;
  strokeWidth?: number;
  /** A fill for the glyph's body — a filled star, a filled heart. Unfilled by default. */
  fill?: string;
}

/**
 * Wraps a lucide icon so size and colour come from the theme.
 *
 * The icon is passed in as a component rather than looked up by a name string:
 * a name map would pull lucide's entire icon set into the bundle, while an
 * import of just the icons used stays tree-shakeable.
 */
export const Icon = memo(
  ({
    as: Component,
    size = 'md',
    color = 'text',
    tint,
    strokeWidth = 2,
    fill,
  }: Props) => {
    const { colors } = useTheme();
    const ink = colors[INK[color]];

    return (
      <Component
        size={typeof size === 'number' ? size : SIZES[size]}
        color={tint ?? (typeof ink === 'string' ? ink : colors.icon)}
        strokeWidth={strokeWidth}
        fill={fill ?? 'none'}
      />
    );
  },
);

Icon.displayName = 'Icon';
