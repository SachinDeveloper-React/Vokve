import { getConfig } from '../../config/remote.js';
import type { AppConfig } from '../../config/defaults.js';
import {
  leaderboardBoardSchema,
  leaderboardHistorySchema,
  leaderboardRulesSchema,
  type LeaderboardBoard,
  type LeaderboardHistory,
  type LeaderboardRules,
} from '../../contracts/index.js';
import { addDays, localDayOf, localHourOf, localMidnightUtc, type IsoDate } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';
import { DELETED_MEMBER, publicName } from '../../lib/names.js';
import { ActivityDailyModel } from '../activity/models.js';
import { ChallengeCompletionModel } from '../challenges/models.js';
import { periodOf } from '../challenges/service.js';
import { credit } from '../economy/service.js';
import { UserModel } from '../identity/models.js';
import { FraudFlagModel } from '../integrity/models.js';
import { notify } from '../notifications/service.js';
import { WorkoutModel } from '../training/models.js';
import { LeaderboardPeriodModel, LeaderboardResultModel, LeaderboardScoreModel } from './models.js';

/**
 * The weekly country board (RULES §L): a score per member per week from
 * verified activity, ranked within their country; at the week's close the
 * standings are frozen and the top places paid.
 */

type Tier = AppConfig['leaderboard']['tiers'][number];

export function zoneOf(config: AppConfig, country: string): string {
  return config.leaderboard.timezones[country] ?? config.locale.timezone;
}

export function countryNameOf(config: AppConfig, country: string): string {
  return config.leaderboard.countryNames[country] ?? country;
}

/** The Monday-to-Sunday week (in the country's zone) that `day` falls in (RULES L1). */
export function weekOf(day: IsoDate): { id: string; start: IsoDate; end: IsoDate } {
  const { start, end } = periodOf('weekly', day);
  return { id: start, start, end };
}

function tierFor(config: AppConfig, rank: number): Tier | null {
  return config.leaderboard.tiers.find(t => rank >= t.fromRank && rank <= t.toRank) ?? null;
}

function tierLabel(tier: Tier): string {
  // The operator's own words where they wrote any (⚙ `leaderboard.tiers[].label`,
  // D-89); the ranks themselves otherwise, which is correct and never what
  // marketing would have said.
  const written = tier.label?.trim();
  if (written) return written;
  return tier.fromRank === tier.toRank ? `Rank ${tier.fromRank}` : `Rank ${tier.fromRank} – ${tier.toRank}`;
}

const fmt = (n: number) => n.toLocaleString('en-IN');

// ─── Scores (RULES L3, L4) ─────────────────────────────────────────────────

/**
 * Recounts one member's score for the week `localDay` falls in, from
 * verified activity only (L4): verified steps, plausible workouts and
 * completed challenges of that week. A closed week is frozen (L6) and left
 * alone. Called after each step rollup, workout save and challenge
 * completion; safe to call again.
 */
export async function refreshLeaderboardScore(userId: string, localDay: IsoDate, now = new Date()): Promise<void> {
  const config = await getConfig();
  const user = await UserModel.findById(userId, { country: 1, deletedAt: 1 }).lean();
  if (!user || user.deletedAt) return;
  const country = user.country ?? config.locale.country;
  const zone = zoneOf(config, country);
  const week = weekOf(localDay);
  if (await LeaderboardPeriodModel.exists({ _id: `${week.id}:${country}` })) return;

  const days = { $gte: week.start, $lte: week.end };
  const [stepRow, workouts, completions] = await Promise.all([
    ActivityDailyModel.aggregate<{ steps: number }>([
      { $match: { userId, localDay: days } },
      { $group: { _id: null, steps: { $sum: '$verifiedSteps' } } },
    ]),
    WorkoutModel.countDocuments({ userId, plausible: true, deletedAt: null, localDay: days }),
    ChallengeCompletionModel.find(
      { userId, completedAt: { $gte: localMidnightUtc(week.start, zone), $lt: localMidnightUtc(addDays(week.end, 1), zone) } },
      { _id: 1 },
    ).lean(),
  ]);
  const steps = Math.round(stepRow[0]?.steps ?? 0);
  const { stepsPerPoint, perWorkout, perChallenge } = config.leaderboard.score;
  const score = Math.floor(steps / stepsPerPoint) + workouts * perWorkout + completions.length * perChallenge;

  const id = `${week.id}:${country}:${userId}`;
  const existing = await LeaderboardScoreModel.findById(id, { score: 1 }).lean();
  if (existing && existing.score === score) {
    await LeaderboardScoreModel.updateOne({ _id: id }, { $set: { steps, workouts, challenges: completions.length } });
    return;
  }
  await LeaderboardScoreModel.updateOne(
    { _id: id },
    {
      $set: { periodId: week.id, country, userId, steps, workouts, challenges: completions.length, score, scoreReachedAt: now },
    },
    { upsert: true },
  );
}

