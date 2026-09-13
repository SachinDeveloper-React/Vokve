import React, { memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { CoinAmount } from '../wallet/CoinAmount';

interface Props {
  coins: number;
  onPressBack: () => void;
  onPressCoins: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The settings screen's masthead.
 *
 * The balance carries a chevron here where the leaderboard's does not: this
 * screen has nothing to do with coins, so the pill is a link rather than a
 * figure the page is about — and a number that looks like a link everywhere
 * except where it is one would be the worse inconsistency.
 */
export const NotificationSettingsHeader = memo(
  ({
    coins,
    onPressBack,
    onPressCoins,
    title = 'Notification Settings',
    subtitle = 'Manage app notifications',
  }: Props) => {
    const { colors } = useTheme();

    return (
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

        <Pressable
          onPress={onPressCoins}
          feedback="scale"
          accessibilityRole="button"
          accessibilityLabel={`${coins} coins. Open your wallet`}
        >
          <Card elevation="low" radius="lg" padding="md">
            <HStack align="center" gap="xs">
              <CoinAmount amount={coins} size="sm" />
              <Icon as={ChevronRight} size="xs" tint={colors.textTertiary} />
            </HStack>
          </Card>
        </Pressable>
      </HStack>
    );
  },
);

NotificationSettingsHeader.displayName = 'NotificationSettingsHeader';
