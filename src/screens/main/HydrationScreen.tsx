import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CustomAmountSheet } from '../../components/hydration/CustomAmountSheet';
import { HydrationHeader } from '../../components/hydration/HydrationHeader';
import { HydrationLogCard } from '../../components/hydration/HydrationLogCard';
import { HydrationProgressCard } from '../../components/hydration/HydrationProgressCard';
import { HydrationStatsCard } from '../../components/hydration/HydrationStatsCard';
import { HydrationTipCard } from '../../components/hydration/HydrationTipCard';
import { QuickAddRow } from '../../components/hydration/QuickAddRow';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useTip } from '../../hooks/useContent';
import { useHydrationStats } from '../../hooks/useHydration';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import {
  useHydrationStore,
  useTodayHydrationView,
} from '../../stores/hydrationStore';
import { useDailyWaterGoalMl } from '../../stores/settingsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * The day's water: how much has gone in, the ways to log more, and what was
 * logged so far.
 *
 * The figure at the top, the glass and the rows at the bottom are three
 * views of one number — the server's day with this phone's unsent drinks
 * laid over it — so a tap on a quick-add moves all three at once, before the
 * network has answered. That is the whole argument for the screen existing
 * alongside the dashboard's hydration card: the card can add water, but only
 * this screen can take a mistaken tap back out.
 *
 * The best run, average and hit rate are the server's (`GET
 * /hydration/stats`), asked again whenever it confirms a drink; the tip is
 * the day's from the server's content.
 */
export const HydrationScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();

  const today = useTodayHydrationView();
  const goalMl = useDailyWaterGoalMl();
  const addWater = useHydrationStore(s => s.add);
  const removeEntry = useHydrationStore(s => s.remove);
  const isSyncing = useHydrationStore(s => s.isSyncing);
  const syncError = useHydrationStore(s => s.syncError);
  const hydrateFromServer = useHydrationStore(s => s.hydrateFromServer);
  const refreshIfStale = useHydrationStore(s => s.refreshIfStale);
  const stats = useHydrationStats();
  const tip = useTip('hydration');

  useRefreshOnFocus(refreshIfStale);

  const [isPulling, setPulling] = useState(false);
  const { reload: reloadStats } = stats;
  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await hydrateFromServer();
    } finally {
      reloadStats();
      setPulling(false);
    }
  }, [hydrateFromServer, reloadStats]);

  const [isCustomOpen, setCustomOpen] = useState(false);
  const openCustom = useCallback(() => setCustomOpen(true), []);
  const closeCustom = useCallback(() => setCustomOpen(false), []);

  const onOpenReminders = useCallback(
    () => navigation.navigate('HydrationReminder'),
    [navigation],
  );

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
        refreshControl={
          <RefreshControl
            refreshing={isPulling}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <HydrationHeader
          onPressBack={onPressBack}
          onPressReminders={onOpenReminders}
        />

        {today.synced ? (
          <HydrationProgressCard
            consumedMl={today.consumedMl}
            goalMl={goalMl}
          />
        ) : (
          <LoadState
            loading={isSyncing || syncError === null}
            title="Couldn't load today's water"
            message={syncError}
            onRetry={hydrateFromServer}
          />
        )}

        <QuickAddRow onAdd={addWater} onPressCustom={openCustom} />

        {stats.data ? (
          <HydrationStatsCard
            bestStreakDays={stats.data.bestStreakDays}
            dailyAverageMl={stats.data.dailyAverageMl}
            goalHitRatePercent={stats.data.goalHitRatePercent}
            dailyReminders={stats.data.reminderCount}
          />
        ) : (
          <LoadState
            loading={stats.loading}
            title="Couldn't load your water habit"
            message={stats.error}
            onRetry={stats.reload}
          />
        )}

        {today.synced ? (
          <HydrationLogCard
            entries={today.entries}
            onRemove={removeEntry}
            onPressHistory={notImplemented}
          />
        ) : null}

        {tip ? <HydrationTipCard tip={tip.text} /> : null}
      </ScrollView>

      <CustomAmountSheet
        visible={isCustomOpen}
        onSubmit={addWater}
        onClose={closeCustom}
      />
    </Screen>
  );
};
