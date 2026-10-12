import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { FoodItem } from '../../types/models';
import { formatGrouped } from '../../utils/format';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Pressable } from '../form/Pressable';

const DISC = moderateScale(40);
const ADD = moderateScale(34);

interface Props {
  item: FoodItem;
  /** How many helpings of it are already on the meal. Zero draws no count. */
  added: number;
  onAdd: (item: FoodItem) => void;
}

/**
 * One food in the library: what it is, the portion the figures describe, and
 * one tap to put it on the meal.
 *
 * The whole row adds rather than only the "+", because a list whose rows look
 * tappable and are not is a list people tap at twice. There is no quantity to
 * choose — the count on the right says how many helpings are on the meal, and
 * tapping again adds another, which is the same gesture as the quick-add
 * tiles rather than a second idea of how portions work.
 */
export const FoodLibraryRow = memo(({ item, added, onAdd }: Props) => {
  const { colors } = useTheme();
  const add = useCallback(() => onAdd(item), [item, onAdd]);

  const macros = `P ${Math.round(item.proteinG)}g · C ${Math.round(
    item.carbsG,
  )}g · F ${Math.round(item.fatsG)}g`;

  return (
    <Pressable
      onPress={add}
      feedback="highlight"
      accessibilityRole="button"
      accessibilityLabel={`Add ${item.name}, ${item.portion}, ${Math.round(
        item.calories,
      )} calories${added > 0 ? `, ${added} already on this meal` : ''}`}
    >
      <Card radius="lg" padding="md">
        <HStack align="center" gap="md">
          <Box
            radius="pill"
            style={[styles.disc, { backgroundColor: colors.muted }]}
          >
            <Emoji size="sm">{item.emoji}</Emoji>
          </Box>

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" numberOfLines={1}>
              {item.name}
            </AppText>
            <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
              {`${item.portion} · ${macros}`}
            </AppText>
          </VStack>

          <VStack align="end" gap="xxs">
            <AppText variant="micro" style={{ color: colors.success }}>
              {`${formatGrouped(Math.round(item.calories))} kcal`}
            </AppText>
            {added > 0 ? <Chip label={`×${added}`} /> : null}
          </VStack>

          <Box
            radius="pill"
            style={[styles.add, { backgroundColor: colors.primary }]}
          >
            <Icon as={Plus} size="xs" color="primaryForeground" />
          </Box>
        </HStack>
      </Card>
    </Pressable>
  );
});

FoodLibraryRow.displayName = 'FoodLibraryRow';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    width: ADD,
    height: ADD,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
