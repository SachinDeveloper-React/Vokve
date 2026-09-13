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
import {
  monthlyStepsByWeek,
  todayActivity,
  todayHourlySteps,
  weeklySteps,
  yearlyStepsByMonth,
} from '../../constants/seedData';
import { useCurrentUser } from '../../stores/authStore';
import { useDailyStepGoal } from '../../stores/settingsStore';
import { useCurrentStreak } from '../../stores/streakStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { todayIso, type IsoDate } from '../../utils/date';
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

/** The milestone a streak is working towards, in whole weeks. */
function nextStreakMilestone(days: number): number {
  return Math.max(7, Math.ceil((days + 1) / 7) * 7);
}

/**
 * Steps, analysed: today's count against the goal, the period's shape, and the
 * two figures worth knowing about the week.
 *
 * The range control drives the overview chart and nothing else. The card above
 * it is a daily readout — it is headed "Total Steps" beside "Daily Goal" — and
 * having a D/W/M/Y switch silently change what "today" meant would make the
 * biggest number on the screen the least trustworthy one. The chart says which
 * period it is drawing under its own title instead.
 *
 * Every series is seeded, and the hourly one adds up to `todayActivity.steps`
 * exactly, so the chart and the total above it can never disagree.
 */
export const AnalyticsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();

  const goal = useDailyStepGoal();
  const streak = useCurrentStreak();

  const [range, setRange] = useState<AnalyticsRange>('day');
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [isCalendarOpen, setCalendarOpen] = useState(false);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);

  const { points, caption, axisLabels } = useMemo<{
    points: OverviewPoint[];
    caption: string;
    axisLabels: string[];
  }>(() => {
    switch (range) {
      case 'week':
        return {
          points: weeklySteps.map(entry => ({
            label: entry.day,
            steps: entry.steps,
          })),
          caption: 'This week, day by day',
          axisLabels: [weeklySteps[0].day, weeklySteps[weeklySteps.length - 1].day],
        };
      case 'month':
        return {
          points: monthlyStepsByWeek.map(entry => ({
            label: entry.label,
            steps: entry.steps,
          })),
          caption: 'This month, week by week',
          axisLabels: monthlyStepsByWeek.map(entry => entry.label),
        };
      case 'year':
        return {
          points: yearlyStepsByMonth.map(entry => ({
            label: entry.label,
            steps: entry.steps,
          })),
          caption: 'This year, month by month',
          axisLabels: ['Jan', 'Apr', 'Jul', 'Oct', 'Dec'],
        };
      default:
        return {
          points: todayHourlySteps.map((steps, hour) => ({
            label: hourLabel(hour),
            steps,
          })),
          caption: 'Today, hour by hour',
          axisLabels: Array.from(
            { length: 24 / HOUR_LABEL_STEP },
            (_, index) => hourLabel(index * HOUR_LABEL_STEP),
          ),
        };
    }
  }, [range]);

  // Yesterday is the day before the last in the week series, which is today.
  const yesterdaySteps = weeklySteps[weeklySteps.length - 2]?.steps ?? null;

  const bestDay = useMemo(
    () =>
      weeklySteps.reduce((best, entry) =>
        entry.steps > best.steps ? entry : best,
      ),
    [],
  );

  const streakTarget = nextStreakMilestone(streak);

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
          steps={todayActivity.steps}
          goal={goal}
          previousSteps={yesterdaySteps}
          caloriesBurned={todayActivity.caloriesBurned}
          distanceKm={todayActivity.distanceKm}
          activeMinutes={todayActivity.activeMinutes}
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
            value={`${formatGrouped(bestDay.steps)} steps`}
            caption={`${bestDay.day} — your highest count of the week`}
            tint={colors.success}
          />

          <AnalyticsHighlightCard
            label="Streak"
            headline={`${streak === 1 ? 'day' : 'days'} in a row`}
            value={`${streak} ${streak === 1 ? 'Day' : 'Days'}`}
            caption={
              streak >= streakTarget
                ? 'Milestone reached. Keep it rolling!'
                : `Keep it up! ${streakTarget - streak} more ${
                    streakTarget - streak === 1 ? 'day' : 'days'
                  }`
            }
            tint={colors.primary}
            tintValue
          />
        </HStack>

        <WeeklyTrendCard data={weeklySteps} />

        <AnalyticsCheerCard
          name={user?.name}
          steps={todayActivity.steps}
          goal={goal}
        />
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
