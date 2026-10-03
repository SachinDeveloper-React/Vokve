import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { CalorieSummaryCard } from '../../components/nutrition/CalorieSummaryCard';
import { DailyGoalCard } from '../../components/nutrition/DailyGoalCard';
import { MealsCard } from '../../components/nutrition/MealsCard';
import { NutritionHeader } from '../../components/nutrition/NutritionHeader';
import {
  NutritionPeriodFilter,
  type NutritionPeriod,
} from '../../components/nutrition/NutritionPeriodFilter';
import {
  PreferencesCard,
  type PreferenceKind,
} from '../../components/nutrition/PreferencesCard';
import {
  DIET_LABEL,
  MEAL_PLAN_LABEL,
  NUTRITION_GOAL_LABEL,
} from '../../components/nutrition/nutritionLabels';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useActivityDay } from '../../hooks/useActivity';
import { useTip } from '../../hooks/useContent';
import { useNutritionDay } from '../../hooks/useNutrition';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type {
  DietType,
  MealPlan,
  MealSlot,
  NutritionGoal,
} from '../../types/models';
import { todayIso, type IsoDate } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** What each preference tile offers, in the order the sheet lists them. */
const DIET_OPTIONS = Object.keys(DIET_LABEL) as DietType[];
const PLAN_OPTIONS = Object.keys(MEAL_PLAN_LABEL) as MealPlan[];
const GOAL_OPTIONS = Object.keys(NUTRITION_GOAL_LABEL) as NutritionGoal[];

/**
 * Nutrition: what has been eaten on a day, against what the day was meant to
 * be.
 *
 * The summary, the meal rows and the macro bars are three readings of one list
 * of food — the server's day (`GET /nutrition/day`) with any meal still on its
 * way laid over it — so logging an item moves all of them at once, which is
 * the only reason the "+" belongs on this screen rather than behind a
 * separate diary. The targets and preferences are the server's profile; the
 * tip is the day's from its content.
 *
 * Calories burned are the server's figure for the day's activity rather than
 * the plate's: they are the one figure here the user does not eat, and the
 * card states it beside the others rather than subtracting it from them,
 * because burning 500 calories does not make room for 500 more on any honest
 * reading of a goal.
 */