/** Ranked order (RULES L5): higher score, then the earlier time it was reached, then the lower id. */
const RANKED = { score: -1, scoreReachedAt: 1, userId: 1 } as const;

// ─── Reads ─────────────────────────────────────────────────────────────────

export interface BoardPage {
  /** How many places to skip. Clipped to the board's own size. */
  offset?: number;
  /** How many to serve. Clipped to the board's own size. */
  limit?: number;
}

/**
 * `GET /leaderboard`: this week's board for the caller's country, a page of
 * it, and the caller's place.
 *
 * **The board is the top ⚙ `leaderboard.boardSize` places and nothing
 * further** (L2b): ranking the whole country would be a list nobody scrolls
 * and a query that grows with the member count, and the places that pay are
 * all inside it. `ranked` says how many are scoring beyond the page so the
 * app never has to pretend the list is everyone.
 *
 * Paged within that: `offset` and `limit` are both clipped to the board, so
 * no request can walk past place 50 however it is asked. A call with neither
 * gets the whole board, which is what an installed build does (X2).
 */
export async function getBoard(userId: string, page: BoardPage = {}, now = new Date()): Promise<LeaderboardBoard> {
  const config = await getConfig();
  const me = await UserModel.findById(userId, { country: 1 }).lean();
  const country = me?.country ?? config.locale.country;
  const zone = zoneOf(config, country);
  const week = weekOf(localDayOf(now, zone));
  const scored = { periodId: week.id, country, score: { $gt: 0 } };

  const size = config.leaderboard.boardSize;
  // Clipped rather than refused: a page past the end of the board is an app
  // asking for one more page than there is, and an empty page is the answer.
  const offset = Math.min(Math.max(0, Math.trunc(page.offset ?? 0)), size);
  const limit = Math.min(Math.max(1, Math.trunc(page.limit ?? size)), size - offset || 1);

  const [top, ranked, mine] = await Promise.all([
    LeaderboardScoreModel.find(scored).sort(RANKED).skip(offset).limit(limit).lean(),
    LeaderboardScoreModel.countDocuments(scored),
    LeaderboardScoreModel.findById(`${week.id}:${country}:${userId}`).lean(),
  ]);
  const people = new Map(
    (await UserModel.find({ _id: { $in: top.map(row => row.userId) } }, { name: 1, avatarUrl: 1, deletedAt: 1 }).lean())
      .map(u => [u._id, u]),
  );
  const location = countryNameOf(config, country);

  const entries = top.map((row, index) => {
    const rank = offset + index + 1;
    const tier = tierFor(config, rank);
    const person = people.get(row.userId);
    return {
      id: row.userId,
      name: person && !person.deletedAt ? publicName(person.name) : DELETED_MEMBER,
      location,
      rank,
      coins: tier?.coins ?? 0,
      perk: tier?.perks.join(' + ') ?? '',
      avatarUrl: person && !person.deletedAt ? person.avatarUrl ?? null : null,
      isCurrentUser: row.userId === userId,
      score: row.score,
    };
  });

  let mePlace: LeaderboardBoard['me'] = null;
  if (mine && mine.score > 0) {
    const ahead = await LeaderboardScoreModel.countDocuments({
      ...scored,
      $or: [
        { score: { $gt: mine.score } },
        { score: mine.score, scoreReachedAt: { $lt: mine.scoreReachedAt } },
        { score: mine.score, scoreReachedAt: mine.scoreReachedAt, userId: { $lt: userId } },
      ],
    });
    const rank = ahead + 1;
    mePlace = {
      rank,
      score: mine.score,
      coins: tierFor(config, rank)?.coins ?? 0,
      percentile: Math.round(((ranked - rank + 1) / ranked) * 100),
    };
  }

  return leaderboardBoardSchema.parse({
    period: {
      id: week.id,
      start: week.start,
      end: week.end,
      resetsAt: localMidnightUtc(addDays(week.end, 1), zone).toISOString(),
      country,
      status: 'live',
    },
    entries,
    me: mePlace,
    ranked,
    offset,
    limit,
    /** The board's own length: everyone scoring, up to its size. */
    total: Math.min(ranked, size),
    /** Whether another page of the board exists above the member's request. */
    hasMore: offset + entries.length < Math.min(ranked, size),
  });
}

