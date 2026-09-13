import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Plus } from 'lucide-react-native';
import { DayPager } from '../../components/diet/DayPager';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { CustomRangeRow } from '../../components/history/CustomRangeRow';
import { DailySummaryCard } from '../../components/history/DailySummaryCard';
import { DayTotalsCard } from '../../components/history/DayTotalsCard';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { HistoryMealCard } from '../../components/history/HistoryMealCard';
import {
  HistoryRangeTabs,
  type HistoryRange,
} from '../../components/history/HistoryRangeTabs';
import { RangeSummaryCard } from '../../components/history/RangeSummaryCard';
import { HStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { useCoinBalance } from '../../stores/coinsStore';
import {
  useDayTotals,
  useFoodEntriesOn,
  useMealSummariesOn,
  useNutritionGoals,
  totalsForDay,
} from '../../stores/nutritionStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import type { MealSlot } from '../../types/models';
import { addDays, daysBetween, todayIso, type IsoDate } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** How many previous days the daily view lists under the meals. */
const PREVIOUS_DAYS = 3;
/** The longest custom span the screen will draw as a list of days. */
const MAX_CUSTOM_DAYS = 92;

/** The run of dates a range covers, newest first. */
function datesFor(
  range: HistoryRange,
  anchor: IsoDate,
  from: IsoDate,
  to: IsoDate,
): IsoDate[] {
  if (range === 'custom') {
    const span = Math.min(MAX_CUSTOM_DAYS, Math.abs(daysBetween(from, to)) + 1);
    const start = daysBetween(from, to) >= 0 ? to : from;
    return Array.from({ length: span }, (_, index) => addDays(start, -index));
  }

  const length = range === 'weekly' ? 7 : 30;
  return Array.from({ length }, (_, index) => addDays(anchor, -index));
}

/**
 * The diary, read backwards.
 *
 * Everything comes from the same per-day buckets the add-meal screen writes
 * into, so a meal logged this morning is in this history a moment later and a
 * day nobody logged reads as "nothing logged" rather than as a day of zero
 * calories — those are different facts and the screen says which one it has.
 *
 * The three fixed ranges are windows ending at the day being looked at; the
 * fourth lets the user draw their own, which is the only way to ask about a
 * holiday or an illness. All four are the same list of days underneath, so
 * switching between them cannot make the figures disagree.
 */
export const NutritionHistoryScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();

  const coins = useCoinBalance();
  const goals = useNutritionGoals();

  const [range, setRange] = useState<HistoryRange>('daily');
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [from, setFrom] = useState<IsoDate>(addDays(todayIso(), -6));
  const [to, setTo] = useState<IsoDate>(todayIso());
  /** Which calendar is open, or null while none is. */
  const [picking, setPicking] = useState<'day' | 'from' | 'to' | null>(null);

  const closePicker = useCallback(() => setPicking(null), []);
  const pickDay = useCallback(() => setPicking('day'), []);
  const pickFrom = useCallback(() => setPicking('from'), []);
  const pickTo = useCallback(() => setPicking('to'), []);

  const entries = useFoodEntriesOn(date);
  const meals = useMealSummariesOn(date);
  const totals = useMemo(() => totalsForDay(entries, date), [date, entries]);

  const previousDates = useMemo(
    () =>
      Array.from({ length: PREVIOUS_DAYS }, (_, index) =>
        addDays(date, -(index + 1)),
      ),
    [date],
  );
  const previousDays = useDayTotals(previousDates);

  const rangeDates = useMemo(
    () => datesFor(range, date, from, to),
    [date, from, range, to],
  );
  const rangeDays = useDayTotals(rangeDates);

  const previousDay = useCallback(
    () => setDate(current => addDays(current, -1)),
    [],
  );
  const nextDay = useCallback(() => setDate(current => addDays(current, 1)), []);

  /** Tapping any day in any list brings the daily view to it. */
  const openDay = useCallback((picked: IsoDate) => {
    setDate(picked);
    setRange('daily');
  }, []);

  const handlePicked = useCallback(
    (picked: IsoDate) => {
      if (picking === 'from') {
        setFrom(picked);
        return;
      }
      if (picking === 'to') {
        setTo(picked);
        return;
      }
      setDate(picked);
    },
    [picking],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  const onAddMeal = useCallback(
    () => navigation.navigate('AddMeal', { date }),
    [date, navigation],
  );

  const onOpenMeal = useCallback(
    (slot: MealSlot) => navigation.navigate('AddMeal', { slot, date }),
    [date, navigation],
  );

  // The insights breakdown and the full archive have no screens yet. Wired as
  // no-ops rather than left off, so each link keeps the shape it will ship
  // with and only the handler changes when its screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <HistoryHeader coins={coins} onPressBack={onPressBack} />

        <HistoryRangeTabs value={range} onChange={setRange} />

        {range === 'custom' ? (
          <CustomRangeRow
            from={from}
            to={to}
            onPressFrom={pickFrom}
            onPressTo={pickTo}
          />
        ) : (
          <DayPager
            date={date}
            onPrevious={previousDay}
            onNext={nextDay}
            onPressDate={pickDay}
          />
        )}

        {range === 'daily' ? (
          <>
            <DailySummaryCard
              totals={totals}
              goals={goals}
              onPressInsights={notImplemented}
            />

            <HStack align="center" justify="between" gap="sm">
              <AppText variant="h3">{`Meals (${
                meals.filter(meal => meal.items > 0).length
              })`}</AppText>

              <Button
                label="Add Meal"
                icon={<Icon as={Plus} size="sm" color="primaryForeground" />}
                size="sm"
                onPress={onAddMeal}
              />
            </HStack>

            {meals.map(meal => (
              <HistoryMealCard
                key={meal.slot}
                meal={meal}
                onPress={onOpenMeal}
              />
            ))}

            <DayTotalsCard
              title="Previous Days"
              days={previousDays}
              actionLabel="View All"
              onPressAction={notImplemented}
              onPressDay={openDay}
            />
          </>
        ) : (
          <>
            <RangeSummaryCard
              title={
                range === 'weekly'
                  ? 'This week'
                  : range === 'monthly'
                  ? 'The last 30 days'
                  : 'Your own span'
              }
              days={rangeDays}
              goals={goals}
            />

            <DayTotalsCard
              title="Day by day"
              days={rangeDays}
              onPressDay={openDay}
            />
          </>
        )}
      </ScrollView>

      <CalendarSheet
        visible={picking !== null}
        value={picking === 'from' ? from : picking === 'to' ? to : date}
        onChange={handlePicked}
        onClose={closePicker}
        title={
          picking === 'from'
            ? 'Start of the span'
            : picking === 'to'
            ? 'End of the span'
            : 'Show the diary for'
        }
      />
    </Screen>
  );
};
