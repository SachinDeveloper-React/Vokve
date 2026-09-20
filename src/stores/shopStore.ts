import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { shopItems as seedShopItems } from '../constants/seedData';
import { shopApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type {
  ShopCategorySummary,
  ShopConfig,
  ShopItem,
} from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

/** How old a synced catalogue may be before opening the shop fetches it again. */
export const SHOP_STALE_AFTER_MS = 5 * 60_000;

/**
 * The till's rules before the first sync — the server's defaults, so a
 * price split drawn on the first frame matches what the first sync says.
 * Replaced, never merged: a share the server has changed must win whole.
 */
export const DEFAULT_SHOP_CONFIG: ShopConfig = {
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

interface ShopState {
  /**
   * The home shelf: the whole catalogue in "popular" order, with `inStock`
   * as the server last reported it. Category pages and search page from
   * the server themselves; this is what the shop's own screen draws from.
   */
  items: ShopItem[];
  /** What each shelf holds, for the tiles' counts; null until the first sync. */
  categories: ShopCategorySummary[] | null;
  /** The till's rules (RULES R11–R13): coin value, coin share, shipping. */
  config: ShopConfig;
  syncedAt: string | null;
  isSyncing: boolean;

  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  /** Puts a fresh copy of one item into the shelf — after a review, say. */
  upsertItem: (item: ShopItem) => void;
  reset: () => void;
}

/**
 * The catalogue and the rules it is sold under.
 *
 * Items are a cache of `GET /shop/items`, seeded with the same catalogue the
 * screens were built against so the shop paints before the network answers
 * and stock arrives with the first sync. Buying lives in `checkoutStore`,
 * the basket in `cartStore`: this store only ever reads.
 */
export const useShopStore = create<ShopState>()(
  persist(
    (set, get) => ({
      items: seedShopItems,
      categories: null,
      config: DEFAULT_SHOP_CONFIG,
      syncedAt: null,
      isSyncing: false,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const [page, categories, config] = await Promise.all([
            shopApi.items({ limit: 100 }),
            shopApi.categories(),
            shopApi.config(),
          ]);
          set({
            items: page.data,
            categories,
            config,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
          });
        } catch (error) {
          logger.warn('shopStore', 'Catalogue sync failed', toApiError(error));
          set({ isSyncing: false });
        }
      },

      refreshIfStale: async () => {
        const { syncedAt, isSyncing, hydrateFromServer } = get();
        if (isSyncing) {
          return;
        }
        const age = syncedAt
          ? Date.now() - new Date(syncedAt).getTime()
          : Infinity;
        if (age < SHOP_STALE_AFTER_MS) {
          return;
        }
        await hydrateFromServer();
      },

      upsertItem: item =>
        set(state => ({
          items: state.items.some(entry => entry.id === item.id)
            ? state.items.map(entry => (entry.id === item.id ? item : entry))
            : [...state.items, item],
        })),

      reset: () =>
        set({
          items: seedShopItems,
          categories: null,
          config: DEFAULT_SHOP_CONFIG,
          syncedAt: null,
          isSyncing: false,
        }),
    }),
    {
      name: 'vokve.shop',
      storage: createJSONStorage(() => mmkvStorage),
      // v2: prices in paise with a money side; the coins-only catalogue
      // cannot be read as this one, so a stored v1 is dropped for the seed.
      version: 2,
      migrate: () => ({
        items: seedShopItems,
        categories: null,
        config: DEFAULT_SHOP_CONFIG,
        syncedAt: null,
      }),
      partialize: state => ({
        items: state.items,
        categories: state.categories,
        config: state.config,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export const useShopItems = () => useShopStore(s => s.items);
export const useShopCategories = () => useShopStore(s => s.categories);
export const useShopConfig = () => useShopStore(s => s.config);
export const useShopItem = (id: string) =>
  useShopStore(s => s.items.find(item => item.id === id) ?? null);
