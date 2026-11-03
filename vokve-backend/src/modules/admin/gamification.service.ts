import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { localDayOf } from '../../lib/dates.js';
import { Errors } from '../../lib/errors.js';
import {
  ACHIEVEMENT_RULES,
  AchievementDefinitionModel,
  CHALLENGE_CADENCES,
  CHALLENGE_METRICS,
  ChallengeCompletionModel,
  ChallengeDefinitionModel,
  UserAchievementModel,
} from '../challenges/models.js';
import { AuditLogModel } from '../platform/models.js';
import { pageFields } from './paging.js';

/**
 * The gamification catalogue (RULES C1–C7), for the operator.
 *
 * Challenges and achievements were seed data: changing what a challenge
 * pays, opening a weekend one, or adding a badge meant editing
 * `seed/data.ts` and deploying. Both are rows the app reads live, so both
 * belong here — and the two are one page's worth of thinking rather than
 * two, because a challenge that `rewardsBadge` pays an achievement, and a
 * badge nothing unlocks is a badge nobody gets.
 *
 * What the writes are careful about:
 *
 *   - **A challenge is never deleted once anybody has finished it.** A
 *     completion row is what paid somebody's coins (C4), and the ledger
 *     points back at the challenge; deleting the definition would leave
 *     those rows naming nothing. Retiring (`active: false`) takes it off
 *     every member's board and leaves the history readable.
 *   - **A badge is never deleted once anybody holds it** (C7), for the same
 *     reason, and never while a challenge still pays it out — that would
 *     turn the next completion into a payout to a badge that does not
 *     exist.
 *   - **Coins here are the owner's to set** (D-32), and they are held until
 *     ⚙ `coins.achievements.enabled`, exactly as step coins wait on
 *     `coins.steps.enabled` (D-46). Every read below says which.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date looks like 2026-10-19');

/** What somebody typed into a search box, as a literal rather than a pattern. */
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Challenges (RULES C1–C5) ──────────────────────────────────────────────

export const challengeBody = z
  .object({
    /** The id every completion row keys on. Derived from the title when left out, and fixed after. */
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'An id looks like ch-10k-steps').optional(),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).optional(),
    emoji: z.string().trim().max(8).optional(),
    metric: z.enum(CHALLENGE_METRICS),
    cadence: z.enum(CHALLENGE_CADENCES),
    /** What finishing it takes, in the metric's own unit. */
    goal: z.number().int().min(1).max(10_000_000),
    /** What finishing it pays, in coins (D-32). */
    rewardCoins: z.number().int().min(0).max(1_000_000),
    rewardsBadge: z.boolean().optional(),
    /** The achievement a completion unlocks; required when `rewardsBadge`. */
    badgeId: z.string().trim().max(64).nullable().optional(),
    /** `YYYY-MM-DD`, or null for "always". */
    startsOn: day.nullable().optional(),
    endsOn: day.nullable().optional(),
    active: z.boolean().optional(),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type ChallengeBody = z.infer<typeof challengeBody>;

export const challengePatch = challengeBody.partial().omit({ id: true }).strict();
export type ChallengePatch = z.infer<typeof challengePatch>;

type CompletionStat = {
  _id: string;
  completions: number;
  members: string[];
  granted: number;
  unpaid: number;
  lastAt: Date | null;
};

/** `10K Steps Challenge` → `ch-10k-steps`. */
function challengeIdOf(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44);
  return slug ? `ch-${slug}` : '';
}

/** Where a challenge is in its own window, as a member's board would show it. */
function windowStateOf(row: { startsOn?: string | null; endsOn?: string | null; active?: boolean }, today: string) {
  if (row.active === false) return 'retired' as const;
  if (row.startsOn && row.startsOn > today) return 'upcoming' as const;
  if (row.endsOn && row.endsOn < today) return 'ended' as const;
  return 'live' as const;
}

export const challengeQuery = z.object({
  /** Words in the title, the description, or the id. */
  q: z.string().max(160).default(''),
  /** The state a member's board would put it in today. */
  state: z.enum(['any', 'live', 'upcoming', 'ended', 'retired']).default('any'),
  cadence: z.enum(CHALLENGE_CADENCES).optional(),
  ...pageFields(25, 100),
  sort: z.enum(['shelf', 'newest', 'title']).default('shelf'),
});
export type ChallengeQuery = z.infer<typeof challengeQuery>;

