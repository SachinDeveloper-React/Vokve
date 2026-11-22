import { create } from 'zustand';
import { track } from '../services/analytics';
import { checkoutApi } from '../services/api/endpoints';
import { ApiError, toApiError } from '../services/api/errors';
import { collectPayment, type PaymentProof } from '../services/payments';
import type {
  DeliveryPreferences,
  Order,
  PaymentIntent,
  PaymentMethod,
  PurchaseLine,
} from '../types/models';
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
  /** The coupon the quote showed applying (RULES R16); left out otherwise. */
  couponCode?: string;
  /** How it should be handed over, as set on the shipping page (RULES R17). */
  delivery?: Partial<DeliveryPreferences>;
  /** What the payment page chose to pay it with (RULES R12). */
  paymentMethod?: PaymentMethod;
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
   * Redeeming needs a verified phone (RULES O5) and this member has none —
   * typically a Google or Apple account. The screen sends them to add one
   * (RULES O14) rather than only saying no.
   */
  | { status: 'phone_required' }
  /**
   * The order is placed and waiting for its money: the user closed the
   * payment sheet, or no gateway is available in this build. It can be
   * paid from its own page until the window closes.
   */
  | { status: 'payment_pending'; order: Order; error: ApiError | null }
  /**
   * The request may have worked: the connection dropped, the server timed
   * out or broke, or it is still working on the first try. Coins may already
   * be gone and the order may already exist. The attempt's key is kept, so
   * pressing pay again for the same thing replays that order rather than
   * placing a second — the screen says exactly that.
   */
  | { status: 'unconfirmed'; error: ApiError }
  /** A charge was already in flight; this second press did nothing. */
  | { status: 'busy' }
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
/**
 * An attempt whose answer never arrived (BACKEND.md §3.6).
 *
 * The server keys an order to the attempt's idempotency key, so the only
 * way a lost answer becomes a *second* order is the app minting a new key
 * for the member's next press. This remembers the key until the attempt is
 * settled one way or the other, and hands it back for the same purchase.
 * In memory on purpose: a relaunch reads the orders afresh, and the server
 * still refuses a duplicate under the old key for a day.
 */
let unresolved: { fingerprint: string; key: string; at: number } | null = null;

/** Long enough to cover a member trying again; short enough not to swallow a deliberate second purchase. */
const UNRESOLVED_TTL_MS = 30 * 60 * 1000;

/**
 * The proof of a payment the gateway took but the server has not yet
 * confirmed, by order. Paying that order again sends this instead of
 * opening the gateway's sheet a second time — which would take the money
 * twice.
 */
const unsentProofs = new Map<string, PaymentProof>();

/** How often, and how far apart, a checkout the server is still working on is asked again. */
const IN_PROGRESS_RETRIES = 4;
const IN_PROGRESS_DELAY_MS = 1500;

/**
 * What makes two presses "the same purchase": the lines, or the basket as
 * it stands. Coins, method and address are left out — a member who nudges
 * the coins after a lost answer is still buying the thing they may already
 * have bought.
 */
function fingerprintOf(input: Omit<CheckoutAttempt, 'idempotencyKey'>): string {
  const lines = input.fromCart
    ? (useCartStore.getState().cart?.lines ?? []).map(l => ({
        itemId: l.item.id,
        quantity: l.quantity,
        size: l.size ?? null,
        color: l.color ?? null,
      }))
    : (input.lines ?? []).map(l => ({
        itemId: l.itemId,
        quantity: l.quantity,
        size: l.size ?? null,
        color: l.color ?? null,
      }));
  return JSON.stringify([
    input.fromCart ? 'cart' : 'lines',
    lines.map(l => `${l.itemId}|${l.quantity}|${l.size}|${l.color}`).sort(),
  ]);
}

/**
 * Whether a failure leaves the outcome unknown — the order may exist. A
 * transport failure, a server fault, a 200 the app could not read, or the
 * server saying the first try is still running. `PAYMENT_UNAVAILABLE` is a
 * 5xx that is nonetheless certain: the server refused, or released the
 * order, before answering.
 */
export function isUncertain(error: ApiError): boolean {
  if (error.code === 'IN_PROGRESS') return true;
  if (error.code === 'PAYMENT_UNAVAILABLE') return false;
  if (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'server') {
    return true;
  }
  // A response arrived and did not parse: the server did *something*.
  return error.kind === 'validation' && error.status === null;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Sends again while the server says the first try is still running; the first answer is the one that counts. */
async function untilSettled<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (caught) {
      const error = toApiError(caught);
      if (error.code !== 'IN_PROGRESS' || attempt >= IN_PROGRESS_RETRIES) {
        throw error;
      }
      await delay(IN_PROGRESS_DELAY_MS);
    }
  }
}

/**
 * After an answer that never came: the wallet, the orders and the basket
 * as the server has them now, so the screens stop showing coins that may
 * already be spent and the member can see the order if it was placed.
 */
function resyncAfterUncertainty(): void {
  useCoinsStore.getState().hydrateFromServer();
  useOrdersStore.getState().hydrateFromServer();
  useCartStore.getState().hydrateFromServer();
}

