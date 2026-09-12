import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { DateChip } from '../../components/streak/DateChip';
import { StreakBenefitsCard } from '../../components/streak/StreakBenefitsCard';
import { StreakCalendarCard } from '../../components/streak/StreakCalendarCard';
import { StreakCheerCard } from '../../components/streak/StreakCheerCard';
import { StreakHeader } from '../../components/streak/StreakHeader';
import { StreakSummaryCard } from '../../components/streak/StreakSummaryCard';
import { StreakToolsCard } from '../../components/streak/StreakToolsCard';
import { Screen } from '../../components/ui/Screen';
import { useToast } from '../../components/feedback/Toast';
import { useCurrentUser } from '../../stores/authStore';
import { useCoinBalance, useCoinsStore } from '../../stores/coinsStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import {
  STREAK_RESTORE_COST,
  useCanRestore,
  useCompletedDays,
  useCountingDays,
  useCurrentStreak,
  useFreezesAvailable,
  useLongestStreak,
  useProtectedDays,
  useStreakStore,
} from '../../stores/streakStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { addDays, fromIsoDate, todayIso } from '../../utils/date';
import { formatCoins } from '../../utils/format';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * The streak: how long it is, how long it has ever been, the calendar that
 * proves it, and the two tools for keeping it alive.
 *
 * Both figures come from the streak store, never from `user.streakDays` —
 * the calendar is drawn from the same day list the figures are counted from,
 * so the number at the top and the run the user can see below it cannot
 * disagree.
 *
 * The coins a restore costs are charged here, through the coins store, and
 * only after the streak store has confirmed there is a gap to bridge: the two
 * stores do not know about each other, and this screen is the one place that
 * makes "50 coins for a restore" a single transaction.
 */
export const StreakScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const toast = useToast();
  const user = useCurrentUser();

  const today = todayIso();
  const completedDays = useCompletedDays();
  const protectedDays = useProtectedDays();
  const countingDays = useCountingDays();
  const currentStreak = useCurrentStreak();
  const longestStreak = useLongestStreak();
  const freezesAvailable = useFreezesAvailable();
  const canRestore = useCanRestore();
  const hasUnreadNotifications = useHasUnreadNotifications();
  const freezeToday = useStreakStore(s => s.freezeToday);
  const restore = useStreakStore(s => s.restore);

  const balance = useCoinBalance();
  const spend = useCoinsStore(s => s.spend);

  const completedSet = useMemo(() => new Set(completedDays), [completedDays]);
  const protectedSet = useMemo(() => new Set(protectedDays), [protectedDays]);

  // The days of the live run, for the calendar to draw on a disc. Counted
  // back from today, or from yesterday when today is not yet done.
  const streakDays = useMemo(() => {
    const days = new Set<string>();
    if (currentStreak === 0) return days;
    let cursor = countingDays.has(today) ? today : addDays(today, -1);
    for (let i = 0; i < currentStreak; i++) {
      days.add(cursor);
      cursor = addDays(cursor, -1);
    }
    return days;
  }, [countingDays, currentStreak, today]);

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

  const handleFreeze = useCallback(() => {
    if (freezeToday()) {
      toast.show({
        title: 'Streak Freeze active',
        message: 'Today is covered. Your streak is safe until tomorrow.',
        tone: 'success',
      });
    } else if (freezesAvailable === 0) {
      toast.show({
        title: 'No freezes left',
        message: 'Earn more by hitting your next streak milestone.',
        tone: 'warning',
      });
    } else {
      toast.show({
        title: 'Already covered',
        message: 'Today already counts — save the freeze for a rest day.',
        tone: 'info',
      });
    }
  }, [freezeToday, freezesAvailable, toast]);

  const handleRestore = useCallback(() => {
    if (!canRestore) {
      toast.show({
        title: 'Nothing to restore',
        message:
          currentStreak > 0
            ? 'Your streak is intact. Keep it going!'
            : 'Your last streak ended too long ago to bring back.',
        tone: 'info',
      });
      return;
    }
    if (balance < STREAK_RESTORE_COST) {
      toast.show({
        title: 'Not enough coins',
        message: `A restore costs ${formatCoins(STREAK_RESTORE_COST)} coins.`,
        tone: 'warning',
      });
      return;
    }
    // Charge first, then restore: `spend` is the call that can still refuse
    // (a stale balance), and a restore with no charge is the wrong failure.
    if (
      spend(STREAK_RESTORE_COST, 'Streak restored', 'purchase') &&
      restore()
    ) {
      toast.show({
        title: 'Streak restored',
        message: 'The missed days are covered. Back on track!',
        tone: 'success',
      });
    }
  }, [balance, canRestore, currentStreak, restore, spend, toast]);

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

  // Names the Account stack's first screen explicitly: the avatar means "my
  // account", not "wherever I last was inside that tab".
  const onOpenAccount = useCallback(
    () =>
      navigation.navigate('Main', {
        screen: 'Account',
        params: { screen: 'AccountHome' },
      }),
    [navigation],
  );

  const onOpenNotifications = useCallback(
    () => navigation.navigate('Notifications'),
    [navigation],
  );

  // Explainers the app has not written yet. Wired as no-ops rather than left
  // off, so the ⓘ and the link keep their place and only the handler changes.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <StreakHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressBack={onPressBack}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
        />

        <DateChip date={today} onPress={showToday} />

        <StreakSummaryCard
          currentStreak={currentStreak}
          longestStreak={longestStreak}
          onPressInfo={notImplemented}
        />

        <StreakCalendarCard
          year={visible.year}
          month={visible.month}
          today={today}
          completedDays={completedSet}
          protectedDays={protectedSet}
          streakDays={streakDays}
          freezesAvailable={freezesAvailable}
          isTodayFrozen={protectedSet.has(today)}
          onPreviousMonth={previousMonth}
          onNextMonth={nextMonth}
          canGoNext={!isCurrentMonth}
          onPressInfo={notImplemented}
          onPressHowItWorks={notImplemented}
        />

        <StreakBenefitsCard
          longestStreak={longestStreak?.length ?? 0}
          onPressInfo={notImplemented}
        />

        <StreakToolsCard
          freezesAvailable={freezesAvailable}
          restoreCostCoins={STREAK_RESTORE_COST}
          onPressFreeze={handleFreeze}
          onPressRestore={handleRestore}
        />

        <StreakCheerCard name={user?.name} currentStreak={currentStreak} />
      </ScrollView>
    </Screen>
  );
};
