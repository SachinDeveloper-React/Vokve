import { create } from 'zustand';
import { checkoutApi } from '../services/api/endpoints';
import { ApiError, toApiError } from '../services/api/errors';
import { collectPayment } from '../services/payments';
import type { Order, PaymentIntent, PurchaseLine } from '../types/models';
import { uuid } from '../utils/uuid';
import { useAuthStore } from './authStore';
import { useCartStore } from './cartStore';
import { useCoinsStore } from './coinsStore';
import { useOrdersStore } from './ordersStore';
import { useShopStore } from './shopStore';

/** One order the user asked for, kept while the server asks for more. */
export interface CheckoutAttempt {
  lines?: PurchaseLine[];
  fromCart?: boolean;
  addressId: string;
  coins: number;
  /**
   * Fixed for the attempt's life, so the retry after a step-up — or after a
   * dropped connection — replays the same order rather than placing a
   * second one (BACKEND.md §3.6).
   */
  idempotencyKey: string;
}

export type CheckoutOutcome =
  /** Placed and, if money was owed, paid. */
  | { status: 'placed'; order: Order; balance: number }
  /** The server wants a code first; the OTP screen is already on its way. */
  | { status: 'step_up_required' }
  /** The user has no address on file yet. */
  | { status: 'address_required' }
  /**
   * The order is placed and waiting for its money: the user closed the
   * payment sheet, or no gateway is available in this build. It can be
   * paid from its own page until the window closes.
   */
  | { status: 'payment_pending'; order: Order; error: ApiError | null }
  | { status: 'failed'; error: ApiError };

interface CheckoutState {
  /** A checkout request is in flight. */
  isPlacing: boolean;
  /** A payment is being collected or confirmed. */
  isPaying: boolean;
  /** The attempt waiting on a step-up code, or null. */
  pendingCheckout: CheckoutAttempt | null;

  /**
   * Places an order and collects its money (RULES R2–R4, R11–R13, O8).
   * Resolves to what happened rather than throwing, because every outcome
   * is one the screen has to word — and `step_up_required` is not a
   * failure at all, only a pause.
   */
  placeOrder: (
    input: Omit<CheckoutAttempt, 'idempotencyKey'>,
  ) => Promise<CheckoutOutcome>;
  /**
   * Finishes the attempt a step-up interrupted, with the token the auth
   * store now holds. Null when there is nothing to resume.
   */
  resumeAfterStepUp: () => Promise<CheckoutOutcome | null>;
  /** Drops the attempt — the user backed out of the code. */
  abandonCheckout: () => void;
  /**
   * Collects the money for an order still waiting on it — from its own
   * page, after the sheet was closed the first time.
   */
  payPending: (order: Order) => Promise<CheckoutOutcome>;
  reset: () => void;
}

/**
 * The act of buying: from a confirmed checkout to a placed, paid order.
 *
 * Lives in a store rather than on the checkout screen because it outlives
 * the screen: the step-up pushes an OTP screen over the checkout, and the
 * attempt has to be waiting when the user comes back. The catalogue, the
 * basket and the orders each keep to their own store; this one moves
 * between them.
 */
export const useCheckoutStore = create<CheckoutState>()((set, get) => ({
  isPlacing: false,
  isPaying: false,
  pendingCheckout: null,

  placeOrder: async input => {
    const attempt: CheckoutAttempt = { ...input, idempotencyKey: uuid() };
    return runAttempt(attempt, null, set);
  },

  resumeAfterStepUp: async () => {
    const attempt = get().pendingCheckout;
    const token = useAuthStore.getState().takeStepUpToken();
    if (!attempt || !token) {
      return null;
    }
    set({ pendingCheckout: null });
    return runAttempt(attempt, token, set);
  },

  abandonCheckout: () => set({ pendingCheckout: null }),

  payPending: async order => {
    if (
      order.status !== 'pending_payment' ||
      !order.payment.provider ||
      !order.payment.providerOrderId ||
      !order.payment.expiresAt
    ) {
      return {
        status: 'placed',
        order,
        balance: useCoinsStore.getState().balance,
      };
    }
    const intent: PaymentIntent = {
      provider: order.payment.provider,
      orderId: order.id,
      providerOrderId: order.payment.providerOrderId,
      amount: order.payment.amount,
      currency: order.payment.currency,
      keyId: useShopStore.getState().config.paymentKeyId,
      expiresAt: order.payment.expiresAt,
    };
    return settlePayment(order, intent, set);
  },

  reset: () =>
    set({ isPlacing: false, isPaying: false, pendingCheckout: null }),
}));

type Set = (patch: Partial<CheckoutState>) => void;

/** What every store learns from a placed order, in one place. */
function absorb(order: Order, balance: number): void {
  // The wallet's balance is the server's answer, at once; the ledger row
  // and the rest follow on the sync.
  useCoinsStore.setState({ balance });
  useCoinsStore.getState().hydrateFromServer();
  useOrdersStore.getState().upsert(order);
  // Stock moved, and for the last unit that changes the card.
  useShopStore.getState().hydrateFromServer();
}

/**
 * One request to the server, and what to make of its answer. Shared by the
 * first try and the resume so the two cannot drift: a stock change between
 * them is handled the same way either time.
 */
async function runAttempt(
  attempt: CheckoutAttempt,
  stepUpToken: string | null,
  set: Set,
): Promise<CheckoutOutcome> {
  set({ isPlacing: true });
  try {
    const { order, balance, payment } = await checkoutApi.place(
      {
        lines: attempt.lines,
        fromCart: attempt.fromCart,
        addressId: attempt.addressId,
        coins: attempt.coins,
        stepUpToken: stepUpToken ?? undefined,
      },
      { idempotencyKey: attempt.idempotencyKey },
    );
    set({ isPlacing: false, pendingCheckout: null });
    absorb(order, balance);
    if (attempt.fromCart) {
      useCartStore.getState().hydrateFromServer();
    }
    if (!payment) {
      return { status: 'placed', order, balance };
    }
    return settlePayment(order, payment, set);
  } catch (caught) {
    const error = toApiError(caught);
    set({ isPlacing: false });

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
      set({ pendingCheckout: attempt });
      return { status: 'step_up_required' };
    }
    if (error.code === 'ADDRESS_REQUIRED') {
      return { status: 'address_required' };
    }
    return { status: 'failed', error };
  }
}

/**
 * Collects the money for a pending order and tells the server. A closed
 * sheet is not a failure: the order stays pending and can be paid from its
 * page; a proof the server refuses is.
 */
async function settlePayment(
  order: Order,
  intent: PaymentIntent,
  set: Set,
): Promise<CheckoutOutcome> {
  set({ isPaying: true });
  try {
    const proof = await collectPayment(intent);
    if (!proof) {
      set({ isPaying: false });
      return { status: 'payment_pending', order, error: null };
    }
    const paid = await checkoutApi.pay(order.id, proof, {
      idempotencyKey: `${intent.orderId}:pay`,
    });
    set({ isPaying: false });
    absorb(paid.order, paid.balance);
    return { status: 'placed', order: paid.order, balance: paid.balance };
  } catch (caught) {
    const error = toApiError(caught);
    set({ isPaying: false });
    if (error.code === 'PAYMENT_PROVIDER_UNAVAILABLE') {
      return { status: 'payment_pending', order, error };
    }
    return { status: 'failed', error };
  }
}

export const useIsPlacingOrder = () => useCheckoutStore(s => s.isPlacing);
export const useIsPaying = () => useCheckoutStore(s => s.isPaying);
export const usePendingCheckout = () =>
  useCheckoutStore(s => s.pendingCheckout);
