import React, { Fragment, memo, useCallback } from 'react';
import { Trash2 } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { FoodEntry, MealSlot } from '../../types/models';
import { formatClockTime, formatGrouped } from '../../utils/format';
import { MEAL_STYLE } from '../nutrition/nutritionLabels';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Pressable } from '../form/Pressable';

interface RowProps {
  entry: FoodEntry;
  onRemove: (id: string) => void;
}

const LoggedRow = memo(({ entry, onRemove }: RowProps) => {
  const { colors } = useTheme();
  const remove = useCallback(() => onRemove(entry.id), [entry.id, onRemove]);

  return (
    <HStack align="center" gap="md" py="sm">
      <VStack flex={1} gap="xxs">
        <AppText variant="bodyStrong" numberOfLines={1}>
          {entry.name}
        </AppText>
        <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
          {[entry.portion, formatClockTime(entry.loggedAt)]
            .filter(part => part.length > 0)
            .join(' · ')}
        </AppText>
      </VStack>

      <AppText variant="bodyStrong" style={{ color: colors.success }}>
        {`${formatGrouped(Math.round(entry.calories))} kcal`}
      </AppText>

      <Pressable
        onPress={remove}
        feedback="opacity"
        visualSize={20}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${entry.name} from the diary`}
      >
        <Icon as={Trash2} size="sm" tint={colors.destructive} />
      </Pressable>
    </HStack>
  );
});

LoggedRow.displayName = 'LoggedRow';

interface Props {
  slot: MealSlot;
  /** What is already logged in this meal, on the day being shown. */
  entries: FoodEntry[];
  /** Takes a food back out of the diary — not out of the draft. */
  onRemove: (id: string) => void;
}

/**
 * What is already in this meal, on the day being shown.
 *
 * Its own card, above the draft, and never merged with it: one list is the
 * diary and the other is a plate being assembled, and the difference matters
 * at the moment the user taps the bin. Taking a row off here deletes what was
 * eaten; taking one off the draft below only changes their mind about what
 * they are about to log. A single list with two meanings for one gesture is
 * how somebody loses yesterday's lunch.
 *
 * It exists because "Added Foods (0)" on a meal that already holds two foods
 * reads as the app having forgotten them. The count was always the draft's,
 * which is true and not what anybody asks the screen.
 */
export const LoggedFoodsCard = memo(({ slot, entries, onRemove }: Props) => {
  const { label, emoji } = MEAL_STYLE[slot];
  const calories = entries.reduce((sum, entry) => sum + entry.calories, 0);

  if (entries.length === 0) {
    return null;
  }

  return (
    <VStack gap="sm">
      <HStack align="center" gap="sm">
        <Emoji size="sm">{emoji}</Emoji>
        <AppText variant="h3">{`Already in ${label}`}</AppText>
        <HStack flex={1} align="center" justify="end">
          <Chip label={`${formatGrouped(Math.round(calories))} kcal`} />
        </HStack>
      </HStack>

      <Card radius="xl" padding="base">
        <VStack>
          {entries.map((entry, index) => (
            <Fragment key={entry.id}>
              {index > 0 ? <Divider /> : null}
              <LoggedRow entry={entry} onRemove={onRemove} />
            </Fragment>
          ))}
        </VStack>
      </Card>

      <AppText variant="miniMicro" color="textTertiary">
        Already saved to your diary. Anything you add below is on top of this.
      </AppText>
    </VStack>
  );
});

LoggedFoodsCard.displayName = 'LoggedFoodsCard';
