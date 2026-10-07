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
  paymentMethods: ['coins', 'coins_upi', 'upi', 'card', 'netbanking'],
  stepUpThreshold: 1000,
  paymentMode: 'mixed',
  coinShareMin: 0,
  couponsEnabled: true,
  deliveryNotice: 'Delivery partners may call you for verification if needed.',
  offersWhatsAppUpdates: true,
  deliveryEstimate: '2–4 working days',
  returnPolicy: 'Free cancellation until it ships',
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
