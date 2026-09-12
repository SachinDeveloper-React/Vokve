import React, { memo } from 'react';
import { ChevronLeft } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { CoinAmount } from '../wallet/CoinAmount';

interface Props {
  /** The user's balance, shown as the price everything here is paid in. */
  coins: number;
  onPressBack: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The leaderboard's masthead.
 *
 * The one header in the app that leads with a chevron instead of the wordmark.
 * Every other screen is somewhere the user navigated *to*; this one is a page
 * of a page — reached from the account's rewards row or the challenge board —
 * and the title has to earn its width against the balance beside it.
 *
 * The balance is a figure rather than a link: the wallet is a tab away, and a
 * tap here that jumped there would pull the user out of the board they just
 * opened.
 */
export const LeaderboardHeader = memo(
  ({
    coins,
    onPressBack,
    title = 'Leaderboard Rewards 🏆',
    subtitle = 'Top performers. Bigger rewards.',
  }: Props) => (
    <HStack align="center" gap="md" pt="sm">
      <Pressable
        onPress={onPressBack}
        feedback="opacity"
        visualSize={24}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Icon as={ChevronLeft} size="lg" color="text" />
      </Pressable>

      <VStack flex={1} gap="xxs">
        <AppText variant="h2" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </VStack>

      <Card elevation="low" radius="lg" padding="md">
        <VStack align="center" gap="xxs">
          <CoinAmount amount={coins} size="sm" />
          <AppText variant="miniMicro" color="textSecondary">
            My Coins
          </AppText>
        </VStack>
      </Card>
    </HStack>
  ),
);

LeaderboardHeader.displayName = 'LeaderboardHeader';
