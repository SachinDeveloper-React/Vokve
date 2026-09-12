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
}

/**
 * Wraps a lucide icon so size and colour come from the theme.
 *
 * The icon is passed in as a component rather than looked up by a name string:
 * a name map would pull lucide's entire icon set into the bundle, while an
 * import of just the icons used stays tree-shakeable.
 */
export const Icon = memo(
  ({ as: Component, size = 'md', color = 'text', tint, strokeWidth = 2 }: Props) => {
    const { colors } = useTheme();

    return (
      <Component
        size={typeof size === 'number' ? size : SIZES[size]}
        color={tint ?? colors[color]}
        strokeWidth={strokeWidth}
      />
    );
  },
);

Icon.displayName = 'Icon';
