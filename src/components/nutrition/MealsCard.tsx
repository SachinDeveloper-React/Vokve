import React, { Fragment, memo } from 'react';
import type { MealSlot } from '../../types/models';
import type { MealSummary } from '../../stores/nutritionStore';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { MealRow } from './MealRow';
import { NutritionTipStrip } from './NutritionTipStrip';

interface Props {
  meals: MealSummary[];
  tip: string;
  onPressAdd: (slot: MealSlot) => void;
  onPressViewAll: () => void;
  onPressTips: () => void;
}

/**
 * The day's four meals, in the order they are eaten.
 *
 * Always four rows, whatever has been logged: the day has a shape, and a card
 * that grew a dinner row only once dinner was eaten would make the shape of
 * the day depend on how much of it had happened.
 */
export const MealsCard = memo(
  ({ meals, tip, onPressAdd, onPressViewAll, onPressTips }: Props) => (
    <Card radius="xl" padding="base">
      <VStack gap="sm">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="label" color="textSecondary" numberOfLines={1}>
            Today's Meals
          </AppText>

          <Pressable
            onPress={onPressViewAll}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="View all meals"
          >
            <AppText variant="micro" color="primary">
              View All
            </AppText>
          </Pressable>
        </HStack>

        <VStack>
          {meals.map((meal, index) => (
            <Fragment key={meal.slot}>
              {index > 0 ? <Divider /> : null}
              <MealRow
                slot={meal.slot}
                items={meal.items}
                calories={meal.calories}
                startedAt={meal.startedAt}
                onPressAdd={onPressAdd}
              />
            </Fragment>
          ))}
        </VStack>

        <NutritionTipStrip tip={tip} onPressTips={onPressTips} />
      </VStack>
    </Card>
  ),
);

MealsCard.displayName = 'MealsCard';
