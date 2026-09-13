import React, { Fragment, memo, useCallback } from 'react';
import { Plus } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { FoodItem } from '../../types/models';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

interface RowProps {
  item: FoodItem;
  onAdd: (item: FoodItem) => void;
}

const ResultRow = memo(({ item, onAdd }: RowProps) => {
  const { colors } = useTheme();
  const add = useCallback(() => onAdd(item), [item, onAdd]);

  return (
    <Pressable
      onPress={add}
      feedback="highlight"
      accessibilityRole="button"
      accessibilityLabel={`Add ${item.name}, ${item.portion}, ${item.calories} calories`}
    >
      <HStack align="center" gap="md" py="sm">
        <Emoji size="sm">{item.emoji}</Emoji>

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {item.name}
          </AppText>
          <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
            {item.portion}
          </AppText>
        </VStack>

        <AppText variant="micro" numberOfLines={1} style={{ color: colors.success }}>
          {`${Math.round(item.calories)} kcal`}
        </AppText>

        <Icon as={Plus} size="sm" tint={colors.primary} />
      </HStack>
    </Pressable>
  );
});

ResultRow.displayName = 'ResultRow';

interface Props {
  query: string;
  results: FoodItem[];
  onAdd: (item: FoodItem) => void;
  onPressAddCustom: () => void;
}

/**
 * What the search found, or the way forward when it found nothing.
 *
 * The empty state names what was typed and offers to add it as a custom food.
 * A library this size misses most of what anyone eats, and "no results" with
 * no next step is where a food diary gets abandoned.
 */
export const FoodSearchResults = memo(
  ({ query, results, onAdd, onPressAddCustom }: Props) => (
    <Card radius="xl" padding="base">
      {results.length === 0 ? (
        <VStack gap="sm">
          <AppText variant="micro" color="textSecondary">
            {`Nothing in the library matches "${query.trim()}".`}
          </AppText>

          <Pressable
            onPress={onPressAddCustom}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={`Add ${query.trim()} as a custom food`}
          >
            <AppText variant="micro" color="primary">
              Add it as a custom food
            </AppText>
          </Pressable>
        </VStack>
      ) : (
        <VStack>
          {results.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 ? <Divider /> : null}
              <ResultRow item={item} onAdd={onAdd} />
            </Fragment>
          ))}
        </VStack>
      )}
    </Card>
  ),
);

FoodSearchResults.displayName = 'FoodSearchResults';
