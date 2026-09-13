import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { MealSlot } from '../../types/models';
import { formatClockTime } from '../../utils/format';
import { formatGrouped } from '../../utils/format';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { MEAL_STYLE } from './nutritionLabels';

const DISC = moderateScale(36);
const ADD = moderateScale(28);

interface Props {
  slot: MealSlot;
  items: number;
  calories: number;
  /** ISO-8601 of the first thing logged, or null while the meal is empty. */
  startedAt: string | null;
  onPressAdd: (slot: MealSlot) => void;
}

/**
 * One meal of the day: when it was, how much was in it, and the way to add to
 * it.
 *
 * An empty meal keeps its row and says "No items yet" rather than being
 * hidden. The row *is* the way to log food into that meal, and a dinner that
 * only appeared once dinner had been logged would be a control that showed up
 * after it was needed.
 */
export const MealRow = memo(
  ({ slot, items, calories, startedAt, onPressAdd }: Props) => {
    const { colors, isDark } = useTheme();
    const { label, emoji } = MEAL_STYLE[slot];

    const handleAdd = useCallback(() => onPressAdd(slot), [onPressAdd, slot]);

    const detail =
      items === 0
        ? 'No items yet'
        : `${startedAt ? `${formatClockTime(startedAt)} · ` : ''}${items} ${
            items === 1 ? 'item' : 'items'
          }`;

    return (
      <HStack align="center" gap="md" py="sm">
        <Box
          radius="pill"
          style={[styles.disc, { backgroundColor: colors.muted }]}
        >
          <Emoji size="sm">{emoji}</Emoji>
        </Box>

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {label}
          </AppText>
          <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
            {detail}
          </AppText>
        </VStack>

        <AppText variant="bodyStrong" numberOfLines={1}>
          {`${formatGrouped(calories)} kcal`}
        </AppText>

        <Pressable
          onPress={handleAdd}
          feedback="scale"
          accessibilityRole="button"
          accessibilityLabel={`Add food to ${label}`}
        >
          <Box
            radius="md"
            style={[
              styles.add,
              {
                backgroundColor: withAlpha(
                  colors.primary,
                  isDark ? 0.28 : 0.14,
                ),
              },
            ]}
          >
            <Icon as={Plus} size="sm" tint={colors.primary} />
          </Box>
        </Pressable>
      </HStack>
    );
  },
);

MealRow.displayName = 'MealRow';

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
