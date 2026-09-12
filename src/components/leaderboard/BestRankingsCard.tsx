import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { formatCoins } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { RankingStatTile } from './RankingStatTile';

interface Props {
  bestRank: number;
  /** Already formatted for display — "12 May 2025". */
  bestRankAchievedOn: string;
  topTenFinishes: number;
  rewardCoinsEarned: number;
  rewardsWon: number;
}

/**
 * The user's own record on the board.
 *
 * Last, and the only card here about the reader rather than about the prizes
 * or the people winning them. A user who has never placed still sees the four
 * tiles — a best rank of nothing is a figure too, and hiding the strip until
 * they qualify would hide the very thing they are working towards.
 */
export const BestRankingsCard = memo(
  ({
    bestRank,
    bestRankAchievedOn,
    topTenFinishes,
    rewardCoinsEarned,
    rewardsWon,
  }: Props) => (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <VStack gap="xxs">
          <HStack align="center" gap="sm">
            <Emoji size="sm">📈</Emoji>
            <AppText variant="h3" numberOfLines={1} style={styles.title}>
              Your Best Rankings
            </AppText>
          </HStack>
          <AppText variant="micro" color="textSecondary">
            Track your performance over time
          </AppText>
        </VStack>

        <HStack align="stretch" gap="sm">
          <RankingStatTile
            emoji="🎖️"
            label="Best Rank"
            value={String(bestRank)}
            caption={`Achieved on ${bestRankAchievedOn}`}
          />
          <RankingStatTile
            emoji="🏆"
            label="Total Top 10"
            value={String(topTenFinishes)}
            caption="This Month"
          />
          <RankingStatTile
            emoji="⭐"
            label="Total Rewards"
            value={formatCoins(rewardCoinsEarned)}
            caption="Coins Earned"
          />
          <RankingStatTile
            emoji="🎁"
            label="Rewards Won"
            value={String(rewardsWon)}
            caption="This Month"
          />
        </HStack>
      </VStack>
    </Card>
  ),
);

BestRankingsCard.displayName = 'BestRankingsCard';

/**
 * Text in a row does not shrink by default, so a title longer than the card —
 * which the OS font scale alone can cause — runs past its edge rather than
 * truncating.
 */
const styles = StyleSheet.create({
  title: { flexShrink: 1 },
});
