import type { ShopItem } from '../types/models';
import { formatCoins } from './format';

/**
 * What the coins of a goal are for, which is what decides the words:
 *
 * - `redeem` — a coins-only item: the coins are the whole price, delivery in.
 * - `share` — a part-coins item whose share is fixed: the coins must be paid,
 *   and money pays the rest.
 * - `discount` — a part-coins item where coins are optional: they take money
 *   off, up to the share, and the item can be bought without them.
 */
export type CoinGoalKind = 'redeem' | 'share' | 'discount';

/** How far a wallet is towards a figure in coins (RULES R20). */
export interface CoinGoal {
  kind: CoinGoalKind;
  /** The coins it takes — the server's `coinGoal`, or an order's `coinsMin`. */
  goal: number;
  /** Whole coins held. The till never spends a fraction, so nor does the bar. */
  have: number;
  /** Coins still to earn; 0 once there. */
  short: number;
  /** 0–1, for the bar. */
  progress: number;
  reached: boolean;
}

/**
 * How `balance` measures up against `goal` coins. The goal is the server's
 * figure; the only arithmetic here is the subtraction the member would do
 * in their head.
 */
export function coinGoalOf(
  goal: number,
  balance: number,
  kind: CoinGoalKind,
): CoinGoal {
  const have = Math.max(0, Math.floor(balance));
  const target = Math.max(0, Math.round(goal));
  const short = Math.max(0, target - have);
  return {
    kind,
    goal: target,
    have,
    short,
    progress: target === 0 ? 1 : Math.min(1, have / target),
    reached: short === 0,
  };
}

/** The kind of goal an item is, from how the server says it is bought. */
export function goalKindOf(
  item: Pick<ShopItem, 'paymentMode' | 'coinsMin'>,
): CoinGoalKind {
  if (item.paymentMode === 'coins') return 'redeem';
  return item.coinsMin > 0 ? 'share' : 'discount';
}

/**
 * An item's goal against the wallet, or null for an item coins cannot go
 * towards (a money-only one, or a cache from before `coinGoal` existed),
 * which draws no bar at all.
 */
export function itemCoinGoal(
  item: Pick<ShopItem, 'coinGoal' | 'paymentMode' | 'coinsMin'>,
  balance: number,
): CoinGoal | null {
  if (!(item.coinGoal > 0)) return null;
  return coinGoalOf(item.coinGoal, balance, goalKindOf(item));
}

export interface RankedGoal {
  item: ShopItem;
  goal: CoinGoal;
}

/**
 * Saved items worth a bar, in the order a member wants them: what they can
 * redeem right now first, then the nearest to it, and anything sold out
 * last — still shown, because it is still what they are saving for. Ties
 * keep the wishlist's own order, newest save first.
 */
export function rankCoinGoals(
  items: ShopItem[],
  balance: number,
): RankedGoal[] {
  const bucket = ({ item, goal }: RankedGoal) =>
    !item.inStock ? 2 : goal.reached ? 0 : 1;
  return items
    .flatMap((item, index) => {
      const goal = itemCoinGoal(item, balance);
      return goal ? [{ item, goal, index }] : [];
    })
    .sort(
      (a, b) =>
        bucket(a) - bucket(b) ||
        b.goal.progress - a.goal.progress ||
        a.index - b.index,
    )
    .map(({ item, goal }) => ({ item, goal }));
}

/**
 * How many of the ranked goals can be redeemed right now: in stock, and
 * covered where coins are what it takes. A part-coins item whose coins are
 * only a discount could always be bought, so it is never "ready".
 */
export function countReady(ranked: RankedGoal[]): number {
  return ranked.filter(
    ({ item, goal }) =>
      item.inStock && goal.reached && goal.kind !== 'discount',
  ).length;
}

/** The words for where a goal stands, long for a page and short for a card. */
export interface GoalStatus {
  long: string;
  short: string;
  tone: 'success' | 'progress' | 'muted';
}

/**
 * Where an item's goal stands, in words. A sold-out item says so first:
 * "ready to redeem" over something that cannot be ordered is a promise the
 * product page would then break.
 */
export function itemGoalStatus(goal: CoinGoal, inStock = true): GoalStatus {
  if (!inStock) {
    return goal.reached
      ? {
          long: 'You have the coins — it is sold out for now',
          short: 'Sold out',
          tone: 'muted',
        }
      : {
          long: `${formatCoins(goal.short)} more coins · sold out for now`,
          short: 'Sold out',
          tone: 'muted',
        };
  }
  if (goal.reached) {
    switch (goal.kind) {
      case 'redeem':
        return {
          long: 'You have enough coins to redeem it',
          short: 'Ready to redeem',
          tone: 'success',
        };
      case 'share':
        return {
          long: 'You have the coins it takes',
          short: 'Coins ready',
          tone: 'success',
        };
      case 'discount':
        return {
          long: 'Full coin discount unlocked',
          short: 'Max discount',
          tone: 'success',
        };
    }
  }
  const coins = formatCoins(goal.short);
  switch (goal.kind) {
    case 'redeem':
      return {
        long: `${coins} more coins to redeem`,
        short: `${coins} to go`,
        tone: 'progress',
      };
    case 'share':
      return {
        long: `${coins} more coins needed to buy`,
        short: `${coins} to go`,
        tone: 'progress',
      };
    case 'discount':
      return {
        long: `${coins} more coins for the full coin discount`,
        short: `${coins} to go`,
        tone: 'progress',
      };
  }
}

/** Where a basket's coins stand, in words. */
export function orderGoalStatus(goal: CoinGoal): GoalStatus {
  return goal.reached
    ? {
        long: 'You have enough coins for this order',
        short: 'Ready',
        tone: 'success',
      }
    : {
        long: `${formatCoins(goal.short)} more coins to check out`,
        short: `${formatCoins(goal.short)} to go`,
        tone: 'progress',
      };
}