/** The member-facing words for an attempt whose answer was lost. */
function unconfirmedError(error: ApiError, what: 'order' | 'payment'): ApiError {
  return new ApiError(
    error.kind,
    what === 'order'
      ? "We couldn't confirm your order. If it went through it will be in My Orders — pressing Pay again won't charge you twice."
      : "We couldn't confirm your payment. If it went through your order will update — pressing Pay again won't charge you twice.",
    error.status,
    error.details,
    error.code,
  );
}

export const useCheckoutStore = create<CheckoutState>()((set, get) => ({
  isPlacing: false,
  isPaying: false,
  pendingCheckout: null,

  placeOrder: async input => {
    // A second press while the first is in flight would otherwise be a
    // second order: both read "not placing" before React disables the button.
    if (get().isPlacing || get().isPaying) {
      return { status: 'busy' };
    }
    const fingerprint = fingerprintOf(input);
    const reuse =
      unresolved !== null &&
      unresolved.fingerprint === fingerprint &&
      Date.now() - unresolved.at < UNRESOLVED_TTL_MS;
    const attempt: CheckoutAttempt = {
      ...input,
      idempotencyKey: reuse && unresolved ? unresolved.key : uuid(),
    };
    return runAttempt(attempt, null, set, fingerprint);
  },

  resumeAfterStepUp: async () => {
    const attempt = get().pendingCheckout;
    const token = useAuthStore.getState().takeStepUpToken();
    if (!attempt || !token) {
      return null;
    }
    if (get().isPlacing || get().isPaying) {
      return { status: 'busy' };
    }
    set({ pendingCheckout: null });
    return runAttempt(attempt, token, set, fingerprintOf(attempt));
  },

  abandonCheckout: () => set({ pendingCheckout: null }),

  payPending: async order => {
    if (get().isPlacing || get().isPaying) {
      return { status: 'busy' };
    }
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
    // Busy from here, not from the sheet: the shop sync below is a wait in
    // which a second press would otherwise get past the guard.
    set({ isPaying: true });
    // The gateway's public key is the till's; an order paid from the
    // orders list may come before the shop has ever synced.
    if (useShopStore.getState().config === null) {
      await useShopStore.getState().hydrateFromServer();
    }
    const intent: PaymentIntent = {
      provider: order.payment.provider,
      method: order.payment.method,
      orderId: order.id,
      providerOrderId: order.payment.providerOrderId,
      amount: order.payment.amount,
      currency: order.payment.currency,
      keyId: useShopStore.getState().config?.paymentKeyId ?? null,
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
  fingerprint: string,
): Promise<CheckoutOutcome> {
  set({ isPlacing: true });
  track('checkout_started', {
    coins: attempt.coins ?? 0,
    fromCart: Boolean(attempt.fromCart),
    paymentMethod: attempt.paymentMethod ?? null,
  });
  try {
    const { order, balance, payment } = await untilSettled(() =>
      checkoutApi.place(
        {
          lines: attempt.lines,
          fromCart: attempt.fromCart,
          addressId: attempt.addressId,
          coins: attempt.coins,
          couponCode: attempt.couponCode,
          delivery: attempt.delivery,
          paymentMethod: attempt.paymentMethod,
          stepUpToken: stepUpToken ?? undefined,
        },
        { idempotencyKey: attempt.idempotencyKey },
      ),
    );
    unresolved = null;
    set({ isPlacing: false, pendingCheckout: null });
    track('order_placed', { orderId: order.id, coins: attempt.coins ?? 0 });
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

    if (isUncertain(error)) {
      // The order may exist. Keep this key for the member's next press of
      // the same purchase, and show them the wallet and orders as they are.
      unresolved = { fingerprint, key: attempt.idempotencyKey, at: Date.now() };
      track('checkout_unconfirmed', { kind: error.kind, code: error.code });
      resyncAfterUncertainty();
      return { status: 'unconfirmed', error: unconfirmedError(error, 'order') };
    }
    // A refusal is certain: nothing was placed, and the next press is new.
    unresolved = null;

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
    if (error.code === 'PHONE_NOT_VERIFIED') {
      return { status: 'phone_required' };
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
    // Money the gateway already took for this order goes to the server
    // again, never through a second sheet.
    const proof = unsentProofs.get(order.id) ?? (await collectPayment(intent));
    if (!proof) {
      set({ isPaying: false });
      return { status: 'payment_pending', order, error: null };
    }
    unsentProofs.set(order.id, proof);
    let paid: Awaited<ReturnType<typeof checkoutApi.pay>>;
    try {
      paid = await untilSettled(() =>
        checkoutApi.pay(order.id, proof, {
          idempotencyKey: `${intent.orderId}:pay:${proof.providerPaymentId}`,
        }),
      );
    } catch (caught) {
      const error = toApiError(caught);
      if (isUncertain(error)) {
        // Keep the proof: the next press sends it again.
        set({ isPaying: false });
        resyncAfterUncertainty();
        return {
          status: 'unconfirmed',
          error: unconfirmedError(error, 'payment'),
        };
      }
      // The server read the proof and answered: it will not be sent again.
      unsentProofs.delete(order.id);
      if (error.code === 'PAYMENT_REFUNDED') {
        // Taken after the order was released, and on its way back. The
        // order (cancelled) and the wallet are what the member reads next.
        resyncAfterUncertainty();
      }
      throw error;
    }
    unsentProofs.delete(order.id);
    set({ isPaying: false });
    track('order_paid', { orderId: paid.order.id, amount: intent.amount });
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
