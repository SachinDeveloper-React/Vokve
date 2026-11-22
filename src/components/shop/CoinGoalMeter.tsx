import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { CircleCheck, Coins } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { CoinGoal, GoalStatus } from '../../utils/coinGoal';
import { formatCoins } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { ProgressBar } from '../ui/ProgressBar';

interface Props {
  goal: CoinGoal;
  status: GoalStatus;
  /**
   * `compact` is for a shelf card's narrow column: the bar, then the
   * figures and how many to go on one line. `regular` is for a page: the
   * figures and the percentage over the bar, and the status in words under
   * it.
   */
  variant?: 'compact' | 'regular';
}

/**
 * How far the wallet is towards something in coins (RULES R20): a bar, the
 * coins held against the coins it takes, and what that means in words.
 *
 * The bar never stands alone — the figure beside it says the same thing, so
 * a member who cannot judge a fill by eye still reads "320 / 538". It is
 * orange while there is walking left to do, green once there is not, and
 * grey for a goal that cannot be had right now (sold out), so the colour
 * never says "ready" over something that cannot be ordered.
 *
 * The whole meter is one element to a screen reader, read as a sentence.
 */
export const CoinGoalMeter = memo(
  ({ goal, status, variant = 'regular' }: Props) => {
    const { colors } = useTheme();
    const tint =
      status.tone === 'success'
        ? colors.success
        : status.tone === 'muted'
        ? colors.textTertiary
        : colors.brandAccent;
    const statusColor =
      status.tone === 'success'
        ? colors.success
        : status.tone === 'muted'
        ? colors.textTertiary
        : colors.textSecondary;
    const percent = Math.floor(goal.progress * 100);
    const figures = `${formatCoins(goal.have)} / ${formatCoins(goal.goal)}`;
    const label = `${formatCoins(goal.have)} of ${formatCoins(
      goal.goal,
    )} coins, ${percent} percent. ${status.long}.`;

    if (variant === 'compact') {
      return (
        <VStack
          gap="xxs"
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={label}
          accessibilityValue={{ min: 0, max: 100, now: percent }}
        >
          <ProgressBar
            progress={goal.progress}
            height={moderateScale(5)}
            tint={tint}
          />
          <HStack align="center" justify="between" gap="xxs">
            <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
              {figures}
            </AppText>
            <AppText
              variant="miniMicro"
              numberOfLines={1}
              style={[styles.shrink, { color: statusColor }]}
            >
              {status.short}
            </AppText>
          </HStack>
        </VStack>
      );
    }

    return (
      <VStack
        gap="xs"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: percent }}
      >
        <HStack align="center" justify="between" gap="sm">
          <HStack align="center" gap="xxs">
            <Icon as={Coins} size="sm" tint={colors.gold} />
            <AppText variant="bodyStrong">{formatCoins(goal.have)}</AppText>
            <AppText variant="caption" color="textTertiary">
              {`/ ${formatCoins(goal.goal)} coins`}
            </AppText>
          </HStack>
          <AppText variant="bodyStrong" style={{ color: tint }}>
            {`${percent}%`}
          </AppText>
        </HStack>

        <ProgressBar
          progress={goal.progress}
          height={moderateScale(8)}
          tint={tint}
        />

        <HStack align="center" gap="xxs">
          {status.tone === 'success' ? (
            <Icon as={CircleCheck} size="xs" tint={colors.success} />
          ) : null}
          <AppText variant="micro" style={{ color: statusColor }}>
            {status.long}
          </AppText>
        </HStack>
      </VStack>
    );
  },
);

CoinGoalMeter.displayName = 'CoinGoalMeter';

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
});
