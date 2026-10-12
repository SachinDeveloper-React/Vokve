import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronRight, LayoutGrid } from 'lucide-react-native';
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
  /** The tile at the end of the row — the whole library. */
  onPressMore: () => void;
  /** The link beside the heading, which goes to the same place. */
  onPressViewAll: () => void;
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
 *
 * "View all" and the "More" tile both open the library. Two ways to the same
 * screen because they answer two different impulses: one is reading the
 * heading and wanting the rest, the other is reaching the end of four tiles
 * and wanting a fifth.
 */
export const FoodQuickAddRow = memo(
  ({ items, onAdd, onPressMore, onPressViewAll }: Props) => {
    const { colors } = useTheme();

    return (
      <VStack gap="sm">
        <HStack align="center" gap="sm">
          <AppText variant="h3">Quick Add</AppText>

          <HStack flex={1} align="center" justify="end">
            <Pressable
              onPress={onPressViewAll}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel="View all foods"
            >
              <HStack align="center" gap="xxs">
                <AppText variant="micro" color="primary">
                  View all
                </AppText>
                <Icon as={ChevronRight} size="xs" color="primary" />
              </HStack>
            </Pressable>
          </HStack>
        </HStack>

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
              <AppText
                variant="miniMicro"
                center
                numberOfLines={1}
                style={styles.name}
              >
                More
              </AppText>
            </VStack>
          </Pressable>
        </HStack>
      </VStack>
    );
  },
);

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
