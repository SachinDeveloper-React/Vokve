import React, { memo } from 'react';
import { formatGrouped } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

interface FigureProps {
  emoji: string;
  value: string;
  label: string;
}

const GoalFigure = memo(({ emoji, value, label }: FigureProps) => (
  <VStack
    flex={1}
    align="center"
    gap="xxs"
    accessible
    accessibilityLabel={`${label}, ${value}`}
  >
    <Emoji size="sm">{emoji}</Emoji>
    <AppText variant="bodyStrong" numberOfLines={1}>
      {value}
    </AppText>
    <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
      {label}
    </AppText>
  </VStack>
));

GoalFigure.displayName = 'GoalFigure';

interface Props {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  onPressEdit: () => void;
}

/**
 * The four targets the rest of the screen is measured against.
 *
 * Stated on their own rather than only inside the bars above, because these
 * are the numbers a user changes: the summary answers "how am I doing", and
 * this answers "against what" — which is the question "Edit Goal" acts on.
 */
export const DailyGoalCard = memo(
  ({ calories, proteinG, carbsG, fatsG, onPressEdit }: Props) => (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="label" color="textSecondary" numberOfLines={1}>
            Your Daily Goal
          </AppText>

          <Pressable
            onPress={onPressEdit}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel="Edit your daily goal"
          >
            <AppText variant="micro" color="primary">
              Edit Goal
            </AppText>
          </Pressable>
        </HStack>

        <HStack align="start" gap="sm">
          <GoalFigure
            emoji="🔥"
            value={`${formatGrouped(calories)} kcal`}
            label="Calories"
          />
          <GoalFigure emoji="💪" value={`${proteinG}g`} label="Protein" />
          <GoalFigure emoji="🌾" value={`${carbsG}g`} label="Carbs" />
          <GoalFigure emoji="🥑" value={`${fatsG}g`} label="Fats" />
        </HStack>
      </VStack>
    </Card>
  ),
);

DailyGoalCard.displayName = 'DailyGoalCard';
