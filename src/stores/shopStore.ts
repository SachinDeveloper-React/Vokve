import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { shopItems as seedShopItems } from '../constants/seedData';
import { shopApi } from '../services/api/endpoints';
import { ApiError, toApiError } from '../services/api/errors';
import type { Order, ShopItem } from '../types/models';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { useAuthStore } from './authStore';
import { useCoinsStore } from './coinsStore';
import { mmkvStorage } from './index';
import { useOrdersStore } from './ordersStore';

/** How old a synced catalogue may be before opening the shop fetches it again. */
export const SHOP_STALE_AFTER_MS = 5 * 60_000;

/** One redemption the user asked for, kept while the server asks for more. */
export interface RedeemAttempt {
  itemId: string;
  quantity: number;
  addressId: string;
  /**
   * Fixed for the attempt's life, so the retry after a step-up — or after a
   * dropped connection — replays the same order rather than placing a
   * second one (BACKEND.md §3.6).
   */
  idempotencyKey: string;
}

export type RedeemOutcome =
  | { status: 'placed'; order: Order; balance: number }
  /** The server wants a code first; the OTP screen is already on its way. */
  | { status: 'step_up_required' }
  /** The user has no address on file yet. */
  | { status: 'address_required' }
  | { status: 'failed'; error: ApiError };

interface ShopState {
  /** The catalogue, with `inStock` as the server last reported it. */
  items: ShopItem[];
  syncedAt: string | null;
  isSyncing: boolean;
  /** A redeem request is in flight. */
  isRedeeming: boolean;
  /** The attempt waiting on a step-up code, or null. */
  pendingRedeem: RedeemAttempt | null;

  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  /**
   * Starts a redemption (RULES R2–R4, O8). Resolves to what happened rather
   * than throwing, because every outcome is one the screen has to word —
   * and `step_up_required` is not a failure at all, only a pause.
   */
  redeem: (input: {
    itemId: string;
    addressId: string;
    quantity?: number;
  }) => Promise<RedeemOutcome>;
  /**
   * Finishes the attempt a step-up interrupted, with the token the auth
   * store now holds. Null when there is nothing to resume.
   */
  resumeAfterStepUp: () => Promise<RedeemOutcome | null>;
  /** Drops the attempt — the user backed out of the code. */
  abandonRedeem: () => void;
  reset: () => void;
}

/**
 * The reward catalogue and the act of buying from it.
 *
 * Items are a cache of `GET /shop/items`, seeded with the same catalogue the
 * screens were built against so the shop paints before the network answers
 * and stock arrives with the first sync. The redemption flow lives here
 * rather than on the screen because it outlives the screen: the step-up
 * pushes an OTP screen over the shop, and the attempt has to be waiting
 * when the user comes back.
 */
export const useShopStore = create<ShopState>()(
  persist(
    (set, get) => ({
      items: seedShopItems,
      syncedAt: null,
      isSyncing: false,
      isRedeeming: false,
      pendingRedeem: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const items = await shopApi.items();
          set({ items, syncedAt: new Date().toISOString(), isSyncing: false });
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

      redeem: async ({ itemId, addressId, quantity = 1 }) => {
        const attempt: RedeemAttempt = {
          itemId,
          quantity,
          addressId,
          idempotencyKey: uuid(),
        };
        return runAttempt(attempt, null, set);
      },

      resumeAfterStepUp: async () => {
        const attempt = get().pendingRedeem;
        const token = useAuthStore.getState().takeStepUpToken();
        if (!attempt || !token) {
          return null;
        }
        set({ pendingRedeem: null });
        return runAttempt(attempt, token, set);
      },

      abandonRedeem: () => set({ pendingRedeem: null }),

      reset: () =>
        set({
          items: seedShopItems,
          syncedAt: null,
          isSyncing: false,
          isRedeeming: false,
          pendingRedeem: null,
        }),
    }),
    {
      name: 'vokve.shop',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      // The attempt is deliberately not persisted: a step-up token lives ten
      // minutes, and an order half-placed before a relaunch should be placed
      // again by the user, not by the app on its own.
      partialize: state => ({ items: state.items, syncedAt: state.syncedAt }),
    },
  ),
);

type Set = (patch: Partial<ShopState>) => void;

/**
 * One request to the server, and what to make of its answer. Shared by the
 * first try and the resume so the two cannot drift: a stock change between
 * them is handled the same way either time.
 */
async function runAttempt(
  attempt: RedeemAttempt,
  stepUpToken: string | null,
  set: Set,
): Promise<RedeemOutcome> {
  set({ isRedeeming: true });
  try {
    const { order, balance } = await shopApi.redeem(
      {
        itemId: attempt.itemId,
        quantity: attempt.quantity,
        addressId: attempt.addressId,
        stepUpToken: stepUpToken ?? undefined,
      },
      { idempotencyKey: attempt.idempotencyKey },
    );
    set({ isRedeeming: false, pendingRedeem: null });
    // The wallet's balance is the server's answer, at once; the ledger row
    // and the rest follow on the sync.
    useCoinsStore.setState({ balance });
    useCoinsStore.getState().hydrateFromServer();
    useOrdersStore.getState().prepend(order);
    // Stock moved, and for the last unit that changes the card.
    useShopStore.getState().hydrateFromServer();
    return { status: 'placed', order, balance };
  } catch (caught) {
    const error = toApiError(caught);
    set({ isRedeeming: false });

    if (error.code === 'STEP_UP_REQUIRED' || error.code === 'STEP_UP_INVALID') {
      // The code is asked for first and the attempt parked only once the
      // challenge is pending: parked earlier, the screen would see an
      // attempt with no code on its way and read that as the user having
      // backed out. If the request for a code itself fails, that failure is
      // the answer and nothing is parked.
      const asked = await useAuthStore.getState().requestStepUp();
      if (!asked) {
        return {
          status: 'failed',
          error: useAuthStore.getState().error ?? error,
        };
      }
      set({ pendingRedeem: attempt });
      return { status: 'step_up_required' };
    }
    if (error.code === 'ADDRESS_REQUIRED') {
      return { status: 'address_required' };
    }
    return { status: 'failed', error };
  }
}

export const useShopItems = () => useShopStore(s => s.items);
export const useIsRedeeming = () => useShopStore(s => s.isRedeeming);
export const usePendingRedeem = () => useShopStore(s => s.pendingRedeem);
