import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { TimePickerSheet } from '../../components/form/TimePickerSheet';
import { VStack } from '../../components/layout/Stack';
import { AddMealHeader } from '../../components/meal/AddMealHeader';
import { AddedFoodsCard } from '../../components/meal/AddedFoodsCard';
import {
  CustomFoodSheet,
  type CustomFood,
} from '../../components/meal/CustomFoodSheet';
import { FoodSearchResults } from '../../components/meal/FoodSearchResults';
import { LoggedFoodsCard } from '../../components/meal/LoggedFoodsCard';
import { FoodSearchRow } from '../../components/meal/FoodSearchRow';
import { MealSlotPicker } from '../../components/meal/MealSlotPicker';
import { MealSummaryCard } from '../../components/meal/MealSummaryCard';
import { MealWhenRow } from '../../components/meal/MealWhenRow';
import { FoodQuickAddRow } from '../../components/meal/FoodQuickAddRow';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { useToast } from '../../components/feedback/Toast';
import {
  useFoodSearch,
  useNutritionDay,
  useQuickAddFoods,
} from '../../hooks/useNutrition';
import { nutritionApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useCoinBalance } from '../../stores/coinsStore';
import { useMealDraftStore } from '../../stores/mealDraftStore';
import { outcomeOf, useNutritionStore } from '../../stores/nutritionStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import type { FoodItem, MealSlot } from '../../types/models';
import { fromIsoDate, todayIso, type IsoDate } from '../../utils/date';
import { logger } from '../../utils/logger';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

const NO_FOODS: FoodItem[] = [];

