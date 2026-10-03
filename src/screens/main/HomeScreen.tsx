import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { HomeHeader } from '../../components/home/HomeHeader';
import { QuickActionsRow } from '../../components/home/QuickActionsRow';
import { ActivityMetricsRow } from '../../components/fitness/ActivityMetricsRow';
import { HydrationCard } from '../../components/fitness/HydrationCard';
import { StepGoalCard } from '../../components/fitness/StepGoalCard';
import { WeeklyStepsChart } from '../../components/fitness/WeeklyStepsChart';
import { StepTrackingPromptCard } from '../../components/steps/StepTrackingPromptCard';
import { Screen } from '../../components/ui/Screen';
import { useTip } from '../../hooks/useContent';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { syncStepsNow } from '../../services/steps';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import { useCurrentStreak, useStreakStore } from '../../stores/streakStore';
import {
  useDailyStepGoal,
  useDailyWaterGoalMl,
} from '../../stores/settingsStore';
import {
  useHydrationStore,
  useTodayHydration,
} from '../../stores/hydrationStore';
import {
  useServerWeek,
  useStepPrompt,
  useTodayActivity,
} from '../../stores/stepsStore';
import { addDays, formatWeekdayShort, todayIso } from '../../utils/date';
import { MotivationCard } from '../../components';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

export const HomeScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();
  const currentStreak = useCurrentStreak();
  const hasUnreadNotifications = useHasUnreadNotifications();
  const stepGoal = useDailyStepGoal();
  const waterGoalMl = useDailyWaterGoalMl();
  const consumedMl = useTodayHydration();
  const addWater = useHydrationStore(s => s.add);
  const today = useTodayActivity();
  const serverWeek = useServerWeek();
  const stepPrompt = useStepPrompt();
  const [refreshing, setRefreshing] = useState(false);

  const motivation = useTip('motivation');

  useRefreshOnFocus(
    useStreakStore.getState().refreshIfStale,
    useHydrationStore.getState().refreshIfStale,
  );

  // Every figure on the step cards is the server's. The last seven days,
  // today last; a day the server has not answered for yet reads as zero.
  const week = useMemo(() => {
    const byDate = new Map(serverWeek.map(day => [day.date, day.steps]));
    const end = todayIso();
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(end, index - 6);
      return { day: formatWeekdayShort(date), steps: byDate.get(date) ?? 0 };
    });
  }, [serverWeek]);

  // Pulling down sends what this phone has counted and reads the server's
  // answer back, the streak with it.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        syncStepsNow(),
        useStreakStore.getState().hydrateFromServer(),
        useHydrationStore.getState().hydrateFromServer(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onOpenAccount = useCallback(
    () => navigation.navigate('Main', { screen: 'Account' }),
    [navigation],
  );

  // A root route rather than one of the tab's: the bell is in every header, and
  // a notification centre parked inside a tab would leave that tab showing it
  // the next time the user tapped the tab itself.
  const onOpenNotifications = useCallback(
    () => navigation.navigate('Notifications'),
    [navigation],
  );

  const onOpenNutrition = useCallback(
    () => navigation.navigate('Nutrition'),
    [navigation],
  );

  const onOpenHealth = useCallback(
    () => navigation.navigate('HealthCheckup'),
    [navigation],
  );

  const onOpenAnalytics = useCallback(
    () => navigation.navigate('Analytics'),
    [navigation],
  );

  const onOpenHydration = useCallback(
    () => navigation.navigate('Hydration'),
    [navigation],
  );

  const onOpenChallenges = useCallback(
    () => navigation.navigate('Challenges'),
    [navigation],
  );

  const onOpenStreak = useCallback(
    () => navigation.navigate('Streak'),
    [navigation],
  );

  const onOpenStepTracking = useCallback(
    () => navigation.navigate('StepTracking'),
    [navigation],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <HomeHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
        />

        {stepPrompt ? (
          <StepTrackingPromptCard
            variant={stepPrompt}
            onPress={onOpenStepTracking}
          />
        ) : null}

        <StepGoalCard
          steps={today.steps}
          goal={stepGoal}
          onEditGoal={() => {}}
        />

        <ActivityMetricsRow
          distanceKm={today.distanceKm}
          activeMinutes={today.activeMinutes}
          caloriesBurned={today.caloriesBurned}
          onPressAnalysis={onOpenAnalytics}
        />

        <WeeklyStepsChart data={week} goal={stepGoal} />

        <QuickActionsRow
          streakDays={currentStreak}
          onPressChallenges={onOpenChallenges}
          onPressNutrition={onOpenNutrition}
          onPressHealth={onOpenHealth}
          onPressStreaks={onOpenStreak}
        />

        <HydrationCard
          consumedMl={consumedMl}
          goalMl={waterGoalMl}
          onAdd={addWater}
          onPressDetails={onOpenHydration}
        />

        {motivation ? <MotivationCard quote={motivation.text} /> : null}
      </ScrollView>
    </Screen>
  );
};
