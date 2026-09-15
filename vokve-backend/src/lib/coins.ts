/**
 * Coins are stored as integer milli-coins (1 coin = 1,000 mc) so 0.095 per
 * 100 steps is exact and no float ever reaches a balance (D-27).
 */
export const MC_PER_COIN = 1000;

export function toMilli(coins: number): number {
  return Math.round(coins * MC_PER_COIN);
}

export function toCoins(milli: number): number {
  return milli / MC_PER_COIN;
}