/** The whole shelf, for the reads that answer with a page after a write. */
const WHOLE_SHELF: ChallengeQuery = { q: '', state: 'any', limit: 25, offset: 0, sort: 'shelf' };

/**
 * `state` as a query rather than as a filter over rows already read.
 *
 * The same four cases `windowStateOf` decides in memory, written against
 * the dates: a page of the live ones has to be cut by the database, or
 * "live" means "live, among the twenty-five this page happened to fetch".
 *
 * `$ne: null` is doing real work in `ended`: BSON sorts null before every
 * string, so a bare `endsOn: { $lt: today }` matches every challenge that
 * runs forever — the exact opposite of ended.
 */
function windowFilter(state: ChallengeQuery['state'], today: string): Record<string, unknown> {
  if (state === 'retired') return { active: false };
  const open = { active: { $ne: false } };
  if (state === 'upcoming') return { ...open, startsOn: { $gt: today } };
  if (state === 'ended') return { ...open, endsOn: { $ne: null, $lt: today } };
  if (state === 'live') {
    return {
      ...open,
      $and: [
        { $or: [{ startsOn: null }, { startsOn: { $lte: today } }] },
        { $or: [{ endsOn: null }, { endsOn: { $gte: today } }] },
      ],
    };
  }
  return {};
}

type ChallengeDoc = {
  _id: string;
  title: string;
  description?: string | null;
  emoji?: string | null;
  metric: string;
  cadence: string;
  goal: number;
  rewardCoins: number;
  rewardsBadge?: boolean | null;
  badgeId?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  active?: boolean;
  sort?: number | null;
  updatedAt?: Date;
};

/**
 * One stored challenge as the panel reads it.
 *
 * Its own row and the lookups beside it, kept apart so that reading one
 * challenge costs one challenge: the list hands in the page's badge names
 * and completion rollup, and `getChallenge` hands in just its own.
 */
