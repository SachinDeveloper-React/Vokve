import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { LayoutGrid } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import type { FoodItem } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface TileProps {
  item: FoodItem;
  onPress: (item: FoodItem) => void;
}

const QuickAddTile = memo(({ item, onPress }: TileProps) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(item), [item, onPress]);

  return (
    <Pressable
      onPress={press}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`Add ${item.name}, ${item.calories} calories`}
      style={styles.press}
    >
      <VStack
        align="center"
        gap="xs"
        py="md"
        px="xs"
        style={[styles.tile, { borderColor: colors.border }]}
      >
        <Emoji size="md">{item.emoji}</Emoji>

        <AppText variant="miniMicro" center numberOfLines={1} style={styles.name}>
          {item.name}
        </AppText>

        <AppText
          variant="miniMicro"
          center
          numberOfLines={1}
          style={{ color: colors.success }}
        >
          {`${Math.round(item.calories)} kcal`}
        </AppText>
      </VStack>
    </Pressable>
  );
});

QuickAddTile.displayName = 'QuickAddTile';

interface Props {
  items: FoodItem[];
  onAdd: (item: FoodItem) => void;
  onPressMore: () => void;
}

/**
 * The four foods most likely to be logged, and the way to the rest.
 *
 * Named for food rather than called `QuickAddRow`: hydration has a row of that
 * name for millilitres, and one component library cannot hold two.
 *
 * One tap each, with no quantity to choose: the portion on the tile is the
 * one the figures describe, and a sheet asking "how much?" for a banana is the
 * friction that stops people logging breakfast at all. Anything unusual goes
 * through the search above.
 */
export const FoodQuickAddRow = memo(({ items, onAdd, onPressMore }: Props) => {
  const { colors } = useTheme();

  return (
    <VStack gap="sm">
      <AppText variant="h3">Quick Add</AppText>

      <HStack align="stretch" gap="sm">
        {items.map(item => (
          <QuickAddTile key={item.id} item={item} onPress={onAdd} />
        ))}

        <Pressable
          onPress={onPressMore}
          feedback="scale"
          accessibilityRole="button"
          accessibilityLabel="More foods"
          style={styles.press}
        >
          <VStack
            align="center"
            gap="xs"
            py="md"
            px="xs"
            style={[styles.tile, { borderColor: colors.border }]}
          >
            <Icon as={LayoutGrid} size="md" color="text" />
            <AppText variant="miniMicro" center numberOfLines={1} style={styles.name}>
              More
            </AppText>
          </VStack>
        </Pressable>
      </HStack>
    </VStack>
  );
});

FoodQuickAddRow.displayName = 'FoodQuickAddRow';

const styles = StyleSheet.create({
  press: { flex: 1 },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: { fontWeight: '600' },
});
