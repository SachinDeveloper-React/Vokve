import React, { useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { HomeHeader } from '../../components/home/HomeHeader';
import { QuickActionsRow } from '../../components/home/QuickActionsRow';
import { ActivityMetricsRow } from '../../components/fitness/ActivityMetricsRow';
import { HydrationCard } from '../../components/fitness/HydrationCard';
import { StepGoalCard } from '../../components/fitness/StepGoalCard';
import { WeeklyStepsChart } from '../../components/fitness/WeeklyStepsChart';
import { Screen } from '../../components/ui/Screen';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { useCurrentUser } from '../../stores/authStore';
import { useCurrentStreak } from '../../stores/streakStore';
import {
  useDailyStepGoal,
  useDailyWaterGoalMl,
} from '../../stores/settingsStore';
import {
  useHydrationStore,
  useTodayHydration,
} from '../../stores/hydrationStore';
import { todayActivity, weeklySteps } from '../../constants/seedData';
import { MotivationCard } from '../../components';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

export const HomeScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const user = useCurrentUser();
  const currentStreak = useCurrentStreak();
  const stepGoal = useDailyStepGoal();
  const waterGoalMl = useDailyWaterGoalMl();
  const consumedMl = useTodayHydration();
  const addWater = useHydrationStore(s => s.add);

  const onOpenAccount = useCallback(
    () => navigation.navigate('Main', { screen: 'Account' }),
    [navigation],
  );
  const onOpenNotifications = useCallback(() => {}, []);
  const onOpenStreak = useCallback(
    () =>
      navigation.navigate('Main', {
        screen: 'Account',
        params: { screen: 'Streak' },
      }),
    [navigation],
  );

  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <HomeHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
        />

        <StepGoalCard
          steps={todayActivity.steps}
          goal={stepGoal}
          onEditGoal={() => {}}
        />

        <ActivityMetricsRow
          distanceKm={todayActivity.distanceKm}
          activeMinutes={todayActivity.activeMinutes}
          caloriesBurned={todayActivity.caloriesBurned}
        />

        <WeeklyStepsChart data={weeklySteps} goal={stepGoal} />

        <QuickActionsRow
          streakDays={currentStreak}
          onPressChallenges={notImplemented}
          onPressNutrition={notImplemented}
          onPressHealth={notImplemented}
          onPressStreaks={onOpenStreak}
        />

        <HydrationCard
          consumedMl={consumedMl}
          goalMl={waterGoalMl}
          onAdd={addWater}
          onPressDetails={notImplemented}
        />

        <MotivationCard quote="Small steps every day lead to big results." />
      </ScrollView>
    </Screen>
  );
};