function challengeRowOf(
  row: ChallengeDoc,
  today: string,
  badgeOf: Map<string, { label: string }>,
  statOf: Map<string, CompletionStat>,
) {
  const stat = statOf.get(row._id);
  return {
    id: row._id,
    title: row.title,
    description: row.description ?? '',
    emoji: row.emoji ?? '🏅',
    metric: row.metric,
    cadence: row.cadence,
    goal: row.goal,
    rewardCoins: row.rewardCoins,
    rewardsBadge: row.rewardsBadge === true,
    badgeId: row.badgeId ?? null,
    /** The badge's own name, so a list never shows a bare id. */
    badgeLabel: row.badgeId ? (badgeOf.get(row.badgeId)?.label ?? null) : null,
    /** Set when `badgeId` names an achievement that is not there any more. */
    badgeMissing: Boolean(row.badgeId) && !badgeOf.has(row.badgeId as string),
    startsOn: row.startsOn ?? null,
    endsOn: row.endsOn ?? null,
    active: row.active !== false,
    sort: row.sort ?? 0,
    /** `live`, `upcoming`, `ended` or `retired` — what a member's board does with it today. */
    state: windowStateOf(row, today),
    completions: {
      total: stat?.completions ?? 0,
      members: stat?.members.length ?? 0,
      /** Coins actually paid out, which the ceiling and the switch can make less than the reward. */
      granted: stat?.granted ?? 0,
      /** Completions the economy has not paid: capped by the daily ceiling, or waiting on the switch. */
      unpaid: stat?.unpaid ?? 0,
      lastAt: iso(stat?.lastAt ?? null),
    },
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Every challenge, with what it has actually paid.
 *
 * The completion rollup is the column that decides anything: a challenge
 * nobody has ever finished is either too hard or broken, and one paying
 * `unpaid` completions is the daily ceiling or the coins switch (D-46)
 * rather than the challenge.
 *
 * A page at a time, and two things follow from that:
 *
 *   - **The rollup is of the page, not of the shelf.** The completion
 *     aggregate used to group every completion row ever written — one per
 *     member per period — to decorate a list of twenty-five. It is matched
 *     to the challenges on the page now, and the figures above the table
 *     come from counts of their own.
 *   - **The tallies stay whole-collection.** "4 live" has to mean four live
 *     challenges, not four on this screen, so each is counted in the
 *     database against the same window the rows were cut by.
 */
export async function listChallenges(query: ChallengeQuery = WHOLE_SHELF) {
  const config = await getConfig();
  const today = localDayOf(new Date(), config.locale.timezone);

  const filter: Record<string, unknown> = windowFilter(query.state, today);
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    filter.$or = [{ _id: like }, { title: like }, { description: like }];
  }
  if (query.cadence) filter.cadence = query.cadence;

  const order: Record<string, 1 | -1> =
    query.sort === 'newest' ? { createdAt: -1, _id: 1 } : query.sort === 'title' ? { title: 1 } : { sort: 1, _id: 1 };

  const [rows, total, tallies, paid] = await Promise.all([
    ChallengeDefinitionModel.find(filter).sort(order).skip(query.offset).limit(query.limit).lean(),
    ChallengeDefinitionModel.countDocuments(filter),
    // Every tally the page's own header shows, each of the whole shelf.
    Promise.all([
      ChallengeDefinitionModel.countDocuments({}),
      ChallengeDefinitionModel.countDocuments(windowFilter('live', today)),
      ChallengeDefinitionModel.countDocuments(windowFilter('upcoming', today)),
      ChallengeDefinitionModel.countDocuments(windowFilter('retired', today)),
    ]),
    ChallengeCompletionModel.aggregate<{ _id: null; completions: number; granted: number; unpaid: number }>([
      {
        $group: {
          _id: null,
          completions: { $sum: 1 },
          granted: { $sum: { $ifNull: ['$granted', 0] } },
          unpaid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 0, 1] } },
        },
      },
    ]),
  ]);

  const ids = rows.map(row => String(row._id));
  const badgeIds = rows.map(row => row.badgeId).filter((id): id is string => Boolean(id));
  const [stats, badges] = await Promise.all([
    ChallengeCompletionModel.aggregate<CompletionStat>([
      { $match: { challengeId: { $in: ids } } },
      {
        $group: {
          _id: '$challengeId',
          completions: { $sum: 1 },
          members: { $addToSet: '$userId' },
          granted: { $sum: { $ifNull: ['$granted', 0] } },
          unpaid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 0, 1] } },
          lastAt: { $max: '$completedAt' },
        },
      },
    ]),
    // Only the badges this page names, for the names beside them.
    AchievementDefinitionModel.find({ _id: { $in: badgeIds } }, { label: 1, title: 1 }).lean(),
  ]);

  const statOf = new Map(stats.map(stat => [stat._id, stat]));
  const badgeOf = new Map(badges.map(badge => [badge._id, badge]));
  const [written, live, upcoming, retired] = tallies;
  const grand = paid[0] ?? null;

  const data = rows.map(row => challengeRowOf(row, today, badgeOf, statOf));

  return {
    metrics: CHALLENGE_METRICS,
    cadences: CHALLENGE_CADENCES,
    /** The knobs that decide whether any of this pays at all. */
    config: {
      achievementCoinsEnabled: config.coins.achievements.enabled,
      stepCoinsEnabled: config.coins.steps.enabled,
      upcomingDays: config.challenges.upcomingDays,
      timezone: config.locale.timezone,
      today,
    },
    /** How many these filters match, of which `data` is one page. */
    total,
    limit: query.limit,
    offset: query.offset,
    /** Of the whole shelf, whatever this page is showing. */
    totals: {
      challenges: written,
      live,
      upcoming,
      retired,
      completions: grand?.completions ?? 0,
      granted: grand?.granted ?? 0,
      unpaid: grand?.unpaid ?? 0,
    },
    /** The two lists the page reads out below the table, found by query. */
    attention: await challengesNeedingAttention(),
    data,
    nextCursor: null,
  };
}

/**
 * The two answers to "why has a completion not paid", which used to be a
 * filter over the whole list and cannot be a filter over a page.
 *
 * Both are the sort of thing an operator wants named rather than counted —
 * which challenge, which missing badge — so each is a handful of rows by
 * query, capped: past a dozen of either, the sentence is "something is
 * wrong with the economy" and the fix is not in this list.
 */
