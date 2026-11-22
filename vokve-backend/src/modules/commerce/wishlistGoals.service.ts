import { getConfig } from '../../config/remote.js';
import { isValidTimeZone, localDayOf, localHourOf, localWeekdayOf } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';
import { onBalanceRaised } from '../economy/events.js';
import { UserModel } from '../identity/models.js';
import { renderTemplate } from '../notifications/automations.catalog.js';
import { deliver, firstNameOf, loadAutomation, pickTemplate, type ZoneClock } from '../notifications/automations.service.js';
import { WishlistModel } from './models.js';
import { coinGoalReached, shopItemsById, spendableCoins } from './service.js';
import type { ShopItem } from '../../contracts/index.js';

const DAY_MS = 86_400_000;

/**
 * "You can redeem it now" (RULES M12): the moment the wallet reaches a
 * saved item's coin goal (RULES R20), the member is told — once.
 *
 * Each wishlist row carries `goalArmed`. Reaching the goal while armed
 * tells the member and disarms it, in one conditional write, so two
 * credits landing together tell them once. Dropping back below — they
 * spent the coins, the price went up — re-arms it, so the next time the
 * wallet gets there is news again, though never within the cooldown of
 * the last time.
 *
 * Only items coins are what it takes for (a coins-only item, or a fixed
 * share): an item whose coins are an optional discount could always be
 * bought, so there is nothing for it to become ready for. Sold out is not
 * reached; a restock that finds the wallet ready is news.
 *
 * Several crossing at once — a big refund, a leaderboard prize — are one
 * message, not a burst.
 */
export async function checkWishlistGoals(userId: string, now = new Date()): Promise<{ told: string[] }> {
  const rows = await WishlistModel.find({ userId }).sort({ addedAt: -1 }).lean();
  if (rows.length === 0) return { told: [] };

  const [items, balance, config, automation] = await Promise.all([
    shopItemsById(rows.map(row => row.itemId)),
    spendableCoins(userId),
    getConfig(),
    loadAutomation('wishlist_goal'),
  ]);
  const speaking = automation.enabled && config.automations.enabled;
  const cooldownMs = Number(automation.params.cooldownDays ?? 7) * DAY_MS;

  const ready: ShopItem[] = [];
  for (const row of rows) {
    const item = items.get(row.itemId);
    if (!item || !(item.coinGoal > 0) || item.coinsMin <= 0) continue;
    const reached = coinGoalReached(item, balance);

    // Saved before the alert existed: set, not told.
    if (row.goalArmed === undefined || row.goalArmed === null) {
      await WishlistModel.updateOne({ _id: row._id, goalArmed: null }, { $set: { goalArmed: !reached } });
      continue;
    }
    if (!reached) {
      if (row.goalArmed === false) await WishlistModel.updateOne({ _id: row._id, goalArmed: false }, { $set: { goalArmed: true } });
      continue;
    }
    if (!row.goalArmed) continue;
    if (row.goalAlertedAt && now.getTime() - new Date(row.goalAlertedAt).getTime() < cooldownMs) continue;

    // Switched off: disarmed without a word, so switching it on later
    // tells nobody about a goal they reached weeks ago.
    const claimed = await WishlistModel.updateOne(
      { _id: row._id, goalArmed: true },
      { $set: speaking ? { goalArmed: false, goalAlertedAt: now } : { goalArmed: false } },
    );
    if (speaking && claimed.modifiedCount === 1) ready.push(item);
  }
  if (ready.length === 0) return { told: [] };

  const user = await UserModel.findById(userId, { name: 1, timezone: 1, deletedAt: 1 }).lean();
  if (!user || user.deletedAt) return { told: [] };
  const zone = user.timezone && isValidTimeZone(user.timezone) ? user.timezone : config.locale.timezone;
  const clock: ZoneClock = { zone, hour: localHourOf(now, zone), day: localDayOf(now, zone), weekday: localWeekdayOf(now, zone) };

  const slot = ready.length === 1 ? 'one' : 'many';
  const template = pickTemplate(automation.templates, slot, userId, clock.day);
  if (!template) return { told: [] };
  const vars = {
    firstName: firstNameOf(user.name),
    balance,
    item: ready[0].title,
    goal: ready[0].coinGoal,
    count: ready.length,
    items: listOf(ready.map(item => item.title)),
  };
  const ids = ready.map(item => item.id);
  await deliver(
    {
      userId,
      clock,
      origin: 'auto:wishlist_goal',
      // The disarming write above is what makes this once; the key only
      // has to be unique to this crossing.
      dedupeKey: `auto:wishlist_goal:${ids.join(',')}:${now.getTime()}`,
      topic: automation.definition.topic,
      preference: automation.definition.preference,
      dropInQuietHours: automation.definition.dropInQuietHours,
      exemptFromCap: true,
      title: renderTemplate(template.title, vars),
      message: renderTemplate(template.message, vars),
      link: ready.length === 1 ? `product:${ids[0]}` : 'wishlist',
      now,
    },
    config.automations.maxPerDay,
  );
  return { told: ids };
}

/** "A", "A and B", "A, B and C", "A, B and 2 more". */
export function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

/**
 * The hourly backstop: everybody with something saved, for what no credit
 * announces — a restock, a price cut, coins put back by a cancelled order,
 * and the re-arming of goals the wallet has dropped below since.
 */
export async function sweepWishlistGoals(now = new Date()): Promise<{ members: number; told: number }> {
  const userIds = (await WishlistModel.distinct('userId')) as string[];
  let told = 0;
  for (const userId of userIds) {
    try {
      told += (await checkWishlistGoals(userId, now)).told.length;
    } catch (err) {
      logger.error({ err, userId }, 'wishlist_goals.check_failed');
    }
  }
  return { members: userIds.length, told };
}

/** The listener the ledger calls after a credit (RULES M12). One function, so registering twice is once. */
async function onCredit(userId: string): Promise<void> {
  await checkWishlistGoals(userId);
}

export function registerWishlistGoalAlerts(): void {
  onBalanceRaised(onCredit);
}
