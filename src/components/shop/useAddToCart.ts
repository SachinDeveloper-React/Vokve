import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useToast } from '../feedback/Toast';
import { useCartStore } from '../../stores/cartStore';
import type { ShopItem } from '../../types/models';

/**
 * The one way anything goes into the basket, wherever the tap came from.
 *
 * A sized or coloured item cannot be added from a card — there is no
 * size or colour yet — so the tap opens the item instead, where they are
 * picked; everything else
 * goes straight in with a toast that offers the basket. The errors the
 * server can answer with are worded here once (`QUANTITY_LIMIT`,
 * `OUT_OF_STOCK`), so a card and the product page say the same thing.
 */
export function useAddToCart() {
  const navigation = useNavigation();
  const toast = useToast();
  const add = useCartStore(s => s.add);

  return useCallback(
    async (
      item: ShopItem,
      size: string | null = null,
      quantity = 1,
      color: string | null = null,
    ) => {
      if (
        (item.sizes.length > 0 && !size) ||
        (item.colors.length > 0 && !color)
      ) {
        navigation.navigate('ProductDetail', { id: item.id });
        return false;
      }
      try {
        await add(item, size, quantity, color);
        toast.show({
          title: 'Added to cart',
          message: [item.title, color, size].filter(Boolean).join(' · '),
          tone: 'success',
          action: {
            label: 'View cart',
            onPress: () => navigation.navigate('Cart'),
          },
        });
        return true;
      } catch (error) {
        const apiError = error as { code?: string | null; message: string };
        toast.show({
          title:
            apiError.code === 'QUANTITY_LIMIT'
              ? 'That is the limit'
              : "Couldn't add to cart",
          message: apiError.message,
          tone: 'warning',
        });
        return false;
      }
    },
    [add, navigation, toast],
  );
}
