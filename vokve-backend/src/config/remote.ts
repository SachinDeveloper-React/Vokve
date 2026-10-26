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

/**
 * Exported for the admin config writer, which has to know what a patch
 * *would* produce before it writes it: `validate()` runs on read, so an
 * invalid document would not fail the write that caused it — it would fail
 * every `getConfig()` in the process, for every member, until somebody
 * worked out which key did it.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
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
 * Would this config be accepted on the next read? Throws the same error
 * `getConfig()` would, so a write can be refused with it instead.
 */
export function assertConfigValid(config: AppConfig): void {
  validate(config);
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
  // The fraud ladder has to climb too (RULES A24, A25): a day that is
  // flagged, then one that is refused. The wrong way round and a day would
  // be refused before anybody was ever warned about it.
  const t = config.activity.thresholds;
  if (t.impossibleDailySteps <= t.maxDailySteps) {
    throw new Error(
      `activity.thresholds.impossibleDailySteps (${t.impossibleDailySteps}) must be above maxDailySteps (${t.maxDailySteps})`,
    );
  }
  if (!(t.maxStepsPerMinute > 0)) {
    throw new Error('activity.thresholds.maxStepsPerMinute must be above zero');
  }
  // The nudge ladder has to climb too (RULES A28): the silent push first,
  // the member told only after it has had time to fail. The wrong way round
  // and somebody who missed one upload would be notified about it before
  // the sync that would have fixed it was ever attempted.
  const nudge = config.activity.syncNudge;
  if (nudge.remindAfterHours < nudge.silentAfterHours) {
    throw new Error(
      `activity.syncNudge.remindAfterHours (${nudge.remindAfterHours}) is below silentAfterHours (${nudge.silentAfterHours})`,
    );
  }
  if (!(nudge.cooldownHours > 0 && nudge.batch > 0)) {
    throw new Error('activity.syncNudge: cooldownHours and batch must both be above zero');
  }
  if (!(t.unaccountedShare > 0 && t.unaccountedShare <= 1)) {
    throw new Error(`activity.thresholds.unaccountedShare (${t.unaccountedShare}) must sit inside 0–1`);
  }
  if (t.unaccountedShareHard !== null && t.unaccountedShareHard < t.unaccountedShare) {
    throw new Error(
      `activity.thresholds.unaccountedShareHard (${t.unaccountedShareHard}) is below unaccountedShare (${t.unaccountedShare})`,
    );
  }
  if (!(t.motion.absentScore >= 0 && t.motion.absentScore <= 100)) {
    throw new Error(`activity.thresholds.motion.absentScore (${t.motion.absentScore}) must be a score, 0–100`);
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
  // The reminder caps (RULES Y5): a block that may hold nothing, or more
  // than the whole plan, is a cap the app and the server would read two
  // different ways.
  if (!(water.maxRemindersPerSlot > 0 && water.maxRemindersPerSlot <= water.maxReminders)) {
    throw new Error(
      `hydration.maxRemindersPerSlot (${water.maxRemindersPerSlot}) must be above zero and no more than maxReminders (${water.maxReminders})`,
    );
  }
  if (water.reminderPushTtlSeconds <= 0) {
    throw new Error('hydration.reminderPushTtlSeconds must be above zero — a reminder push with no life left is never sent');
  }
  if (water.reminderCatchUpMinutes < 0) {
    throw new Error('hydration.reminderCatchUpMinutes cannot be negative');
  }
  // A block is a part of the day, so the times a new member starts with have
  // to be in it: the app pins each block's picker to the half named in
  // `reminderSlotPeriods`, and a default plan that broke that would ship
  // every new member a chip they could not have set themselves.
  for (const [slot, half] of Object.entries(water.reminderSlotPeriods)) {
    if (!['am', 'pm', 'any'].includes(half)) {
      throw new Error(`hydration.reminderSlotPeriods.${slot}: '${half}' is not one of am, pm, any`);
    }
  }
  for (const slot of ['morning', 'afternoon', 'evening'] as const) {
    const half = water.reminderSlotPeriods[slot];
    const times = water.defaultPlan.times[slot] ?? [];
    if (times.length > water.maxRemindersPerSlot) {
      throw new Error(
        `hydration.defaultPlan.times.${slot} holds ${times.length} times, above maxRemindersPerSlot (${water.maxRemindersPerSlot})`,
      );
    }
    if (half === 'any') continue;
    for (const time of times) {
      const hours = Number(time.slice(0, 2));
      const isAm = hours < 12;
      if (!Number.isFinite(hours) || isAm !== (half === 'am')) {
        throw new Error(
          `hydration.defaultPlan.times.${slot}: '${time}' is not a ${half.toUpperCase()} time, and hydration.reminderSlotPeriods.${slot} is ${half.toUpperCase()}`,
        );
      }
    }
  }
  // The prize ladder (RULES L7). This one is money: `tierFor` takes the
  // *first* tier whose range holds a rank, so two ranges over the same place
  // is an ambiguity nobody would see until a Monday paid the wrong figure,
  // and a gap between them is a rank that silently wins nothing while the one
  // below it does. A ladder is therefore: starts at 1, each rung continuing
  // where the last ended.
  const board = config.leaderboard;
  let previous = 0;
  for (const [index, tier] of board.tiers.entries()) {
    const where = `leaderboard.tiers[${index}]`;
    if (!(Number.isInteger(tier.fromRank) && Number.isInteger(tier.toRank))) {
      throw new Error(`${where}: ranks are whole places, not ${tier.fromRank}–${tier.toRank}`);
    }
    if (tier.fromRank < 1 || tier.toRank < tier.fromRank) {
      throw new Error(`${where}: ${tier.fromRank}–${tier.toRank} is not a range of places`);
    }
    if (tier.fromRank !== previous + 1) {
      throw new Error(
        previous === 0
          ? `${where}: the ladder has to start at place 1, not ${tier.fromRank}`
          : `${where}: places ${previous + 1}–${tier.fromRank - 1} would win nothing while ${tier.fromRank}–${tier.toRank} does. Each rung continues where the last ended.`,
      );
    }
    if (!(tier.coins >= 0) || !Number.isInteger(tier.coins)) {
      throw new Error(`${where}.coins (${tier.coins}) is not a number of coins`);
    }
    if (tier.perks.some(perk => perk.trim().length === 0)) {
      throw new Error(`${where}.perks holds an empty line`);
    }
    previous = tier.toRank;
  }
  if (!(board.score.stepsPerPoint >= 1)) {
    throw new Error('leaderboard.score.stepsPerPoint must be at least 1 — a point per zero steps is every member on the same score');
  }
  if (board.score.perWorkout < 0 || board.score.perChallenge < 0) {
    throw new Error('leaderboard.score: a workout or a challenge cannot be worth negative points');
  }
  if (!(board.boardSize >= 1)) {
    throw new Error('leaderboard.boardSize must be at least 1');
  }
  if (board.closeAfterHours < 0 || board.closeAfterHours > 23) {
    throw new Error(`leaderboard.closeAfterHours (${board.closeAfterHours}) is hours into Monday, so 0–23`);
  }
  // The words the screen says (D-89). Empty copy is a blank card, and the
  // app draws whatever is here without a release to correct it.
  if (board.howItWorks.length === 0) {
    throw new Error('leaderboard.howItWorks: the How it works tab would be empty');
  }
  for (const [index, step] of board.howItWorks.entries()) {
    if (step.title.trim().length === 0 || step.detail.trim().length === 0) {
      throw new Error(`leaderboard.howItWorks[${index}]: a step needs both a title and a detail`);
    }
  }
  for (const [key, line] of Object.entries(board.banner)) {
    if (String(line).trim().length === 0) {
      throw new Error(`leaderboard.banner.${key} is empty, and the app draws the banner whatever is in it`);
    }
  }
  if (board.note.trim().length === 0) {
    throw new Error('leaderboard.note is empty — it is the line under the prize ladder');
  }
  // A week that paid nothing has to be able to say why (D-90). An empty
  // reason is a zero with no explanation, which reads as money kept.
  for (const outcome of ['paid', 'held', 'skipped', 'none'] as const) {
    if (String(board.outcomes[outcome] ?? '').trim().length === 0) {
      throw new Error(`leaderboard.outcomes.${outcome} is empty — a closed week would state a figure and no reason`);
    }
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
