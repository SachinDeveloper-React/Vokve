import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { formatGrouped } from '../../utils/format';
import { formatLongDate, toIsoDate, type IsoDate } from '../../utils/date';
import { Card } from '../ui/Card';
import { AppText } from '../ui/AppText';
import { Grid } from '../layout/Grid';
import { HStack, VStack } from '../layout/Stack';
import { MonthNav } from '../streak/MonthNav';
import { ActivityCalendarDay, type ActivityLevel } from './ActivityCalendarDay';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Where the washes change, as a share of the day's goal. */
const MID = 0.5;

interface Props {
  year: number;
  /** 0-based, as `Date` counts them. */
  month: number;
  /** Verified steps per day. A day that is absent counted none. */
  stepsByDay: Map<IsoDate, number>;
  goal: number;
  today: IsoDate;
  /** The day the rest of the screen is reading, ringed here. */
  selected?: IsoDate;
  onPressDay: (date: IsoDate) => void;
  onPrevious: () => void;
  onNext: () => void;
  canGoNext: boolean;
}

interface Cell {
  iso: IsoDate;
  day: number;
  steps: number;
  level: ActivityLevel;
}

/**
 * Lays the month out Monday-first, padded at both ends with the neighbouring
 * months' days so every row has seven cells under the weekday header.
 */
function cellsFor(
  year: number,
  month: number,
  stepsByDay: Map<IsoDate, number>,
  goal: number,
  today: IsoDate,
): Cell[] {
  const first = new Date(year, month, 1);
  // `getDay` is Sunday-first; the row is Monday-first.
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;
  const safeGoal = Math.max(1, goal);

  return Array.from({ length: total }, (_, index) => {
    // `Date` normalises a day of 0 or 32 into the neighbouring month.
    const date = new Date(year, month, index - leading + 1);
    const iso = toIsoDate(date);
    const steps = stepsByDay.get(iso) ?? 0;
    const share = steps / safeGoal;

    const level: ActivityLevel =
      date.getMonth() !== month
        ? 'outside'
        : iso > today
        ? 'future'
        : steps === 0
        ? 'none'
        : share >= 1
        ? 'met'
        : share >= MID
        ? 'mid'
        : 'low';

    return { iso, day: date.getDate(), steps, level };
  });
}

/** "27 October 2026, 8,420 steps, goal met" — the whole cell, spoken. */
function spokenFor(cell: Cell, goal: number): string {
  const date = formatLongDate(cell.iso);
  if (cell.level === 'outside' || cell.level === 'future') return date;
  if (cell.level === 'none') return `${date}, no steps counted`;
  const met = cell.steps >= Math.max(1, goal) ? ', goal met' : '';
  return `${date}, ${formatGrouped(cell.steps)} steps${met}`;
}

interface SwatchProps {
  level: ActivityLevel;
}

/** One square of the legend, drawn from the same rules as a cell. */
const Swatch = memo(({ level }: SwatchProps) => {
  const { colors, isDark } = useTheme();
  const wash = (light: number, dark: number) =>
    withAlpha(colors.brandAccent, isDark ? dark : light);

  const fill =
    level === 'met'
      ? colors.brandAccent
      : level === 'mid'
      ? wash(0.42, 0.5)
      : level === 'low'
      ? wash(0.16, 0.24)
      : colors.muted;

  return <View style={[styles.swatch, { backgroundColor: fill }]} />;
});

Swatch.displayName = 'Swatch';

/**
 * A month of days, each weighted by how far it got towards the goal.
 *
 * The screen's other figures all answer "how much?"; this answers "how
 * often?", which is the question a run of good days and a run of bad ones
 * only shows up in. A month laid out as a calendar rather than as thirty bars
 * is what makes the pattern legible: weekends land in the same two columns
 * every row, so "I stop walking at weekends" is something the grid states and
 * a bar chart hides.
 *
 * Every day that has happened is a button on to that day. The rest of the
 * screen re-anchors to whichever is pressed, so the calendar is the way
 * around the month and the summary above it is what you arrive at.
 */
export const ActivityCalendarCard = memo(
  ({
    year,
    month,
    stepsByDay,
    goal,
    today,
    selected,
    onPressDay,
    onPrevious,
    onNext,
    canGoNext,
  }: Props) => {
    const cells = useMemo(
      () => cellsFor(year, month, stepsByDay, goal, today),
      [year, month, stepsByDay, goal, today],
    );

    const met = cells.filter(cell => cell.level === 'met').length;
    const counted = cells.filter(
      cell => cell.level !== 'outside' && cell.level !== 'future',
    ).length;

    return (
      <Card elevation="low" radius="xl">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <VStack gap="xxs">
              <AppText variant="label" color="textSecondary">
                Activity Calendar
              </AppText>
              <AppText variant="micro" color="textTertiary">
                {counted === 0
                  ? 'Nothing counted this month yet'
                  : `Goal met on ${met} of ${counted} days`}
              </AppText>
            </VStack>

            <MonthNav
              year={year}
              month={month}
              onPrevious={onPrevious}
              onNext={onNext}
              canGoNext={canGoNext}
            />
          </HStack>

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
                <ActivityCalendarDay
                  key={cell.iso}
                  day={cell.day}
                  level={cell.level}
                  isToday={cell.iso === today}
                  selected={cell.iso === selected}
                  accessibilityLabel={spokenFor(cell, goal)}
                  onPress={
                    cell.level === 'outside' || cell.level === 'future'
                      ? undefined
                      : () => onPressDay(cell.iso)
                  }
                />
              ))}
            </Grid>
          </VStack>

          {/*
            The key is spelled out because the washes are a ranking, not a
            scale: without it the only honest reading of a mid tone is "more
            than a pale one", which is not enough to act on.
          */}
          <HStack align="center" gap="xs" wrap accessibilityRole="text" accessibilityLabel={`Darker is more steps. A solid square is the ${formatGrouped(goal)} step goal met.`}>
            <AppText variant="miniMicro" color="textTertiary">
              Less
            </AppText>
            <Swatch level="none" />
            <Swatch level="low" />
            <Swatch level="mid" />
            <Swatch level="met" />
            <AppText variant="miniMicro" color="textTertiary">
              Goal met
            </AppText>
          </HStack>
        </VStack>
      </Card>
    );
  },
);

ActivityCalendarCard.displayName = 'ActivityCalendarCard';

const styles = StyleSheet.create({
  swatch: {
    width: moderateScale(10),
    height: moderateScale(10),
    borderRadius: moderateScale(3),
  },
});
