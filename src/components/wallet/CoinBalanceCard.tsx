import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { formatCoins } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { CoinBadge } from './CoinBadge';
import { CoinExpiryPanel } from './CoinExpiryPanel';
import { InfoLabel } from './InfoLabel';
import { LifetimeCoinStat } from './LifetimeCoinStat';
import { RewardPill } from './RewardPill';

interface Props {
  balance: number;
  /** Every coin ever credited, spent or not. */
  lifetimeEarned: number;
  /** Days until the coins in hand lapse. */
  expiryDaysLeft: number;
  onPressAboutExpiry: () => void;
  onPressBalanceInfo?: () => void;
  onPressExpiryInfo?: () => void;
}

/**
 * The wallet's headline: what the user holds, and how long they have to use it.
 *
 * Earned and spent sit underneath as a pair rather than as a single "lifetime"
 * figure, because the two together are what explain the balance — a user who
 * sees only a total has no way to tell a slow month from a spending spree.
 * Spent is derived here rather than stored: it is earned minus balance by
 * definition, and a third stored number is a third thing that can disagree.
 */
export const CoinBalanceCard = memo(
  ({
    balance,
    lifetimeEarned,
    expiryDaysLeft,
    onPressAboutExpiry,
    onPressBalanceInfo,
    onPressExpiryInfo,
  }: Props) => {
    const { colors, isDark } = useTheme();
    const spent = Math.max(0, lifetimeEarned - balance);

    return (
      <Card
        radius="lg"
        padding="base"
        style={{
          backgroundColor: withAlpha(colors.brandAccent, isDark ? 0.07 : 0.06),
        }}
      >
        {/*
          `align="stretch"` is what lets the rule between the two halves take
          the row's height — a vertical Divider sizes itself by stretching, and
          a centred row would collapse it to nothing.
        */}
        <HStack align="stretch">
          {/*
            Weighted rather than even: the balance side carries a 30pt number
            and a pair of figures under it, and splitting the card down the
            middle would wrap both while leaving the countdown half empty.
          */}
          <VStack flex={3} gap="md">
            <InfoLabel label="Your Coins" emphasis onPressInfo={onPressBalanceInfo} />

            <HStack align="center" gap="sm">
              <CoinBadge tint={colors.gold} size={42} />
              <AppText variant="metric" numberOfLines={1} style={styles.balance}>
                {formatCoins(balance)}
              </AppText>
            </HStack>

            <RewardPill />

            <HStack gap="sm">
              <LifetimeCoinStat label="Lifetime Earned" amount={lifetimeEarned} />
              <LifetimeCoinStat label="Lifetime Spent" amount={spent} />
            </HStack>
          </VStack>

          <Divider orientation="vertical" inset="sm" />

          <VStack flex={2}>
            <CoinExpiryPanel
              daysLeft={expiryDaysLeft}
              onPressAbout={onPressAboutExpiry}
              onPressInfo={onPressExpiryInfo}
            />
          </VStack>
        </HStack>
      </Card>
    );
  },
);

CoinBalanceCard.displayName = 'CoinBalanceCard';

const styles = StyleSheet.create({
  /** Lets the number shrink rather than truncate on a narrow screen. */
  balance: { flexShrink: 1 },
});
