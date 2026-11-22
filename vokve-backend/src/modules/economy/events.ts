import { logger } from '../../lib/logger.js';

/**
 * "This member's spendable balance just went up" (RULES M12), for the
 * modules that care without the ledger having to know about them.
 *
 * The ledger is the bottom of the dependency graph — commerce, streaks and
 * challenges all call into it — so it cannot import the wishlist to tell
 * it about a credit. A listener registered from above can. Listeners run
 * after the transaction has committed, are awaited (a serverless instance
 * may be frozen once the response is out, so nothing is left running in
 * the background) and can never fail a credit: a throw is logged and
 * swallowed, because the coins are already in the wallet.
 */
type BalanceListener = (userId: string) => Promise<void>;

const listeners = new Set<BalanceListener>();

export function onBalanceRaised(listener: BalanceListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function balanceRaised(userId: string): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(userId);
    } catch (err) {
      logger.error({ err, userId }, 'economy.balance_listener_failed');
    }
  }
}