/** How a closed week ended for one member (D-90). */
type Outcome = 'paid' | 'held' | 'skipped' | 'none';

function outcomeOf(row: { coins: number; granted?: number | null; excluded?: boolean }): Outcome {
  if (row.excluded) return 'skipped';
  if ((row.granted ?? 0) > 0) return 'paid';
  // A place that pays, and nothing credited: prizes were not running when
  // the week closed (⚙ `coins.steps.enabled`, D-46). Not a promise — nothing
  // is paid retroactively.
  if (row.coins > 0) return 'held';
  return 'none';
}

/**
 * `GET /leaderboard/history`: the caller's record over closed weeks, from
 * the frozen results (L6).
 *
 * Every week carries **what it won, what was paid, and why those differ**
 * (D-90). A zero against a place that pays is the one figure a member cannot
 * explain to themselves, and the three reasons it can be zero — prizes not
 * running, a place under review, a place below the ladder — are not
 * interchangeable. The words are the operator's (⚙ `leaderboard.outcomes`).
 */
export async function getHistory(userId: string): Promise<LeaderboardHistory> {
  const config = await getConfig();
  const results = await LeaderboardResultModel.find({ userId }).sort({ periodId: -1 }).lean();
  const best = results.reduce<(typeof results)[number] | null>(
    (top, row) => (top === null || row.rank < top.rank || (row.rank === top.rank && row.periodId < top.periodId) ? row : top),
    null,
  );
  const lastPaid = Math.max(0, ...config.leaderboard.tiers.map(t => t.toRank));

  return leaderboardHistorySchema.parse({
    bestRank: best?.rank ?? null,
    bestRankAchievedOn: best?.end ?? null,
    topTenFinishes: results.filter(r => r.rank <= 10 && !r.excluded).length,
    rewardCoinsEarned: results.reduce((sum, r) => sum + (r.granted ?? 0), 0),
    rewardsWon: results.filter(r => !r.excluded && r.perks.length > 0).length,
    rewardCoinsHeld: results.reduce(
      (sum, r) => sum + (outcomeOf(r) === 'held' ? r.coins : 0),
      0,
    ),
    prizesRunning: config.coins.steps.enabled,
    periods: results.slice(0, 12).map(r => {
      const state = outcomeOf(r);
      return {
        id: r.periodId,
        start: r.start,
        end: r.end,
        rank: r.rank,
        score: r.score,
        coins: r.granted ?? 0,
        won: r.coins,
        perks: r.perks ?? [],
        state,
        reason: fill(config.leaderboard.outcomes[state] ?? '', {
          coins: fmt(state === 'paid' ? r.granted ?? 0 : r.coins),
          rank: fmt(r.rank),
          perks: (r.perks ?? []).join(' + '),
          lastPaid: fmt(lastPaid),
          week: r.end,
        }),
      };
    }),
  });
}

