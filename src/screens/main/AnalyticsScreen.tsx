import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ActivityCalendarCard } from '../../components/analytics/ActivityCalendarCard';
import { AnalyticsCheerCard } from '../../components/analytics/AnalyticsCheerCard';
import { AnalyticsHeader } from '../../components/analytics/AnalyticsHeader';
import { AnalyticsHighlightCard } from '../../components/analytics/AnalyticsHighlightCard';
import {
  AnalyticsRangeFilter,
  type AnalyticsRange,
} from '../../components/analytics/AnalyticsRangeFilter';
import { DayDetailSheet } from '../../components/analytics/DayDetailSheet';
import { MostActiveCard } from '../../components/analytics/MostActiveCard';
import {
  PeriodOverviewCard,
  PERIOD_DAYS,
  type AnalyticsPeriod,
} from '../../components/analytics/PeriodOverviewCard';
import { StepsInsightsSheet } from '../../components/analytics/StepsInsightsSheet';
import {
  StepsOverviewCard,
  type OverviewPoint,
} from '../../components/analytics/StepsOverviewCard';
import { StepsSummaryCard } from '../../components/analytics/StepsSummaryCard';
import { WeeklyTrendCard } from '../../components/analytics/WeeklyTrendCard';
import { StaleFigures } from '../../components/feedback';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { ReferralPromoCard } from '../../components/referral/ReferralPromoCard';
import { Screen } from '../../components/ui/Screen';
import { useReferralCard } from '../../hooks/useContent';
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
 * Steps, analysed: the chosen day in full, the period's shape, and what the
 * weeks around it say.
 *
 * The date anchors everything: the summary is that day's, and the chart is
 * the day, week, month or year it falls in. The range control drives the
 * chart and nothing else. The card above it is a daily readout — it is
 * headed "Total Steps" beside "Daily Goal" — and having a D/W/M/Y switch
 * silently change what the day meant would make the biggest number on the
 * screen the least trustworthy one. The chart says which period it is
 * drawing under its own title instead.
 *
 * Below the chart the screen answers the three questions a total cannot.
 * **How much, lately** is the period overview, on rolling 7, 14 and 30-day
 * windows against the same window before it — rolling because "the last
 * thirty days" is the question people ask, where the first of the month is
 * an accident of the calendar. **When** is the most-active card: the window's
 * busiest day and the chosen day's busiest hour. **How often** is the
 * calendar, a month of days weighted by how far each got, where a run of
 * good days and the weekends that break it are a shape rather than a list.
 *
 * Every day that has happened is a way in: pressed in the grid or in the
 * busiest-day row, it re-anchors the screen and opens that day in full. So
 * the screen reads downwards as a summary and is navigated upwards from the
 * calendar, and there is never more than one day being talked about.
 *
 * Every figure is the server's (`/activity/day`, `/activity/range`), read
 * again whenever a sync lands — the same numbers the dashboard shows, and
 * always the verified part of them (`verifiedActivityOf`).
 */
