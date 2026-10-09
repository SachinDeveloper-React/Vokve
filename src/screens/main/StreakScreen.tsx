import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StreakBenefitsCard } from '../../components/streak/StreakBenefitsCard';
import { StreakCalendarCard } from '../../components/streak/StreakCalendarCard';
import { StreakDetailHeader } from '../../components/streak/StreakDetailHeader';
import { StreakFiguresCard } from '../../components/streak/StreakFiguresCard';
import { StreakGapAlert } from '../../components/streak/StreakGapAlert';
import { StreakHistoryCard } from '../../components/streak/StreakHistoryCard';
import {
  StreakFreezeCard,
  StreakRestoreCard,
} from '../../components/streak/StreakToolCard';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/media/Icon';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useToast } from '../../components/feedback/Toast';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useStreakHistory } from '../../hooks/useStreakHistory';
import { ArrowRight } from 'lucide-react-native';
import { useCoinBalance, useWalletSyncedAt } from '../../stores/coinsStore';
import { useStreakStore } from '../../stores/streakStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { addDays, fromIsoDate, todayIso } from '../../utils/date';
import { formatCoins } from '../../utils/format';

const makeStyles = ({ spacing, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xl, gap: spacing.md },
    /** Bleeds through the screen's gutter so the rule runs edge to edge. */
    bar: {
      marginHorizontal: -spacing.base,
      paddingHorizontal: spacing.base,
      paddingTop: spacing.md,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
  });

/**
 * The streak: how long it is, how long it has ever been, the calendar that
 * proves it, and the two tools for keeping it alive.
 *
 * Everything here is the server's (`GET /streak`): which days counted, the
 * two figures, the freezes, the milestones and what a restore costs. The
 * calendar and the figures come from the same answer, so the number at the
 * top and the run the user can see below it cannot disagree. A freeze and a
 * restore are asked of the server, which charges for a restore in the same
 * transaction that protects the days — the screen only says what happened.
 */
