import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import type { IsoDate } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';
import { DateChip } from '../streak/DateChip';

/** The period the overview chart is drawn over. */
export type AnalyticsRange = 'day' | 'week' | 'month' | 'year';

const RANGES: readonly { value: AnalyticsRange; label: string; name: string }[] =
  [
    { value: 'day', label: 'D', name: 'Day' },
    { value: 'week', label: 'W', name: 'Week' },
    { value: 'month', label: 'M', name: 'Month' },
    { value: 'year', label: 'Y', name: 'Year' },
  ];

interface ChipProps {
  value: AnalyticsRange;
  label: string;
  name: string;
  selected: boolean;
  onPress: (value: AnalyticsRange) => void;
}

/**
 * One letter of the range control.
 *
 * A letter is all the design gives it, so the accessibility label carries the
 * word: "D" announced on its own is a letter, not a period of time.
 */
const RangeChip = memo(({ value, label, name, selected, onPress }: ChipProps) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(value), [onPress, value]);

  return (
    <Pressable
      onPress={press}
      feedback="opacity"
      visualSize={28}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
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

RangeChip.displayName = 'RangeChip';

interface Props {
  date?: IsoDate;
  value: AnalyticsRange;
  onChange: (value: AnalyticsRange) => void;
  onPressDate: () => void;
}

/**
 * The day the figures are anchored to, and the period the chart covers.
 *
 * The same shape as the challenge board's filter row, and small for the same
 * reason: it qualifies everything under it rather than being a section of its
 * own.
 */
export const AnalyticsRangeFilter = memo(
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
          {RANGES.map(range => (
            <RangeChip
              key={range.value}
              value={range.value}
              label={range.label}
              name={range.name}
              selected={range.value === value}
              onPress={onChange}
            />
          ))}
        </HStack>
      </HStack>
    );
  },
);

AnalyticsRangeFilter.displayName = 'AnalyticsRangeFilter';

const styles = StyleSheet.create({
  track: { borderRadius: radius.pill },
  chip: { borderRadius: radius.pill },
  label: { fontWeight: '700' },
});
