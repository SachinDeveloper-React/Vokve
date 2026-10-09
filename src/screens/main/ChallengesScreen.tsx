import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AchievementsCard } from '../../components/challenges/AchievementsCard';
import { ActiveChallengesCard } from '../../components/challenges/ActiveChallengesCard';
import { ChallengeCheerCard } from '../../components/challenges/ChallengeCheerCard';
import { ChallengeRewardStrip } from '../../components/challenges/ChallengeRewardStrip';
import {
  ChallengePeriodFilter,
  type ChallengePeriod,
} from '../../components/challenges/ChallengePeriodFilter';
import { ChallengesHeader } from '../../components/challenges/ChallengesHeader';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { UpcomingChallengesCard } from '../../components/challenges/UpcomingChallengesCard';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useAchievements, useChallengeBoard } from '../../hooks/useChallenges';
import { syncStepsNow } from '../../services/steps';
import { useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { Challenge } from '../../types/models';
import { todayIso, type IsoDate } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

const matchesPeriod = (challenge: Challenge, period: ChallengePeriod) =>
  period === 'all' || challenge.cadence === period;

/**
 * The challenge board: what is running, what it has already won the user, and
 * what opens next.
 *
 * The cadence filter and the chosen day are screen state rather than store
 * state — they are ways of looking at the board, not facts about it, and a
 * filter that survived into the next visit would greet the user with a board
 * that is missing challenges for no reason they can see.
 *
 * The board is the server's for the chosen day (`GET /challenges?date=`):
 * which challenges are open, how far the user has got with each — counted
 * from verified activity — and which completed; the shelf is
 * `GET /achievements`. Both are read again when a step sync lands and on a
 * pull. The two lists are split on the challenge's own start date, so a
 * challenge cannot appear as both running and upcoming however the data is
 * ordered.
 *
 * Each row opens that challenge in full (`ChallengeDetail`), carrying the day
 * the board is showing, so the detail is about the same period the row was.
 *
 * It is a root route rather than a page of a tab. It is opened from Home's
 * shortcut row today and from the account's rewards later, and filing it under
 * one tab would leave that tab showing a challenge board the next time its own
 * icon was tapped.
 */
export const ChallengesScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = useCurrentUser();
  const hasUnreadNotifications = useHasUnreadNotifications();

  const [period, setPeriod] = useState<ChallengePeriod>('all');
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [isCalendarOpen, setCalendarOpen] = useState(false);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);

  const board = useChallengeBoard(date);
  const shelf = useAchievements();

  const active = useMemo(
    () =>
      (board.data ?? []).filter(
        challenge =>
          challenge.startsAt === null && matchesPeriod(challenge, period),
      ),
    [board.data, period],
  );

  // Soonest first: the card shows the top of the list, and a board that opened
  // with next month's challenge would bury the one starting tomorrow.
  const upcoming = useMemo(
    () =>
      (board.data ?? [])
        .filter(
          challenge =>
            challenge.startsAt !== null && matchesPeriod(challenge, period),
        )
        .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '')),
    [board.data, period],
  );

  // Earned first. The shelf is a record of what the user has done, and a first
  // page of padlocks would read as a list of failures.
  const achievements = useMemo(
    () =>
      [...(shelf.data ?? [])].sort(
        (a, b) =>
          Number(b.achievedAt !== null) - Number(a.achievedAt !== null),
      ),
    [shelf.data],
  );

  // Pulling down sends what this phone has counted — the progress moves with
  // it — and asks for the board and the shelf again.
  const [refreshing, setRefreshing] = useState(false);
  const { reload: reloadBoard } = board;
  const { reload: reloadShelf } = shelf;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncStepsNow();
    } finally {
      reloadBoard();
      reloadShelf();
      setRefreshing(false);
    }
  }, [reloadBoard, reloadShelf]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  const onOpenNotifications = useCallback(
    () => navigation.navigate('Notifications'),
    [navigation],
  );

  // Straight to the rules half: the strip asks "how does this work?", and
  // landing on the prize table would answer a different question.
  const onOpenHowItWorks = useCallback(
    () => navigation.navigate('LeaderboardRewards', { tab: 'how' }),
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

  // Tapping a row opens that challenge in full, for the day the board is
  // showing — so a member looking back at Tuesday opens Tuesday's challenge
  // rather than today's.
  const onOpenChallenge = useCallback(
    (id: string) => navigation.navigate('ChallengeDetail', { id, date }),
    [date, navigation],
  );

  // "View All" on either list opens that list in full, carrying the day the
  // board is showing so the screen behind the link covers the same period.
  const onViewAllActive = useCallback(
    () => navigation.navigate('ChallengeList', { kind: 'active', date }),
    [date, navigation],
  );

  const onViewAllUpcoming = useCallback(
    () => navigation.navigate('ChallengeList', { kind: 'upcoming', date }),
    [date, navigation],
  );

  const onViewAllAchievements = useCallback(
    () => navigation.navigate('Achievements'),
    [navigation],
  );

  const onOpenAchievement = useCallback(
    (id: string) => navigation.navigate('AchievementDetail', { id }),
    [navigation],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <ChallengesHeader
          name={user?.name}
          avatarUri={user?.avatarUrl}
          hasUnreadNotifications={hasUnreadNotifications}
          onPressBack={onPressBack}
          onPressNotifications={onOpenNotifications}
          onPressAvatar={onOpenAccount}
        />

        <ChallengePeriodFilter
          date={date}
          value={period}
          onChange={setPeriod}
          onPressDate={openCalendar}
        />

        {board.data === null ? (
          <LoadState
            loading={board.loading}
            title="Couldn't load the challenges"
            message={board.error}
            onRetry={board.reload}
          />
        ) : (
          <ActiveChallengesCard
            challenges={active}
            onPressViewAll={onViewAllActive}
            onPressChallenge={onOpenChallenge}
          />
        )}

        <ChallengeRewardStrip onPressHowItWorks={onOpenHowItWorks} />

        {shelf.data === null ? (
          <LoadState
            loading={shelf.loading}
            title="Couldn't load your achievements"
            message={shelf.error}
            onRetry={shelf.reload}
          />
        ) : (
          <AchievementsCard
            achievements={achievements}
            onPressViewAll={onViewAllAchievements}
            onPressAchievement={onOpenAchievement}
          />
        )}

        {board.data !== null ? (
          <UpcomingChallengesCard
            challenges={upcoming}
            relativeTo={date}
            onPressViewAll={onViewAllUpcoming}
            onPressChallenge={onOpenChallenge}
          />
        ) : null}

        <ChallengeCheerCard name={user?.name} />
      </ScrollView>

      <CalendarSheet
        visible={isCalendarOpen}
        value={date}
        onChange={setDate}
        onClose={closeCalendar}
        title="Show challenges for"
      />
    </Screen>
  );
};
