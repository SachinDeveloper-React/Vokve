import React, { memo, useMemo } from 'react';
import { formatLongDate, toIsoDate, type IsoDate } from '../../utils/date';
import { Grid } from '../layout/Grid';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { CalendarDay, type DayStatus } from './CalendarDay';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Props {
  year: number;
  /** 0-based, as `Date` counts them. */
  month: number;
  completedDays: Set<IsoDate>;
  protectedDays: Set<IsoDate>;
  /** The days of the run that is still going. */
  streakDays: Set<IsoDate>;
  today: IsoDate;
  /**
   * Opens one day. Only the month's own days that have happened are wired to
   * it — a neighbouring month's day is drawn for alignment, and a day still
   * to come has nothing to show.
   */
  onPressDay?: (date: IsoDate) => void;
}

interface Cell {
  iso: IsoDate;
  day: number;
  status: DayStatus;
}

/**
 * Lays a month out Monday-first, padded at both ends with the neighbouring
 * months' days so every row has seven cells and the weekday header lines up.
 */
function cellsFor(
  year: number,
  month: number,
  completed: Set<IsoDate>,
  protectedDays: Set<IsoDate>,
  today: IsoDate,
): Cell[] {
  const first = new Date(year, month, 1);
  // `getDay` is Sunday-first; the row is Monday-first.
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;

  return Array.from({ length: total }, (_, index) => {
    // `Date` normalises a day of 0 or 32 into the neighbouring month.
    const date = new Date(year, month, index - leading + 1);
    const iso = toIsoDate(date);
    const outside = date.getMonth() !== month;

    const status: DayStatus = outside
      ? 'outside'
      : iso > today
      ? 'future'
      : completed.has(iso)
      ? 'completed'
      : protectedDays.has(iso)
      ? 'protected'
      : 'incomplete';

    return { iso, day: date.getDate(), status };
  });
}

/**
 * The month's cells under their weekday header.
 *
 * Neighbouring months' days are drawn, greyed, rather than left as gaps: a
 * row that starts on Thursday with three empty slots before it reads as
 * three days that were missed.
 */
export const CalendarGrid = memo(
  ({
    year,
    month,
    completedDays,
    protectedDays,
    streakDays,
    today,
    onPressDay,
  }: Props) => {
    const cells = useMemo(
      () => cellsFor(year, month, completedDays, protectedDays, today),
      [year, month, completedDays, protectedDays, today],
    );

    return (
      <VStack gap="sm">
        <Grid columns={7} gap="xs">
          {WEEKDAYS.map(day => (
            <AppText key={day} variant="micro" color="textTertiary" center>
              {day}
            </AppText>
          ))}
        </Grid>

        <Grid columns={7} gap="xs">
          {cells.map(cell => (
            <CalendarDay
              key={cell.iso}
              day={cell.day}
              status={cell.status}
              inStreak={cell.status !== 'outside' && streakDays.has(cell.iso)}
              isToday={cell.iso === today}
              accessibilityLabel={formatLongDate(cell.iso)}
              onPress={
                onPressDay === undefined ||
                cell.status === 'outside' ||
                cell.status === 'future'
                  ? undefined
                  : () => onPressDay(cell.iso)
              }
            />
          ))}
        </Grid>
      </VStack>
    );
  },
);

CalendarGrid.displayName = 'CalendarGrid';