export const NutritionScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();
  const hasUnreadNotifications = useHasUnreadNotifications();

  const [period, setPeriod] = useState<NutritionPeriod>('day');
  const [date, setDate] = useState<IsoDate>(todayIso());

  const profile = useNutritionStore(s => s.profile);
  const isSyncing = useNutritionStore(s => s.isSyncing);
  const syncError = useNutritionStore(s => s.syncError);
  const hydrateFromServer = useNutritionStore(s => s.hydrateFromServer);
  const refreshIfStale = useNutritionStore(s => s.refreshIfStale);
  const setPreferences = useNutritionStore(s => s.setPreferences);
  const day = useNutritionDay(date);
  const burned = useActivityDay(date).data?.caloriesBurned ?? 0;
  const tip = useTip('nutrition');

  useRefreshOnFocus(refreshIfStale);

  const [isPulling, setPulling] = useState(false);
  const { reload: reloadDay } = day;
  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await hydrateFromServer();
    } finally {
      reloadDay();
      setPulling(false);
    }
  }, [hydrateFromServer, reloadDay]);
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  /** Which preference picker is open, or null while none is. */
  const [editing, setEditing] = useState<PreferenceKind | null>(null);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const closeEditing = useCallback(() => setEditing(null), []);

  /**
   * The picker's options, built from whichever preference was tapped. One
   * sheet rather than three: they differ only in their list.
   */
  const preferenceActions = useMemo(() => {
    if (editing === 'dietType') {
      return DIET_OPTIONS.map(value => ({
        label: DIET_LABEL[value],
        onPress: () => setPreferences({ dietType: value }),
      }));
    }
    if (editing === 'mealPlan') {
      return PLAN_OPTIONS.map(value => ({
        label: MEAL_PLAN_LABEL[value],
        onPress: () => setPreferences({ mealPlan: value }),
      }));
    }
    if (editing === 'goal') {
      return GOAL_OPTIONS.map(value => ({
        label: NUTRITION_GOAL_LABEL[value],
        onPress: () => setPreferences({ goal: value }),
      }));
    }
    return [];
  }, [editing, setPreferences]);

  const preferenceTitle =
    editing === 'dietType'
      ? 'Diet type'
      : editing === 'mealPlan'
      ? 'Meal plan'
      : 'Nutrition goal';

  // The plan behind the preferences: "Manage" is the one control here that is
  // about the whole plan rather than one field of it.
  const onOpenDietPlan = useCallback(
    () => navigation.navigate('DietPlan'),
    [navigation],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  // Logging food is a screen of its own rather than a sheet: a meal is several
  // foods, each with a portion and four macros, and that is more than a sheet
  // over a scrolling screen can hold.
  const onAddToMeal = useCallback(
    (slot: MealSlot) => navigation.navigate('AddMeal', { slot }),
    [navigation],
  );

  const onOpenHistory = useCallback(
    () => navigation.navigate('NutritionHistory'),
    [navigation],
  );

  const onOpenNotifications = useCallback(
    () => navigation.navigate('Notifications'),
    [navigation],
  );

  const onOpenAccount = useCallback(
    () =>
      navigation.navigate('Main', {
        screen: 'Account',
        params: { screen: 'AccountHome' },
      }),
    [navigation],
  );

  // The goal editor, the full diary and the tips library have no screens yet.
  // Wired as no-ops rather than left off, so each control keeps the shape it
  // will ship with and only the handler changes when its screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isPulling}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <NutritionHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressBack={onPressBack}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
        />

        <NutritionPeriodFilter
          date={date}
          value={period}
          onChange={setPeriod}
          onPressDate={openCalendar}
        />

        {profile === null ? (
          <LoadState
            loading={isSyncing || syncError === null}
            title="Couldn't load your targets"
            message={syncError}
            onRetry={hydrateFromServer}
          />
        ) : (
          <>
            <CalorieSummaryCard
              consumed={day.totals.calories}
              goal={profile.goals.calories}
              burned={burned}
              proteinG={day.totals.proteinG}
              carbsG={day.totals.carbsG}
              fatsG={day.totals.fatsG}
              proteinGoalG={profile.goals.proteinG}
              carbsGoalG={profile.goals.carbsG}
              fatsGoalG={profile.goals.fatsG}
              onPressLearnMore={notImplemented}
            />

            <DailyGoalCard
              calories={profile.goals.calories}
              proteinG={profile.goals.proteinG}
              carbsG={profile.goals.carbsG}
              fatsG={profile.goals.fatsG}
              onPressEdit={notImplemented}
            />
          </>
        )}

        {day.loaded ? (
          <MealsCard
            meals={day.meals}
            tip={tip?.text ?? null}
            onPressAdd={onAddToMeal}
            onPressViewAll={onOpenHistory}
            onPressTips={notImplemented}
          />
        ) : (
          <LoadState
            loading={day.loading}
            title="Couldn't load the day's meals"
            message={day.error}
            onRetry={day.reload}
          />
        )}

        {profile !== null ? (
          <PreferencesCard
            dietType={DIET_LABEL[profile.preferences.dietType]}
            mealPlan={MEAL_PLAN_LABEL[profile.preferences.mealPlan]}
            goal={NUTRITION_GOAL_LABEL[profile.preferences.goal]}
            onPressChange={setEditing}
            onPressManage={onOpenDietPlan}
          />
        ) : null}
      </ScrollView>

      <ActionSheet
        visible={editing !== null}
        onClose={closeEditing}
        title={preferenceTitle}
        actions={preferenceActions}
      />

      <CalendarSheet
        visible={isCalendarOpen}
        value={date}
        onChange={setDate}
        onClose={closeCalendar}
        title="Show nutrition for"
      />
    </Screen>
  );
};