async function challengesNeedingAttention() {
  const [unpaidBy, orphaned] = await Promise.all([
    ChallengeCompletionModel.aggregate<{ _id: string; unpaid: number }>([
      { $match: { status: { $ne: 'paid' } } },
      { $group: { _id: '$challengeId', unpaid: { $sum: 1 } } },
      { $sort: { unpaid: -1 } },
      { $limit: 12 },
    ]),
    // A challenge pointing at a badge that is not there any more: the next
    // completion would award nothing. Joined in the database rather than by
    // reading both collections out and comparing them here.
    ChallengeDefinitionModel.aggregate<{ _id: string; title: string; badgeId: string }>([
      { $match: { badgeId: { $nin: [null, ''] } } },
      {
        $lookup: {
          from: AchievementDefinitionModel.collection.name,
          localField: 'badgeId',
          foreignField: '_id',
          as: 'badge',
        },
      },
      { $match: { badge: { $size: 0 } } },
      { $project: { title: 1, badgeId: 1 } },
      { $limit: 12 },
    ]),
  ]);

  const titles = new Map(
    (
      await ChallengeDefinitionModel.find({ _id: { $in: unpaidBy.map(row => row._id) } }, { title: 1 }).lean()
    ).map(row => [String(row._id), row.title]),
  );

  return {
    /** Challenges with completions the economy has not paid, worst first. */
    unpaid: unpaidBy.map(row => ({
      id: row._id,
      title: titles.get(row._id) ?? row._id,
      unpaid: row.unpaid,
    })),
    /** Challenges awarding a badge that has been deleted. */
    badgeMissing: orphaned.map(row => ({ id: String(row._id), title: row.title, badgeId: row.badgeId })),
  };
}

/**
 * One challenge, by id.
 *
 * Asked of the collection rather than found in a page: the list is paged
 * now, so "the one I just saved" is not reliably on the first page of it —
 * and reading the whole shelf to pick one row out was never the cheap way
 * to answer this.
 */
export async function getChallenge(id: string) {
  const row = await ChallengeDefinitionModel.findById(id).lean();
  if (!row) throw Errors.notFound('That challenge');
  const config = await getConfig();
  const today = localDayOf(new Date(), config.locale.timezone);

  const [stats, badge] = await Promise.all([
    ChallengeCompletionModel.aggregate<CompletionStat>([
      { $match: { challengeId: id } },
      {
        $group: {
          _id: '$challengeId',
          completions: { $sum: 1 },
          members: { $addToSet: '$userId' },
          granted: { $sum: { $ifNull: ['$granted', 0] } },
          unpaid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 0, 1] } },
          lastAt: { $max: '$completedAt' },
        },
      },
    ]),
    row.badgeId
      ? AchievementDefinitionModel.findById(row.badgeId, { label: 1 }).lean()
      : Promise.resolve(null),
  ]);

  return {
    config: {
      achievementCoinsEnabled: config.coins.achievements.enabled,
      stepCoinsEnabled: config.coins.steps.enabled,
      upcomingDays: config.challenges.upcomingDays,
      timezone: config.locale.timezone,
      today,
    },
    challenge: challengeRowOf(
      row as ChallengeDoc,
      today,
      new Map(badge ? [[String(badge._id), { label: badge.label }]] : []),
      new Map(stats.map(stat => [stat._id, stat])),
    ),
  };
}

/** A badge a challenge pays has to exist, or the next completion pays nothing. */
async function assertBadge(rewardsBadge: boolean, badgeId: string | null | undefined): Promise<void> {
  if (!rewardsBadge) return;
  if (!badgeId) throw Errors.validation({ badgeId: 'A challenge that awards a badge has to say which badge.' });
  const badge = await AchievementDefinitionModel.findById(badgeId).lean();
  if (!badge) throw Errors.validation({ badgeId: `There is no “${badgeId}” achievement — add it on Achievements first.` });
}

function assertWindow(startsOn: string | null | undefined, endsOn: string | null | undefined): void {
  if (startsOn && endsOn && endsOn < startsOn) {
    throw Errors.validation({ endsOn: 'It cannot end before it starts.' });
  }
}

