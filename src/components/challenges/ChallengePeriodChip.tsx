import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import type { ChallengePeriod } from './ChallengePeriodFilter';

interface Props {
  value: ChallengePeriod;
  label: string;
  selected: boolean;
  onPress: (value: ChallengePeriod) => void;
}

/**
 * One chip in the cadence row.
 *
 * The chosen chip inverts — the app's text colour becomes its background —
 * exactly as the notification filter does, so the two rows behave the same way
 * in either theme. No icon and no count here: four one-word labels are already
 * distinct, and a glyph on each would make the row wider than the screen it has
 * to share with the date.
 */
export const ChallengePeriodChip = memo(
  ({ value, label, selected, onPress }: Props) => {
    const { colors } = useTheme();
    const handlePress = useCallback(() => onPress(value), [onPress, value]);

    return (
      <Pressable
        onPress={handlePress}
        feedback="opacity"
        // Under the 44pt floor by design — the row has to fit a date beside
        // four chips — so the target is padded out instead of the pill.
        visualSize={28}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
      >
        <HStack
          align="center"
          px="base"
          py="xs"
          style={[styles.chip, selected && { backgroundColor: colors.text }]}
        >
          <AppText
            variant="micro"
            style={[
              styles.label,
              { color: selected ? colors.card : colors.textSecondary },
            ]}
          >
            {label}
          </AppText>
        </HStack>
      </Pressable>
    );
  },
);

ChallengePeriodChip.displayName = 'ChallengePeriodChip';

const styles = StyleSheet.create({
  chip: { borderRadius: radius.pill },
  label: { fontWeight: '600' },
});
