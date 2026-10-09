import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActiveChallengesCard } from '../../components/challenges/ActiveChallengesCard';
import {
  ChallengePeriodFilter,
  type ChallengePeriod,
} from '../../components/challenges/ChallengePeriodFilter';
import { UpcomingChallengesCard } from '../../components/challenges/UpcomingChallengesCard';
import { CalendarSheet } from '../../components/form/CalendarSheet';
import { PageHeader } from '../../components/layout/PageHeader';
import { FilterChips, type FilterOption } from '../../components/ui/FilterChips';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import { useChallengeBoard } from '../../hooks/useChallenges';
import { syncStepsNow } from '../../services/steps';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { Challenge } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';
import { formatDateRange, todayIso, type IsoDate } from '../../utils/date';

type Kind = 'active' | 'upcoming';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

const matchesPeriod = (challenge: Challenge, period: ChallengePeriod) =>
  period === 'all' || challenge.cadence === period;

/**
 * Every challenge of one kind, for one day.
 *
 * What the board's "View All" leads to. The board shows three of each because
 * it has an achievement shelf and an upcoming list to fit underneath; this
 * screen has only the one list, so it shows the lot — which is the whole
 * reason to leave the board for it.
 *
 * Both kinds live here behind two chips rather than on two screens. They are
 * the same list asked about twice — "what can I do now" and "what is next" —
 * and a user who opened one and wanted the other would otherwise have to go
 * back through the board to reach it.
 *
 * The day and the cadence are carried over from the board, so arriving here
 * does not silently widen what the user was looking at. Both stay screen state
 * afterwards, for the same reason they are screen state on the board: they are
 * ways of looking at the list, not facts about it.
 */
export const ChallengeListScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RootStackScreenProps<'ChallengeList'>['route']>();

  const [kind, setKind] = useState<Kind>(params?.kind ?? 'active');
  const [date, setDate] = useState<IsoDate>(params?.date ?? todayIso());
  const [period, setPeriod] = useState<ChallengePeriod>('all');
  const [isCalendarOpen, setCalendarOpen] = useState(false);

  const openCalendar = useCallback(() => setCalendarOpen(true), []);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);

  const board = useChallengeBoard(date);

  // The same split the board makes, on the challenge's own start date: a
  // challenge cannot be in both lists however the server happens to order them.
  const active = useMemo(
    () =>
      (board.data ?? []).filter(
        challenge =>
          challenge.startsAt === null && matchesPeriod(challenge, period),
      ),
    [board.data, period],
  );

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

  // Counted after the cadence filter, so a chip that says 4 is followed by
  // four rows rather than by whatever the filter leaves of them.
  const kinds = useMemo<readonly FilterOption<Kind>[]>(
    () => [
      { value: 'active', label: 'Active', count: active.length },
      { value: 'upcoming', label: 'Upcoming', count: upcoming.length },
    ],
    [active.length, upcoming.length],
  );

  const [refreshing, setRefreshing] = useState(false);
  const { reload } = board;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncStepsNow();
    } finally {
      reload();
      setRefreshing(false);
    }
  }, [reload]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Challenges');
  }, [navigation]);

  const onOpenChallenge = useCallback(
    (id: string) => navigation.navigate('ChallengeDetail', { id, date }),
    [date, navigation],
  );

  // The period the day falls in, so the header says what "today" covers
  // without the user having to work it out from the rows.
  const subtitle =
    kind === 'active'
      ? `Open on ${formatDateRange(date, date)}`
      : 'Opening over the next few weeks';

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
        <PageHeader
          title="All Challenges"
          subtitle={subtitle}
          onPressBack={onPressBack}
        />

        <FilterChips options={kinds} value={kind} onChange={setKind} />

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
        ) : kind === 'active' ? (
          <ActiveChallengesCard
            challenges={active}
            max={active.length}
            onPressChallenge={onOpenChallenge}
          />
        ) : (
          <UpcomingChallengesCard
            challenges={upcoming}
            relativeTo={date}
            max={upcoming.length}
            onPressChallenge={onOpenChallenge}
          />
        )}
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
