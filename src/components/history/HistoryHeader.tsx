import React, { memo } from 'react';
import { ChevronLeft } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { CoinAmount } from '../wallet/CoinAmount';

interface Props {
  coins: number;
  onPressBack: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The history screen's masthead: the way back, the title, the balance.
 *
 * The balance is a figure rather than a link, as it is on the leaderboard:
 * the wallet is two taps away and a tap here would pull the user out of the
 * history they just opened.
 */
export const HistoryHeader = memo(
  ({
    coins,
    onPressBack,
    title = 'Nutrition History',
    subtitle = 'View your past meals and nutrition',
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

      <VStack flex={1} align="center" gap="xxs">
        <AppText variant="h2" numberOfLines={1}>
          {title}
        </AppText>
        <AppText
          variant="miniMicro"
          color="textSecondary"
          center
          numberOfLines={1}
        >
          {subtitle}
        </AppText>
      </VStack>

      <Card elevation="low" radius="lg" padding="md">
        <CoinAmount amount={coins} size="sm" />
      </Card>
    </HStack>
  ),
);

HistoryHeader.displayName = 'HistoryHeader';
