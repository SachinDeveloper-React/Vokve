import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { MealSummary } from '../../stores/nutritionStore';
import type { MealSlot } from '../../types/models';
import { formatClockTime, formatGrouped } from '../../utils/format';
import { MEAL_STYLE } from '../nutrition/nutritionLabels';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

const DISC = moderateScale(36);

interface Props {
  meal: MealSummary;
  onPress: (slot: MealSlot) => void;
}

/**
 * One meal of a past day: when it was, what was in it, what it came to.
 *
 * The items are listed by name rather than counted. "3 items" is what a meal
 * being built needs to know; a meal being looked back on is identified by
 * "Oats, Banana, Boiled Egg" — that is what tells the user which morning this
 * was.
 */
export const HistoryMealCard = memo(({ meal, onPress }: Props) => {
  const { colors } = useTheme();
  const { label, emoji } = MEAL_STYLE[meal.slot];
  const handlePress = useCallback(
    () => onPress(meal.slot),
    [meal.slot, onPress],
  );

  const items = meal.names.join(', ');

  return (
    <Pressable
      onPress={handlePress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${formatGrouped(meal.calories)} calories${
        items ? `, ${items}` : ', nothing logged'
      }`}
    >
      <Card radius="xl" padding="base">
        <HStack align="center" gap="md">
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

            {meal.startedAt ? (
              <AppText variant="miniMicro" color="textSecondary">
                {formatClockTime(meal.startedAt)}
              </AppText>
            ) : null}

            <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
              {items || 'Nothing logged'}
            </AppText>
          </VStack>

          <AppText variant="bodyStrong" numberOfLines={1}>
            {`${formatGrouped(meal.calories)} kcal`}
          </AppText>

          <Icon as={ChevronRight} size="sm" color="textTertiary" />
        </HStack>
      </Card>
    </Pressable>
  );
});

HistoryMealCard.displayName = 'HistoryMealCard';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
