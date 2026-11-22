import { getConfig } from '../../config/remote.js';
import { addDays, isValidTimeZone, localDayOf, localHourOf, localMidnightUtc, localWeekdayOf, weekdayOf } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';
import { compareVersions } from '../../middleware/version.js';
import { ActivityDailyModel } from '../activity/models.js';
import { resolveSegment, segmentSchema } from '../admin/broadcast.service.js';
import { tipOfTheDay } from '../content/service.js';
import { AppReleaseModel, DeviceModel } from '../devices/models.js';
import { CoinBalanceModel, CoinLedgerModel } from '../economy/models.js';
import { NotificationPreferencesModel, UserModel, UserSettingsModel } from '../identity/models.js';
import {
  AUTOMATIONS,
  AUTOMATION_KEYS,
  CATEGORY_ROUTE,
  renderTemplate,
  type AutomationDefinition,
  type AutomationKey,
  type AutomationTemplate,
} from './automations.catalog.js';
import { NotificationAutomationModel, NotificationCampaignModel } from './automations.models.js';
import { NotificationModel } from './models.js';
import { notify, type NotifyResult } from './service.js';

/**
 * The automated messages (RULES M11): the built-in automations, run on the
 * hourly tick at each member's own local hour, and the operator's scheduled
 * messages, run the same way.
 *
 * Every message goes through `notify()`, so consent and quiet hours are
 * decided exactly as for any job; what is added here is the three things
 * an automated sender owes a member on top of that:
 *
 *   - **Their clock, not ours.** "8 am" is 8 am where they are. The tick is
 *     hourly and each run asks which time zones are at the hour now.
 *   - **Once.** Every message names its occasion in its dedupe key — the
 *     automation and the member's own date — so a tick that runs twice, or
 *     two instances, write one row.
 *   - **Not too much.** ⚙ `automations.maxPerDay` caps the automated
 *     messages in a member's day. A goal reached and a saved reward now
 *     affordable are their own news and are never held back.
 */

const DAY_MS = 86_400_000;
const BATCH = 25;

// ─── Settings ──────────────────────────────────────────────────────────────

