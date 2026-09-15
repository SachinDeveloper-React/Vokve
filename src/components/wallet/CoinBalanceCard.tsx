import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import type { CoinExpiryUrgency } from '../../stores/coinsStore';
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
  /**
   * Step coins the server is still verifying (RULES E15). Not in `balance`
   * and not spendable; shown so a walk that has not paid out yet reads as
   * "on its way" rather than "ignored". Omitted or zero draws nothing.
   */
  pending?: number;
  /** Every coin ever credited, spent or not. */
  lifetimeEarned: number;
  /** Days until the coins in hand lapse. */
  expiryDaysLeft: number;
  /** How loudly the countdown speaks; see `CoinExpiryPanel`. */
  expiryUrgency?: CoinExpiryUrgency;
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
    pending = 0,
    lifetimeEarned,
    expiryDaysLeft,
    expiryUrgency,
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

            {pending > 0 ? (
              <AppText
                variant="micro"
                color="textSecondary"
                numberOfLines={1}
                accessibilityLabel={`${formatCoins(pending)} coins pending verification`}
              >
                {`+${formatCoins(pending)} pending verification`}
              </AppText>
            ) : null}

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
              urgency={expiryUrgency}
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
