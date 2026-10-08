import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { orderApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { Order, OrderFilter, ReorderResult } from '../types/models';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { useCartStore } from './cartStore';
import { useCoinsStore } from './coinsStore';
import { mmkvStorage } from './index';

/** How old a synced tab may be before opening it fetches it again. */
export const ORDERS_STALE_AFTER_MS = 60_000;

/** The tabs the list is read through, in the order they are offered. */
export const ORDER_FILTERS: readonly { value: OrderFilter; label: string }[] = [
  { value: 'all', label: 'All Orders' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** One tab of the list: its own page, its own cursor, its own clock. */
export interface OrderTab {
  orders: Order[];
  nextCursor: string | null;
  syncedAt: string | null;
  isSyncing: boolean;
  isLoadingMore: boolean;
}

const emptyTab = (): OrderTab => ({
  orders: [],
  nextCursor: null,
  syncedAt: null,
  isSyncing: false,
  isLoadingMore: false,
});

/**
 * The one empty tab every reader falls back to. Shared and frozen rather
 * than built per call: a selector that answered with a fresh object each
 * render would tell the store something had changed on every render.
 */
const EMPTY_TAB: OrderTab = Object.freeze(emptyTab());

const emptyTabs = (): Record<OrderFilter, OrderTab> => ({
  all: emptyTab(),
  processing: emptyTab(),
  shipped: emptyTab(),
  delivered: emptyTab(),
  cancelled: emptyTab(),
});

interface OrdersState {
  /** One cache per tab, each newest first (RULES R5–R7). */
  tabs: Record<OrderFilter, OrderTab>;
  /**
   * The server's own count (RULES R7) — orders, not purchase rows — for the
   * shop's header, which needs the figure without needing the list.
   */
  count: number;
  /** The id being cancelled, so the row can show it; null otherwise. */
  cancellingId: string | null;
  /** Likewise for the two writes the order page offers. */
  movingId: string | null;
  reorderingId: string | null;

  hydrateFromServer: (filter?: OrderFilter) => Promise<void>;
  refreshIfStale: (filter?: OrderFilter) => Promise<void>;
  loadMore: (filter?: OrderFilter) => Promise<void>;
  /**
   * Puts a freshly placed order at the top of every tab that is holding a
   * page, or replaces the row it already has, without a round trip. The
   * count only grows for an order that is an order — one still waiting on
   * its payment is not counted (R7).
   */
  upsert: (order: Order) => void;
  /**
   * Cancels, and on success replaces the row and refreshes the wallet — the
   * refund is the wallet's to show. Throws the `ApiError` so the screen can
   * word the failure (`ORDER_NOT_CANCELLABLE` when it shipped in between).
   */
  cancel: (id: string) => Promise<Order>;
  /**
   * Sends the order to another saved address while the warehouse can still
   * honour it. Throws the `ApiError` — `ORDER_ADDRESS_LOCKED` once it is
   * packed — so the screen can say why.
   */
  changeAddress: (id: string, addressId: string) => Promise<Order>;
  /** Puts the order's lines back in the basket and takes the server's basket back. */
  reorder: (id: string) => Promise<ReorderResult>;
  /**
   * Takes a row the server has just rewritten — cancelled, moved, paid —
   * wherever it is held, and marks the other tabs stale, because which tab
   * it now belongs to is the server's to say.
   */
  replace: (order: Order) => void;
  reset: () => void;
}

/** The tab as it stands, or the empty one — a filter is never missing. */
const tabOf = (state: OrdersState, filter: OrderFilter): OrderTab =>
  state.tabs[filter] ?? EMPTY_TAB;

/**
 * Writes `patch` over one tab, leaving the others as they are.
 */
const patchTab = (
  state: OrdersState,
  filter: OrderFilter,
  patch: Partial<OrderTab>,
): Pick<OrdersState, 'tabs'> => ({
  tabs: { ...state.tabs, [filter]: { ...tabOf(state, filter), ...patch } },
});

/**
 * The user's orders (RULES R5–R7): a cache of `GET /orders`, newest first,
 * one page per tab of the list.
 *
 * The tabs are kept apart rather than sifted out of one list, because the
 * server pages each one: a member on "Cancelled" whose last cancellation
 * was in March would otherwise see an empty screen until they had scrolled
 * every delivered order since. Which states a tab holds is the server's to
 * decide, so an order whose state changed here marks every tab stale and
 * lets the next read sort it out — the app never guesses which tab an
 * order has just moved to.
 *
 * The count is kept apart from the lists on purpose. The shop's header
 * shows it on every visit, and asking for a whole list to draw one number
 * would make the cheapest screen in the app the most expensive to open.
 */
export const useOrdersStore = create<OrdersState>()(
  persist(
    (set, get) => ({
      tabs: emptyTabs(),
      count: 0,
      cancellingId: null,
      movingId: null,
      reorderingId: null,

      hydrateFromServer: async (filter = 'all') => {
        if (tabOf(get(), filter).isSyncing) {
          return;
        }
        set(state => patchTab(state, filter, { isSyncing: true }));
        try {
          // The count is the same figure whichever tab asked for it, so it
          // is fetched beside the page rather than on its own schedule.
          const [page, count] = await Promise.all([
            orderApi.list(undefined, filter),
            orderApi.count(),
          ]);
          set(state => ({
            ...patchTab(state, filter, {
              orders: page.data,
              nextCursor: page.nextCursor,
              syncedAt: new Date().toISOString(),
              isSyncing: false,
            }),
            count,
          }));
        } catch (error) {
          logger.warn('ordersStore', 'Orders sync failed', toApiError(error));
          set(state => patchTab(state, filter, { isSyncing: false }));
        }
      },

      refreshIfStale: async (filter = 'all') => {
        const tab = tabOf(get(), filter);
        if (tab.isSyncing) {
          return;
        }
        const age = tab.syncedAt
          ? Date.now() - new Date(tab.syncedAt).getTime()
          : Infinity;
        if (age < ORDERS_STALE_AFTER_MS) {
          return;
        }
        await get().hydrateFromServer(filter);
      },

      loadMore: async (filter = 'all') => {
        const tab = tabOf(get(), filter);
        if (tab.nextCursor === null || tab.isLoadingMore || tab.isSyncing) {
          return;
        }
        set(state => patchTab(state, filter, { isLoadingMore: true }));
        try {
          const page = await orderApi.list(tab.nextCursor, filter);
          set(state => {
            const current = tabOf(state, filter);
            return patchTab(state, filter, {
              orders: [...current.orders, ...page.data],
              nextCursor: page.nextCursor,
              isLoadingMore: false,
            });
          });
        } catch (error) {
          logger.warn(
            'ordersStore',
            'Could not load more orders',
            toApiError(error),
          );
          set(state => patchTab(state, filter, { isLoadingMore: false }));
        }
      },

      upsert: order =>
        set(state => {
          const existing = state.tabs.all.orders.find(o => o.id === order.id);
          const wasCounted =
            existing !== undefined && existing.status !== 'pending_payment';
          const isCounted = order.status !== 'pending_payment';
          const tabs = {} as Record<OrderFilter, OrderTab>;
          for (const { value } of ORDER_FILTERS) {
            const tab = tabOf(state, value);
            const held = tab.orders.some(o => o.id === order.id);
            tabs[value] = {
              ...tab,
              orders: held
                ? tab.orders.map(o => (o.id === order.id ? order : o))
                : // An order just placed belongs at the top of the tab that
                  // holds every order. Which of the others it belongs to is
                  // the server's to say, so they are only marked stale.
                  value === 'all'
                ? [order, ...tab.orders]
                : tab.orders,
              syncedAt: held || value === 'all' ? tab.syncedAt : null,
            };
          }
          return {
            tabs,
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
          set({ cancellingId: null });
          get().replace(order);
          useCoinsStore.getState().hydrateFromServer();
          return order;
        } catch (error) {
          set({ cancellingId: null });
          throw toApiError(error);
        }
      },

      changeAddress: async (id, addressId) => {
        set({ movingId: id });
        try {
          const order = await orderApi.changeAddress(id, addressId);
          set({ movingId: null });
          get().replace(order);
          return order;
        } catch (error) {
          set({ movingId: null });
          throw toApiError(error);
        }
      },

      reorder: async id => {
        set({ reorderingId: id });
        try {
          const result = await orderApi.reorder(id, {
            idempotencyKey: uuid(),
          });
          set({ reorderingId: null });
          // The server answered with the whole basket; the cart screen and
          // the tab badge read it from there, not from a second fetch.
          useCartStore.getState().replace(result.cart);
          return result;
        } catch (error) {
          set({ reorderingId: null });
          throw toApiError(error);
        }
      },

      replace: order =>
        set(state => {
          const tabs = {} as Record<OrderFilter, OrderTab>;
          for (const { value } of ORDER_FILTERS) {
            const tab = tabOf(state, value);
            const held = tab.orders.some(o => o.id === order.id);
            tabs[value] = {
              ...tab,
              orders: held
                ? tab.orders.map(o => (o.id === order.id ? order : o))
                : tab.orders,
              syncedAt: value === 'all' ? tab.syncedAt : null,
            };
          }
          return { tabs };
        }),

      reset: () =>
        set({
          tabs: emptyTabs(),
          count: 0,
          cancellingId: null,
          movingId: null,
          reorderingId: null,
        }),
    }),
    {
      name: 'vokve.orders',
      storage: createJSONStorage(() => mmkvStorage),
      version: 2,
      // The in-flight ids and the spinners belong to one run of the app.
      partialize: state => ({
        tabs: Object.fromEntries(
          ORDER_FILTERS.map(({ value }) => [
            value,
            {
              ...tabOf(state, value),
              isSyncing: false,
              isLoadingMore: false,
            },
          ]),
        ) as Record<OrderFilter, OrderTab>,
        count: state.count,
      }),
      migrate: (persisted, version) => {
        // v1 kept one flat list, which is the "all" tab by another name.
        if (version < 2 && persisted && typeof persisted === 'object') {
          const old = persisted as {
            orders?: Order[];
            nextCursor?: string | null;
            syncedAt?: string | null;
            count?: number;
          };
          return {
            tabs: {
              ...emptyTabs(),
              all: {
                ...emptyTab(),
                orders: old.orders ?? [],
                nextCursor: old.nextCursor ?? null,
                syncedAt: old.syncedAt ?? null,
              },
            },
            count: old.count ?? 0,
          };
        }
        return persisted as never;
      },
    },
  ),
);

export const useOrders = (filter: OrderFilter = 'all') =>
  useOrdersStore(s => tabOf(s, filter).orders);

export const useOrderTab = (filter: OrderFilter = 'all') =>
  useOrdersStore(s => tabOf(s, filter));

export const useOrderCount = () => useOrdersStore(s => s.count);

/** The order wherever it is cached — the tab it was opened from, or another. */
export const useOrder = (id: string) =>
  useOrdersStore(
    s =>
      ORDER_FILTERS.map(
        ({ value }) => tabOf(s, value).orders.find(o => o.id === id) ?? null,
      ).find(found => found !== null) ?? null,
  );
