import { useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
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

interface ShopState {
  /**
   * The home shelf: the whole catalogue in "popular" order, with `inStock`
   * as the server last reported it. Category pages and search page from
   * the server themselves; this is what the shop's own screen draws from.
   */
  items: ShopItem[];
  /** What each shelf holds, for the tiles' counts; null until the first sync. */
  categories: ShopCategorySummary[] | null;
  /**
   * The till's rules (RULES R11–R13): coin value, coin share, shipping.
   * Null until the first sync — the app keeps no copy of them, so a price
   * split is only ever drawn with the rules the server is selling under.
   */
  config: ShopConfig | null;
  syncedAt: string | null;
  isSyncing: boolean;
  /** Why the last sync failed; cleared by the next one that succeeds. */
  syncError: string | null;

  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  /** Puts a fresh copy of one item into the shelf — after a review, say. */
  upsertItem: (item: ShopItem) => void;
  reset: () => void;
}

/** The shop before the first sync: nothing on the shelf the server has not put there. */
const EMPTY_SHOP = {
  items: [] as ShopItem[],
  categories: null,
  config: null,
  syncedAt: null,
} satisfies Partial<ShopState>;

/**
 * The catalogue and the rules it is sold under.
 *
 * Items are a cache of `GET /shop/items`; until the first sync there are
 * none, and the shop says it is loading rather than showing a shelf the
 * server never stocked. Buying lives in `checkoutStore`, the basket in
 * `cartStore`: this store only ever reads.
 */
export const useShopStore = create<ShopState>()(
  persist(
    (set, get) => ({
      ...EMPTY_SHOP,
      isSyncing: false,
      syncError: null,

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
            syncError: null,
          });
        } catch (error) {
          const apiError = toApiError(error);
          logger.warn('shopStore', 'Catalogue sync failed', apiError);
          set({ isSyncing: false, syncError: apiError.message });
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

      reset: () => set({ ...EMPTY_SHOP, isSyncing: false, syncError: null }),
    }),
    {
      name: 'vokve.shop',
      storage: createJSONStorage(() => mmkvStorage),
      // v2: prices in paise with a money side. v3: no placeholder catalogue —
      // a stored v2 shop that never synced was that placeholder, and goes; a
      // v1 shop cannot be read as this one at all.
      version: 3,
      migrate: (persisted, version) => {
        const stored = persisted as Partial<ShopState> | null;
        return version >= 2 && stored?.syncedAt ? stored : EMPTY_SHOP;
      },
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

/**
 * The till's rules, or null while they have not arrived. A screen that needs
 * them — a product page opened from the basket, say, before the shop tab has
 * ever synced — asks for them here rather than drawing a split from rules
 * the app made up.
 */
export const useShopConfig = (): ShopConfig | null => {
  const config = useShopStore(s => s.config);
  useEffect(() => {
    if (config === null) {
      useShopStore.getState().refreshIfStale();
    }
  }, [config]);
  return config;
};
export const useShopItem = (id: string) =>
  useShopStore(s => s.items.find(item => item.id === id) ?? null);
