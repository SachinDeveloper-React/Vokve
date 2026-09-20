import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { wishlistApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { ShopItem } from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

interface WishlistState {
  /** Saved item ids, newest save first — enough to draw a heart on any card. */
  ids: string[];
  /** The saved items in full, for the wishlist screen; null until it asks. */
  items: ShopItem[] | null;
  syncedAt: string | null;
  isSyncing: boolean;
  isLoadingItems: boolean;

  /** The ids, cheap enough to fetch on sign-in. */
  hydrateFromServer: () => Promise<void>;
  /** The items, for the screen that shows them. */
  loadItems: () => Promise<void>;
  /**
   * Saves or unsaves, the heart flipping at once and flipping back if the
   * server refuses. Resolves to whether the item is saved afterwards.
   */
  toggle: (item: ShopItem) => Promise<boolean>;
  reset: () => void;
}

/**
 * Saved-for-later (RULES R14). The ids are kept apart from the items on
 * purpose: every card in the shop asks "is this saved?", and answering
 * from a list of ids costs nothing, while the items themselves — with
 * prices and stock as they are now — are only fetched for the screen that
 * shows them.
 */
export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      ids: [],
      items: null,
      syncedAt: null,
      isSyncing: false,
      isLoadingItems: false,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const ids = await wishlistApi.ids();
          set({ ids, syncedAt: new Date().toISOString(), isSyncing: false });
        } catch (error) {
          logger.warn(
            'wishlistStore',
            'Wishlist sync failed',
            toApiError(error),
          );
          set({ isSyncing: false });
        }
      },

      loadItems: async () => {
        if (get().isLoadingItems) {
          return;
        }
        set({ isLoadingItems: true });
        try {
          const items = await wishlistApi.list();
          set({
            items,
            ids: items.map(item => item.id),
            syncedAt: new Date().toISOString(),
            isLoadingItems: false,
          });
        } catch (error) {
          logger.warn(
            'wishlistStore',
            'Wishlist load failed',
            toApiError(error),
          );
          set({ isLoadingItems: false });
        }
      },

      toggle: async item => {
        const wasSaved = get().ids.includes(item.id);
        // The heart flips first; the request follows.
        set(state => ({
          ids: wasSaved
            ? state.ids.filter(id => id !== item.id)
            : [item.id, ...state.ids],
          items:
            state.items === null
              ? null
              : wasSaved
              ? state.items.filter(entry => entry.id !== item.id)
              : [item, ...state.items.filter(entry => entry.id !== item.id)],
        }));
        try {
          if (wasSaved) {
            await wishlistApi.remove(item.id);
          } else {
            await wishlistApi.add(item.id);
          }
          return !wasSaved;
        } catch (error) {
          logger.warn(
            'wishlistStore',
            'Wishlist write failed',
            toApiError(error),
          );
          set(state => ({
            ids: wasSaved
              ? [item.id, ...state.ids.filter(id => id !== item.id)]
              : state.ids.filter(id => id !== item.id),
            items:
              state.items === null
                ? null
                : wasSaved
                ? [item, ...state.items.filter(entry => entry.id !== item.id)]
                : state.items.filter(entry => entry.id !== item.id),
          }));
          throw toApiError(error);
        }
      },

      reset: () =>
        set({
          ids: [],
          items: null,
          syncedAt: null,
          isSyncing: false,
          isLoadingItems: false,
        }),
    }),
    {
      name: 'vokve.wishlist',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: state => ({ ids: state.ids, syncedAt: state.syncedAt }),
    },
  ),
);

export const useWishlistIds = () => useWishlistStore(s => s.ids);
export const useIsWishlisted = (itemId: string) =>
  useWishlistStore(s => s.ids.includes(itemId));
export const useWishlistCount = () => useWishlistStore(s => s.ids.length);
export const useWishlistItems = () => useWishlistStore(s => s.items);
