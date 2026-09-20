import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Heart } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { useIsWishlisted, useWishlistStore } from '../../stores/wishlistStore';
import type { ShopItem } from '../../types/models';
import { useToast } from '../feedback/Toast';
import { Icon, type IconSize } from '../media/Icon';
import { Pressable } from '../form/Pressable';

interface Props {
  item: ShopItem;
  size?: IconSize;
  /** Draws a round white well behind the heart, for sitting on a card's art. */
  raised?: boolean;
}

/**
 * The heart on a card or a product page: saved, or not.
 *
 * It flips at once — the store reverts it if the server refuses — because
 * a heart that waits for the network reads as a heart that did not work.
 */
export const WishlistButton = memo(
  ({ item, size = 'md', raised = false }: Props) => {
    const { colors } = useTheme();
    const toast = useToast();
    const saved = useIsWishlisted(item.id);
    const toggle = useWishlistStore(s => s.toggle);

    const onPress = useCallback(async () => {
      try {
        const nowSaved = await toggle(item);
        toast.show({
          title: nowSaved ? 'Saved to wishlist' : 'Removed from wishlist',
          message: item.title,
          tone: 'info',
          durationMs: 1800,
        });
      } catch (error) {
        toast.show({
          title: "Couldn't update your wishlist",
          message: (error as Error).message,
          tone: 'warning',
        });
      }
    }, [item, toast, toggle]);

    return (
      <Pressable
        onPress={onPress}
        feedback="scale"
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          saved
            ? `Remove ${item.title} from wishlist`
            : `Save ${item.title} to wishlist`
        }
        accessibilityState={{ selected: saved }}
        style={
          raised ? [styles.well, { backgroundColor: colors.card }] : undefined
        }
      >
        <Icon
          as={Heart}
          size={size}
          tint={saved ? colors.destructive : colors.textSecondary}
          fill={saved ? colors.destructive : undefined}
        />
      </Pressable>
    );
  },
);

WishlistButton.displayName = 'WishlistButton';

const styles = StyleSheet.create({
  well: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
