import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { cartApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { Cart, ShopItem } from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

/** How a line is told apart: the item, and the size if it has one. */
export const cartLineKey = (itemId: string, size: string | null | undefined) =>
  `${itemId}:${size ?? ''}`;

interface CartState {
  /** The basket as the server last answered; null before the first sync. */
  cart: Cart | null;
  syncedAt: string | null;
  isSyncing: boolean;
  /** Line keys with a write in flight, so a stepper can hold still. */
  busy: string[];
  syncError: string | null;

  hydrateFromServer: () => Promise<void>;
  /**
   * Sets a line's quantity — adding it if new, removing it at zero — and
   * takes the server's basket back as the truth. Throws the `ApiError`
   * so the screen can word it (`SIZE_REQUIRED`, `QUANTITY_LIMIT`).
   */
  setQuantity: (
    item: Pick<ShopItem, 'id'>,
    quantity: number,
    size?: string | null,
  ) => Promise<Cart>;
  /** Adds `quantity` more of the item to whatever is already there. */
  add: (
    item: ShopItem,
    size?: string | null,
    quantity?: number,
  ) => Promise<Cart>;
  remove: (itemId: string, size?: string | null) => Promise<Cart>;
  clear: () => Promise<void>;
  /** Replaces the basket wholesale — after a checkout emptied it. */
  replace: (cart: Cart | null) => void;
  reset: () => void;
}

/**
 * The basket (RULES R14): a cache of `GET /cart`, written through to the
 * server on every change.
 *
 * The server's answer is always taken as the truth rather than applied
 * optimistically, because the answer carries the quote — the coins the
 * order may take, the shipping — and a basket that guessed at those would
 * show a total the checkout then corrects. The writes are fast enough that
 * a stepper waits a beat rather than lying for one.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cart: null,
      syncedAt: null,
      isSyncing: false,
      busy: [],
      syncError: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true, syncError: null });
        try {
          const cart = await cartApi.get();
          set({ cart, syncedAt: new Date().toISOString(), isSyncing: false });
        } catch (error) {
          const apiError = toApiError(error);
          logger.warn('cartStore', 'Cart sync failed', apiError);
          set({ isSyncing: false, syncError: apiError.message });
        }
      },

      setQuantity: async (item, quantity, size = null) => {
        const key = cartLineKey(item.id, size);
        set(state => ({ busy: [...state.busy, key] }));
        try {
          const cart = await cartApi.setLine({
            itemId: item.id,
            quantity,
            size,
          });
          set(state => ({
            cart,
            syncedAt: new Date().toISOString(),
            busy: state.busy.filter(entry => entry !== key),
          }));
          return cart;
        } catch (error) {
          set(state => ({ busy: state.busy.filter(entry => entry !== key) }));
          throw toApiError(error);
        }
      },

      add: async (item, size = null, quantity = 1) => {
        const current =
          get().cart?.lines.find(
            line => line.item.id === item.id && line.size === (size ?? null),
          )?.quantity ?? 0;
        return get().setQuantity(item, current + quantity, size);
      },

      remove: async (itemId, size = null) =>
        get().setQuantity({ id: itemId }, 0, size),

      clear: async () => {
        try {
          const cart = await cartApi.clear();
          set({ cart, syncedAt: new Date().toISOString() });
        } catch (error) {
          throw toApiError(error);
        }
      },

      replace: cart => set({ cart, syncedAt: new Date().toISOString() }),

      reset: () =>
        set({
          cart: null,
          syncedAt: null,
          isSyncing: false,
          busy: [],
          syncError: null,
        }),
    }),
    {
      name: 'vokve.cart',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: state => ({ cart: state.cart, syncedAt: state.syncedAt }),
    },
  ),
);

export const useCart = () => useCartStore(s => s.cart);
/** Units in the basket — the badge on the cart icon. */
export const useCartCount = () => useCartStore(s => s.cart?.count ?? 0);
export const useCartLineBusy = (itemId: string, size: string | null) =>
  useCartStore(s => s.busy.includes(cartLineKey(itemId, size)));
/** How many of an item, across its sizes, are already in the basket. */
export const useCartQuantityOf = (itemId: string) =>
  useCartStore(s =>
    (s.cart?.lines ?? [])
      .filter(line => line.item.id === itemId)
      .reduce((sum, line) => sum + line.quantity, 0),
  );
