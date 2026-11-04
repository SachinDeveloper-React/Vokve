import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { PlannedMeal } from '../../types/models';
import { formatGrouped, formatTimeOfDay } from '../../utils/format';
import { MEAL_STYLE } from '../nutrition/nutritionLabels';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

const DISC = moderateScale(36);

interface Props {
  meal: PlannedMeal;
}

/**
 * One meal of the plan: when it is, what is in it, and what it comes to.
 *
 * Its own card rather than a row in a list, unlike the nutrition screen's
 * meals. Those are a log — four lines summarising what happened — where this
 * is an instruction with three or four items under it, and instructions read
 * better with an edge around them.
 *
 * The card is not pressable. It used to be, with a chevron, for a meal's own
 * page that does not exist — and everything that page would have shown is
 * already here: the time, the items, their quantities and the calories.
 */
export const PlannedMealCard = memo(({ meal }: Props) => {
  const { colors } = useTheme();
  const { label, emoji } = MEAL_STYLE[meal.slot];

  return (
    <Card
      radius="xl"
      padding="base"
      accessible
      accessibilityLabel={`${label}, ${formatTimeOfDay(
        meal.time,
      )}, ${formatGrouped(meal.calories)} calories, ${meal.items.length} items`}
    >
      <VStack gap="sm">
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
            <AppText variant="miniMicro" color="textSecondary">
              {formatTimeOfDay(meal.time)}
            </AppText>
          </VStack>

          <AppText variant="bodyStrong" numberOfLines={1}>
            {`${formatGrouped(meal.calories)} kcal`}
          </AppText>
        </HStack>

        <VStack gap="xxs">
          {meal.items.map(item => (
            <HStack key={item.name} align="center" justify="between" gap="sm">
              <AppText
                variant="miniMicro"
                color="textSecondary"
                numberOfLines={1}
                style={styles.item}
              >
                {item.name}
              </AppText>
              <AppText
                variant="miniMicro"
                color="textTertiary"
                numberOfLines={1}
              >
                {item.quantity}
              </AppText>
            </HStack>
          ))}
        </VStack>
      </VStack>
    </Card>
  );
});

PlannedMealCard.displayName = 'PlannedMealCard';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Text in a row does not shrink on its own, so a long dish would overrun. */
  item: { flexShrink: 1 },
});