export interface ResolvedAutomation {
  definition: AutomationDefinition;
  enabled: boolean;
  hour: number | null;
  weekdays: number[];
  params: Record<string, unknown>;
  templates: AutomationTemplate[];
  /** Whether the row holds anything, or the code's defaults are in force. */
  customised: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** One automation as the operator left it, over the code's defaults. */
export async function loadAutomation(key: AutomationKey): Promise<ResolvedAutomation> {
  const row = await NotificationAutomationModel.findById(key).lean();
  return resolve(key, row);
}

export async function loadAutomations(): Promise<ResolvedAutomation[]> {
  const rows = await NotificationAutomationModel.find({ _id: { $in: [...AUTOMATION_KEYS] } }).lean();
  const byKey = new Map(rows.map(row => [row._id, row]));
  return AUTOMATION_KEYS.map(key => resolve(key, byKey.get(key) ?? null));
}

type AutomationRow = {
  enabled?: boolean;
  hour?: number | null;
  weekdays?: number[] | null;
  params?: Record<string, unknown> | null;
  templates?: AutomationTemplate[] | null;
  updatedAt?: Date;
  updatedBy?: string | null;
} | null;

function resolve(key: AutomationKey, row: AutomationRow): ResolvedAutomation {
  const definition = AUTOMATIONS[key];
  const { defaults } = definition;
  const params = { ...defaults.params, ...(row?.params ?? {}) };
  const parsed = definition.params.safeParse(params);
  return {
    definition,
    enabled: row?.enabled ?? defaults.enabled,
    hour: definition.timing === 'hour' ? row?.hour ?? defaults.hour : null,
    weekdays: row?.weekdays?.length ? row.weekdays : defaults.weekdays,
    // A stored value the code no longer accepts falls back rather than
    // stopping the automation; the panel shows the defaults it fell to.
    params: parsed.success ? (parsed.data as Record<string, unknown>) : defaults.params,
    templates: row?.templates?.length ? row.templates : defaults.templates,
    customised: Boolean(row),
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

// ─── The member's clock ────────────────────────────────────────────────────

export interface ZoneClock {
  zone: string;
  hour: number;
  day: string;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
}

/** Every time zone a member lives in, and what its clock says now. */
async function zoneClocks(now: Date, fallbackZone: string): Promise<ZoneClock[]> {
  const zones = new Set<string>([fallbackZone]);
  for (const zone of (await UserModel.distinct('timezone', { deletedAt: null })) as (string | null)[]) {
    if (typeof zone === 'string' && zone) zones.add(zone);
  }
  return [...zones]
    .filter(zone => isValidTimeZone(zone))
    .map(zone => ({ zone, hour: localHourOf(now, zone), day: localDayOf(now, zone), weekday: localWeekdayOf(now, zone) }));
}

interface Member {
  userId: string;
  name: string;
  clock: ZoneClock;
}

/** The members in the zones whose clock is at `hour` on one of `weekdays` now. */
async function membersAt(clocks: ZoneClock[], fallbackZone: string, hour: number, weekdays: number[]): Promise<Member[]> {
  const due = clocks.filter(clock => clock.hour === hour && weekdays.includes(clock.weekday));
  if (due.length === 0) return [];
  const byZone = new Map(due.map(clock => [clock.zone, clock]));
  const zones = [...byZone.keys()];
  const filter: Record<string, unknown> = { deletedAt: null };
  filter.$or = byZone.has(fallbackZone)
    ? [{ timezone: { $in: zones } }, { timezone: null }, { timezone: '' }]
    : [{ timezone: { $in: zones } }];
  const users = await UserModel.find(filter, { name: 1, timezone: 1 }).lean();
  return users.flatMap(user => {
    const clock = byZone.get(user.timezone || fallbackZone);
    return clock ? [{ userId: user._id, name: user.name ?? '', clock }] : [];
  });
}

async function activeMembers(withinDays: number, now: Date): Promise<Set<string>> {
  const ids = await DeviceModel.distinct('userId', { revokedAt: null, lastSeenAt: { $gte: new Date(now.getTime() - withinDays * DAY_MS) } });
  return new Set(ids as string[]);
}

// ─── Words ─────────────────────────────────────────────────────────────────

/** First word of the name on file; empty when there is none. */
export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** A small stable number per member, so members do not all get the same line on the same day. */
function spread(userId: string): number {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) hash = (hash * 31 + userId.charCodeAt(index)) % 2_147_483_647;
  return hash;
}

/**
 * Which of a slot's lines this member reads today: the next one each day,
 * starting from a place of their own, so one member is not told the same
 * thing two days running and a whole base is not told one thing at once.
 */
export function pickTemplate(templates: AutomationTemplate[], slot: string, userId: string, day: string): AutomationTemplate | null {
  const live = templates.filter(template => template.active && (template.slot ?? 'default') === slot);
  if (live.length === 0) return null;
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
  return live[(dayNumber + spread(userId)) % live.length];
}

// ─── Sending ───────────────────────────────────────────────────────────────

export type DeliveryOutcome = NotifyResult['status'] | 'capped' | 'switched_off';

interface Delivery {
  userId: string;
  clock: ZoneClock;
  origin: string;
  dedupeKey: string;
  topic: AutomationDefinition['topic'];
  preference: AutomationDefinition['preference'];
  dropInQuietHours: boolean;
  exemptFromCap: boolean;
  title: string;
  message: string;
  link?: string | null;
  now: Date;
}

/** Origins that are the member's own news and neither count towards nor obey the cap. */
const UNCAPPED_ORIGINS = AUTOMATION_KEYS.filter(key => AUTOMATIONS[key].exemptFromCap).map(key => `auto:${key}`);

/** Whether the member has had their day's automated messages already. */
async function capReached(userId: string, clock: ZoneClock, maxPerDay: number): Promise<boolean> {
  const since = localMidnightUtc(clock.day, clock.zone);
  const sent = await NotificationModel.countDocuments({
    userId,
    createdAt: { $gte: since },
    origin: { $type: 'string', $nin: UNCAPPED_ORIGINS },
  });
  return sent >= maxPerDay;
}

/**
 * Whether the member's switch for this message is on. Asked before the row
 * is written, unlike `notify()`'s own check: a job's news is worth a feed
 * row even with the push switched off (RULES M4), but a member who turned
 * off the daily check-ins does not want them in their feed every day
 * instead (RULES M11).
 */
async function switchedOn(userId: string, preference: Delivery['preference']): Promise<boolean> {
  const prefs = await NotificationPreferencesModel.findById(userId, { categories: 1 }).lean();
  const value = (prefs?.categories as Partial<Record<string, boolean>> | undefined)?.[preference];
  return value ?? preference !== 'health';
}

/** Writes one automated message through `notify()`, after the member's switch and the cap. */
export async function deliver(delivery: Delivery, maxPerDay: number): Promise<{ outcome: DeliveryOutcome; push: NotifyResult['push'] | null }> {
  if (!(await switchedOn(delivery.userId, delivery.preference))) return { outcome: 'switched_off', push: null };
  if (!delivery.exemptFromCap && (await capReached(delivery.userId, delivery.clock, maxPerDay))) {
    return { outcome: 'capped', push: null };
  }
  const result = await notify({
    userId: delivery.userId,
    topic: delivery.topic,
    preference: delivery.preference,
    title: delivery.title.slice(0, 120),
    message: delivery.message.slice(0, 500),
    dedupeKey: delivery.dedupeKey,
    origin: delivery.origin,
    link: delivery.link ?? null,
    dropInQuietHours: delivery.dropInQuietHours,
    now: delivery.now,
  });
  return { outcome: result.status, push: result.push };
}

// ─── What each automation knows about a member ─────────────────────────────

interface Basics {
  goal: number;
  coins: number;
}

async function basicsOf(userIds: string[]): Promise<Map<string, Basics>> {
  const [settings, balances] = await Promise.all([
    UserSettingsModel.find({ _id: { $in: userIds } }, { dailyStepGoal: 1 }).lean(),
    CoinBalanceModel.find({ _id: { $in: userIds } }, { balanceMc: 1 }).lean(),
  ]);
  const goals = new Map(settings.map(row => [String(row._id), row.dailyStepGoal ?? 10_000]));
  const coins = new Map(balances.map(row => [String(row._id), Math.floor((row.balanceMc ?? 0) / 1000)]));
  return new Map(userIds.map(id => [id, { goal: goals.get(id) ?? 10_000, coins: coins.get(id) ?? 0 }]));
}

/** The day's figure the app shows: the count cut to what the server verified. */
const verifiedOf = (row: { steps?: number; verifiedSteps?: number } | null | undefined): number =>
  row ? Math.max(0, Math.min(Math.round(row.steps ?? 0), Math.round(row.verifiedSteps ?? 0))) : 0;

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface Occasion {
  slot: string;
  vars: Record<string, string | number>;
  /** What makes this one message different from yesterday's — the dedupe key's tail. */
  occasion: string;
  link?: string | null;
}

type Evaluate = (members: Member[], ctx: RunContext, automation: ResolvedAutomation) => Promise<Map<string, Occasion>>;

interface RunContext {
  now: Date;
  basics: Map<string, Basics>;
}

const person = (member: Member, basics: Basics | undefined): Record<string, string | number> => ({
  firstName: firstNameOf(member.name),
  goal: basics?.goal ?? 10_000,
  coins: basics?.coins ?? 0,
});

const EVALUATE: Partial<Record<AutomationKey, Evaluate>> = {
  morning_motivation: async (members, ctx) =>
    new Map(members.map(member => [member.userId, { slot: 'default', vars: person(member, ctx.basics.get(member.userId)), occasion: member.clock.day }])),

  afternoon_check: async (members, ctx, automation) => {
    const below = Number(automation.params.belowPercent ?? 50);
    const rows = await ActivityDailyModel.find(
      { _id: { $in: members.map(member => `${member.userId}:${member.clock.day}`) } },
      { steps: 1, verifiedSteps: 1 },
    ).lean();
    const byId = new Map(rows.map(row => [String(row._id), row]));
    const out = new Map<string, Occasion>();
    for (const member of members) {
      const basics = ctx.basics.get(member.userId);
      const goal = basics?.goal ?? 10_000;
      const steps = verifiedOf(byId.get(`${member.userId}:${member.clock.day}`));
      // Nothing synced yet is not "you walked nothing": the phone may simply not have reported.
      if (steps <= 0 || steps * 100 >= goal * below) continue;
      out.set(member.userId, {
        slot: 'default',
        occasion: member.clock.day,
        vars: { ...person(member, basics), steps, stepsLeft: goal - steps, percent: Math.floor((steps * 100) / goal) },
      });
    }
    return out;
  },

  weekly_summary: async (members, ctx) => {
    const out = new Map<string, Occasion>();
    for (const member of members) {
      const { day, zone } = member.clock;
      const days = Array.from({ length: 7 }, (_, index) => addDays(day, index - 7));
      const [rows, earned] = await Promise.all([
        ActivityDailyModel.find({ _id: { $in: days.map(d => `${member.userId}:${d}`) } }, { localDay: 1, steps: 1, verifiedSteps: 1 }).lean(),
        CoinLedgerModel.aggregate<{ mc: number }>([
          {
            $match: {
              userId: member.userId,
              amountMc: { $gt: 0 },
              source: { $ne: 'refund' },
              createdAt: { $gte: localMidnightUtc(days[0], zone), $lt: localMidnightUtc(day, zone) },
            },
          },
          { $group: { _id: null, mc: { $sum: '$amountMc' } } },
        ]),
      ]);
      const basics = ctx.basics.get(member.userId);
      const goal = basics?.goal ?? 10_000;
      const walked = rows.map(row => ({ day: row.localDay as string, steps: verifiedOf(row) }));
      const weekSteps = walked.reduce((sum, entry) => sum + entry.steps, 0);
      if (weekSteps === 0) continue;
      const best = walked.reduce((top, entry) => (entry.steps > top.steps ? entry : top), walked[0]);
      out.set(member.userId, {
        slot: 'default',
        occasion: day,
        vars: {
          ...person(member, basics),
          weekSteps,
          goalDays: walked.filter(entry => entry.steps >= goal).length,
          weekCoins: Math.floor((earned[0]?.mc ?? 0) / 1000),
          bestDay: WEEKDAY_NAMES[weekdayOf(best.day)],
          bestDaySteps: best.steps,
          averageSteps: Math.round(weekSteps / 7),
        },
      });
    }
    return out;
  },

  win_back: async (members, ctx, automation) => {
    const stages = new Set((automation.params.afterDays as number[] | undefined) ?? [3, 7, 14]);
    const seen = await DeviceModel.aggregate<{ _id: string; last: Date }>([
      { $match: { userId: { $in: members.map(member => member.userId) }, revokedAt: null } },
      { $group: { _id: '$userId', last: { $max: '$lastSeenAt' } } },
    ]);
    const lastSeen = new Map(seen.map(row => [row._id, row.last]));
    const out = new Map<string, Occasion>();
    for (const member of members) {
      const last = lastSeen.get(member.userId);
      if (!last) continue;
      const away = Math.floor((ctx.now.getTime() - last.getTime()) / DAY_MS);
      if (!stages.has(away)) continue;
      out.set(member.userId, {
        slot: 'default',
        // One message per stage of one absence: the day they went quiet, and how long ago.
        occasion: `${localDayOf(last, member.clock.zone)}:${away}`,
        vars: { ...person(member, ctx.basics.get(member.userId)), days: away },
      });
    }
    return out;
  },

  app_update: async (members, ctx) => {
    const releases = await AppReleaseModel.find({ status: { $ne: 'blocked' } }, { platform: 1, version: 1, notes: 1 }).lean();
    const newest = new Map<string, { version: string; notes: string }>();
    for (const release of releases) {
      const best = newest.get(release.platform);
      if (!best || compareVersions(release.version, best.version) > 0) {
        newest.set(release.platform, { version: release.version, notes: release.notes ?? '' });
      }
    }
    if (newest.size === 0) return new Map();
    const phones = await DeviceModel.aggregate<{ _id: string; platform: string; version: string | null }>([
      { $match: { userId: { $in: members.map(member => member.userId) }, revokedAt: null } },
      { $sort: { lastSeenAt: -1 } },
      { $group: { _id: '$userId', platform: { $first: '$platform' }, version: { $first: '$app.version' } } },
    ]);
    const byUser = new Map(phones.map(phone => [phone._id, phone]));
    const out = new Map<string, Occasion>();
    for (const member of members) {
      const phone = byUser.get(member.userId);
      const latest = phone ? newest.get(phone.platform) : undefined;
      if (!phone?.version || !latest || compareVersions(phone.version, latest.version) >= 0) continue;
      const notes = latest.notes.replace(/\s+/g, ' ').trim();
      out.set(member.userId, {
        slot: 'default',
        occasion: `${phone.platform}:${latest.version}`,
        link: 'update',
        vars: {
          ...person(member, ctx.basics.get(member.userId)),
          version: latest.version,
          notes: notes.length > 140 ? `${notes.slice(0, 137)}…` : notes,
        },
      });
    }
    return out;
  },

  health_tip: async (members, ctx, automation) => {
    const topic = String(automation.params.tipTopic ?? 'health');
    const tips = new Map<string, { title: string | null; text: string } | null>();
    const out = new Map<string, Occasion>();
    for (const member of members) {
      if (!tips.has(member.clock.zone)) {
        tips.set(member.clock.zone, await tipOfTheDay(topic, member.clock.zone, ctx.now).catch(() => null));
      }
      const tip = tips.get(member.clock.zone);
      if (!tip) continue;
      out.set(member.userId, {
        slot: 'default',
        occasion: member.clock.day,
        vars: { ...person(member, ctx.basics.get(member.userId)), tip: tip.text, tipTitle: tip.title ?? '' },
      });
    }
    return out;
  },
};

// ─── The hourly run ────────────────────────────────────────────────────────

export interface AutomationRun {
  enabled: boolean;
  automations: Record<string, { due: number; sent: number; capped: number; skipped: number }>;
  campaigns: Record<string, { due: number; sent: number; capped: number; skipped: number }>;
}

type Tally = { due: number; sent: number; capped: number; skipped: number };
const tally = (): Tally => ({ due: 0, sent: 0, capped: 0, skipped: 0 });

function count(into: Tally, outcome: DeliveryOutcome): void {
  if (outcome === 'created') into.sent += 1;
  else if (outcome === 'capped') into.capped += 1;
  else into.skipped += 1;
}

/** In small parallel batches, so a big zone does not open a thousand connections at once. */
async function inBatches<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += BATCH) {
    await Promise.all(items.slice(index, index + BATCH).map(item => run(item).catch(err => logger.error({ err }, 'automations.send_failed'))));
  }
}