/**
 * Every rung as a sentence — "Place 1 takes 5,000 coins and a T-Shirt + a
 * Bottle; places 2–3 take 3,000 coins…".
 *
 * Built rather than written because it is the one string that is *only* the
 * figures: an operator who changes a prize would otherwise have to change
 * the sentence about it too, and the two would drift apart the first time
 * somebody forgot.
 */
function prizeSentence(tiers: readonly Tier[]): string {
  const lines = tiers.map((tier, index) => {
    const who = tier.fromRank === tier.toRank ? `place ${tier.fromRank}` : `places ${tier.fromRank}–${tier.toRank}`;
    const gear = tier.perks.length > 0 ? ` and ${tier.perks.join(' + ')}` : '';
    const line = `${who} ${tier.fromRank === tier.toRank ? 'takes' : 'take'} ${fmt(tier.coins)} coins${gear}`;
    return index === 0 ? line.charAt(0).toUpperCase() + line.slice(1) : line;
  });
  return lines.join('; ');
}

/**
 * The operator's words with this reader's figures in them (D-89).
 *
 * A placeholder nothing fills is left alone rather than blanked: a typo
 * should read as a typo, not as a missing prize.
 */
function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** `GET /leaderboard/reward-tiers`: the prizes and the rules, worded from the config in force. */
export async function getRules(userId: string): Promise<LeaderboardRules> {
  const config = await getConfig();
  const me = await UserModel.findById(userId, { country: 1 }).lean();
  return rulesFor(config, me?.country ?? config.locale.country);
}

/**
 * The same answer for a country rather than a member.
 *
 * Split out for the operator panel, which has to be able to show *exactly*
 * what the app will say for a board (D-89): the copy carries placeholders
 * filled in per reader, so a preview written anywhere else would be a second
 * implementation of the one thing the page exists to get right.
 */
export function rulesFor(config: AppConfig, country: string): LeaderboardRules {
  const scope = countryNameOf(config, country);
  const { stepsPerPoint, perWorkout, perChallenge } = config.leaderboard.score;
  const tiers = config.leaderboard.tiers;
  const lastPaid = Math.max(0, ...tiers.map(t => t.toRank));

  // What every string on the screen may ask for. One map, so the panel's
  // preview and the app's copy can never be filled from two different sets.
  const values: Record<string, string> = {
    scope,
    stepsPerPoint: fmt(stepsPerPoint),
    perWorkout: fmt(perWorkout),
    perChallenge: fmt(perChallenge),
    lastPaid: fmt(lastPaid),
    tierCount: fmt(tiers.length),
    prizes: prizeSentence(tiers),
  };
  const words = config.leaderboard;

  return leaderboardRulesSchema.parse({
    scope,
    tiers: tiers.map(tier => ({
      id: `rank-${tier.fromRank}-${tier.toRank}`,
      fromRank: tier.fromRank,
      toRank: tier.toRank,
      label: fill(tierLabel(tier), values),
      coins: tier.coins,
      perks: tier.perks,
    })),
    banner: {
      kicker: fill(words.banner.kicker, values),
      title: fill(words.banner.title, values),
      subtitle: fill(words.banner.subtitle, values),
    },
    howItWorks: words.howItWorks.map(step => ({
      title: fill(step.title, values),
      detail: fill(step.detail, values),
    })),
    note: fill(words.note, values),
  });
}


// ─── Close and pay (RULES L6, L9, L10) ─────────────────────────────────────

/**
 * Closes every country's last week once ⚙ `leaderboard.closeAfterHours`
 * into Monday have passed in its zone: freezes the standings into
 * `leaderboard_results` (L6), skips a place held by an account with an open
 * hard fraud flag that week (L9 — nobody moves up into it), and pays the
 * prize tiers through `credit()`, exempt from the daily ceiling (E8d) with
 * `source: 'challenge'` (E13). Prizes are step-derived, so they wait for
 * ⚙ `coins.steps.enabled` like every other (D-46) — the result is frozen and
 * the member told either way. Hourly; idempotent.
 */
