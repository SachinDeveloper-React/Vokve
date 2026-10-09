import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { CalendarCheck } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { AchievementDetail } from '../../types/models';
import { formatCoins, formatClockTime } from '../../utils/format';
import { formatLongDate } from '../../utils/date';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { CoinBadge } from '../wallet/CoinBadge';

interface Props {
  detail: AchievementDetail;
}

/**
 * The two facts that do not need a card each: what it pays, and when it
 * landed.
 *
 * Side by side because they are the two halves of one answer — "was it worth
 * it, and when did I do it" — and because a badge that is still locked has
 * only the first of them, which would leave a full-width card half empty.
 *
 * The reward's caption is the server's. It is the one line that has to be able
 * to say the coins have not started yet (⚙ `coins.achievements.enabled`)
 * rather than letting the figure above it read as money already banked.
 */
export const AchievementFactsRow = memo(({ detail }: Props) => {
  const { colors } = useTheme();
  const { reward, unlockedAt, progress } = detail;

  return (
    <HStack align="stretch" gap="md">
      <Card radius="xl" padding="base" style={styles.half}>
        <HStack align="center" gap="md">
          <CoinBadge tint={colors.gold} size={36} halo />

          <VStack
            flex={1}
            gap="xxs"
            accessible
            accessibilityLabel={
              reward.coins > 0
                ? `Reward: ${formatCoins(reward.coins)} coins. ${reward.caption}`
                : reward.caption
            }
          >
            <AppText variant="micro" color="textSecondary">
              Reward
            </AppText>
            {reward.coins > 0 ? (
              <AppText
                variant="h2"
                numberOfLines={1}
                style={{ color: colors.brandAccent }}
              >
                {`${formatCoins(reward.coins)} coins`}
              </AppText>
            ) : (
              <AppText variant="bodyStrong" numberOfLines={2}>
                {reward.caption}
              </AppText>
            )}
            {reward.coins > 0 ? (
              <AppText variant="miniMicro" color="textTertiary" numberOfLines={2}>
                {reward.caption}
              </AppText>
            ) : null}
          </VStack>
        </HStack>
      </Card>

      <Card radius="xl" padding="base" style={styles.half}>
        <HStack align="center" gap="md">
          <IconBadge
            icon={CalendarCheck}
            tint={unlockedAt ? colors.success : colors.textTertiary}
            size={36}
          />

          <VStack flex={1} gap="xxs">
            <AppText variant="micro" color="textSecondary">
              {unlockedAt ? 'Unlocked On' : 'Not yet unlocked'}
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {unlockedAt && progress.completedOn
                ? formatLongDate(progress.completedOn)
                : '—'}
            </AppText>
            {unlockedAt ? (
              <AppText variant="miniMicro" color="textTertiary">
                {formatClockTime(unlockedAt)}
              </AppText>
            ) : null}
          </VStack>
        </HStack>
      </Card>
    </HStack>
  );
});

AchievementFactsRow.displayName = 'AchievementFactsRow';

const styles = StyleSheet.create({
  half: { flex: 1 },
});
