import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { FoodSuggestion } from '../../types/models';
import { formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { FoodGlyph } from '../meal/FoodGlyph';

interface RowProps {
  suggestion: FoodSuggestion;
  onPress: (suggestion: FoodSuggestion) => void;
}

const SuggestionRow = memo(({ suggestion, onPress }: RowProps) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(suggestion), [onPress, suggestion]);
  const { food } = suggestion;

  return (
    <Pressable
      onPress={press}
      feedback="highlight"
      accessibilityRole="button"
      accessibilityLabel={`Add ${food.name}, ${food.portion}, ${Math.round(
        food.calories,
      )} calories. ${suggestion.reason}`}
    >
      <HStack align="center" gap="md" py="sm">
        <FoodGlyph
          imageUrl={food.imageUrl}
          emoji={food.emoji}
          size={moderateScale(38)}
        />

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {food.name}
          </AppText>
          <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
            {food.portion}
          </AppText>
        </VStack>

        <AppText variant="micro" style={{ color: colors.success }}>
          {`${formatGrouped(Math.round(food.calories))} kcal`}
        </AppText>
      </HStack>
    </Pressable>
  );
});

SuggestionRow.displayName = 'SuggestionRow';

interface Props {
  /** Why these, in the member's own figures. Shared by every row. */
  reason: string | null;
  /** Why there are none, where there are none. */
  note: string | null;
  suggestions: FoodSuggestion[];
  onPressSuggestion: (suggestion: FoodSuggestion) => void;
}

/**
 * What to eat next, and why (RULES N12).
 *
 * The reason sits at the top, once, rather than on every row: the server
 * answers one gap at a time, so repeating "72g of protein still to go"
 * five times would be five copies of a single sentence. What belongs on
 * the rows is what differs between them — the food, its portion and what
 * it costs against the day.
 *
 * When there is nothing to suggest the card says why and stays. A shelf
 * that simply disappeared on the day somebody met their goal would read
 * as the feature breaking, exactly when it had in fact worked.
 */
export const SuggestionsCard = memo(
  ({ reason, note, suggestions, onPressSuggestion }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <VStack gap="sm">
          <HStack align="center" gap="sm">
            <Icon as={Sparkles} size="sm" tint={colors.success} />
            <AppText variant="label" color="textSecondary" numberOfLines={1}>
              What to eat next
            </AppText>
          </HStack>

          {reason !== null && suggestions.length > 0 ? (
            <AppText variant="caption" color="textSecondary">
              {reason}
            </AppText>
          ) : null}

          {suggestions.length === 0 ? (
            <AppText variant="caption" color="textSecondary" style={styles.note}>
              {note ?? 'Nothing to suggest just now.'}
            </AppText>
          ) : (
            <VStack>
              {suggestions.map((suggestion, index) => (
                <React.Fragment key={suggestion.food.id}>
                  {index > 0 ? <Divider /> : null}
                  <SuggestionRow
                    suggestion={suggestion}
                    onPress={onPressSuggestion}
                  />
                </React.Fragment>
              ))}
            </VStack>
          )}
        </VStack>
      </Card>
    );
  },
);

SuggestionsCard.displayName = 'SuggestionsCard';

const styles = StyleSheet.create({
  note: { paddingVertical: moderateScale(4) },
});
