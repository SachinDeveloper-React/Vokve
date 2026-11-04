import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, type LucideIcon } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/** One choice in a picker — an `OptionSheet`, or a `Select`'s own sheet. */
export interface SheetOption<T extends string> {
  value: T;
  label: string;
  /** A line under the label saying what the option is, not what it promises. */
  helper?: string;
  /** The glyph in the leading tile. Without one the tile is not drawn. */
  icon?: LucideIcon;
  disabled?: boolean;
}

const MARK_SIZE = moderateScale(22);
const TILE_SIZE = moderateScale(38);

interface Props<T extends string> {
  option: SheetOption<T>;
  selected: boolean;
  onSelect: (value: T) => void;
}

/**
 * One option in a picker, as a row that states whether it is the one in force.
 *
 * Three things say "selected" at once — the tinted fill, the coloured border
 * and the filled check — because any one of them alone is a difference a user
 * has to go looking for. What it does *not* do is say "selected" in the
 * accessibility label: that belongs in `accessibilityState`, which is what a
 * screen reader reads out as the row's state, and baking it into the label
 * instead would rename the row depending on what was chosen.
 *
 * Shared by every single-choice sheet in the app rather than each one drawing
 * its own rows, so a picker cannot end up looking like a menu of actions —
 * which is the version that leaves a user unable to tell what they picked
 * last time.
 */
function OptionRowInner<T extends string>({
  option,
  selected,
  onSelect,
}: Props<T>) {
  const { colors } = useTheme();
  const press = useCallback(
    () => onSelect(option.value),
    [onSelect, option.value],
  );

  const tint = selected ? colors.primary : colors.textSecondary;

  return (
    <Pressable
      onPress={press}
      disabled={option.disabled}
      feedback="opacity"
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: Boolean(option.disabled) }}
      accessibilityLabel={option.label}
      accessibilityHint={option.helper}
      style={[
        styles.row,
        {
          backgroundColor: selected ? colors.accent : colors.card,
          borderColor: selected ? colors.primary : colors.border,
          borderWidth: selected ? moderateScale(1.5) : StyleSheet.hairlineWidth,
        },
        option.disabled === true && styles.disabled,
      ]}
    >
      <HStack align="center" gap="md">
        {option.icon ? (
          <View
            style={[
              styles.tile,
              {
                backgroundColor: selected
                  ? withAlpha(colors.primary, 0.14)
                  : colors.muted,
              },
            ]}
          >
            <Icon as={option.icon} size="md" tint={tint} />
          </View>
        ) : null}

        <VStack flex={1} gap="xxs">
          <AppText
            variant="bodyStrong"
            numberOfLines={2}
            style={{ color: selected ? colors.primary : colors.text }}
          >
            {option.label}
          </AppText>
          {option.helper ? (
            <AppText variant="caption" color="textSecondary" numberOfLines={2}>
              {option.helper}
            </AppText>
          ) : null}
        </VStack>

        <View
          style={[
            styles.mark,
            selected
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { borderColor: colors.switchBackground },
          ]}
        >
          {selected ? (
            <Icon
              as={Check}
              size="xs"
              tint={colors.primaryForeground}
              strokeWidth={3}
            />
          ) : null}
        </View>
      </HStack>
    </Pressable>
  );
}

export const OptionRow = memo(OptionRowInner) as typeof OptionRowInner;

const styles = StyleSheet.create({
  row: {
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: moderateScale(60),
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    borderRadius: MARK_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
