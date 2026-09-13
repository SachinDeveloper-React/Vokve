import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { TimePickerSheet } from '../../components/form/TimePickerSheet';
import { VStack } from '../../components/layout/Stack';
import { AddMealHeader } from '../../components/meal/AddMealHeader';
import {
  AddedFoodsCard,
  type DraftFood,
} from '../../components/meal/AddedFoodsCard';
import {
  CustomFoodSheet,
  type CustomFood,
} from '../../components/meal/CustomFoodSheet';
import { FoodSearchResults } from '../../components/meal/FoodSearchResults';
import { FoodSearchRow } from '../../components/meal/FoodSearchRow';
import { MealSlotPicker } from '../../components/meal/MealSlotPicker';
import { MealSummaryCard } from '../../components/meal/MealSummaryCard';
import { MealWhenRow } from '../../components/meal/MealWhenRow';
import { FoodQuickAddRow } from '../../components/meal/FoodQuickAddRow';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { useToast } from '../../components/feedback/Toast';
import { foodLibrary, quickAddFoodIds } from '../../constants/seedData';
import { useCoinBalance } from '../../stores/coinsStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import type { FoodItem, MealSlot } from '../../types/models';
import { fromIsoDate, todayIso, type IsoDate } from '../../utils/date';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/** The clock time a screen opened now would default to, as `HH:mm`. */
function currentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`;
}

/** A draft row's key, so two of the same food can be removed separately. */
let draftCount = 0;
function nextKey(): string {
  draftCount += 1;
  return `draft-${draftCount}`;
}

function toDraft(item: FoodItem): DraftFood {
  return {
    key: nextKey(),
    name: item.name,
    portion: item.portion,
    emoji: item.emoji,
    calories: item.calories,
    proteinG: item.proteinG,
    carbsG: item.carbsG,
    fatsG: item.fatsG,
    fiberG: item.fiberG,
  };
}

/**
 * Logging a meal: which meal, when, and what was in it.
 *
 * The whole screen is a draft. Foods are added to and taken off a list held
 * here, and nothing reaches the nutrition store until Save Meal — a user
 * assembling a plate adds the wrong thing and changes their mind, and a screen
 * that wrote each of those straight to the diary would fill the day's history
 * with corrections.
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

  const [slot, setSlot] = useState<MealSlot>(params?.slot ?? 'breakfast');
  const [date, setDate] = useState<IsoDate>(params?.date ?? todayIso());
  const [time, setTime] = useState(currentTime());
  const [query, setQuery] = useState('');
  const [foods, setFoods] = useState<DraftFood[]>([]);

  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [isTimeOpen, setTimeOpen] = useState(false);
  const [isCustomOpen, setCustomOpen] = useState(false);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  const openTime = useCallback(() => setTimeOpen(true), []);
  const closeTime = useCallback(() => setTimeOpen(false), []);
  const openCustom = useCallback(() => setCustomOpen(true), []);
  const closeCustom = useCallback(() => setCustomOpen(false), []);

  const quickAdds = useMemo(
    () =>
      quickAddFoodIds
        .map(id => foodLibrary.find(item => item.id === id))
        .filter((item): item is FoodItem => item !== undefined),
    [],
  );

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length === 0) {
      return [];
    }
    return foodLibrary.filter(item =>
      item.name.toLowerCase().includes(term),
    );
  }, [query]);

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

  const addFood = useCallback((item: FoodItem) => {
    setFoods(current => [...current, toDraft(item)]);
    // Cleared so the next search starts from the library rather than from the
    // term that just produced a hit.
    setQuery('');
  }, []);

  const addCustomFood = useCallback((food: CustomFood) => {
    setFoods(current => [
      ...current,
      { key: nextKey(), emoji: '🍽️', ...food },
    ]);
    setQuery('');
  }, []);

  const removeFood = useCallback(
    (key: string) => setFoods(current => current.filter(food => food.key !== key)),
    [],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  const saveMeal = useCallback(() => {
    if (foods.length === 0) {
      return;
    }

    // The chosen day and time become the entry's timestamp, which is what
    // decides the day's bucket it lands in.
    const [hours, minutes] = time.split(':').map(Number);
    const at = fromIsoDate(date);
    at.setHours(hours, minutes, 0, 0);
    const loggedAt = at.toISOString();

    addEntries(
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

    toast.show({
      title: 'Meal saved',
      message: `${foods.length} ${
        foods.length === 1 ? 'item' : 'items'
      } added to your diary.`,
      tone: 'success',
    });

    onPressBack();
  }, [addEntries, date, foods, onPressBack, slot, time, toast]);

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
            onAdd={addFood}
            onPressAddCustom={openCustom}
          />
        ) : (
          <FoodQuickAddRow
            items={quickAdds}
            onAdd={addFood}
            onPressMore={openCustom}
          />
        )}

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