export async function createChallenge(actor: string, body: ChallengeBody) {
  const id = body.id ?? challengeIdOf(body.title);
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) {
    throw Errors.validation({ id: `“${body.title}” does not make an id — type one, like ch-10k-steps.` });
  }
  if (await ChallengeDefinitionModel.exists({ _id: id })) {
    throw Errors.validation({ id: `There is already a “${id}” challenge.` });
  }
  const rewardsBadge = body.rewardsBadge === true;
  await assertBadge(rewardsBadge, body.badgeId);
  assertWindow(body.startsOn, body.endsOn);

  await ChallengeDefinitionModel.create({
    _id: id,
    title: body.title,
    description: body.description ?? '',
    emoji: body.emoji || '🏅',
    metric: body.metric,
    cadence: body.cadence,
    goal: body.goal,
    rewardCoins: body.rewardCoins,
    rewardsBadge,
    badgeId: rewardsBadge ? (body.badgeId ?? null) : null,
    startsOn: body.startsOn ?? null,
    endsOn: body.endsOn ?? null,
    active: body.active ?? true,
    sort: body.sort ?? 0,
  });

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'challenge.created', subjectType: 'challenge', subjectId: id,
    before: null, after: { ...body, id, note: body.note ?? null },
  });

  return { created: true, ...(await getChallenge(id)) };
}

/**
 * Changes one.
 *
 * The goal and the cadence are editable even once people are part way
 * through: a completion row keeps the goal it was judged against (C4), so
 * raising the bar changes what *today* takes and leaves yesterday's payout
 * exactly as it was.
 */
export async function updateChallenge(actor: string, id: string, body: ChallengePatch) {
  const before = await ChallengeDefinitionModel.findById(id).lean();
  if (!before) throw Errors.notFound('That challenge');
  const { note, ...fields } = body;
  if (Object.keys(fields).length === 0) throw Errors.validation({ title: 'Nothing to change.' });

  const rewardsBadge = fields.rewardsBadge ?? before.rewardsBadge === true;
  const badgeId = fields.badgeId !== undefined ? fields.badgeId : (before.badgeId ?? null);
  await assertBadge(rewardsBadge, badgeId);
  assertWindow(
    fields.startsOn !== undefined ? fields.startsOn : before.startsOn,
    fields.endsOn !== undefined ? fields.endsOn : before.endsOn,
  );

  await ChallengeDefinitionModel.updateOne(
    { _id: id },
    { $set: { ...fields, rewardsBadge, badgeId: rewardsBadge ? badgeId : null } },
  );

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'challenge.updated', subjectType: 'challenge', subjectId: id,
    before: { title: before.title, goal: before.goal, rewardCoins: before.rewardCoins, active: before.active, badgeId: before.badgeId ?? null },
    after: { ...fields, note: note ?? null },
  });

  return getChallenge(id);
}

/** Takes it off every member's board, or puts it back. The completions stay readable. */
export async function setChallengeActive(actor: string, id: string, active: boolean, note?: string) {
  const before = await ChallengeDefinitionModel.findById(id).lean();
  if (!before) throw Errors.notFound('That challenge');
  await ChallengeDefinitionModel.updateOne({ _id: id }, { $set: { active } });
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: active ? 'challenge.restored' : 'challenge.retired',
    subjectType: 'challenge', subjectId: id,
    before: { active: before.active !== false }, after: { active, note: note ?? null },
  });
  return getChallenge(id);
}

/**
 * Deletes one outright — the mistake case, and only that.
 *
 * Refused the moment anybody has finished it: a completion row is what paid
 * their coins, and the ledger entry beside it names the challenge. Deleting
 * the definition would leave both pointing at nothing, which is exactly the
 * question support asks six months later. That is a retire, and the refusal
 * says so.
 */
