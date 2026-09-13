import React, { Fragment, memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Delete, Plus } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { MacroStrip } from './MacroStrip';

/** One food on the draft meal, before it is saved. */
export interface DraftFood {
  /** Unique to this draft row, so two bananas can be removed separately. */
  key: string;
  name: string;
  portion: string;
  emoji: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  fiberG: number;
}

interface RowProps {
  food: DraftFood;
  onRemove: (key: string) => void;
}

const AddedFoodRow = memo(({ food, onRemove }: RowProps) => {
  const { colors } = useTheme();
  const remove = useCallback(() => onRemove(food.key), [food.key, onRemove]);

  return (
    <VStack gap="sm" py="sm">
      <HStack align="center" gap="md">
        <Emoji size="sm">{food.emoji}</Emoji>

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {food.name}
          </AppText>
          {food.portion ? (
            <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
              {food.portion}
            </AppText>
          ) : null}
        </VStack>

        <AppText
          variant="bodyStrong"
          numberOfLines={1}
          style={{ color: colors.success }}
        >
          {`${Math.round(food.calories)} kcal`}
        </AppText>

        <Pressable
          onPress={remove}
          feedback="opacity"
          visualSize={20}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${food.name}`}
        >
          <Icon as={Delete} size="sm" tint={colors.destructive} />
        </Pressable>
      </HStack>

      <MacroStrip macros={food} />
    </VStack>
  );
});

AddedFoodRow.displayName = 'AddedFoodRow';

interface Props {
  foods: DraftFood[];
  onRemove: (key: string) => void;
  onPressAddAnother: () => void;
}

/**
 * The meal being built, before it is saved.
 *
 * A draft rather than a running write to the diary: a user assembling a meal
 * adds the wrong thing, removes it, and changes the portion, and a screen that
 * logged each of those would leave the day's history full of corrections.
 * Nothing here reaches the store until Save Meal.
 */
export const AddedFoodsCard = memo(
  ({ foods, onRemove, onPressAddAnother }: Props) => {
    const { colors, isDark } = useTheme();

    return (
      <VStack gap="sm">
        <AppText variant="h3">{`Added Foods (${foods.length})`}</AppText>

        <Card radius="xl" padding="base">
          <VStack gap="sm">
            {foods.length === 0 ? (
              <AppText variant="micro" color="textSecondary">
                Nothing added yet — search above, or tap one of the quick adds.
              </AppText>
            ) : (
              <VStack>
                {foods.map((food, index) => (
                  <Fragment key={food.key}>
                    {index > 0 ? <Divider /> : null}
                    <AddedFoodRow food={food} onRemove={onRemove} />
                  </Fragment>
                ))}
              </VStack>
            )}

            <Pressable
              onPress={onPressAddAnother}
              feedback="opacity"
              accessibilityRole="button"
              accessibilityLabel="Add another food"
            >
              <HStack
                align="center"
                justify="center"
                gap="xs"
                py="md"
                style={[
                  styles.add,
                  {
                    borderColor: colors.avatarPurple,
                    backgroundColor: withAlpha(
                      colors.avatarPurple,
                      isDark ? 0.16 : 0.07,
                    ),
                  },
                ]}
              >
                <Icon as={Plus} size="sm" tint={colors.avatarPurple} />
                <AppText variant="micro" style={{ color: colors.avatarPurple }}>
                  Add Another Food
                </AppText>
              </HStack>
            </Pressable>
          </VStack>
        </Card>
      </VStack>
    );
  },
);

AddedFoodsCard.displayName = 'AddedFoodsCard';

const styles = StyleSheet.create({
  add: { borderRadius: radius.lg, borderWidth: 1 },
});
