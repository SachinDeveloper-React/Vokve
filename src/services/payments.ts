import { ApiError } from './api/errors';
import type { PaymentIntent } from '../types/models';
import { uuid } from '../utils/uuid';

/** What the gateway hands back once the user has paid — the server verifies it. */
export interface PaymentProof {
  providerPaymentId: string;
  signature?: string;
}

/**
 * Collects the money side of an order (RULES R12): opens the gateway's
 * checkout for the intent the server issued and resolves with its proof,
 * or with null when the user backed out of it.
 *
 * Two providers, chosen by the server. `mock` is what the backend runs
 * outside production: there is no sheet to show, so the proof is made up
 * on the spot — the order is then paid the moment the app says so, which
 * is what a demo build wants. `razorpay` needs the gateway's SDK, which
 * this build does not carry yet; until it does, an order that reaches a
 * real gateway is left pending with a clear message rather than pretended
 * paid. When the SDK is added, this is the one function to fill in:
 *
 *   const result = await RazorpayCheckout.open({
 *     key: intent.keyId, order_id: intent.providerOrderId,
 *     amount: intent.amount, currency: intent.currency, name: 'VOKVE',
 *     ...(gatewayMethod(intent.method) ? { method: gatewayMethod(intent.method) } : {}),
 *   });
 *   return { providerPaymentId: result.razorpay_payment_id, signature: result.razorpay_signature };
 *
 * and a dismissed sheet (`error.code === 0`) resolves null. The method is
 * the member's own choice from the payment page, so the sheet opens on the
 * tab they picked rather than making them pick twice; the server has
 * already locked its gateway order to it.
 */
export function gatewayMethod(
  method: PaymentIntent['method'],
): 'upi' | 'card' | 'netbanking' | null {
  // `coins` never reaches a gateway, and `coins_upi` deliberately leaves
  // the choice open: the member said "coins and then something".
  return method === 'upi' || method === 'card' || method === 'netbanking'
    ? method
    : null;
}

export async function collectPayment(
  intent: PaymentIntent,
): Promise<PaymentProof | null> {
  if (intent.provider === 'mock') {
    return { providerPaymentId: `mockpay_${uuid()}` };
  }
  throw new ApiError(
    'unknown',
    'Card and UPI payments are not available in this build yet. Your order is saved — pay for it from My Orders once they are.',
    null,
    null,
    'PAYMENT_PROVIDER_UNAVAILABLE',
  );
}
