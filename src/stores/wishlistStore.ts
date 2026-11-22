import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { wishlistApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import { shopItemSchema, type ShopItem } from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

interface WishlistState {
  /** Saved item ids, newest save first — enough to draw a heart on any card. */
  ids: string[];
  /**
   * The saved items in full — for the wishlist screen, and for the goal
   * bars on Home, the wallet and the shop (RULES R20); null until asked.
   */
  items: ShopItem[] | null;
  syncedAt: string | null;
  /** When `items` last came from the server, so a bar is never days old. */
  itemsSyncedAt: string | null;
  isSyncing: boolean;
  isLoadingItems: boolean;

  /** The ids, cheap enough to fetch on sign-in. */
  hydrateFromServer: () => Promise<void>;
  /** The items, for the screen that shows them. */
  loadItems: () => Promise<void>;
  /**
   * The items again if they are older than a few minutes or no longer
   * match the saved ids — for the screens that draw goal bars on focus.
   * Nothing saved, nothing asked.
   */
  refreshItemsIfStale: () => Promise<void>;
  /**
   * Saves or unsaves, the heart flipping at once and flipping back if the
   * server refuses. Resolves to whether the item is saved afterwards.
   */
  toggle: (item: ShopItem) => Promise<boolean>;
  reset: () => void;
}

/** How long the saved items' prices and stock are trusted before a focus asks again. */
const ITEMS_STALE_AFTER_MS = 5 * 60 * 1000;
/** How soon a list that does not match the saved ids is asked for again. */
const ITEMS_RETRY_AFTER_MS = 30 * 1000;

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
      itemsSyncedAt: null,
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
          const now = new Date().toISOString();
          set({
            items,
            ids: items.map(item => item.id),
            syncedAt: now,
            itemsSyncedAt: now,
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

      refreshItemsIfStale: async () => {
        const { ids, items, itemsSyncedAt, isLoadingItems } = get();
        if (isLoadingItems) {
          return;
        }
        if (ids.length === 0) {
          // The ids are the server's answer; items left over from before
          // it would draw bars for things no longer saved.
          if (items !== null && items.length > 0) {
            set({ items: [] });
          }
          return;
        }
        const age = itemsSyncedAt
          ? Date.now() - new Date(itemsSyncedAt).getTime()
          : Infinity;
        const matches =
          items !== null &&
          items.length === ids.length &&
          items.every(item => ids.includes(item.id));
        // A saved item taken off sale stays among the ids but never comes
        // back as an item, so a mismatch is retried on a short leash
        // rather than on every focus.
        if (age < (matches ? ITEMS_STALE_AFTER_MS : ITEMS_RETRY_AFTER_MS)) {
          return;
        }
        await get().loadItems();
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
          itemsSyncedAt: null,
          isSyncing: false,
          isLoadingItems: false,
        }),
    }),
    {
      name: 'vokve.wishlist',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      // The items are kept too, so the goal bars are on Home from the first
      // frame — offline included — rather than after a request. Read back
      // through the contract, like the shop's cache, so an item stored by
      // an older build gets the fields added since.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<WishlistState>;
        const items = Array.isArray(stored.items)
          ? stored.items.flatMap(raw => {
              const parsed = shopItemSchema.safeParse(raw);
              return parsed.success ? [parsed.data] : [];
            })
          : null;
        return { ...current, ...stored, items };
      },
      partialize: state => ({
        ids: state.ids,
        syncedAt: state.syncedAt,
        items: state.items,
        itemsSyncedAt: state.itemsSyncedAt,
      }),
    },
  ),
);

export const useWishlistIds = () => useWishlistStore(s => s.ids);
export const useIsWishlisted = (itemId: string) =>
  useWishlistStore(s => s.ids.includes(itemId));
export const useWishlistCount = () => useWishlistStore(s => s.ids.length);
export const useWishlistItems = () => useWishlistStore(s => s.items);
