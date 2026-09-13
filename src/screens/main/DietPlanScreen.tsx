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
import { Screen } from '../../components/ui/Screen';
import {
  usePlanForDate,
  usePlanTotals,
} from '../../stores/dietPlanStore';
import { useNutritionGoals } from '../../stores/nutritionStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { addDays, todayIso, type IsoDate } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    action: { flex: 1 },
  });

/** How many days either tab lists. */
const RUN_LENGTH = 7;

/**
 * The diet plan: what to eat on a given day, and the week either side of it.
 *
 * The plan itself is a three-day rotation rather than a row per date, so every
 * day the user pages to has something behind it — forwards into next week as
 * readily as back into last. What the user adds is stored per date on top of
 * that, which is the only part of a plan that is theirs.
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

  const meals = usePlanForDate(date);
  const totals = usePlanTotals(date);
  const goals = useNutritionGoals();

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
          <PlanDayList
            dates={upcoming}
            selected={date}
            title="The week ahead"
            caption="Your plan runs on a three-day rotation."
            onPressDay={handlePickDay}
          />
        ) : null}

        {tab === 'nutrition' ? (
          <PlanNutritionCard meals={meals} totals={totals} goals={goals} />
        ) : null}

        {tab === 'history' ? (
          <PlanDayList
            dates={past}
            selected={date}
            title="The week behind"
            caption="What the plan asked for on each of the last seven days."
            onPressDay={handlePickDay}
          />
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
