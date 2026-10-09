import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { BestRankingsCard } from '../../components/leaderboard/BestRankingsCard';
import { CurrentLeaderboardCard } from '../../components/leaderboard/CurrentLeaderboardCard';
import { LeaderboardHeader } from '../../components/leaderboard/LeaderboardHeader';
import { LeaderboardHeroBanner } from '../../components/leaderboard/LeaderboardHeroBanner';
import { LeaderboardHowItWorks } from '../../components/leaderboard/LeaderboardHowItWorks';
import {
  LeaderboardTabs,
  type LeaderboardTab,
} from '../../components/leaderboard/LeaderboardTabs';
import {
  RewardTiersCard,
  toRewardTiers,
} from '../../components/leaderboard/RewardTiersCard';
import { LoadState } from '../../components/ui/LoadState';
import { Screen } from '../../components/ui/Screen';
import {
  useLeaderboardBoard,
  useLeaderboardHistory,
  useLeaderboardRules,
} from '../../hooks/useLeaderboard';
import { useCoinBalance } from '../../stores/coinsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { RootStackScreenProps } from '../../types/navigation';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * The leaderboard's reward side: what each place pays, who is holding those
 * places this week, and how the user has done on the board themselves.
 *
 * Two tabs rather than two screens. The prizes and the rules that award them
 * are the same subject asked about in two ways — "what do I get" and "how do I
 * get it" — and a user who opens one and wants the other is one tap away
 * rather than back out and in again.
 *
 * Which tab opens is a route param, so the challenge board's "How it Works?"
 * link can land on the rules while the account's rewards row lands on the
 * prizes. It is read once, as the initial state: after that the tab is the
 * user's, and a param that kept reasserting itself would snap the screen back
 * under them.
 *
 * Everything here is the server's: the prizes and the rules
 * (`GET /leaderboard/reward-tiers`, worded from the config in force), this
 * week's board for the user's country with their own place
 * (`GET /leaderboard`), and their record over closed weeks
 * (`GET /leaderboard/history`). Each card waits for its own answer.
 */
export const LeaderboardRewardsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RootStackScreenProps<'LeaderboardRewards'>['route']>();
  const coins = useCoinBalance();

  const [tab, setTab] = useState<LeaderboardTab>(params?.tab ?? 'rewards');

  const rules = useLeaderboardRules();
  const board = useLeaderboardBoard();
  const history = useLeaderboardHistory();

  const tiers = useMemo(
    () => (rules.data ? toRewardTiers(rules.data.tiers, rules.data.scope) : []),
    [rules.data],
  );
  // The card is a glance at who is winning; the rest is behind "View Full".
  const top = useMemo(() => board.data?.entries.slice(0, 5) ?? [], [board.data]);

  // A pull asks all three again; each card shows its own answer as it lands.
  const { reload: reloadRules } = rules;
  const { reload: reloadBoard } = board;
  const { reload: reloadHistory } = history;
  const onRefresh = useCallback(() => {
    reloadRules();
    reloadBoard();
    reloadHistory();
  }, [reloadBoard, reloadHistory, reloadRules]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  const onViewFullBoard = useCallback(
    () => navigation.navigate('LeaderboardBoard'),
    [navigation],
  );

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <LeaderboardHeader coins={coins} onPressBack={onPressBack} />

        <LeaderboardHeroBanner />

        <LeaderboardTabs value={tab} onChange={setTab} />

        {tab === 'rewards' ? (
          <>
            {rules.data ? (
              <RewardTiersCard tiers={tiers} note={rules.data.note} />
            ) : (
              <LoadState
                loading={rules.loading}
                title="Couldn't load the prizes"
                message={rules.error}
                onRetry={rules.reload}
              />
            )}

            {board.data ? (
              <CurrentLeaderboardCard
                entries={top}
                me={board.data.me}
                onPressViewFull={onViewFullBoard}
              />
            ) : (
              <LoadState
                loading={board.loading}
                title="Couldn't load the board"
                message={board.error}
                onRetry={board.reload}
              />
            )}

            {history.data ? (
              <BestRankingsCard
                bestRank={history.data.bestRank}
                bestRankAchievedOn={history.data.bestRankAchievedOn}
                topTenFinishes={history.data.topTenFinishes}
                rewardCoinsEarned={history.data.rewardCoinsEarned}
                rewardsWon={history.data.rewardsWon}
              />
            ) : (
              <LoadState
                loading={history.loading}
                title="Couldn't load your rankings"
                message={history.error}
                onRetry={history.reload}
              />
            )}
          </>
        ) : rules.data ? (
          <LeaderboardHowItWorks steps={rules.data.howItWorks} />
        ) : (
          <LoadState
            loading={rules.loading}
            title="Couldn't load how it works"
            message={rules.error}
            onRetry={rules.reload}
          />
        )}
      </ScrollView>
    </Screen>
  );
};
