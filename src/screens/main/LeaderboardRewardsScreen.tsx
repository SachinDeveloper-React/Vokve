import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
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
import { RewardTiersCard } from '../../components/leaderboard/RewardTiersCard';
import { Screen } from '../../components/ui/Screen';
import { leaderboardHighlights, seedLeaderboard } from '../../constants/seedData';
import { useCoinBalance } from '../../stores/coinsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';
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
 * The balance in the header is live from the coins store; the board and the
 * user's record come from the seed, because nothing here changes them.
 */
export const LeaderboardRewardsScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const { params } = useRoute<RootStackScreenProps<'LeaderboardRewards'>['route']>();
  const coins = useCoinBalance();

  const [tab, setTab] = useState<LeaderboardTab>(params?.tab ?? 'rewards');

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  // The full board has no screen yet. Wired as a no-op rather than left off, so
  // the link keeps the shape it will ship with and only the handler changes.
  const notImplemented = useCallback(() => {}, []);

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <LeaderboardHeader coins={coins} onPressBack={onPressBack} />

        <LeaderboardHeroBanner />

        <LeaderboardTabs value={tab} onChange={setTab} />

        {tab === 'rewards' ? (
          <>
            <RewardTiersCard />

            <CurrentLeaderboardCard
              entries={seedLeaderboard}
              onPressViewFull={notImplemented}
            />

            <BestRankingsCard
              bestRank={leaderboardHighlights.bestRank}
              bestRankAchievedOn={leaderboardHighlights.bestRankAchievedOn}
              topTenFinishes={leaderboardHighlights.topTenFinishes}
              rewardCoinsEarned={leaderboardHighlights.rewardCoinsEarned}
              rewardsWon={leaderboardHighlights.rewardsWon}
            />
          </>
        ) : (
          <LeaderboardHowItWorks />
        )}
      </ScrollView>
    </Screen>
  );
};
