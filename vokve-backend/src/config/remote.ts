import { offeredMethods, PAYMENT_METHODS } from '../lib/payments.js';
import { AppConfigModel } from '../modules/platform/models.js';
import { CONFIG_DEFAULTS, type AppConfig } from './defaults.js';

/**
 * Remote config: `app_config` documents override the defaults key by key.
 * Cached in memory for a short window so a hot path never waits on a read;
 * `invalidate()` after an admin write.
 */
const TTL_MS = 30_000;
let cached: { at: number; value: AppConfig } | null = null;

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v);
  }
  return out as T;
}

export async function getConfig(): Promise<AppConfig> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.value;
  }
  const docs = await AppConfigModel.find().lean();
  let value: AppConfig = structuredClone(CONFIG_DEFAULTS);
  for (const doc of docs) {
    value = deepMerge(value, { [String(doc._id)]: doc.value });
  }
  validate(value);
  cached = { at: Date.now(), value };
  return value;
}

export function invalidateConfig(): void {
  cached = null;
}

/**
 * RULES E8c: no per-source cap may exceed the daily ceiling. A step goal
 * range a member could not pick from (D-55). And a shop that could not
 * take payment (D-59, D-62): an unknown mode, coin shares outside 0–1 with
 * the floor above the ceiling, an unknown payment method, or a menu of
 * methods the mode leaves empty — a shop nobody could pay.
 */
function validate(config: AppConfig): void {
  for (const [source, cap] of Object.entries(config.coins.sourceCaps)) {
    if (cap > config.coins.dailyCap) {
      throw new Error(`coins.sourceCaps.${source} (${cap}) exceeds coins.dailyCap (${config.coins.dailyCap})`);
    }
  }
  const { min, max, increment } = config.activity.goal;
  if (!(min > 0 && min < max && increment > 0)) {
    throw new Error(`activity.goal: ${min}–${max} by ${increment} is not a range a goal can be set in`);
  }
  const { paymentMode, coinShareMin, coinShareMax } = config.commerce;
  if (!['coins', 'money', 'mixed'].includes(paymentMode)) {
    throw new Error(`commerce.paymentMode: '${paymentMode}' is not one of coins, money, mixed`);
  }
  if (!(coinShareMin >= 0 && coinShareMin <= coinShareMax && coinShareMax <= 1)) {
    throw new Error(`commerce.coinShareMin–coinShareMax: ${coinShareMin}–${coinShareMax} must sit inside 0–1, the floor not above the ceiling`);
  }
  const methods = config.commerce.paymentMethods;
  const unknown = methods.filter(m => !(PAYMENT_METHODS as readonly string[]).includes(m));
  if (unknown.length > 0) {
    throw new Error(`commerce.paymentMethods: ${unknown.join(', ')} is not one of ${PAYMENT_METHODS.join(', ')}`);
  }
  if (offeredMethods(paymentMode as 'coins' | 'money' | 'mixed', methods).length === 0) {
    throw new Error(`commerce.paymentMethods: [${methods.join(', ')}] leaves a '${paymentMode}' shop with no way to pay`);
  }
}