/**
 * Everything automated that is due this hour. Run by the hourly tick; safe
 * to run twice (every message is keyed to its occasion).
 */
export async function runAutomations(now = new Date()): Promise<AutomationRun> {
  const config = await getConfig();
  const settings = config.automations;
  const run: AutomationRun = { enabled: settings.enabled, automations: {}, campaigns: {} };
  if (!settings.enabled) return run;

  const fallbackZone = config.locale.timezone;
  const clocks = await zoneClocks(now, fallbackZone);
  let active: Set<string> | null = null;
  const activeSet = async () => (active ??= await activeMembers(settings.activeWithinDays, now));

  for (const automation of await loadAutomations()) {
    const { definition } = automation;
    if (!automation.enabled || definition.timing !== 'hour' || automation.hour === null) continue;
    const evaluate = EVALUATE[definition.key];
    if (!evaluate) continue;

    let members = await membersAt(clocks, fallbackZone, automation.hour, automation.weekdays);
    // The win-back is for exactly the members the others leave alone.
    if (definition.key !== 'win_back') {
      const live = await activeSet();
      members = members.filter(member => live.has(member.userId));
    }
    if (members.length === 0) continue;

    const into = (run.automations[definition.key] = tally());
    const basics = await basicsOf(members.map(member => member.userId));
    const occasions = await evaluate(members, { now, basics }, automation);
    into.due = occasions.size;

    await inBatches(members.filter(member => occasions.has(member.userId)), async member => {
      const occasion = occasions.get(member.userId)!;
      const template = pickTemplate(automation.templates, occasion.slot, member.userId, member.clock.day);
      if (!template) {
        into.skipped += 1;
        return;
      }
      const { outcome } = await deliver(
        {
          userId: member.userId,
          clock: member.clock,
          origin: `auto:${definition.key}`,
          dedupeKey: `auto:${definition.key}:${occasion.occasion}`,
          topic: definition.topic,
          preference: definition.preference,
          dropInQuietHours: definition.dropInQuietHours,
          exemptFromCap: definition.exemptFromCap,
          title: renderTemplate(template.title, occasion.vars),
          message: renderTemplate(template.message, occasion.vars),
          link: occasion.link ?? null,
          now,
        },
        settings.maxPerDay,
      );
      count(into, outcome);
    });
  }

  run.automations.goal_reached = await celebrateGoals(now, fallbackZone, settings.maxPerDay);
  run.campaigns = await runCampaigns(now, clocks, fallbackZone, settings.maxPerDay);
  if (Object.values(run.automations).some(t => t.sent > 0) || Object.values(run.campaigns).some(t => t.sent > 0)) {
    logger.info({ automations: run.automations, campaigns: run.campaigns }, 'automations.ran');
  }
  return run;
}

