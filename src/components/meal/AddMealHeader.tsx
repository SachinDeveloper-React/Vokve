import React, { memo } from 'react';
import { ChevronLeft } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { CoinAmount } from '../wallet/CoinAmount';

interface Props {
  /** The balance logging a meal earns towards. */
  coins: number;
  onPressBack: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The add-meal screen's masthead.
 *
 * Built like the leaderboard's — a chevron, the title, and the balance — for
 * the same reason: this is a page of a page, and three levels in the corner
 * needs the way back rather than the logo.
 */
export const AddMealHeader = memo(
  ({
    coins,
    onPressBack,
    title = 'Add Meal',
    subtitle = 'Log your food and track your nutrition',
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

AddMealHeader.displayName = 'AddMealHeader';
