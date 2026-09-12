import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { Icon, type IconSize } from '../media/Icon';

export type IconBadgeSize = 'sm' | 'md' | 'lg';

/**
 * How the disc behind the icon is filled.
 *
 * `soft` is the default pairing — a wash of the tint, derived rather than
 * chosen, so a new accent colour never needs a matching background added
 * alongside it. `solid` spends the tint on the disc itself and drops the glyph
 * out in white, for the one badge a card is built around. `muted` takes the
 * tint off the disc entirely and leaves it on the glyph, which is what a list
 * of rows wants: a column of tinted discs competes with the text beside it.
 * `outline` draws only the disc's edge, for a glyph on a surface that is
 * already dark or tinted, where any fill would be a wash on a wash.
 */
export type IconBadgeVariant = 'soft' | 'solid' | 'muted' | 'outline';

/**
 * The outline of the disc.
 *
 * `circle` is the default and what a standalone shortcut wants. `rounded` is
 * for a column of them down a settings list: a squircle shares its corner
 * radius with the card it sits in, so a stack of rows reads as one block
 * rather than a strip of unrelated buttons.
 */
export type IconBadgeShape = 'circle' | 'rounded';

const SIZES: Record<IconBadgeSize, { box: number; icon: IconSize }> = {
  sm: { box: moderateScale(32), icon: 'sm' },
  md: { box: moderateScale(44), icon: 'md' },
  lg: { box: moderateScale(56), icon: 'lg' },
};

/** The glyph's share of the disc when a caller gives an exact diameter. */
const ICON_RATIO = 0.45;

interface Props {
  icon: LucideIcon;
  /** The icon's colour, and what the disc behind it is derived from. */
  tint: string;
  /**
   * A size token, or an exact diameter for a design the scale does not carry.
   * A number is read at the 375pt baseline and scaled per device, exactly as
   * the tokens are — so callers pass the number from the design, not a
   * pre-scaled one.
   */
  size?: IconBadgeSize | number;
  variant?: IconBadgeVariant;
  shape?: IconBadgeShape;
}

/**
 * An icon on a circular disc.
 *
 * The disc is always derived from the tint or from a surface token, never
 * chosen per call site, so the pairing stays correct in both themes without
 * anyone having to pick a matching background.
 */
export const IconBadge = memo(
  ({ icon, tint, size = 'md', variant = 'soft', shape = 'circle' }: Props) => {
    const { colors, isDark } = useTheme();

    const box = typeof size === 'number' ? moderateScale(size) : SIZES[size].box;
    const iconSize: IconSize | number =
      typeof size === 'number' ? Math.round(box * ICON_RATIO) : SIZES[size].icon;

    // A dark surface needs a touch more wash for a soft disc to read at all.
    const background =
      variant === 'solid'
        ? tint
        : variant === 'muted'
        ? colors.muted
        : variant === 'outline'
        ? 'transparent'
        : withAlpha(tint, isDark ? 0.22 : 0.12);

    return (
      <View
        style={[
          styles.disc,
          {
            width: box,
            height: box,
            // A squircle's corner is a share of the box rather than a token, so
            // it stays proportional at every size the badge is asked for.
            borderRadius: shape === 'circle' ? box / 2 : box * 0.32,
            backgroundColor: background,
          },
          variant === 'outline' && [
            styles.outline,
            { borderColor: withAlpha(tint, 0.45) },
          ],
        ]}
      >
        <Icon
          as={icon}
          size={iconSize}
          tint={variant === 'solid' ? colors.primaryForeground : tint}
        />
      </View>
    );
  },
);

IconBadge.displayName = 'IconBadge';

const styles = StyleSheet.create({
  disc: { alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 1 },
});