export async function deleteChallenge(actor: string, id: string, note?: string) {
  const before = await ChallengeDefinitionModel.findById(id).lean();
  if (!before) throw Errors.notFound('That challenge');

  const completions = await ChallengeCompletionModel.countDocuments({ challengeId: id });
  if (completions > 0) {
    throw Errors.validation({
      id: `${completions} member completion(s) point at this challenge, and each one paid coins. Retire it instead: it comes off every board and the history stays readable.`,
    });
  }

  await ChallengeDefinitionModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'challenge.deleted', subjectType: 'challenge', subjectId: id,
    before: { title: before.title, metric: before.metric, cadence: before.cadence, goal: before.goal, rewardCoins: before.rewardCoins },
    after: { deleted: true, note: note ?? null },
  });

  return { deleted: true, id, ...(await listChallenges(WHOLE_SHELF)) };
}

// ─── Achievements (RULES C7) ───────────────────────────────────────────────

export const achievementBody = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'An id looks like a-10k-steps').optional(),
    /** The short name on the badge tile. */
    label: z.string().trim().min(1).max(40),
    /** The longer one on the badge's own screen; the label when empty. */
    title: z.string().trim().max(80).optional(),
    /** The figure the badge stands for — 10,000 steps, 7 days. */
    value: z.number().int().min(0).max(10_000_000),
    metric: z.enum(CHALLENGE_METRICS),
    /** What unlocks it on its own; null for one only a challenge pays. */
    rule: z.enum(ACHIEVEMENT_RULES).nullable().optional(),
    /** What that rule has to reach. Defaults to `value` when a rule is set. */
    threshold: z.number().int().min(0).max(10_000_000).nullable().optional(),
    rewardCoins: z.number().int().min(0).max(1_000_000).optional(),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type AchievementBody = z.infer<typeof achievementBody>;

export const achievementPatch = achievementBody.partial().omit({ id: true }).strict();
export type AchievementPatch = z.infer<typeof achievementPatch>;

/** `10K Steps` → `a-10k-steps`. */
function achievementIdOf(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 46);
  return slug ? `a-${slug}` : '';
}

/**
 * Every badge, with how many members hold it and what pays it.
 *
 * A badge with no rule *and* no challenge paying it is the one worth
 * spotting: nothing can ever unlock it, and it sits on the shelf looking
 * like something to aim for.
 */
export const achievementQuery = z.object({
  /** Words in the label, the title, or the id. */
  q: z.string().max(160).default(''),
  metric: z.enum(CHALLENGE_METRICS).optional(),
  /**
   * `unreachable` is the one worth filtering to: a badge with no rule of
   * its own and no challenge paying it can never be unlocked, and it sits
   * on the shelf looking like something to aim for.
   */
  state: z.enum(['any', 'held', 'unheld', 'unreachable']).default('any'),
  ...pageFields(25, 100),
  sort: z.enum(['shelf', 'newest', 'label']).default('shelf'),
});
export type AchievementQuery = z.infer<typeof achievementQuery>;

const WHOLE_CASE: AchievementQuery = { q: '', state: 'any', limit: 25, offset: 0, sort: 'shelf' };

