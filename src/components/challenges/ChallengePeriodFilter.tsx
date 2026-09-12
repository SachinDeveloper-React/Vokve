import React, { memo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import type { ChallengeCadence } from '../../types/models';
import type { IsoDate } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { DateChip } from '../streak/DateChip';
import { ChallengePeriodChip } from './ChallengePeriodChip';

/** The cadence filter's states. `all` is a view of the board, not a cadence. */
export type ChallengePeriod = ChallengeCadence | 'all';

const PERIODS: readonly { value: ChallengePeriod; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

interface Props {
  date?: IsoDate;
  value: ChallengePeriod;
  onChange: (value: ChallengePeriod) => void;
  onPressDate: () => void;
}

/**
 * The day the board is showing, and the cadence it is filtered to.
 *
 * One row rather than two: the date says *when*, the chips say *which*, and
 * they qualify the same two lists below. The chips scroll while the date keeps
 * its width — the date is the longer label and the one that cannot be guessed
 * from a glance, so it is the half that stays whole on a narrow screen.
 *
 * Both halves are drawn small. At the size the date leads the streak screen
 * with, the two of them together are taller than the cards they filter, which
 * makes a control row look like a section of its own.
 */
export const ChallengePeriodFilter = memo(
  ({ date, value, onChange, onPressDate }: Props) => (
    <HStack align="center" gap="sm">
      <DateChip
        date={date}
        size="sm"
        onPress={onPressDate}
        accessibilityHint="Change the day"
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        style={styles.scroller}
      >
        {PERIODS.map(period => (
          <ChallengePeriodChip
            key={period.value}
            value={period.value}
            label={period.label}
            selected={period.value === value}
            onPress={onChange}
          />
        ))}
      </ScrollView>
    </HStack>
  ),
);

ChallengePeriodFilter.displayName = 'ChallengePeriodFilter';

const styles = StyleSheet.create({
  // Takes what the date leaves rather than its content's width, or the row
  // would push the chips off the screen instead of scrolling them.
  scroller: { flex: 1 },
  row: { gap: spacing.xs, alignItems: 'center' },
});
