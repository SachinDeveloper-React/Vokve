import React, { memo } from 'react';
import type { IsoDate } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { DateChip } from '../streak/DateChip';
import { ChipTrack, type Chip } from './ChipTrack';

/** The period the overview chart is drawn over. */
export type AnalyticsRange = 'day' | 'week' | 'month' | 'year';

const RANGES: readonly Chip<AnalyticsRange>[] = [
  { value: 'day', label: 'D', name: 'Day' },
  { value: 'week', label: 'W', name: 'Week' },
  { value: 'month', label: 'M', name: 'Month' },
  { value: 'year', label: 'Y', name: 'Year' },
];

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
 * own. These are the *calendar* periods — the week, month or year the chosen
 * day falls in. The rolling ones ("the last 30 days") belong to the period
 * overview further down, which is why that card carries a track of its own
 * rather than this one growing to seven chips.
 */
export const AnalyticsRangeFilter = memo(
  ({ date, value, onChange, onPressDate }: Props) => (
    <HStack align="center" justify="between" gap="sm">
      <DateChip
        date={date}
        size="sm"
        onPress={onPressDate}
        accessibilityHint="Change the day"
      />

      <ChipTrack chips={RANGES} value={value} onChange={onChange} />
    </HStack>
  ),
);

AnalyticsRangeFilter.displayName = 'AnalyticsRangeFilter';