export async function listAchievements(query: AchievementQuery = WHOLE_CASE) {
  const config = await getConfig();

  const filter: Record<string, unknown> = {};
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    filter.$or = [{ _id: like }, { label: like }, { title: like }];
  }
  if (query.metric) filter.metric = query.metric;
  // Unreachable is half a query: "no rule of its own" is a field, and "no
  // challenge pays it" is the other collection. The ids that *are* paid are
  // asked for first, which is a short list by nature — a challenge names at
  // most one badge, and there are as many of those as there are challenges.
  if (query.state === 'unreachable') {
    const paying = await ChallengeDefinitionModel.distinct('badgeId', { badgeId: { $nin: [null, ''] } });
    filter.rule = null;
    filter._id = { $nin: paying };
  }
  if (query.state === 'held' || query.state === 'unheld') {
    const unlocked = await UserAchievementModel.distinct('achievementId');
    filter._id = query.state === 'held' ? { $in: unlocked } : { $nin: unlocked };
  }

  const order: Record<string, 1 | -1> =
    query.sort === 'newest'
      ? { createdAt: -1, _id: 1 }
      : query.sort === 'label'
        ? { label: 1 }
        : { sort: 1, _id: 1 };

  const [rows, total, shelf] = await Promise.all([
    AchievementDefinitionModel.find(filter).sort(order).skip(query.offset).limit(query.limit).lean(),
    AchievementDefinitionModel.countDocuments(filter),
    achievementShelfTotals(),
  ]);

  const ids = rows.map(row => String(row._id));
  const [held, challenges] = await Promise.all([
    // Who holds the badges on this page. Grouping every unlock ever written
    // to decorate twenty-five rows is the read this used to do.
    UserAchievementModel.aggregate<{ _id: string; members: number; lastAt: Date }>([
      { $match: { achievementId: { $in: ids } } },
      { $group: { _id: '$achievementId', members: { $sum: 1 }, lastAt: { $max: '$achievedAt' } } },
    ]),
    ChallengeDefinitionModel.find({ badgeId: { $in: ids } }, { title: 1, badgeId: 1, active: 1 }).lean(),
  ]);

  const heldOf = new Map(held.map(row => [row._id, row]));

  const data = rows.map(row => {
    const mine = challenges.filter(challenge => challenge.badgeId === row._id);
    const holders = heldOf.get(row._id);
    return {
      id: row._id,
      label: row.label,
      title: row.title || row.label,
      value: row.value,
      metric: row.metric,
      rule: row.rule ?? null,
      threshold: row.threshold ?? null,
      rewardCoins: row.rewardCoins ?? 0,
      sort: row.sort ?? 0,
      /** The challenges that pay this badge out, by name. */
      awardedBy: mine.map(challenge => ({ id: challenge._id, title: challenge.title, active: challenge.active !== false })),
      /** Nothing unlocks it: no rule of its own, and no challenge pays it. */
      unreachable: (row.rule ?? null) === null && mine.length === 0,
      members: holders?.members ?? 0,
      lastAt: iso(holders?.lastAt ?? null),
      updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
    };
  });

  return {
    metrics: CHALLENGE_METRICS,
    rules: ACHIEVEMENT_RULES,
    config: {
      /** Badge coins are held until this is on (D-46), exactly as step coins are. */
      achievementCoinsEnabled: config.coins.achievements.enabled,
    },
    /** How many these filters match, of which `data` is one page. */
    total,
    limit: query.limit,
    offset: query.offset,
    /** Of the whole shelf, whatever this page is showing. */
    totals: shelf,
    data,
    nextCursor: null,
  };
}

/**
 * The four figures above the table, each of the whole shelf.
 *
 * "3 unreachable" has to mean three badges nobody can ever get, not three
 * on this screen — which is the one number here that cannot be a count,
 * because it is a question about two collections at once.
 */
async function achievementShelfTotals() {
  const paying = await ChallengeDefinitionModel.distinct('badgeId', { badgeId: { $nin: [null, ''] } });
  const [achievements, unlocked, unreachable, offered] = await Promise.all([
    AchievementDefinitionModel.countDocuments({}),
    UserAchievementModel.estimatedDocumentCount(),
    AchievementDefinitionModel.countDocuments({ rule: null, _id: { $nin: paying } }),
    AchievementDefinitionModel.aggregate<{ _id: null; coins: number }>([
      { $group: { _id: null, coins: { $sum: { $ifNull: ['$rewardCoins', 0] } } } },
    ]),
  ]);
  return {
    achievements,
    /** Every unlock anybody holds, across the shelf. */
    unlocked,
    unreachable,
    coinsOnOffer: offered[0]?.coins ?? 0,
  };
}

/**
 * Every badge by name alone, for the pickers.
 *
 * A challenge's badge dropdown and the grant-by-hand form need the whole
 * shelf to choose from, which is the one thing a paged list cannot give
 * them. So they get this instead: two fields per badge and no joins, which
 * is a few kilobytes where the full list is a read per row.
 */
export async function achievementPicker() {
  const rows = await AchievementDefinitionModel.find({}, { label: 1, title: 1, rewardCoins: 1 })
    .sort({ sort: 1, _id: 1 })
    .lean();
  return {
    total: rows.length,
    data: rows.map(row => ({
      id: String(row._id),
      label: row.label,
      title: row.title || row.label,
      rewardCoins: row.rewardCoins ?? 0,
    })),
  };
}