/** The clock time a screen opened now would default to, as `HH:mm`. */
function currentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`;
}

/**
 * Logging a meal: which meal, when, and what was in it.
 *
 * The library is the server's: the shortcuts (`GET /foods/quick-add`) and
 * the search (`GET /foods?q=`, asked once typing pauses).
 *
 * The whole screen is a draft. Foods are added to and taken off a list
 * (`mealDraftStore`), and nothing reaches the nutrition store until Save Meal
 * — a user assembling a plate adds the wrong thing and changes their mind, and
 * a screen that wrote each of those straight to the diary would fill the day's
 * history with corrections. The draft is a store rather than this screen's own
 * state because the food library screen adds to the same meal; it is emptied
 * on the way in, so yesterday's abandoned plate is not in today's breakfast.
 *
 * What the meal already holds is shown above the draft (`LoggedFoodsCard`),
 * because "Added Foods (0)" on a lunch that already has two foods in it reads
 * as the app having forgotten them. The two lists stay apart: the bin on a
 * logged row deletes what was eaten (`DELETE /nutrition/entries/:id`), the bin
 * on a draft row only changes the user's mind about what they are about to
 * log, and one list with two meanings for one gesture is how somebody loses
 * yesterday's lunch.
 *
 * The date and time are asked for rather than stamped as "now", because the
 * commonest moment to log breakfast is halfway through the morning. The store
 * buckets food by the day it was eaten, so the answer actually decides which
 * day's totals it lands in.
 */
export const AddMealScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const { params } = useRoute<RootStackScreenProps<'AddMeal'>['route']>();
  const toast = useToast();

  const coins = useCoinBalance();
  const addEntries = useNutritionStore(s => s.addEntries);

  const foods = useMealDraftStore(s => s.foods);
  const addFoodToDraft = useMealDraftStore(s => s.add);
  const addCustomToDraft = useMealDraftStore(s => s.addCustom);
  const removeFromDraft = useMealDraftStore(s => s.remove);
  const clearDraft = useMealDraftStore(s => s.clear);

  const [slot, setSlot] = useState<MealSlot>(params?.slot ?? 'breakfast');
  const [date, setDate] = useState<IsoDate>(params?.date ?? todayIso());
  const [time, setTime] = useState(currentTime());
  const [query, setQuery] = useState('');

  /**
   * The draft is emptied when this screen is *left*, not when it is entered.
   *
   * Entering looks like the obvious moment, and it is wrong: pushing the food
   * library on top of this screen can take it off the tree and put it back
   * when the library pops, and a clear on mount then threw away every food
   * the user had just picked over there — they came back to an empty meal and
   * a Save button that did nothing.
   *
   * `beforeRemove` fires when this screen is actually leaving the stack — the
   * chevron, the hardware back, the swipe — and not when something is merely
   * pushed over it, which is exactly the line we need. The chevron clears
   * directly as well, so the behaviour does not rest on one event alone.
   */
  useEffect(
    () => navigation.addListener?.('beforeRemove', clearDraft),
    [clearDraft, navigation],
  );

  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [isTimeOpen, setTimeOpen] = useState(false);
  const [isCustomOpen, setCustomOpen] = useState(false);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const openTime = useCallback(() => setTimeOpen(true), []);
  const closeTime = useCallback(() => setTimeOpen(false), []);
  const openCustom = useCallback(() => setCustomOpen(true), []);
  const closeCustom = useCallback(() => setCustomOpen(false), []);

  // What this meal already holds on the day being shown. The card above the
  // draft is the answer to "Added Foods (0)" on a lunch that already has two
  // foods in it: that count is the draft's, and nobody reads it that way.
  const day = useNutritionDay(date);
  const removeEntry = useNutritionStore(s => s.removeEntry);
  const logged = useMemo(
    () => day.entries.filter(entry => entry.slot === slot),
    [day.entries, slot],
  );

  const quickAdds = useQuickAddFoods().data ?? NO_FOODS;
  const search = useFoodSearch(query);
  const results = search.data ?? NO_FOODS;

  const totals = useMemo(
    () =>
      foods.reduce(
        (sum, food) => ({
          calories: sum.calories + food.calories,
          proteinG: sum.proteinG + food.proteinG,
          carbsG: sum.carbsG + food.carbsG,
          fatsG: sum.fatsG + food.fatsG,
          fiberG: sum.fiberG + food.fiberG,
        }),
        { calories: 0, proteinG: 0, carbsG: 0, fatsG: 0, fiberG: 0 },
      ),
    [foods],
  );

  const addFood = useCallback(
    (item: FoodItem) => {
      addFoodToDraft(item);
      // Cleared so the next search starts from the library rather than from
      // the term that just produced a hit.
      setQuery('');
    },
    [addFoodToDraft],
  );

  /**
   * A food added by hand goes on the meal at once and is sent to the member's
   * own library behind it (`POST /foods/custom`), so the next meal can find it
   * by searching. A library that refuses the row does not cost the plate.
   */
  const addCustomFood = useCallback(
    (food: CustomFood) => {
      addCustomToDraft(food);
      setQuery('');
      nutritionApi.createCustomFood(food).catch(caught => {
        const error = toApiError(caught);
        logger.warn('AddMealScreen', 'Custom food not saved', error);
        toast.show({
          title: 'Added to this meal only',
          message: `It couldn't be saved to your foods: ${error.message}`,
          tone: 'warning',
        });
      });
    },
    [addCustomToDraft, toast],
  );

  const removeFood = useCallback(
    (key: string) => removeFromDraft(key),
    [removeFromDraft],
  );

  // The whole library is a screen of its own: it is paged, searchable and
  // long, which is more than a row of four tiles can be made to hold.
  const openLibrary = useCallback(
    () => navigation.navigate('FoodLibrary'),
    [navigation],
  );

  const onPressBack = useCallback(() => {
    // Leaving by the chevron abandons the meal, so the draft goes with it.
    clearDraft();
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [clearDraft, navigation]);

  const [isSaving, setSaving] = useState(false);

  /**
   * Sends the meal and says what actually became of it.
   *
   * It waits for the server rather than claiming success the moment the meal
   * is queued. "Meal saved" over a plate the server went on to refuse is the
   * worst thing this screen can say: the food appears in the diary for a
   * second, vanishes, and the user is left believing the app lost it. So:
   * taken means taken, queued says it will sync, and refused keeps the draft
   * on the screen with the server's own reason, so the meal can be fixed
   * rather than retyped.
   */
  const saveMeal = useCallback(async () => {
    if (foods.length === 0 || isSaving) {
      return;
    }

    // The chosen day and time become the entry's timestamp, which is what
    // decides the day's bucket it lands in.
    const [hours, minutes] = time.split(':').map(Number);
    const at = fromIsoDate(date);
    at.setHours(hours, minutes, 0, 0);
    const loggedAt = at.toISOString();

    setSaving(true);
    const items = `${foods.length} ${foods.length === 1 ? 'item' : 'items'}`;
    try {
      const queuedId = addEntries(
        foods.map(food => ({
          slot,
          name: food.name,
          portion: food.portion,
          calories: food.calories,
          proteinG: food.proteinG,
          carbsG: food.carbsG,
          fatsG: food.fatsG,
          fiberG: food.fiberG,
          loggedAt,
        })),
      );
      await useNutritionStore.getState().flush();

      const outcome = outcomeOf(queuedId);
      if (outcome === 'refused') {
        const reason =
          useNutritionStore.getState().syncError ??
          'The server would not take it.';
        logger.warn('AddMealScreen', 'The meal was refused', reason);
        toast.show({
          title: "This meal wasn't saved",
          message: reason,
          tone: 'error',
          durationMs: 0,
        });
        return;
      }

      toast.show({
        title: outcome === 'saved' ? 'Meal saved' : 'Meal waiting to sync',
        message:
          outcome === 'saved'
            ? `${items} added to your diary.`
            : `${items} will be added as soon as you are back online.`,
        tone: outcome === 'saved' ? 'success' : 'info',
      });

      clearDraft();
      onPressBack();
    } finally {
      setSaving(false);
    }
  }, [
    addEntries,
    clearDraft,
    date,
    foods,
    isSaving,
    onPressBack,
    slot,
    time,
    toast,
  ]);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <AddMealHeader coins={coins} onPressBack={onPressBack} />

        <MealSlotPicker
          value={slot}
          onChange={setSlot}
          onPressCustom={openCustom}
        />

        <MealWhenRow
          date={date}
          time={time}
          onPressDate={openCalendar}
          onPressTime={openTime}
        />

        <FoodSearchRow
          value={query}
          onChange={setQuery}
          onPressAddCustom={openCustom}
        />

        {query.trim().length > 0 ? (
          <FoodSearchResults
            query={query}
            results={results}
            searching={search.data === null && search.error === null}
            onAdd={addFood}
            onPressAddCustom={openCustom}
          />
        ) : (
          <FoodQuickAddRow
            items={quickAdds}
            onAdd={addFood}
            onPressMore={openLibrary}
            onPressViewAll={openLibrary}
          />
        )}

        <LoggedFoodsCard slot={slot} entries={logged} onRemove={removeEntry} />

        <AddedFoodsCard
          foods={foods}
          onRemove={removeFood}
          onPressAddAnother={openCustom}
        />

        <MealSummaryCard totals={totals} />

        <VStack gap="xs">
          <Button
            label="Save Meal"
            size="lg"
            fullWidth
            loading={isSaving}
            disabled={foods.length === 0}
            onPress={saveMeal}
          />
          <AppText variant="miniMicro" color="textSecondary" center>
            Your meal will be saved to your history
          </AppText>
        </VStack>
      </ScrollView>

      <CustomFoodSheet
        visible={isCustomOpen}
        initialName={query.trim()}
        onSubmit={addCustomFood}
        onClose={closeCustom}
      />

      <CalendarSheet
        visible={isCalendarOpen}
        value={date}
        onChange={setDate}
        onClose={closeCalendar}
        title="When did you eat this?"
      />

      <TimePickerSheet
        visible={isTimeOpen}
        value={time}
        onSubmit={setTime}
        onClose={closeTime}
        title="What time?"
        submitLabel="Set time"
      />
    </Screen>
  );
};
