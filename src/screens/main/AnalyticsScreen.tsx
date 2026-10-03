import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AnalyticsCheerCard } from '../../components/analytics/AnalyticsCheerCard';
import { AnalyticsHeader } from '../../components/analytics/AnalyticsHeader';
import { AnalyticsHighlightCard } from '../../components/analytics/AnalyticsHighlightCard';
import {
  AnalyticsRangeFilter,
  type AnalyticsRange,
} from '../../components/analytics/AnalyticsRangeFilter';
import {
  StepsOverviewCard,
  type OverviewPoint,
} from '../../components/analytics/StepsOverviewCard';
import { StepsSummaryCard } from '../../components/analytics/StepsSummaryCard';
import { WeeklyTrendCard } from '../../components/analytics/WeeklyTrendCard';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { HStack } from '../../components/layout/Stack';
import { Screen } from '../../components/ui/Screen';
import { useActivityDay, useActivityRange } from '../../hooks/useActivity';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import type { ActivityRangeQuery } from '../../services/api/contracts';
import { useCurrentUser } from '../../stores/authStore';
import { useDailyStepGoal } from '../../stores/settingsStore';
import { useTodayActivity } from '../../stores/stepsStore';
import { useStreakStore, useStreakSummary } from '../../stores/streakStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { ActivityRangePoint } from '../../types/models';
import {
  addDays,
  formatLongDate,
  formatMonthShort,
  formatMonthYear,
  formatWeekdayShort,
  fromIsoDate,
  mondayOf,
  monthBounds,
  todayIso,
  type IsoDate,
} from '../../utils/date';
import { formatGrouped } from '../../utils/format';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** How many hours apart the overview's axis labels are drawn. */
const HOUR_LABEL_STEP = 4;

