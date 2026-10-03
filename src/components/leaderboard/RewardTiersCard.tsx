import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import type { RewardTierInfo } from '../../types/models';
import {
  RewardTierCard,
  type RewardTier,
  type TierTint,
} from './RewardTierCard';

/** The podium, rung by rung; a ladder longer than three gets the third's look. */
const MEDALS = ['🥇', '🥈', '🥉'];
const TINTS: readonly TierTint[] = ['gold', 'textSecondary', 'brandAccent'];

/**
 * The server's tiers in the card's own terms. The prizes are the server's
 * (⚙ `leaderboard.tiers`, RULES L7); the medals and colours are only how
 * the card tells the rungs apart.
 */
export function toRewardTiers(
  tiers: readonly RewardTierInfo[],
  scope: string,
): RewardTier[] {
  return tiers.map((tier, index) => ({
    id: tier.id,
    medal: MEDALS[Math.min(index, MEDALS.length - 1)],
    label: tier.label,
    coins: tier.coins,
    perks: tier.perks,
    scope: `${scope} Rank`,
    tint: TINTS[Math.min(index, TINTS.length - 1)],
  }));
}

interface Props {
  tiers: readonly RewardTier[];
  /** The line under the rungs, in the server's words. */
  note: string;
}

/**
 * The reward ladder, three rungs across.
 *
 * Across rather than down: the tiers are read against each other — what the
 * next place up is worth — and a stack of three rows makes that a scroll
 * instead of a glance.
 */
export const RewardTiersCard = memo(({ tiers, note }: Props) => (
  <Card radius="xl" padding="base">
    <VStack gap="base">
      <HStack align="center" gap="sm">
        <Emoji size="sm">🎁</Emoji>
        <AppText variant="h3" numberOfLines={1} style={styles.title}>
          Leaderboard Reward Tiers
        </AppText>
      </HStack>

      <HStack align="stretch" gap="sm">
        {tiers.map(tier => (
          <RewardTierCard key={tier.id} tier={tier} />
        ))}
      </HStack>

      <HStack align="center" gap="xs">
        <Icon as={Info} size="xs" color="textTertiary" />
        <AppText variant="miniMicro" color="textTertiary" numberOfLines={2}>
          {note}
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