/**
 * The day's goal reached, said within the hour of the server verifying it.
 * Reads only the days a sync has touched in the last two hours, so the
 * whole base is never scanned for it.
 */
async function celebrateGoals(now: Date, fallbackZone: string, maxPerDay: number): Promise<Tally> {
  const into = tally();
  const automation = await loadAutomation('goal_reached');
  if (!automation.enabled) return into;
  const rows = await ActivityDailyModel.find(
    { updatedAt: { $gte: new Date(now.getTime() - 2 * 60 * 60 * 1000) }, verifiedSteps: { $gt: 0 } },
    { userId: 1, localDay: 1, steps: 1, verifiedSteps: 1 },
  ).lean();
  if (rows.length === 0) return into;
  const userIds = [...new Set(rows.map(row => row.userId as string))];
  const [users, basics] = await Promise.all([
    UserModel.find({ _id: { $in: userIds }, deletedAt: null }, { name: 1, timezone: 1 }).lean(),
    basicsOf(userIds),
  ]);
  const byUser = new Map(users.map(user => [user._id, user]));

  await inBatches(rows, async row => {
    const user = byUser.get(row.userId as string);
    if (!user) return;
    const zone = user.timezone && isValidTimeZone(user.timezone) ? user.timezone : fallbackZone;
    const clock: ZoneClock = { zone, hour: localHourOf(now, zone), day: localDayOf(now, zone), weekday: localWeekdayOf(now, zone) };
    // Today's day only: a late sync that finishes yesterday's goal is not news this morning.
    if (row.localDay !== clock.day) return;
    const own = basics.get(user._id);
    const goal = own?.goal ?? 10_000;
    const steps = verifiedOf(row);
    if (steps < goal) return;
    into.due += 1;
    const member: Member = { userId: user._id, name: user.name ?? '', clock };
    const template = pickTemplate(automation.templates, 'default', user._id, clock.day);
    if (!template) return;
    const vars = { ...person(member, own), steps, goal };
    const { outcome } = await deliver(
      {
        userId: user._id,
        clock,
        origin: 'auto:goal_reached',
        dedupeKey: `auto:goal_reached:${clock.day}`,
        topic: automation.definition.topic,
        preference: automation.definition.preference,
        dropInQuietHours: automation.definition.dropInQuietHours,
        exemptFromCap: true,
        title: renderTemplate(template.title, vars),
        message: renderTemplate(template.message, vars),
        link: 'steps',
        now,
      },
      maxPerDay,
    );
    count(into, outcome);
  });
  return into;
}