/** "12 AM", "4 AM", "12 PM" — the axis under a day of hourly bars. */
function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12} ${suffix}`;
}

/** The server query behind each range, for the period `date` falls in. */
function queryFor(range: AnalyticsRange, date: IsoDate): ActivityRangeQuery {
  switch (range) {
    case 'week': {
      const monday = mondayOf(date);
      return { from: monday, to: addDays(monday, 6), granularity: 'day' };
    }
    case 'month': {
      // Weekly buckets from the 1st — days 1–7, 8–14 and so on, so the last
      // is a short W5. A month of daily bars is thirty columns on a 375pt
      // screen, which is a texture rather than a chart.
      const { first, last } = monthBounds(date);
      return { from: first, to: last, granularity: 'week' };
    }
    case 'year': {
      const year = date.slice(0, 4);
      return {
        from: `${year}-01-01`,
        to: `${year}-12-31`,
        granularity: 'month',
      };
    }
    default:
      return { from: date, to: date, granularity: 'hour' };
  }
}

/** What each bar is called, from the point the server drew it for. */
function labelFor(
  range: AnalyticsRange,
  point: ActivityRangePoint,
  index: number,
): string {
  switch (range) {
    case 'week':
      return formatWeekdayShort(point.start);
    case 'month':
      return `W${index + 1}`;
    case 'year':
      return formatMonthShort(point.start);
    default:
      return hourLabel(index);
  }
}

/**
 * Steps, analysed: the chosen day's count against the goal, the period's
 * shape, and the two figures worth knowing about the week.
 *
 * The date anchors everything: the summary is that day's, and the chart is
 * the day, week, month or year it falls in. The range control drives the
 * chart and nothing else. The card above it is a daily readout — it is
 * headed "Total Steps" beside "Daily Goal" — and having a D/W/M/Y switch
 * silently change what the day meant would make the biggest number on the
 * screen the least trustworthy one. The chart says which period it is
 * drawing under its own title instead.
 *
 * Every figure is the server's (`/activity/day`, `/activity/range`), read
 * again whenever a sync lands — the same numbers the dashboard shows.
 */
export const AnalyticsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();

  const goal = useDailyStepGoal();
  const streakSummary = useStreakSummary();
  useRefreshOnFocus(useStreakStore.getState().refreshIfStale);

  const [range, setRange] = useState<AnalyticsRange>('day');
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [isCalendarOpen, setCalendarOpen] = useState(false);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);

  const isToday = date === todayIso();
  const day = useActivityDay(date).data;
  const previous = useActivityDay(addDays(date, -1)).data;
  const today = useTodayActivity();

  // The week always — its best day and its trend have cards of their own,
  // whatever the range shows — and the chart's own period.
  const weekQuery = useMemo(() => queryFor('week', date), [date]);
  const chartQuery = useMemo(() => queryFor(range, date), [range, date]);
  const week = useActivityRange(weekQuery).data;
  const chart = useActivityRange(chartQuery).data;

  const weekSteps = useMemo(
    () =>
      (week?.points ?? []).map(point => ({
        day: formatWeekdayShort(point.start),
        steps: point.steps,
      })),
    [week],
  );

  const { points, caption, axisLabels } = useMemo<{
    points: OverviewPoint[];
    caption: string;
    axisLabels: string[];
  }>(() => {
    const drawn = (chart?.points ?? []).map((point, index) => ({
      label: labelFor(range, point, index),
      steps: point.steps,
    }));
    const isCurrent = (from: IsoDate) =>
      from === queryFor(range, todayIso()).from;
    switch (range) {
      case 'week':
        return {
          points: drawn,
          caption: isCurrent(chartQuery.from)
            ? 'This week, day by day'
            : `Week of ${formatLongDate(chartQuery.from)}, day by day`,
          axisLabels: ['Mon', 'Sun'],
        };
      case 'month': {
        const anchor = fromIsoDate(date);
        return {
          points: drawn,
          caption: isCurrent(chartQuery.from)
            ? 'This month, week by week'
            : `${formatMonthYear(
                anchor.getFullYear(),
                anchor.getMonth(),
              )}, week by week`,
          axisLabels: drawn.map(point => point.label),
        };
      }
      case 'year':
        return {
          points: drawn,
          caption: isCurrent(chartQuery.from)
            ? 'This year, month by month'
            : `${date.slice(0, 4)}, month by month`,
          axisLabels: ['Jan', 'Apr', 'Jul', 'Oct', 'Dec'],
        };
      default:
        return {
          points: drawn,
          caption: isToday
            ? 'Today, hour by hour'
            : `${formatLongDate(date)}, hour by hour`,
          axisLabels: Array.from({ length: 24 / HOUR_LABEL_STEP }, (_, index) =>
            hourLabel(index * HOUR_LABEL_STEP),
          ),
        };
    }
  }, [chart, chartQuery.from, date, isToday, range]);

  const bestDay = useMemo(
    () =>
      weekSteps.reduce<{ day: string; steps: number } | null>(
        (best, entry) => (entry.steps > (best?.steps ?? 0) ? entry : best),
        null,
      ),
    [weekSteps],
  );

  // The streak and the milestone it is working towards are the server's.
  const streak = streakSummary?.currentStreak ?? null;
  const nextMilestone = streakSummary?.nextMilestone ?? null;
  const toNext =
    streak !== null && nextMilestone ? nextMilestone.days - streak : null;

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  // The AI report and the insights breakdown have no screens yet. Wired as
  // no-ops rather than left off, so each control keeps the shape it will ship
  // with and only the handler changes when its screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <AnalyticsHeader onPressBack={onPressBack} />

        <AnalyticsRangeFilter
          date={date}
          value={range}
          onChange={setRange}
          onPressDate={openCalendar}
        />

        <StepsSummaryCard
          steps={day?.steps ?? 0}
          goal={goal}
          previousSteps={previous?.steps ?? null}
          comparedWith={isToday ? 'yesterday' : 'the day before'}
          caloriesBurned={day?.caloriesBurned ?? 0}
          distanceKm={day?.distanceKm ?? 0}
          activeMinutes={day?.activeMinutes ?? 0}
          onPressReport={notImplemented}
        />

        <StepsOverviewCard
          points={points}
          caption={caption}
          axisLabels={axisLabels}
          onPressInsights={notImplemented}
        />

        <HStack align="stretch" gap="md">
          <AnalyticsHighlightCard
            label="Top Achievement"
            headline="Best Day This Week"
            value={`${formatGrouped(bestDay?.steps ?? 0)} steps`}
            caption={
              bestDay
                ? `${bestDay.day} — your highest count of the week`
                : 'No steps counted this week yet'
            }
            tint={colors.success}
          />

          <AnalyticsHighlightCard
            label="Streak"
            headline={`${streak === 1 ? 'day' : 'days'} in a row`}
            value={
              streak === null
                ? '—'
                : `${streak} ${streak === 1 ? 'Day' : 'Days'}`
            }
            caption={
              streak === null
                ? 'Your streak is on its way.'
                : toNext === null
                ? 'Every milestone reached. Keep it rolling!'
                : `Keep it up! ${toNext} more ${
                    toNext === 1 ? 'day' : 'days'
                  } to ${nextMilestone!.days}`
            }
            tint={colors.primary}
            tintValue
          />
        </HStack>

        <WeeklyTrendCard data={weekSteps} />

        <AnalyticsCheerCard name={user?.name} steps={today.steps} goal={goal} />
      </ScrollView>

      <CalendarSheet
        visible={isCalendarOpen}
        value={date}
        onChange={setDate}
        onClose={closeCalendar}
        title="Show analytics for"
      />
    </Screen>
  );
};
