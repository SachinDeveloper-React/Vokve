import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CustomAmountSheet } from '../../components/hydration/CustomAmountSheet';
import { HydrationHeader } from '../../components/hydration/HydrationHeader';
import { HydrationLogCard } from '../../components/hydration/HydrationLogCard';
import { HydrationProgressCard } from '../../components/hydration/HydrationProgressCard';
import { HydrationStatsCard } from '../../components/hydration/HydrationStatsCard';
import { HydrationTipCard } from '../../components/hydration/HydrationTipCard';
import { QuickAddRow } from '../../components/hydration/QuickAddRow';
import { Screen } from '../../components/ui/Screen';
import { hydrationHighlights, hydrationTip } from '../../constants/seedData';
import {
  useHydrationStore,
  useTodayHydration,
  useTodayHydrationEntries,
} from '../../stores/hydrationStore';
import { useDailyWaterGoalMl } from '../../stores/settingsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * The day's water: how much has gone in, the ways to log more, and what was
 * logged so far.
 *
 * Everything on it is live from the hydration store — the figure at the top,
 * the glass, and the rows at the bottom are three views of one number, so a
 * tap on a quick-add moves all three at once. That is the whole argument for
 * the screen existing alongside the dashboard's hydration card: the card can
 * add water, but only this screen can take a mistaken tap back out.
 *
 * The streak, average and hit rate come from the seed rather than the store,
 * because they need a history of days and the store keeps only today. They are
 * the one part of the screen a real endpoint will replace wholesale.
 */
export const HydrationScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();

  const consumedMl = useTodayHydration();
  const entries = useTodayHydrationEntries();
  const goalMl = useDailyWaterGoalMl();
  const addWater = useHydrationStore(s => s.add);
  const removeEntry = useHydrationStore(s => s.remove);

  const [isCustomOpen, setCustomOpen] = useState(false);
  const openCustom = useCallback(() => setCustomOpen(true), []);
  const closeCustom = useCallback(() => setCustomOpen(false), []);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  // The history of past days has no screen yet. Wired as a no-op rather than
  // left off, so the link keeps the shape it will ship with and only the
  // handler changes when that screen lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <HydrationHeader onPressBack={onPressBack} />

        <HydrationProgressCard consumedMl={consumedMl} goalMl={goalMl} />

        <QuickAddRow onAdd={addWater} onPressCustom={openCustom} />

        <HydrationStatsCard
          bestStreakDays={hydrationHighlights.bestStreakDays}
          dailyAverageMl={hydrationHighlights.dailyAverageMl}
          goalHitRatePercent={hydrationHighlights.goalHitRatePercent}
          dailyReminders={hydrationHighlights.dailyReminders}
        />

        <HydrationLogCard
          entries={entries}
          onRemove={removeEntry}
          onPressHistory={notImplemented}
        />

        <HydrationTipCard tip={hydrationTip} />
      </ScrollView>

      <CustomAmountSheet
        visible={isCustomOpen}
        onSubmit={addWater}
        onClose={closeCustom}
      />
    </Screen>
  );
};