// ─── Scheduled messages ────────────────────────────────────────────────────

type CampaignRow = {
  _id: string;
  category: 'motivation' | 'information' | 'update' | 'offer';
  title: string;
  message: string;
  link?: string | null;
  segment?: Record<string, unknown>;
  schedule: { kind: 'once' | 'daily' | 'weekly'; date?: string | null; weekdays?: number[] | null; hour: number };
  startsOn?: string | null;
  endsOn?: string | null;
};

/** Whether a scheduled message is due on this member clock. */
export function campaignDueOn(campaign: Pick<CampaignRow, 'schedule' | 'startsOn' | 'endsOn'>, clock: ZoneClock): boolean {
  const { schedule } = campaign;
  if (clock.hour !== schedule.hour) return false;
  if (campaign.startsOn && clock.day < campaign.startsOn) return false;
  if (campaign.endsOn && clock.day > campaign.endsOn) return false;
  if (schedule.kind === 'once') return schedule.date === clock.day;
  if (schedule.kind === 'weekly') return (schedule.weekdays ?? []).includes(clock.weekday);
  return true;
}

/**
 * The operator's scheduled messages that are due this hour. The segment is
 * the broadcast's (resolved the same way, with the same ceiling), narrowed
 * to the members whose own clock is at the hour.
 */
