import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ClipboardList, Plus } from 'lucide-react-native';
import { Icon } from '../../components/media/Icon';
import { DayPager } from '../../components/diet/DayPager';
import { DietPlanHeader } from '../../components/diet/DietPlanHeader';
import {
  DietPlanTabs,
  type DietPlanTab,
} from '../../components/diet/DietPlanTabs';
import { PlanCaloriesCard } from '../../components/diet/PlanCaloriesCard';
import { PlanDayList } from '../../components/diet/PlanDayList';
import { PlanNutritionCard } from '../../components/diet/PlanNutritionCard';
import { PlannedMealCard } from '../../components/diet/PlannedMealCard';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { HStack } from '../../components/layout/Stack';
import { Button } from '../../components/ui/Button';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useDietPlan, useDietPlanDays } from '../../hooks/useNutrition';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import {
  useNutritionGoals,
  useNutritionStore,
} from '../../stores/nutritionStore';
import type { PlannedMeal } from '../../types/models';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { addDays, todayIso, type IsoDate } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    action: { flex: 1 },
  });

/** How many days either tab lists. */
const RUN_LENGTH = 7;

const NO_MEALS: PlannedMeal[] = [];
const NO_TOTALS = { calories: 0, proteinG: 0, carbsG: 0, fatsG: 0, fiberG: 0 };

/**
 * The diet plan: what to eat on a given day, and the week either side of it.
 *
 * The plan is the server's (`GET /diet-plan`, `/diet-plan/days`), chosen from
 * the user's preferences: the days that suit them, in rotation, so every day
 * the user pages to has something behind it — forwards into next week as
 * readily as back into last. Changing a preference on the nutrition screen
 * changes the plan here.
 *
 * The calorie goal is the nutrition screen's, not a second one of this
 * screen's own: a plan measured against one target while the day's food is
 * logged against another would be two answers to "what am I aiming at".
 */
export const DietPlanScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();

  const [tab, setTab] = useState<DietPlanTab>('today');
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [isCalendarOpen, setCalendarOpen] = useState(false);

  const plan = useDietPlan(date);
  const meals = plan.data?.meals ?? NO_MEALS;
  const totals = plan.data?.totals ?? NO_TOTALS;
  const goals = useNutritionGoals();
  useRefreshOnFocus(useNutritionStore.getState().refreshIfStale);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);

  const previousDay = useCallback(
    () => setDate(current => addDays(current, -1)),
    [],
  );
  const nextDay = useCallback(() => setDate(current => addDays(current, 1)), []);

  // The add-meal screen rather than a sheet of this screen's own: logging a
  // meal is several foods with portions and macros, and the app has one place
  // that does it properly. It opens on the day the plan is showing.
  const openAdd = useCallback(
    () => navigation.navigate('AddMeal', { date }),
    [date, navigation],
  );

  /** Tapping a day in either list is how those tabs get back to the plan. */
  const handlePickDay = useCallback((picked: IsoDate) => {
    setDate(picked);
    setTab('today');
  }, []);

  const upcoming = useMemo(
    () =>
      Array.from({ length: RUN_LENGTH }, (_, index) =>
        addDays(todayIso(), index),
      ),
    [],
  );

  const past = useMemo(
    () =>
      Array.from({ length: RUN_LENGTH }, (_, index) =>
        addDays(todayIso(), -(index + 1)),
      ),
    [],
  );
  const ahead = useDietPlanDays(upcoming);
  const behind = useDietPlanDays(past);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  // A meal's own page and the daily summary have no screens yet. Wired as
  // no-ops rather than left off, so each control keeps the shape it will ship
  // with and only the handler changes when its screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <DietPlanHeader onPressBack={onPressBack} />

        <DietPlanTabs value={tab} onChange={setTab} />

        {tab === 'today' ? (
          <>
            <DayPager
              date={date}
              onPrevious={previousDay}
              onNext={nextDay}
              onPressDate={openCalendar}
            />

            {plan.data === null || goals === null ? (
              <LoadState
                loading={plan.loading}
                title="Couldn't load the plan"
                message={plan.error}
                onRetry={plan.reload}
              />
            ) : (
              <>
                <PlanCaloriesCard
                  calories={totals.calories}
                  goal={goals.calories}
                  proteinG={totals.proteinG}
                  carbsG={totals.carbsG}
                  fatsG={totals.fatsG}
                />

                {meals.map(meal => (
                  <PlannedMealCard
                    key={meal.id}
                    meal={meal}
                    onPress={notImplemented}
                  />
                ))}
              </>
            )}

            {/* `Button` sizes itself to its label, so the halves are set by
                the views around it rather than by the buttons themselves. */}
            <HStack align="stretch" gap="md">
              <View style={styles.action}>
                <Button
                  label="Add Meal"
                  icon={<Icon as={Plus} size="sm" color="primaryForeground" />}
                  size="md"
                  fullWidth
                  onPress={openAdd}
                />
              </View>

              <View style={styles.action}>
                <Button
                  label="Daily Summary"
                  icon={<Icon as={ClipboardList} size="sm" color="text" />}
                  variant="secondary"
                  size="md"
                  fullWidth
                  onPress={notImplemented}
                />
              </View>
            </HStack>
          </>
        ) : null}

        {tab === 'plan' ? (
          ahead.data ? (
            <PlanDayList
              days={ahead.data}
              selected={date}
              title="The week ahead"
              caption={
                plan.data
                  ? `${plan.data.basis} — a ${plan.data.cycleLength}-day rotation.`
                  : 'Your plan, day by day.'
              }
              onPressDay={handlePickDay}
            />
          ) : (
            <LoadState
              loading={ahead.loading}
              title="Couldn't load the week ahead"
              message={ahead.error}
              onRetry={ahead.reload}
            />
          )
        ) : null}

        {tab === 'nutrition' ? (
          goals !== null && plan.data ? (
            <PlanNutritionCard meals={meals} totals={totals} goals={goals} />
          ) : (
            <LoadState
              loading={plan.loading}
              title="Couldn't load the plan"
              message={plan.error}
              onRetry={plan.reload}
            />
          )
        ) : null}

        {tab === 'history' ? (
          behind.data ? (
            <PlanDayList
              days={behind.data}
              selected={date}
              title="The week behind"
              caption="What the plan asked for on each of the last seven days."
              onPressDay={handlePickDay}
            />
          ) : (
            <LoadState
              loading={behind.loading}
              title="Couldn't load the week behind"
              message={behind.error}
              onRetry={behind.reload}
            />
          )
        ) : null}
      </ScrollView>

      <CalendarSheet
        visible={isCalendarOpen}
        value={date}
        onChange={setDate}
        onClose={closeCalendar}
        title="Show the plan for"
      />
    </Screen>
  );
};
