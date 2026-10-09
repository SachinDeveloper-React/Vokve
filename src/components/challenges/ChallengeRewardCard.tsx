import React, { memo, useCallback } from 'react';
import { Lock } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { ChallengeDetail } from '../../types/models';
import { formatCoins } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { CoinBadge } from '../wallet/CoinBadge';

interface Props {
  reward: ChallengeDetail['reward'];
  /** Whether this period's goal has already been reached and paid. */
  completed: boolean;
  /** Opens the badge this challenge pays. Left off, it is a readout. */
  onPressBadge?: (id: string) => void;
}

/**
 * What finishing pays: the coins, and the badge if there is one.
 *
 * The caption above the figure is the server's ("Complete all 7 days to earn")
 * rather than a sentence assembled here, because what counts as finishing
 * differs by challenge — seven goal days, a week's steps, today alone — and an
 * app that guessed would promise the wrong thing the first time an owner
 * changed a cadence.
 *
 * The badge shows its own state. A shelf badge the member already has is worth
 * saying so about: it is the difference between "finish this for a badge" and
 * "finish this for the coins — you have the badge". It is also the way to that
 * badge's own screen, which is where the rest of its ladder is.
 */
export const ChallengeRewardCard = memo(
  ({ reward, completed, onPressBadge }: Props) => {
    const { colors } = useTheme();
    const badge = reward.badge;
    const badgeEarned = badge?.achievedAt != null;

    const press = useCallback(() => {
      if (badge) onPressBadge?.(badge.id);
    }, [badge, onPressBadge]);

    const label = badge
      ? `${badge.label} badge, ${
          badgeEarned ? 'already on your shelf' : 'not yet unlocked'
        }`
      : '';

    const badgeBody = badge ? (
      <VStack align="center" gap="xxs">
        {badgeEarned ? (
          <Emoji size="lg">🎁</Emoji>
        ) : (
          <Icon as={Lock} size="md" color="textTertiary" />
        )}
        <AppText
          variant="miniMicro"
          center
          numberOfLines={2}
          style={{ color: colors.brandAccent }}
        >
          {badgeEarned ? badge.label : `+ ${badge.label}`}
        </AppText>
      </VStack>
    ) : null;

    return (
      <Card radius="xl" padding="base">
        <HStack align="center" gap="md">
          <CoinBadge tint={colors.gold} size={44} halo />

          <VStack flex={1} gap="xxs">
            <AppText variant="h3">Challenge Reward</AppText>
            <AppText variant="micro" color="textSecondary" numberOfLines={2}>
              {completed ? 'Already earned this period' : reward.caption}
            </AppText>
            <AppText variant="h1" style={{ color: colors.brandAccent }}>
              {`${formatCoins(reward.coins)} coins`}
            </AppText>
          </VStack>

          {badge && onPressBadge ? (
            <Pressable
              onPress={press}
              feedback="scale"
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityHint="Opens this achievement"
            >
              {badgeBody}
            </Pressable>
          ) : badge ? (
            <VStack accessible accessibilityLabel={label}>
              {badgeBody}
            </VStack>
          ) : null}
        </HStack>
      </Card>
    );
  },
);

ChallengeRewardCard.displayName = 'ChallengeRewardCard';