async function runCampaigns(now: Date, clocks: ZoneClock[], fallbackZone: string, maxPerDay: number): Promise<Record<string, Tally>> {
  const out: Record<string, Tally> = {};
  const campaigns = (await NotificationCampaignModel.find({ enabled: true }).lean()) as unknown as CampaignRow[];
  if (campaigns.length === 0) return out;

  for (const campaign of campaigns) {
    const dueClocks = clocks.filter(clock => campaignDueOn(campaign, clock));
    if (dueClocks.length === 0) continue;
    const into = (out[campaign._id] = tally());
    const segment = segmentSchema.safeParse(campaign.segment ?? {});
    const inSegment = new Set(await resolveSegment(segment.success ? segment.data : {}));
    const members: Member[] = [];
    for (const clock of dueClocks) {
      const zoneMembers = await membersAt([clock], fallbackZone, clock.hour, [clock.weekday]);
      members.push(...zoneMembers.filter(member => inSegment.has(member.userId)));
    }
    into.due = members.length;
    if (members.length === 0) continue;
    const basics = await basicsOf(members.map(member => member.userId));
    const route = CATEGORY_ROUTE[campaign.category];

    await inBatches(members, async member => {
      const vars = person(member, basics.get(member.userId));
      const { outcome } = await deliver(
        {
          userId: member.userId,
          clock: member.clock,
          origin: `campaign:${campaign._id}`,
          dedupeKey: `campaign:${campaign._id}:${member.clock.day}`,
          topic: route.topic,
          preference: route.preference,
          dropInQuietHours: false,
          exemptFromCap: false,
          title: renderTemplate(campaign.title, vars),
          message: renderTemplate(campaign.message, vars),
          link: campaign.link ?? null,
          now,
        },
        maxPerDay,
      );
      count(into, outcome);
    });
    await NotificationCampaignModel.updateOne({ _id: campaign._id }, { $set: { lastRunAt: now } });
  }
  return out;
}

