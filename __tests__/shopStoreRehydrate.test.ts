/**
 * A cache written by an older build must not reach a screen without the
 * fields added since: the shelf card reads `item.colors.length`, and an
 * item stored before colours existed crashed the shop tab.
 *
 * @format
 */

import { shopItems } from '../src/constants/seedData';
import { mmkvStorage } from '../src/stores';
import { useCartStore } from '../src/stores/cartStore';
import { useShopStore } from '../src/stores/shopStore';
import { SHOP_CONFIG } from './helpers/shop';

/** `source` without `keys` — a record as an older build wrote it. */
const without = (source: object, keys: string[]) =>
  Object.fromEntries(
    Object.entries(source).filter(([key]) => !keys.includes(key)),
  );

/** The tee as a build before the product page and payment modes stored it. */
const oldTee = without(shopItems.find(i => i.id === 'tee')!, [
  'images',
  'ribbon',
  'colors',
  'highlights',
  'features',
  'specs',
  'coinsMin',
  'coinPrice',
]);
const oldConfig = without(SHOP_CONFIG, [
  'deliveryEstimate',
  'returnPolicy',
  'paymentMode',
  'coinShareMin',
  'couponsEnabled',
]);

test('a stored shop from an older build is read back with the new fields defaulted', async () => {
  mmkvStorage.setItem(
    'vokve.shop',
    JSON.stringify({
      state: {
        items: [oldTee, { id: 'broken' }],
        categories: null,
        config: oldConfig,
        syncedAt: new Date().toISOString(),
      },
      version: 3,
    }),
  );
  await useShopStore.persist.rehydrate();

  const { items, config } = useShopStore.getState();
  expect(items.map(i => i.id)).toEqual(['tee']); // the unreadable one waits for a sync
  expect(items[0]).toMatchObject({
    colors: [],
    features: [],
    specs: [],
    highlights: [],
    images: [],
    ribbon: null,
    coinsMin: 0,
    coinPrice: 0,
  });
  expect(config).toMatchObject({
    deliveryEstimate: null,
    returnPolicy: null,
    paymentMode: 'mixed',
    coinShareMin: 0,
    couponsEnabled: false,
  });
});

test('a stored basket from an older build gets its lines a colour', async () => {
  mmkvStorage.setItem(
    'vokve.cart',
    JSON.stringify({
      state: {
        cart: {
          lines: [
            {
              item: oldTee,
              quantity: 1,
              size: 'M',
              addedAt: new Date().toISOString(),
            },
          ],
          count: 1,
          quote: {
            currency: 'INR',
            lines: [],
            mrpTotal: 0,
            discount: 0,
            subtotal: 0,
            shipping: 0,
            total: 0,
            coinValuePaise: 25,
            coinsMax: 0,
            coinsApplied: 0,
            coinsValue: 0,
            payable: 0,
            needsStepUp: false,
          },
        },
        syncedAt: new Date().toISOString(),
      },
      version: 1,
    }),
  );
  await useCartStore.persist.rehydrate();

  const line = useCartStore.getState().cart!.lines[0];
  expect(line.color).toBeNull();
  expect(line.item.colors).toEqual([]);
});
