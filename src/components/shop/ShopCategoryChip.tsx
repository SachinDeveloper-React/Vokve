import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { VStack } from '../layout/Stack';
import { Pressable } from '../form/Pressable';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';

/**
 * Fixed so every chip in the row is the same width whatever its label, and
 * wide enough that "Accessories" fits on one line rather than breaking
 * mid-word the way an equal share of a 375pt row would force it to.
 */
export const CATEGORY_CHIP_WIDTH = moderateScale(64);

interface Props<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
  /** Colours the glyph and its disc. Pass a theme colour. */
  tint: string;
  selected: boolean;
  onPress: (value: T) => void;
}

/**
 * One chip in the shop's category row: a tinted disc over a label.
 *
 * Selection is a wash behind the whole chip *and* the label switching to the
 * accent, so the chosen one is still obvious to a reader who cannot separate
 * the wash from the card it sits on. The disc keeps its own category colour
 * either way — recolouring it on selection would make the chosen category
 * look like a different category.
 */
function ShopCategoryChipInner<T extends string>({
  value,
  label,
  icon,
  tint,
  selected,
  onPress,
}: Props<T>) {
  const { colors, isDark } = useTheme();
  const handlePress = useCallback(() => onPress(value), [onPress, value]);

  return (
    <Pressable
      onPress={handlePress}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <VStack
        align="center"
        gap="sm"
        py="sm"
        px="xs"
        radius="lg"
        style={[
          styles.chip,
          selected && {
            backgroundColor: withAlpha(colors.brandAccent, isDark ? 0.2 : 0.12),
          },
        ]}
      >
        <IconBadge icon={icon} tint={tint} size={40} />

        <AppText
          variant="miniMicro"
          center
          numberOfLines={2}
          style={{
            color: selected ? colors.brandAccent : colors.textSecondary,
          }}
        >
          {label}
        </AppText>
      </VStack>
    </Pressable>
  );
}

export const ShopCategoryChip = memo(
  ShopCategoryChipInner,
) as typeof ShopCategoryChipInner;

const styles = StyleSheet.create({
  chip: { width: CATEGORY_CHIP_WIDTH },
});