// ─── For the panel ─────────────────────────────────────────────────────────

/** Sent, pushed and opened over the last `days`, per origin. */
export async function originStats(origins: string[], days = 7, now = new Date()): Promise<Map<string, { sent: number; pushed: number; read: number }>> {
  if (origins.length === 0) return new Map();
  const rows = await NotificationModel.aggregate<{ _id: string; sent: number; pushed: number; read: number }>([
    { $match: { origin: { $in: origins }, createdAt: { $gte: new Date(now.getTime() - days * DAY_MS) } } },
    {
      $group: {
        _id: '$origin',
        sent: { $sum: 1 },
        pushed: { $sum: { $cond: [{ $ifNull: ['$pushedAt', false] }, 1, 0] } },
        read: { $sum: { $cond: ['$read', 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map(row => [row._id, { sent: row.sent, pushed: row.pushed, read: row.read }]));
}

/**
 * What an automation would say to one member right now, from their real
 * figures — and whether its reason holds for them today. For the panel's
 * "try it on a member" before an automation is switched on.
 */
export async function previewAutomation(key: AutomationKey, userId: string, now = new Date()) {
  const config = await getConfig();
  const automation = await loadAutomation(key);
  const user = await UserModel.findById(userId, { name: 1, timezone: 1, deletedAt: 1 }).lean();
  if (!user || user.deletedAt) return null;
  const zone = user.timezone && isValidTimeZone(user.timezone) ? user.timezone : config.locale.timezone;
  const clock: ZoneClock = { zone, hour: localHourOf(now, zone), day: localDayOf(now, zone), weekday: localWeekdayOf(now, zone) };
  const member: Member = { userId, name: user.name ?? '', clock };
  const basics = await basicsOf([userId]);

  let occasion: Occasion | null = null;
  let applies = true;
  const evaluate = EVALUATE[key];
  if (evaluate) {
    occasion = (await evaluate([member], { now, basics }, automation)).get(userId) ?? null;
    applies = occasion !== null;
  } else if (key === 'goal_reached') {
    const row = await ActivityDailyModel.findById(`${userId}:${clock.day}`, { steps: 1, verifiedSteps: 1 }).lean();
    const goal = basics.get(userId)?.goal ?? 10_000;
    const steps = verifiedOf(row);
    applies = steps >= goal;
    occasion = { slot: 'default', occasion: clock.day, vars: { ...person(member, basics.get(userId)), steps, goal } };
  }
  // A member the reason does not hold for still gets a preview, filled
  // with what is known about them, so the words can be read either way.
  const slot = key === 'wishlist_goal' ? 'one' : 'default';
  const vars = occasion?.vars ?? {
    ...person(member, basics.get(userId)),
    steps: 0, stepsLeft: 0, percent: 0, days: 0, version: '', notes: '', tip: '', tipTitle: '',
    item: 'Wrist Wraps', goal: basics.get(userId)?.goal ?? 0, balance: basics.get(userId)?.coins ?? 0, count: 2, items: 'Wrist Wraps and Speed Rope',
  };
  const template = pickTemplate(automation.templates, occasion?.slot ?? slot, userId, clock.day);
  return {
    key,
    applies,
    clock,
    title: template ? renderTemplate(template.title, vars) : null,
    message: template ? renderTemplate(template.message, vars) : null,
    templateId: template?.id ?? null,
    link: occasion?.link ?? null,
    topic: automation.definition.topic,
    preference: automation.definition.preference,
  };
}
