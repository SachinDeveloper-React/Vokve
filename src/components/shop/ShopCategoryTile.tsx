import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import type { ShopCategory } from '../../types/models';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

interface Props {
  category: ShopCategory;
  label: string;
  icon: LucideIcon;
  /** Colours the disc, the wash behind the tile and its edge. Pass a theme colour. */
  tint: string;
  /** How many rewards the category holds right now. */
  count: number;
  onPress: (category: ShopCategory) => void;
}

/**
 * One tile in the "Top Categories" grid.
 *
 * The count is the tile's whole reason to exist beside the filter row above,
 * which already lists the same categories: a chip says a category exists, a
 * tile says how much is in it, and that is what lets a user decide whether
 * Lifestyle is worth a look before they tap it.
 */
export const ShopCategoryTile = memo(
  ({ category, label, icon, tint, count, onPress }: Props) => {
    const { isDark } = useTheme();
    const handlePress = useCallback(() => onPress(category), [category, onPress]);

    return (
      <Pressable
        onPress={handlePress}
        feedback="scale"
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${count} ${count === 1 ? 'reward' : 'rewards'}`}
      >
        <VStack
          align="center"
          gap="sm"
          py="lg"
          px="md"
          radius="xl"
          style={[
            styles.tile,
            {
              backgroundColor: withAlpha(tint, isDark ? 0.14 : 0.08),
              borderColor: withAlpha(tint, isDark ? 0.3 : 0.2),
            },
          ]}
        >
          <IconBadge icon={icon} tint={tint} size={44} />

          <VStack align="center" gap="xxs">
            <AppText variant="bodyStrong" center numberOfLines={1}>
              {label}
            </AppText>
            <AppText variant="micro" color="textSecondary" center>
              {`${count} ${count === 1 ? 'Reward' : 'Rewards'}`}
            </AppText>
          </VStack>
        </VStack>
      </Pressable>
    );
  },
);

ShopCategoryTile.displayName = 'ShopCategoryTile';

/** `Box` draws its border only in the theme's border colour; this one is tinted. */
const styles = StyleSheet.create({
  tile: { borderWidth: StyleSheet.hairlineWidth },
});
