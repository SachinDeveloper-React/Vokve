import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
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
import { Screen } from '../../components/ui/Screen';
import { seedAchievements, seedChallenges } from '../../constants/seedData';
import { useCurrentUser } from '../../stores/authStore';
import { useHasUnreadNotifications } from '../../stores/notificationsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
import type { Challenge } from '../../types/models';
import { todayIso, type IsoDate } from '../../utils/date';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * A challenge is running on a given day once its start date is not still in
 * front of that day. Challenges with no start date are always running.
 *
 * Measured against the day the user is looking at rather than against today,
 * so moving the date actually moves a challenge between the two cards: that is
 * what makes the calendar a control rather than a caption.
 */
const isActiveOn = (challenge: Challenge, date: IsoDate) =>
  challenge.startsAt === null || challenge.startsAt <= date;

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
 * Challenges and achievements come straight from the seed rather than through a
 * store: nothing on this screen changes them. The two lists are split on the
 * challenge's own start date, so a challenge cannot appear as both running and
 * upcoming however the data is ordered.
 *
 * It is a root route rather than a page of a tab. It is opened from Home's
 * shortcut row today and from the account's rewards later, and filing it under
 * one tab would leave that tab showing a challenge board the next time its own
 * icon was tapped.
 */
export const ChallengesScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const user = useCurrentUser();
  const hasUnreadNotifications = useHasUnreadNotifications();

  const [period, setPeriod] = useState<ChallengePeriod>('all');
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [isCalendarOpen, setCalendarOpen] = useState(false);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);

  const active = useMemo(
    () =>
      seedChallenges.filter(
        challenge =>
          isActiveOn(challenge, date) && matchesPeriod(challenge, period),
      ),
    [date, period],
  );

  // Soonest first: the card shows the top of the list, and a board that opened
  // with next month's challenge would bury the one starting tomorrow.
  const upcoming = useMemo(
    () =>
      seedChallenges
        .filter(
          challenge =>
            !isActiveOn(challenge, date) && matchesPeriod(challenge, period),
        )
        .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '')),
    [date, period],
  );

  // Earned first. The shelf is a record of what the user has done, and a first
  // page of padlocks would read as a list of failures.
  const achievements = useMemo(
    () =>
      [...seedAchievements].sort(
        (a, b) =>
          Number(b.achievedAt !== null) - Number(a.achievedAt !== null),
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

  // The full challenge list, the achievement shelf and the rules explainer have
  // no screens yet. Wired as no-ops rather than left off, so each control keeps
  // the shape it will ship with and only the handler changes when its screen
  // lands.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
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

        <ActiveChallengesCard
          challenges={active}
          onPressViewAll={notImplemented}
        />

        <ChallengeRewardStrip onPressHowItWorks={onOpenHowItWorks} />

        <AchievementsCard
          achievements={achievements}
          onPressViewAll={notImplemented}
        />

        <UpcomingChallengesCard
          challenges={upcoming}
          relativeTo={date}
          onPressViewAll={notImplemented}
        />

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
