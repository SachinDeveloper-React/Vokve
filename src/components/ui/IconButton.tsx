import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { elevation, fontWeight, radius, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { Icon, type IconColor } from '../media/Icon';
import { Pressable } from '../form/Pressable';

export type IconButtonSize = 'sm' | 'md' | 'lg';

const SIZES: Record<IconButtonSize, number> = {
  sm: moderateScale(36),
  md: moderateScale(44),
  lg: moderateScale(52),
};

interface Props {
  icon: LucideIcon;
  onPress: () => void;
  accessibilityLabel: string;
  size?: IconButtonSize;
  color?: IconColor;
  /**
   * `true` draws an unread dot in the top-right corner; a number draws a
   * count there instead. Zero and `false` draw nothing.
   */
  badge?: boolean | number;
  disabled?: boolean;
}

/** Anything past this is shown as "9+": a two-digit count no longer fits. */
const MAX_COUNT = 9;

/**
 * A square, rounded action button — the bell and similar header actions.
 *
 * The dot or count is decorative and marked as such: its meaning is already
 * carried by the button's accessibility label, and announcing a bare dot or a
 * lone digit alongside it would just be noise.
 */
export const IconButton = memo(
  ({
    icon,
    onPress,
    accessibilityLabel,
    size = 'md',
    color = 'text',
    badge = false,
    disabled = false,
  }: Props) => {
    const { colors } = useTheme();
    const dimension = SIZES[size];
    const dotSize = Math.round(dimension * 0.22);
    const count = typeof badge === 'number' ? badge : 0;
    const showsCount = count > 0;
    const showsDot = badge === true;
    // A count needs room for a digit and its ring where the dot needs neither.
    const countSize = Math.round(dimension * 0.4);

    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        feedback="scale"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.button,
          elevation.low,
          {
            width: dimension,
            height: dimension,
            borderRadius: radius.lg,
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Icon as={icon} size="md" color={color} />

        {showsDot ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[
              styles.badge,
              {
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: colors.destructive,
                borderColor: colors.card,
              },
            ]}
          />
        ) : null}

        {showsCount ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[
              styles.badge,
              styles.count,
              {
                minWidth: countSize,
                height: countSize,
                borderRadius: countSize / 2,
                backgroundColor: colors.brandAccent,
                borderColor: colors.card,
              },
            ]}
          >
            <Text
              style={[styles.countText, { color: colors.primaryForeground }]}
              allowFontScaling={false}
            >
              {count > MAX_COUNT ? `${MAX_COUNT}+` : count}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  },
);

IconButton.displayName = 'IconButton';

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    borderWidth: 2,
  },
  // Pushed past the corner rather than tucked inside it: a count is a second
  // glyph, and on the button's edge it stays clear of the icon.
  count: {
    top: -4,
    right: -4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  countText: {
    fontSize: moderateScale(10),
    lineHeight: moderateScale(12),
    fontWeight: fontWeight.bold,
  },
});