export const StreakScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();

  const summary = useStreakStore(s => s.summary);
  const isSyncing = useStreakStore(s => s.isSyncing);
  const syncError = useStreakStore(s => s.syncError);
  const pendingAction = useStreakStore(s => s.pendingAction);
  const hydrateFromServer = useStreakStore(s => s.hydrateFromServer);
  const refreshIfStale = useStreakStore(s => s.refreshIfStale);
  const freezeToday = useStreakStore(s => s.freezeToday);
  const restore = useStreakStore(s => s.restore);
  const balance = useCoinBalance();
  const walletSynced = useWalletSyncedAt() !== null;

  useRefreshOnFocus(refreshIfStale);

  // The record behind the figures (`GET /streak/history`). Its own read
  // rather than part of the summary: the summary is one small answer the
  // whole screen waits on, and a month of days does not belong inside it.
  const history = useStreakHistory();

  // The server's today, so the calendar and the figures agree on it; the
  // phone's own before the first answer.
  const today = summary?.today ?? todayIso();

  const completedSet = useMemo(
    () => new Set(summary?.completedDays ?? []),
    [summary],
  );
  const protectedSet = useMemo(
    () => new Set(summary?.protectedDays ?? []),
    [summary],
  );

  // The days of the live run, for the calendar to draw on a disc. Counted
  // back from today, or from yesterday when today is not yet covered.
  const streakDays = useMemo(() => {
    const days = new Set<string>();
    if (!summary || summary.currentStreak === 0) return days;
    let cursor = summary.todayCovered ? today : addDays(today, -1);
    for (let i = 0; i < summary.currentStreak; i++) {
      days.add(cursor);
      cursor = addDays(cursor, -1);
    }
    return days;
  }, [summary, today]);

  const now = fromIsoDate(today);
  const [visible, setVisible] = useState({
    year: now.getFullYear(),
    month: now.getMonth(),
  });
  const isCurrentMonth =
    visible.year === now.getFullYear() && visible.month === now.getMonth();

  const showToday = useCallback(
    () => setVisible({ year: now.getFullYear(), month: now.getMonth() }),
    [now],
  );
  const previousMonth = useCallback(
    () =>
      setVisible(v =>
        v.month === 0
          ? { year: v.year - 1, month: 11 }
          : { year: v.year, month: v.month - 1 },
      ),
    [],
  );
  const nextMonth = useCallback(
    () =>
      setVisible(v =>
        v.month === 11
          ? { year: v.year + 1, month: 0 }
          : { year: v.year, month: v.month + 1 },
      ),
    [],
  );

  // The spinner follows the pull, not the background refresh on focus.
  const [isPulling, setPulling] = useState(false);
  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await hydrateFromServer();
    } finally {
      setPulling(false);
    }
  }, [hydrateFromServer]);

  const handleFreeze = useCallback(async () => {
    const result = await freezeToday();
    if (result.ok) {
      toast.show({
        title: 'Streak Freeze active',
        message: 'Today is covered. Your streak is safe until tomorrow.',
        tone: 'success',
      });
      return;
    }
    switch (result.code) {
      case 'IN_PROGRESS':
        return;
      case 'NO_FREEZES_LEFT':
        toast.show({
          title: 'No freezes left',
          message: result.message,
          tone: 'warning',
        });
        return;
      case 'STREAK_ALREADY_COVERED':
        toast.show({
          title: 'Already covered',
          message: result.message,
          tone: 'info',
        });
        return;
      default:
        toast.show({
          title: "Couldn't freeze today",
          message: result.message,
          tone: 'error',
        });
    }
  }, [freezeToday, toast]);

  const handleRestore = useCallback(async () => {
    if (!summary) return;
    // The server would refuse both of these; saying so here saves the trip.
    if (!summary.canRestore) {
      toast.show({
        title: 'Nothing to restore',
        message:
          summary.currentStreak > 0
            ? 'Your streak is intact. Keep it going!'
            : 'Your last streak ended too long ago to bring back.',
        tone: 'info',
      });
      return;
    }
    if (walletSynced && balance < summary.restoreCostCoins) {
      toast.show({
        title: 'Not enough coins',
        message: `A restore costs ${formatCoins(
          summary.restoreCostCoins,
        )} coins.`,
        tone: 'warning',
      });
      return;
    }

    const result = await restore();
    if (result.ok) {
      toast.show({
        title: 'Streak restored',
        message: 'The missed days are covered. Back on track!',
        tone: 'success',
      });
      return;
    }
    switch (result.code) {
      case 'IN_PROGRESS':
        return;
      case 'INSUFFICIENT_COINS':
        toast.show({
          title: 'Not enough coins',
          message: result.message,
          tone: 'warning',
        });
        return;
      case 'NOTHING_TO_RESTORE':
        toast.show({
          title: 'Nothing to restore',
          message: result.message,
          tone: 'info',
        });
        return;
      default:
        toast.show({
          title: "Couldn't restore your streak",
          message: result.message,
          tone: 'error',
        });
    }
  }, [balance, restore, summary, toast, walletSynced]);

  // A notification tap or a deep link can open the app straight onto this
  // screen, and `goBack` with nothing behind it is silently a no-op — the
  // chevron would look broken. Home is where the fallback lands.
  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  // The "?" and the calendar's "How it Works?" both ask the same question —
  // what makes a day count — which the app guide answers in full.
  const onPressHelp = useCallback(
    () => navigation.navigate('AppGuide'),
    [navigation],
  );

  const onViewAllHistory = useCallback(
    () => navigation.navigate('StreakHistory'),
    [navigation],
  );

  // The gap banner is a shortcut to the two tools, which are the next thing
  // down the screen: a restore is what it is really offering, so it goes
  // straight there rather than scrolling and leaving the user to find it.
  const onPressGap = useCallback(() => {
    handleRestore();
  }, [handleRestore]);

  // Where the streak is actually kept: the step tracker. The label changes
  // with the day — there is nothing to save on a day already covered — but
  // the destination does not, because watching the figure move is the point
  // either way.
  const onPressKeepAlive = useCallback(
    () => navigation.navigate('StepTracking'),
    [navigation],
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <StreakDetailHeader
        onPressBack={onPressBack}
        onPressHelp={onPressHelp}
      />

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
        {summary === null ? (
          <LoadState
            loading={isSyncing || syncError === null}
            title="Couldn't load your streak"
            message={syncError}
            onRetry={hydrateFromServer}
          />
        ) : (
          <>
            <StreakFiguresCard
              currentStreak={summary.currentStreak}
              longestStreak={summary.longestStreak}
              howToEarn={summary.howToEarn}
            />

            <StreakCalendarCard
              year={visible.year}
              month={visible.month}
              today={today}
              completedDays={completedSet}
              protectedDays={protectedSet}
              streakDays={streakDays}
              freezesAvailable={summary.freezesAvailable}
              isTodayFrozen={summary.todayFrozen}
              onPreviousMonth={previousMonth}
              onNextMonth={nextMonth}
              canGoNext={!isCurrentMonth}
              onPressToday={showToday}
              onPressHowItWorks={onPressHelp}
            />

            {summary.canRestore ? (
              <StreakGapAlert
                missedDays={summary.restoreGap.length}
                onPress={onPressGap}
              />
            ) : null}

            <StreakFreezeCard
              available={summary.freezesAvailable}
              maxFreezes={summary.maxFreezes}
              pending={pendingAction === 'freeze'}
              disabled={pendingAction === 'restore'}
              onPress={handleFreeze}
            />

            <StreakRestoreCard
              costCoins={summary.restoreCostCoins}
              gapDays={summary.restoreGap.length}
              pending={pendingAction === 'restore'}
              disabled={pendingAction === 'freeze'}
              onPress={handleRestore}
            />

            <StreakHistoryCard
              days={history.days}
              loading={history.isLoading}
              total={history.total}
              onPressViewAll={onViewAllHistory}
            />

            {/* Not on the design, kept because it is the only place the
                milestone rewards are stated. */}
            <StreakBenefitsCard milestones={summary.milestones} />
          </>
        )}
      </ScrollView>

      {summary === null ? null : (
        <View style={styles.bar}>
          {summary.todayCovered ? (
            <AppText variant="caption" color="textSecondary" center>
              Today already counts — your streak is safe.
            </AppText>
          ) : (
            <Button
              label="Keep Your Streak Alive"
              variant="brand"
              size="lg"
              fullWidth
              onPress={onPressKeepAlive}
              icon={
                <Icon
                  as={ArrowRight}
                  size="sm"
                  tint={colors.primaryForeground}
                />
              }
              iconPosition="trailing"
            />
          )}
        </View>
      )}
    </Screen>
  );
};