export async function getAchievement(id: string) {
  const page = await listAchievements({ ...WHOLE_CASE, q: id, limit: 100 });
  const achievement = page.data.find(row => row.id === id);
  if (!achievement) throw Errors.notFound('That achievement');
  return { config: page.config, achievement };
}

export async function createAchievement(actor: string, body: AchievementBody) {
  const id = body.id ?? achievementIdOf(body.label);
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) {
    throw Errors.validation({ id: `“${body.label}” does not make an id — type one, like a-10k-steps.` });
  }
  if (await AchievementDefinitionModel.exists({ _id: id })) {
    throw Errors.validation({ id: `There is already an “${id}” achievement.` });
  }

  const rule = body.rule ?? null;
  await AchievementDefinitionModel.create({
    _id: id,
    label: body.label,
    title: body.title ?? '',
    value: body.value,
    metric: body.metric,
    rule,
    // A rule with no threshold would unlock for everybody at zero, so the
    // figure the badge stands for is the sensible default.
    threshold: rule === null ? null : (body.threshold ?? body.value),
    rewardCoins: body.rewardCoins ?? 0,
    sort: body.sort ?? 0,
  });

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'achievement.created', subjectType: 'achievement', subjectId: id,
    before: null, after: { ...body, id, note: body.note ?? null },
  });

  return { created: true, ...(await getAchievement(id)) };
}

/**
 * Changes one.
 *
 * Raising a threshold never takes a badge away from somebody who holds it
 * (C7 — unlocked once, never taken back); it only changes what the next
 * member has to do.
 */
export async function updateAchievement(actor: string, id: string, body: AchievementPatch) {
  const before = await AchievementDefinitionModel.findById(id).lean();
  if (!before) throw Errors.notFound('That achievement');
  const { note, ...fields } = body;
  if (Object.keys(fields).length === 0) throw Errors.validation({ label: 'Nothing to change.' });

  const rule = fields.rule !== undefined ? fields.rule : (before.rule ?? null);
  const threshold =
    fields.threshold !== undefined
      ? fields.threshold
      : rule === null
        ? null
        : (before.threshold ?? fields.value ?? before.value);

  await AchievementDefinitionModel.updateOne(
    { _id: id },
    { $set: { ...fields, rule, threshold: rule === null ? null : threshold } },
  );

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'achievement.updated', subjectType: 'achievement', subjectId: id,
    before: { label: before.label, value: before.value, rule: before.rule ?? null, threshold: before.threshold ?? null, rewardCoins: before.rewardCoins ?? 0 },
    after: { ...fields, note: note ?? null },
  });

  return getAchievement(id);
}

/**
 * Deletes a badge.
 *
 * Refused while anybody holds it — a badge is unlocked once and never taken
 * back (C7), and deleting the definition would take it off the shelf of
 * every member who earned it — and refused while a challenge still pays it
 * out, because the next completion would award a badge that is not there.
 * Unlike a challenge there is nothing to retire into: a badge nobody can
 * reach is simply one with no rule and no challenge, which the list marks.
 */
export async function deleteAchievement(actor: string, id: string, note?: string) {
  const before = await AchievementDefinitionModel.findById(id).lean();
  if (!before) throw Errors.notFound('That achievement');

  const [holders, awarding] = await Promise.all([
    UserAchievementModel.countDocuments({ achievementId: id }),
    ChallengeDefinitionModel.find({ badgeId: id }, { title: 1 }).lean(),
  ]);
  if (holders > 0) {
    throw Errors.validation({
      id: `${holders} member(s) hold this badge, and a badge is never taken back. Change what it says instead.`,
    });
  }
  if (awarding.length > 0) {
    throw Errors.validation({
      id: `${awarding.map(challenge => challenge.title).join(', ')} award${awarding.length === 1 ? 's' : ''} this badge. Point ${awarding.length === 1 ? 'that challenge' : 'those challenges'} elsewhere first.`,
    });
  }

  await AchievementDefinitionModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'achievement.deleted', subjectType: 'achievement', subjectId: id,
    before: { label: before.label, value: before.value, metric: before.metric, rewardCoins: before.rewardCoins ?? 0 },
    after: { deleted: true, note: note ?? null },
  });

  return { deleted: true, id, ...(await listAchievements(WHOLE_CASE)) };
}
