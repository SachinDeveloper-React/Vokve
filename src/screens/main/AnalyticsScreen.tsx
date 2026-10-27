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
import { StepsInsightsSheet } from '../../components/analytics/StepsInsightsSheet';
import {
  StepsOverviewCard,
  type OverviewPoint,
} from '../../components/analytics/StepsOverviewCard';
import { StepsSummaryCard } from '../../components/analytics/StepsSummaryCard';
import { WeeklyTrendCard } from '../../components/analytics/WeeklyTrendCard';
import { StaleFigures } from '../../components/feedback';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { HStack } from '../../components/layout/Stack';
import { Screen } from '../../components/ui/Screen';
import { useActivityDay, useActivityRange } from '../../hooks/useActivity';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import type { ActivityRangeQuery } from '../../services/api/contracts';
import { useCurrentUser } from '../../stores/authStore';
import { useDailyStepGoal } from '../../stores/settingsStore';
import { useTodaySteps, verifiedActivityOf } from '../../stores/stepsStore';
import { useStreakStore, useStreakSummary } from '../../stores/streakStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { ActivityRangePoint } from '../../types/models';
import {
  addDays,
  formatDateRange,
  formatDayNumberRange,
  formatLongDate,
  formatMonthShort,
  formatMonthYear,
  formatWeekdayDate,
  formatWeekdayDay,
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

/**
 * What each bar is called, from the point the server drew it for.
 *
 * Every label carries its own date: "Mon 20" rather than "Mon", and the days
 * a month's week covers ("8–14") rather than "W2". A bar labelled only by
 * its weekday is readable as a shape and unreadable as a figure — which week
 * it belongs to is exactly what a user comes to this screen to find out. The
 * hours of a single day and the months of a year are already unambiguous
 * under a caption that names the day or the year.
 */
function labelFor(
  range: AnalyticsRange,
  point: ActivityRangePoint,
  index: number,
): string {
  switch (range) {
    case 'week':
      return formatWeekdayDay(point.start);
    case 'month':
      return formatDayNumberRange(point.start, point.end);
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
  const [isInsightsOpen, setInsightsOpen] = useState(false);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const openInsights = useCallback(() => setInsightsOpen(true), []);
  const closeInsights = useCallback(() => setInsightsOpen(false), []);

  const isToday = date === todayIso();
  // Every step figure on this screen is the verified part of the server's
  // day, never the whole count a phone sent (see `verifiedActivityOf`).
  // The day's read is also what dates this screen: every figure below comes
  // from it or from the range reads beside it, which are refreshed together.
  const dayRead = useActivityDay(date);
  const day = verifiedActivityOf(dayRead.data);
  const previous = useActivityDay(addDays(date, -1)).data;
  const today = useTodaySteps();

  // The week always — its best day and its trend have cards of their own,
  // whatever the range shows — and the chart's own period.
  const weekQuery = useMemo(() => queryFor('week', date), [date]);
  const chartQuery = useMemo(() => queryFor(range, date), [range, date]);
  const week = useActivityRange(weekQuery).data;
  const chart = useActivityRange(chartQuery).data;

  const weekSteps = useMemo(
    () =>
      (week?.points ?? []).map(point => ({
        // Dated, so the trend's bars and the week's best day each say which
        // day they mean rather than only which weekday.
        day: formatWeekdayDay(point.start),
        date: point.start,
        steps: point.verifiedSteps,
      })),
    [week],
  );

  // The trend card draws the week whatever range the chart is on, so it is
  // dated from the week's own query rather than from the chart's caption.
  const weekCaption = useMemo(() => {
    const span = formatDateRange(weekQuery.from, weekQuery.to);
    return weekQuery.from === mondayOf(todayIso())
      ? `This week · ${span}`
      : span;
  }, [weekQuery]);

  const { points, caption, labelEvery } = useMemo<{
    points: OverviewPoint[];
    caption: string;
    labelEvery: number;
  }>(() => {
    const drawn = (chart?.points ?? []).map((point, index) => ({
      label: labelFor(range, point, index),
      steps: point.verifiedSteps,
    }));
    const isCurrent = (from: IsoDate) =>
      from === queryFor(range, todayIso()).from;
    // Every caption names the dates the bars cover, the current period
    // included: "This week" on its own leaves the reader counting back from
    // today to work out which Monday it started on, and the sheet behind
    // "View Insights" reads the same line over the same figures.
    switch (range) {
      case 'week': {
        const span = formatDateRange(chartQuery.from, chartQuery.to);
        return {
          points: drawn,
          caption: isCurrent(chartQuery.from)
            ? `This week · ${span}, day by day`
            : `${span}, day by day`,
          labelEvery: 1,
        };
      }
      case 'month': {
        const anchor = fromIsoDate(date);
        const month = formatMonthYear(anchor.getFullYear(), anchor.getMonth());
        return {
          points: drawn,
          caption: isCurrent(chartQuery.from)
            ? `This month · ${month}, week by week`
            : `${month}, week by week`,
          labelEvery: 1,
        };
      }
      case 'year': {
        const year = date.slice(0, 4);
        return {
          points: drawn,
          caption: isCurrent(chartQuery.from)
            ? `This year · ${year}, month by month`
            : `${year}, month by month`,
          labelEvery: 1,
        };
      }
      default:
        return {
          points: drawn,
          caption: isToday
            ? `Today · ${formatLongDate(date)}, hour by hour`
            : `${formatLongDate(date)}, hour by hour`,
          labelEvery: HOUR_LABEL_STEP,
        };
    }
  }, [chart, chartQuery.from, chartQuery.to, date, isToday, range]);

  const bestDay = useMemo(
    () =>
      weekSteps.reduce<{ day: string; date: string; steps: number } | null>(
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

  // The AI report has no screen yet. Wired as a no-op rather than left off, so
  // the control keeps the shape it will ship with and only the handler changes
  // when its screen lands.
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

        <StaleFigures at={dayRead.cachedAt} stale={dayRead.isStale} />

        <StepsSummaryCard
          steps={day.steps}
          goal={goal}
          previousSteps={previous ? verifiedActivityOf(previous).steps : null}
          comparedWith={isToday ? 'yesterday' : 'the day before'}
          caloriesBurned={day.caloriesBurned}
          distanceKm={day.distanceKm}
          activeMinutes={day.activeMinutes}
          onPressReport={notImplemented}
        />

        <StepsOverviewCard
          points={points}
          caption={caption}
          labelEvery={labelEvery}
          onPressInsights={openInsights}
        />

        <HStack align="stretch" gap="md">
          <AnalyticsHighlightCard
            label="Top Achievement"
            headline="Best Day This Week"
            value={`${formatGrouped(bestDay?.steps ?? 0)} steps`}
            caption={
              bestDay
                ? `${formatWeekdayDate(
                    bestDay.date,
                  )} — your highest count of the week`
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

        <WeeklyTrendCard data={weekSteps} caption={weekCaption} />

        <AnalyticsCheerCard name={user?.name} steps={today.shown} goal={goal} />
      </ScrollView>

      <CalendarSheet
        visible={isCalendarOpen}
        value={date}
        onChange={setDate}
        onClose={closeCalendar}
        title="Show analytics for"
      />

      <StepsInsightsSheet
        visible={isInsightsOpen}
        onClose={closeInsights}
        range={range}
        caption={caption}
        points={points}
        totals={chart?.totals ?? null}
        goal={goal}
      />
    </Screen>
  );
};
