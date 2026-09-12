import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { RewardTierCard, type RewardTier } from './RewardTierCard';

/**
 * What each rung pays, declared here rather than fetched.
 *
 * These are the product's rules, not the user's data — the same reasoning as
 * the streak's milestones. A screen that could not state the prizes until a
 * request came back would be a screen with no reason to exist while it waited.
 */
export const REWARD_TIERS: readonly RewardTier[] = [
  {
    id: 'rank-1',
    medal: '🥇',
    label: 'Rank 1',
    coins: 5_000,
    perks: ['Premium T-Shirt', 'Water Bottle'],
    scope: 'Country Rank',
    tint: 'gold',
  },
  {
    id: 'rank-2-3',
    medal: '🥈',
    label: 'Rank 2 – 3',
    coins: 3_000,
    perks: ['Premium T-Shirt', 'Fitness Mat'],
    scope: 'Country Rank',
    tint: 'textSecondary',
  },
  {
    id: 'rank-4-10',
    medal: '🥉',
    label: 'Rank 4 – 10',
    coins: 1_000,
    perks: ['Fitness Mat'],
    scope: 'Country Rank',
    tint: 'brandAccent',
  },
];

/**
 * The reward ladder, three rungs across.
 *
 * Across rather than down: the tiers are read against each other — what the
 * next place up is worth — and a stack of three rows makes that a scroll
 * instead of a glance.
 */
export const RewardTiersCard = memo(() => (
  <Card radius="xl" padding="base">
    <VStack gap="base">
      <HStack align="center" gap="sm">
        <Emoji size="sm">🎁</Emoji>
        <AppText variant="h3" numberOfLines={1} style={styles.title}>
          Leaderboard Reward Tiers
        </AppText>
      </HStack>

      <HStack align="stretch" gap="sm">
        {REWARD_TIERS.map(tier => (
          <RewardTierCard key={tier.id} tier={tier} />
        ))}
      </HStack>

      <HStack align="center" gap="xs">
        <Icon as={Info} size="xs" color="textTertiary" />
        <AppText variant="miniMicro" color="textTertiary" numberOfLines={2}>
          Rewards are given every week based on leaderboard ranking.
        </AppText>
      </HStack>
    </VStack>
  </Card>
));

RewardTiersCard.displayName = 'RewardTiersCard';

/**
 * Text in a row does not shrink by default, so a title longer than the card —
 * which the OS font scale alone can cause — runs past its edge rather than
 * truncating.
 */
const styles = StyleSheet.create({
  title: { flexShrink: 1 },
});
