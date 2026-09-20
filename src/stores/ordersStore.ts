import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { orderApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { Order } from '../types/models';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { useCoinsStore } from './coinsStore';
import { mmkvStorage } from './index';

/** How old a synced list may be before opening the screen fetches it again. */
export const ORDERS_STALE_AFTER_MS = 60_000;

interface OrdersState {
  /** Newest first: the first page, plus any pages scrolled to. */
  orders: Order[];
  nextCursor: string | null;
  /**
   * The server's own count (RULES R7) — orders, not purchase rows — for the
   * shop's header, which needs the figure without needing the list.
   */
  count: number;
  syncedAt: string | null;
  isSyncing: boolean;
  isLoadingMore: boolean;
  /** The id being cancelled, so the row can show it; null otherwise. */
  cancellingId: string | null;

  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  loadMore: () => Promise<void>;
  /**
   * Puts a freshly placed order at the top, or replaces the row it already
   * has, without a round trip. The count only grows for an order that is
   * an order — one still waiting on its payment is not counted (R7).
   */
  upsert: (order: Order) => void;
  /**
   * Cancels, and on success replaces the row and refreshes the wallet — the
   * refund is the wallet's to show. Throws the `ApiError` so the screen can
   * word the failure (`ORDER_NOT_CANCELLABLE` when it shipped in between).
   */
  cancel: (id: string) => Promise<Order>;
  reset: () => void;
}

/**
 * The user's orders (RULES R5–R7): a cache of `GET /orders`, newest first.
 *
 * The count is kept apart from the list on purpose. The shop's header shows
 * it on every visit, and asking for the whole list to draw one number would
 * make the cheapest screen in the app the most expensive to open.
 */
export const useOrdersStore = create<OrdersState>()(
  persist(
    (set, get) => ({
      orders: [],
      nextCursor: null,
      count: 0,
      syncedAt: null,
      isSyncing: false,
      isLoadingMore: false,
      cancellingId: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const [page, count] = await Promise.all([
            orderApi.list(),
            orderApi.count(),
          ]);
          set({
            orders: page.data,
            nextCursor: page.nextCursor,
            count,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
          });
        } catch (error) {
          logger.warn('ordersStore', 'Orders sync failed', toApiError(error));
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
        if (age < ORDERS_STALE_AFTER_MS) {
          return;
        }
        await hydrateFromServer();
      },

      loadMore: async () => {
        const { nextCursor, isLoadingMore, isSyncing } = get();
        if (nextCursor === null || isLoadingMore || isSyncing) {
          return;
        }
        set({ isLoadingMore: true });
        try {
          const page = await orderApi.list(nextCursor);
          set(state => ({
            orders: [...state.orders, ...page.data],
            nextCursor: page.nextCursor,
            isLoadingMore: false,
          }));
        } catch (error) {
          logger.warn(
            'ordersStore',
            'Could not load more orders',
            toApiError(error),
          );
          set({ isLoadingMore: false });
        }
      },

      upsert: order =>
        set(state => {
          const existing = state.orders.find(o => o.id === order.id);
          const wasCounted =
            existing !== undefined && existing.status !== 'pending_payment';
          const isCounted = order.status !== 'pending_payment';
          return {
            orders: existing
              ? state.orders.map(o => (o.id === order.id ? order : o))
              : [order, ...state.orders],
            count: state.count + (isCounted && !wasCounted ? 1 : 0),
          };
        }),

      cancel: async id => {
        set({ cancellingId: id });
        try {
          // One key per attempt: a retry after a dropped connection replays
          // the same cancel rather than being refused as a second one.
          const { order } = await orderApi.cancel(id, {
            idempotencyKey: uuid(),
          });
          set(state => ({
            orders: state.orders.map(o => (o.id === id ? order : o)),
            cancellingId: null,
          }));
          useCoinsStore.getState().hydrateFromServer();
          return order;
        } catch (error) {
          set({ cancellingId: null });
          throw toApiError(error);
        }
      },

      reset: () =>
        set({
          orders: [],
          nextCursor: null,
          count: 0,
          syncedAt: null,
          isSyncing: false,
          isLoadingMore: false,
          cancellingId: null,
        }),
    }),
    {
      name: 'vokve.orders',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: state => ({
        orders: state.orders,
        nextCursor: state.nextCursor,
        count: state.count,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export const useOrders = () => useOrdersStore(s => s.orders);
export const useOrderCount = () => useOrdersStore(s => s.count);
export const useOrder = (id: string) =>
  useOrdersStore(s => s.orders.find(o => o.id === id) ?? null);
