import { shopItems } from '../../src/constants/seedData';
import { useShopStore } from '../../src/stores/shopStore';
import type { ShopConfig, ShopItem } from '../../src/types/models';

/** The till's rules as the server sends them by default (`GET /shop/config`). */
export const SHOP_CONFIG: ShopConfig = {
  currency: 'INR',
  coinValuePaise: 25,
  coinShareMax: 0.3,
  shippingFeePaise: 4900,
  freeShippingAbovePaise: 99900,
  maxQuantityPerLine: 5,
  paymentProvider: 'mock',
  paymentKeyId: null,
  stepUpThreshold: 1000,
};

/** The shop as a finished sync leaves it: the catalogue and its rules. */
export const stockShop = (items: ShopItem[] = shopItems) =>
  useShopStore.setState({
    items,
    categories: null,
    config: SHOP_CONFIG,
    syncedAt: new Date().toISOString(),
    isSyncing: false,
    syncError: null,
  });
