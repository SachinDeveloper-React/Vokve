import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import type { IsoDate } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { DateChip } from '../streak/DateChip';

/** The period the day's figures are read against. */
export type NutritionPeriod = 'day' | 'week' | 'month';

const PERIODS: readonly { value: NutritionPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

interface ChipProps {
  value: NutritionPeriod;
  label: string;
  selected: boolean;
  onPress: (value: NutritionPeriod) => void;
}

const PeriodChip = memo(({ value, label, selected, onPress }: ChipProps) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(value), [onPress, value]);

  return (
    <Pressable
      onPress={press}
      feedback="opacity"
      visualSize={28}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <HStack
        align="center"
        justify="center"
        px="md"
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
});

PeriodChip.displayName = 'PeriodChip';

interface Props {
  date?: IsoDate;
  value: NutritionPeriod;
  onChange: (value: NutritionPeriod) => void;
  onPressDate: () => void;
}

/**
 * The day the plate belongs to, and the period its figures are read against.
 *
 * The same row the challenge board and the analytics screen use, and small for
 * the same reason: it qualifies everything under it rather than being a
 * section of its own.
 */
export const NutritionPeriodFilter = memo(
  ({ date, value, onChange, onPressDate }: Props) => {
    const { colors } = useTheme();

    return (
      <HStack align="center" justify="between" gap="sm">
        <DateChip
          date={date}
          size="sm"
          onPress={onPressDate}
          accessibilityHint="Change the day"
        />

        <HStack
          align="center"
          gap="xxs"
          p="xxs"
          style={[styles.track, { backgroundColor: colors.muted }]}
        >
          {PERIODS.map(period => (
            <PeriodChip
              key={period.value}
              value={period.value}
              label={period.label}
              selected={period.value === value}
              onPress={onChange}
            />
          ))}
        </HStack>
      </HStack>
    );
  },
);

NutritionPeriodFilter.displayName = 'NutritionPeriodFilter';

const styles = StyleSheet.create({
  track: { borderRadius: radius.pill },
  chip: { borderRadius: radius.pill },
  label: { fontWeight: '600' },
});
