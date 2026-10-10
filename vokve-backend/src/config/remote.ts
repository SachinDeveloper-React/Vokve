import { offeredMethods, PAYMENT_METHODS } from '../lib/payments.js';
import { supportCategorySchema, supportIconSchema, supportTintSchema, supportTopicKindSchema } from '../contracts/index.js';
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
 * methods the mode leaves empty — a shop nobody could pay. And a returns
 * window or a tracking link an order page could not honour.
 */
/** The most `PATCH /me/settings` lets a member set their water goal to. */
const MAX_WATER_GOAL_ML = 8_000;

const SUPPORT_TOPIC_KINDS: readonly string[] = supportTopicKindSchema.options;
const SUPPORT_ICONS: readonly string[] = supportIconSchema.options;
const SUPPORT_TINTS: readonly string[] = supportTintSchema.options;
const SUPPORT_CATEGORIES: readonly string[] = supportCategorySchema.options;

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
  // The water ladder has to climb (RULES Y1b): a single drink, then the ask,
  // then the health note, then the refusal. Out of order, a member could be
  // refused a day they were never warned about — or, worse, have their own
  // 8 L goal be unreachable, since that is the most `/me/settings` allows.
  const water = config.hydration;
  const ladder: [string, number][] = [
    ['maxMl', water.maxMl],
    ['confirmAboveMl', water.confirmAboveMl],
    ['cautionAboveMl', water.cautionAboveMl],
    ['maxDailyMl', water.maxDailyMl],
  ];
  for (let i = 1; i < ladder.length; i += 1) {
    const [name, value] = ladder[i];
    const [below, lower] = ladder[i - 1];
    if (value < lower) {
      throw new Error(`hydration.${name} (${value}) is below hydration.${below} (${lower})`);
    }
  }
  if (water.maxDailyMl < MAX_WATER_GOAL_ML) {
    throw new Error(
      `hydration.maxDailyMl (${water.maxDailyMl}) is below the largest goal a member may set (${MAX_WATER_GOAL_ML}), so their own goal could not be logged`,
    );
  }
  if (water.minMl <= 0 || water.minMl > water.maxMl) {
    throw new Error(`hydration: ${water.minMl}–${water.maxMl} ml is not a range a drink can be in`);
  }
  if (water.hourlyMl <= 0 || water.hourlyMinutes <= 0) {
    throw new Error('hydration.hourlyMl and hourlyMinutes must both be above zero');
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
  // A help row the app cannot draw is a blank tile on a member's screen,
  // and a row that opens nothing is a dead end (RULES P12).
  for (const topic of config.support.topics) {
    if (!SUPPORT_TOPIC_KINDS.includes(topic.kind)) {
      throw new Error(`support.topics[${topic.id}].kind: '${topic.kind}' is not one of ${SUPPORT_TOPIC_KINDS.join(', ')}`);
    }
    if (!SUPPORT_ICONS.includes(topic.icon)) {
      throw new Error(`support.topics[${topic.id}].icon: '${topic.icon}' is not one of ${SUPPORT_ICONS.join(', ')}`);
    }
    if (!SUPPORT_TINTS.includes(topic.tint)) {
      throw new Error(`support.topics[${topic.id}].tint: '${topic.tint}' is not one of ${SUPPORT_TINTS.join(', ')}`);
    }
    if (topic.category !== null && !SUPPORT_CATEGORIES.includes(topic.category)) {
      throw new Error(`support.topics[${topic.id}].category: '${topic.category}' is not one of ${SUPPORT_CATEGORIES.join(', ')}`);
    }
  }
  const { returnWindowDays, trackingUrlTemplate } = config.commerce;
  if (!(Number.isInteger(returnWindowDays) && returnWindowDays >= 0)) {
    throw new Error(`commerce.returnWindowDays: ${returnWindowDays} is not a whole number of days`);
  }
  // A template without the reference would send every member to one page,
  // which reads as tracking and is not.
  if (trackingUrlTemplate !== null && !trackingUrlTemplate.includes('{ref}')) {
    throw new Error("commerce.trackingUrlTemplate: must hold '{ref}', the order's tracking reference");
  }
}