export const AnalyticsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();

  /**
   * The invite card for this screen, as the server wrote it — null where the
   * operator has not put one here, and then nothing is drawn.
   */
  const referralCard = useReferralCard('analytics');
  const onOpenReferral = useCallback(
    () => navigation.navigate('Referral'),
    [navigation],
  );
  const user = useCurrentUser();

  const goal = useDailyStepGoal();
  const streakSummary = useStreakSummary();
  useRefreshOnFocus(useStreakStore.getState().refreshIfStale);

  const [range, setRange] = useState<AnalyticsRange>('day');
  const [period, setPeriod] = useState<AnalyticsPeriod>('7d');
  const [date, setDate] = useState<IsoDate>(todayIso());
  /**
   * The month the calendar is showing, which is not the same thing as the
   * day being read: paging to August to look at it should not move every
   * figure on the screen to August, and picking a day out of the grid should
   * not page the grid away from where the reader is. So the two are separate
   * pieces of state, and only the date chip sets both.
   */
  const [calendarAnchor, setCalendarAnchor] = useState<IsoDate>(todayIso());
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [isInsightsOpen, setInsightsOpen] = useState(false);
  /**
   * The day the detail sheet is showing, which is deliberately **not** the
   * day the screen is anchored to.
   *
   * Opening a day used to move the anchor, which invalidated all five of the
   * screen's reads at once: every card behind the sheet emptied while they
   * were in flight, and the sheet itself opened on a day of zeros because its
   * own figures had not landed either. So the sheet keeps its own day and
   * reads it on its own, nothing else moves, and re-anchoring is a button
   * inside the sheet for a reader who actually wants it.
   */
  const [openDay, setOpenDay] = useState<IsoDate | null>(null);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const openInsights = useCallback(() => setInsightsOpen(true), []);
  const closeInsights = useCallback(() => setInsightsOpen(false), []);
  const closeDay = useCallback(() => setOpenDay(null), []);

  /** The date chip: the whole screen, the calendar included, moves with it. */
  const onPickDate = useCallback((next: IsoDate) => {
    setDate(next);
    setCalendarAnchor(next);
  }, []);

  /** A day pressed in the grid, or the busiest-day row: show it, in place. */
  const onOpenDay = useCallback((next: IsoDate) => setOpenDay(next), []);

  /** "Show this day" inside the sheet: move the whole screen onto it. */
  const onAnchorToOpenDay = useCallback(() => {
    if (openDay === null) return;
    // Read from the closure rather than from inside a `setOpenDay` updater:
    // an updater has to be pure, and React calls it twice in development.
    setDate(openDay);
    setCalendarAnchor(openDay);
    setOpenDay(null);
  }, [openDay]);

  const onPreviousMonth = useCallback(
    () => setCalendarAnchor(current => addDays(monthBounds(current).first, -1)),
    [],
  );
  const onNextMonth = useCallback(
    () => setCalendarAnchor(current => addDays(monthBounds(current).last, 1)),
    [],
  );

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

  // The rolling window the overview totals, the same length of time before
  // it for the comparison, the month the calendar is drawing, and the chosen
  // day by the hour. The hourly read shares its cache key with the chart's
  // when the chart happens to be on D, so the two are one request.
  const periodDays = PERIOD_DAYS[period];
  const periodQuery = useMemo<ActivityRangeQuery>(
    () => ({
      from: addDays(date, -(periodDays - 1)),
      to: date,
      granularity: 'day',
    }),
    [date, periodDays],
  );
  const beforeQuery = useMemo<ActivityRangeQuery>(
    () => ({
      from: addDays(date, -(periodDays * 2 - 1)),
      to: addDays(date, -periodDays),
      granularity: 'day',
    }),
    [date, periodDays],
  );
  const calendarQuery = useMemo<ActivityRangeQuery>(() => {
    const { first, last } = monthBounds(calendarAnchor);
    return { from: first, to: last, granularity: 'day' };
  }, [calendarAnchor]);
  const hourQuery = useMemo<ActivityRangeQuery>(
    () => ({ from: date, to: date, granularity: 'hour' }),
    [date],
  );

  // The sheet's own day, read only once one has been opened: its count, the
  // day before it for the comparison, and its hours for the busiest one.
  const openDayRead = useActivityDay(openDay);
  const openPrevious = useActivityDay(
    openDay === null ? null : addDays(openDay, -1),
  ).data;
  const openHours = useActivityRange(
    openDay === null
      ? null
      : { from: openDay, to: openDay, granularity: 'hour' },
  ).data;

  const periodRange = useActivityRange(periodQuery).data;
  const beforeRange = useActivityRange(beforeQuery).data;
  const calendar = useActivityRange(calendarQuery).data;
  const hours = useActivityRange(hourQuery).data;

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

  /** The window's days, and the three findings read off them. */
  const periodSteps = useMemo(
    () =>
      (periodRange?.points ?? []).map(point => ({
        date: point.start,
        steps: point.verifiedSteps,
      })),
    [periodRange],
  );

  /**
   * The window's totals, cut to the verified share — the same arithmetic
   * `verifiedActivityOf` does for a single day, for the same reason: the
   * server's own totals are of everything a phone counted, and this screen
   * shows nothing it has not verified. The steps figure and the kilometres
   * beside it have to be cut by the same share or the card states a distance
   * that its own step count could not have covered.
   */
  const periodTotals = useMemo(() => {
    const totals = periodRange?.totals;
    if (!totals) return null;
    const share =
      totals.steps > 0 ? Math.min(1, totals.verifiedSteps / totals.steps) : 1;
    return {
      steps: Math.min(totals.steps, totals.verifiedSteps),
      distanceKm: totals.distanceKm * share,
      caloriesBurned: totals.caloriesBurned * share,
      activeMinutes: Math.round(totals.activeMinutes * share),
      activeDays: totals.activeDays,
    };
  }, [periodRange]);

  const goalDays = useMemo(
    () => periodSteps.filter(entry => entry.steps >= Math.max(1, goal)).length,
    [goal, periodSteps],
  );

  // A day of no steps never becomes the best one, so a window with nothing
  // in it stays null and the card says so rather than naming a day at zero.
  const mostActiveDay = useMemo(
    () =>
      periodSteps.reduce<{ date: IsoDate; steps: number } | null>(
        (best, entry) => (entry.steps > (best?.steps ?? 0) ? entry : best),
        null,
      ),
    [periodSteps],
  );

  /**
   * A day's busiest hour, off the hourly series: the index *is* the hour, as
   * `/activity/range` draws it. Used for the day on screen and again for the
   * day in the sheet, which is why it is a function rather than one memo.
   */
  const peakHourOf = useCallback(
    (hourly: ActivityRangePoint[] | undefined) =>
      (hourly ?? []).reduce<{ hour: number; steps: number } | null>(
        (top, point, hour) =>
          point.verifiedSteps > (top?.steps ?? 0)
            ? { hour, steps: point.verifiedSteps }
            : top,
        null,
      ),
    [],
  );

  const peakHour = useMemo(
    () => peakHourOf(hours?.points),
    [hours, peakHourOf],
  );
  const openPeakHour = useMemo(
    () => peakHourOf(openHours?.points),
    [openHours, peakHourOf],
  );

  const stepsByDay = useMemo(
    () =>
      new Map(
        (calendar?.points ?? []).map(
          point => [point.start, point.verifiedSteps] as const,
        ),
      ),
    [calendar],
  );

  const calendarMonth = useMemo(() => {
    const anchor = fromIsoDate(calendarAnchor);
    return { year: anchor.getFullYear(), month: anchor.getMonth() };
  }, [calendarAnchor]);

  /** Nothing to see past this month, so the grid stops there. */
  const canGoNextMonth = useMemo(
    () => monthBounds(calendarAnchor).first < monthBounds(todayIso()).first,
    [calendarAnchor],
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

        <ReferralPromoCard
          card={referralCard}
          at="top"
          onPress={onOpenReferral}
        />

        <StepsSummaryCard
          steps={day.steps}
          goal={goal}
          previousSteps={previous ? verifiedActivityOf(previous).steps : null}
          comparedWith={isToday ? 'yesterday' : 'the day before'}
          caloriesBurned={day.caloriesBurned}
          distanceKm={day.distanceKm}
          activeMinutes={day.activeMinutes}
        />

        <StepsOverviewCard
          points={points}
          caption={caption}
          labelEvery={labelEvery}
          onPressInsights={openInsights}
        />

        <PeriodOverviewCard
          value={period}
          onChange={setPeriod}
          caption={formatDateRange(periodQuery.from, periodQuery.to)}
          totals={periodTotals}
          goalDays={goalDays}
          previousSteps={beforeRange?.totals.verifiedSteps ?? null}
        />

        <MostActiveCard
          day={mostActiveDay}
          dayWithin={`the last ${periodDays} days`}
          hour={peakHour}
          hourOn={formatWeekdayDate(date)}
          onPressDay={onOpenDay}
        />

        <ReferralPromoCard
          card={referralCard}
          at="middle"
          onPress={onOpenReferral}
        />

        <ActivityCalendarCard
          year={calendarMonth.year}
          month={calendarMonth.month}
          stepsByDay={stepsByDay}
          goal={goal}
          today={todayIso()}
          selected={date}
          onPressDay={onOpenDay}
          onPrevious={onPreviousMonth}
          onNext={onNextMonth}
          canGoNext={canGoNextMonth}
        />

        {/*
          The week's best day used to sit beside this one. It has gone: the
          busiest day of the chosen window is said properly above, and two
          cards naming a best day over two different spans is how a screen
          gets read wrong.
        */}
        <AnalyticsHighlightCard
          label="Streak"
          headline={`${streak === 1 ? 'day' : 'days'} in a row`}
          value={
            streak === null ? '—' : `${streak} ${streak === 1 ? 'Day' : 'Days'}`
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

        <WeeklyTrendCard data={weekSteps} caption={weekCaption} />

        <AnalyticsCheerCard name={user?.name} steps={today.shown} goal={goal} />
        <ReferralPromoCard card={referralCard} onPress={onOpenReferral} />
      </ScrollView>

      <CalendarSheet
        visible={isCalendarOpen}
        value={date}
        onChange={onPickDate}
        onClose={closeCalendar}
        title="Show analytics for"
      />

      <DayDetailSheet
        visible={openDay !== null}
        onClose={closeDay}
        // Left off when the screen is already on this day, which is every
        // day opened from the grid while the grid is on the anchor's month:
        // a button that does nothing is worse than no button.
        onShowDay={
          openDay !== null && openDay !== date ? onAnchorToOpenDay : undefined
        }
        date={openDay ?? date}
        activity={verifiedActivityOf(openDayRead.data)}
        goal={goal}
        previousSteps={
          openPrevious ? verifiedActivityOf(openPrevious).steps : null
        }
        peakHour={openPeakHour}
        pending={openDayRead.data === null}
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
