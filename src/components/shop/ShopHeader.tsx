import React, { memo } from 'react';
import { Heart, ShoppingCart } from 'lucide-react-native';
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
  /** Units in the basket. Shown as a count on the cart. */
  cartCount?: number;
  /** Saved items. Shown as a dot on the heart. */
  wishlistCount?: number;
  onPressCart: () => void;
  onPressWishlist: () => void;
  onPressAvatar: () => void;
  title?: string;
  subtitle?: string;
}

/**
 * The shop's masthead: wordmark and actions on one row, the screen's name
 * beneath.
 *
 * The header actions are the heart and the cart rather than the bell the
 * other tabs carry: the two questions a shopper has while browsing are
 * "what have I saved" and "what have I picked", and the count on the cart
 * answers the second without leaving the screen. Orders live behind the
 * cart and the wallet, where a user goes to see what they have bought.
 */
export const ShopHeader = memo(
  ({
    name,
    avatarUri,
    cartCount = 0,
    wishlistCount = 0,
    onPressCart,
    onPressWishlist,
    onPressAvatar,
    title = 'Shop',
    subtitle = 'Gear up — pay with money, coins, or both',
  }: Props) => (
    <VStack gap="base" pt="sm">
      <HStack align="center" justify="between">
        <Wordmark size="md" />

        <HStack align="center" gap="md">
          <IconButton
            icon={Heart}
            onPress={onPressWishlist}
            badge={wishlistCount > 0}
            accessibilityLabel={
              wishlistCount > 0
                ? `Wishlist, ${wishlistCount} saved`
                : 'Wishlist'
            }
          />

          <IconButton
            icon={ShoppingCart}
            onPress={onPressCart}
            badge={cartCount}
            accessibilityLabel={
              cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart'
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