export async function closeDueWeeks(now = new Date()): Promise<{ closed: string[] }> {
  const config = await getConfig();
  const closed: string[] = [];
  const countries = new Set([...Object.keys(config.leaderboard.timezones), config.locale.country]);

  for (const country of countries) {
    const zone = zoneOf(config, country);
    const today = localDayOf(now, zone);
    const last = weekOf(addDays(weekOf(today).start, -1));
    const dueDay = addDays(last.end, 1);
    if (today < dueDay || (today === dueDay && localHourOf(now, zone) < config.leaderboard.closeAfterHours)) continue;
    if (await LeaderboardPeriodModel.exists({ _id: `${last.id}:${country}` })) continue;

    await closeWeek(country, last, config, now);
    closed.push(`${last.id}:${country}`);
  }
  return { closed };
}

async function closeWeek(country: string, week: { id: string; start: IsoDate; end: IsoDate }, config: AppConfig, now: Date): Promise<void> {
  const zone = zoneOf(config, country);
  const rows = await LeaderboardScoreModel.find({ periodId: week.id, country, score: { $gt: 0 } }).sort(RANKED).lean();
  const payable = config.coins.steps.enabled;
  const payDay = localDayOf(now, zone);

  for (const [index, row] of rows.entries()) {
    const rank = index + 1;
    const tier = tierFor(config, rank);
    const excluded = Boolean(
      tier &&
        (await FraudFlagModel.exists({
          userId: row.userId,
          localDay: { $gte: week.start, $lte: week.end },
          severity: 'hard',
          status: { $in: ['open', 'confirmed'] },
        })),
    );
    const resultId = `${week.id}:${country}:${row.userId}`;
    await LeaderboardResultModel.updateOne(
      { _id: resultId },
      {
        $setOnInsert: {
          _id: resultId, periodId: week.id, country, userId: row.userId, start: week.start, end: week.end,
          rank, score: row.score, coins: tier?.coins ?? 0, perks: tier?.perks ?? [], excluded,
        },
      },
      { upsert: true },
    );
    if (!tier || excluded) continue;

    let granted = 0;
    if (payable && tier.coins > 0) {
      const result = await credit({
        userId: row.userId,
        source: 'challenge',
        referenceType: 'leaderboard',
        referenceId: `${week.id}:${country}`,
        amount: tier.coins,
        title: `Leaderboard #${rank} — week of ${week.start}`,
        localDay: payDay,
        exemptFromCap: true,
      });
      granted = result.granted;
      await LeaderboardResultModel.updateOne({ _id: resultId }, { $set: { granted, paid: true, ledgerId: result.ledgerId ?? null } });
    }

    await notify({
      userId: row.userId,
      topic: 'reward',
      title: `You finished #${rank} on the ${countryNameOf(config, country)} board! 🏆`,
      // The same words the week's own row will carry in the history
      // (⚙ `leaderboard.outcomes`, D-90), so the push and the screen cannot
      // tell a member two different stories about one week. The unpaid case
      // is deliberately not "coming soon": nothing is paid retroactively.
      message:
        granted > 0
          ? `${fill(config.leaderboard.outcomes.paid, { coins: fmt(granted), rank: fmt(rank), perks: tier.perks.join(' + '), week: week.end })}${
              tier.perks.length > 0 ? ` ${tier.perks.join(' + ')} are on the way.` : ''
            }`
          : fill(config.leaderboard.outcomes.held, {
              coins: fmt(tier.coins),
              rank: fmt(rank),
              perks: tier.perks.join(' + '),
              week: week.end,
            }),
      dedupeKey: `leaderboard:${resultId}`,
      now,
    }).catch(err => logger.warn({ err, userId: row.userId }, 'leaderboard.notify_failed'));
  }

  // Written last: a close interrupted half-way runs again from the top, and
  // the results and ledger rows already written are its own idempotent no-ops.
  await LeaderboardPeriodModel.create({
    _id: `${week.id}:${country}`, periodId: week.id, country, start: week.start, end: week.end, ranked: rows.length, closedAt: now,
  });
  logger.info({ periodId: week.id, country, ranked: rows.length }, 'leaderboard.closed');
}
