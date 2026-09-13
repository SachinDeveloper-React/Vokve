import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import type { MealSlot } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { MEAL_STYLE } from '../nutrition/nutritionLabels';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

const SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

interface TileProps {
  slot: MealSlot;
  selected: boolean;
  onPress: (slot: MealSlot) => void;
}

const SlotTile = memo(({ slot, selected, onPress }: TileProps) => {
  const { colors, isDark } = useTheme();
  const press = useCallback(() => onPress(slot), [onPress, slot]);
  const { label, emoji } = MEAL_STYLE[slot];

  return (
    <Pressable
      onPress={press}
      feedback="scale"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={styles.press}
    >
      <VStack
        align="center"
        gap="xs"
        py="md"
        px="xs"
        style={[
          styles.tile,
          {
            borderColor: selected ? colors.success : colors.border,
            backgroundColor: selected
              ? withAlpha(colors.success, isDark ? 0.18 : 0.1)
              : colors.card,
          },
        ]}
      >
        <Emoji size="sm">{emoji}</Emoji>
        <AppText
          variant="miniMicro"
          center
          numberOfLines={1}
          style={{ color: selected ? colors.success : colors.textSecondary }}
        >
          {label}
        </AppText>
      </VStack>
    </Pressable>
  );
});

SlotTile.displayName = 'SlotTile';

interface Props {
  value: MealSlot;
  onChange: (slot: MealSlot) => void;
  onPressCustom: () => void;
}

/**
 * Which meal the food is going into.
 *
 * The fifth tile is not a fifth meal: it adds a food the library does not
 * carry, which is what its plus promises. A meal called "Custom" would be a
 * slot nothing else in the app — the diet plan, the nutrition summary, the
 * reminders — knows how to show.
 */
export const MealSlotPicker = memo(({ value, onChange, onPressCustom }: Props) => {
  const { colors } = useTheme();

  return (
    <HStack align="stretch" gap="sm">
      {SLOTS.map(slot => (
        <SlotTile
          key={slot}
          slot={slot}
          selected={slot === value}
          onPress={onChange}
        />
      ))}

      <Pressable
        onPress={onPressCustom}
        feedback="scale"
        accessibilityRole="button"
        accessibilityLabel="Add a custom food"
        style={styles.press}
      >
        <VStack
          align="center"
          gap="xs"
          py="md"
          px="xs"
          style={[
            styles.tile,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Icon as={Plus} size="sm" color="text" />
          <AppText variant="miniMicro" color="textSecondary" center numberOfLines={1}>
            Custom
          </AppText>
        </VStack>
      </Pressable>
    </HStack>
  );
});

MealSlotPicker.displayName = 'MealSlotPicker';

const styles = StyleSheet.create({
  press: { flex: 1 },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
