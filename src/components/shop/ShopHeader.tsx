import React, { memo } from 'react';
import { ShoppingBag } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Avatar } from '../media/Avatar';
import { AppText } from '../ui/AppText';
import { IconButton } from '../ui/IconButton';
import { Pressable } from '../form/Pressable';
import { Wordmark } from '../brand/Wordmark';

interface Props {
  /** Null while the profile is still loading or the user is a guest. */
  name?: string | null;
  avatarUri?: string | null;
  /** Redeemed rewards on their way. Shown as a count on the bag. */
  orderCount?: number;
  onPressOrders: () => void;
  onPressAvatar: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The shop's masthead: wordmark and actions on one row, the screen's name
 * beneath.
 *
 * The header action is a bag with the order count rather than the bell the
 * other tabs carry. Every redemption here becomes an order, and the one
 * question a shopper has after redeeming — "did that go through?" — is
 * answered by the number on the bag without leaving the screen.
 */
export const ShopHeader = memo(
  ({
    name,
    avatarUri,
    orderCount = 0,
    onPressOrders,
    onPressAvatar,
    title = 'Shop',
    subtitle = 'Spend your coins on exciting rewards',
  }: Props) => (
    <VStack gap="base" pt="sm">
      <HStack align="center" justify="between">
        <Wordmark size="md" />

        <HStack align="center" gap="md">
          <IconButton
            icon={ShoppingBag}
            onPress={onPressOrders}
            badge={orderCount}
            accessibilityLabel={
              orderCount > 0
                ? `Orders, ${orderCount} on the way`
                : 'Orders'
            }
          />

          <Pressable
            onPress={onPressAvatar}
            feedback="scale"
            accessibilityRole="button"
            accessibilityLabel="Your profile"
          >
            <Avatar name={name ?? 'vokve'} uri={avatarUri} size="md" ring />
          </Pressable>
        </HStack>
      </HStack>

      <VStack gap="xxs">
        <AppText variant="h1">{title}</AppText>
        <AppText variant="caption" color="textSecondary">
          {subtitle}
        </AppText>
      </VStack>
    </VStack>
  ),
);

ShopHeader.displayName = 'ShopHeader';
