import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { localDayOf, localMidnightUtc } from '../../lib/dates.js';
import { DELETED_MEMBER, publicName } from '../../lib/names.js';
import { UserModel } from '../identity/models.js';
import {
  LeaderboardPeriodModel,
  LeaderboardResultModel,
  LeaderboardScoreModel,
} from '../leaderboard/models.js';
import { countryNameOf, rulesFor, weekOf, zoneOf } from '../leaderboard/service.js';
import { limitField, offsetField, pageFields } from './paging.js';

/**
 * The weekly board as the operator needs it (RULES §L).
 *
 * The prizes were always the config's (⚙ `leaderboard.tiers`) and the words
 * around them were the code's, which meant the one page in the app that
 * promises people money could only be reworded by a release (D-89). Now both
 * are config, and this is the read behind the panel that writes them:
 *
 *   - **the words as the app will receive them.** The copy carries
 *     placeholders — `{prizes}`, `{scope}`, `{stepsPerPoint}` — filled in per
 *     reader, so the only honest preview is the server's own filling of them.
 *     The panel shows exactly the strings `GET /leaderboard/reward-tiers`
 *     would answer with for that country.
 *   - **who is holding the paid places right now**, with what each would take
 *     if the week closed as it stands. A prize ladder is edited while real
 *     people are standing on it, and "places 4–10 take 1,000" is a different
 *     decision when seven people are in them.
 *   - **the last week that closed**, what it paid, and whether it paid at all
 *     — prizes are step-derived, so they wait on ⚙ `coins.steps.enabled`
 *     (D-46) and a board can look perfect while paying nobody.
 *
 * Writes go through `PUT /admin/config` like every other knob: the whole
 * merged config runs through the same cross-field validator every read does,
 * which is what refuses a ladder with two rungs over the same place — an
 * ambiguity `tierFor` would otherwise settle by accident, on a Monday, with
 * coins.
 */

export const adminLeaderboardQuery = z.object({
  /** ISO-3166-1 alpha-2. Left out, the shop's own country. */
  country: z.string().trim().length(2).toUpperCase().optional(),
  /** A page of the live standings — `offset` is places, so rank survives it. */
  ...pageFields(25, 100),
  /** And a page of the last closed week's winners, which is its own list. */
  winnerLimit: limitField(20, 100),
  winnerOffset: offsetField(),
});
export type AdminLeaderboardQuery = z.infer<typeof adminLeaderboardQuery>;

const RANKED = { score: -1, scoreReachedAt: 1, userId: 1 } as const;

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

export async function adminLeaderboard(query: AdminLeaderboardQuery) {
  const config = await getConfig();
  const board = config.leaderboard;
  // Every board there is: a country with a zone of its own, plus the shop's.
  const countries = [...new Set([...Object.keys(board.timezones), config.locale.country])].sort();
  const country = query.country ?? config.locale.country;
  const zone = zoneOf(config, country);
  const scope = countryNameOf(config, country);

  const today = localDayOf(new Date(), zone);
  const week = weekOf(today);
  const scored = { periodId: week.id, country, score: { $gt: 0 } };

  const [top, ranked, closedPeriod] = await Promise.all([
    LeaderboardScoreModel.find(scored).sort(RANKED).skip(query.offset).limit(query.limit).lean(),
    LeaderboardScoreModel.countDocuments(scored),
    LeaderboardPeriodModel.find({ country }).sort({ periodId: -1 }).limit(1).lean(),
  ]);

  const people = new Map(
    (
      await UserModel.find(
        { _id: { $in: top.map(row => row.userId) } },
        { name: 1, deletedAt: 1, country: 1 },
      ).lean()
    ).map(user => [user._id, user]),
  );

  const tierFor = (rank: number) => board.tiers.find(t => rank >= t.fromRank && rank <= t.toRank) ?? null;
  const lastPaid = Math.max(0, ...board.tiers.map(t => t.toRank));

  const standings = top.map((row, index) => {
    // The place, not the row's position on this page: the sort is the rank,
    // so page two starts at `offset + 1` rather than at 1 again.
    const rank = query.offset + index + 1;
    const tier = tierFor(rank);
    const person = people.get(row.userId);
    return {
      rank,
      userId: row.userId,
      /** The member's own name, not the app's "First L." — this is the operator's screen. */
      name: person && !person.deletedAt ? person.name || row.userId : DELETED_MEMBER,
      /** What the app would show beside the place, for comparison. */
      publicName: person && !person.deletedAt ? publicName(person.name) : DELETED_MEMBER,
      score: row.score,
      steps: row.steps,
      workouts: row.workouts,
      challenges: row.challenges,
      /** What this place takes if the week closes as it stands. */
      coins: tier?.coins ?? 0,
      perks: tier?.perks ?? [],
      tierLabel: tier?.label ?? null,
      reachedAt: iso(row.scoreReachedAt),
    };
  });

  const last = closedPeriod[0] ?? null;
  /**
   * The closed week, two reads rather than one.
   *
   * This used to load every result row of the week to add three numbers up
   * and then show the first twenty — on a week with fifty thousand people
   * scoring, that is fifty thousand documents through the process to render
   * a table of twenty. The sums are what the database is for, and the
   * winners are a page like any other.
   *
   * A result row exists for everyone who scored, so the table's own filter
   * moves into the query: a winner is a place the tiers paid something to,
   * in coins or in a perk.
   */
  const winnerFilter = last
    ? {
        periodId: last.periodId,
        country,
        $or: [{ coins: { $gt: 0 } }, { 'perks.0': { $exists: true } }],
      }
    : null;
  const [paidUp, lastResults, winnersTotal] = last
    ? await Promise.all([
        LeaderboardResultModel.aggregate<{ _id: null; coinsPaid: number; coinsOwed: number; excluded: number }>([
          { $match: { periodId: last.periodId, country } },
          {
            $group: {
              _id: null,
              coinsPaid: { $sum: { $ifNull: ['$granted', 0] } },
              coinsOwed: {
                $sum: {
                  $cond: ['$excluded', 0, { $subtract: ['$coins', { $ifNull: ['$granted', 0] }] }],
                },
              },
              excluded: { $sum: { $cond: ['$excluded', 1, 0] } },
            },
          },
        ]),
        LeaderboardResultModel.find(winnerFilter!)
          .sort({ rank: 1 })
          .skip(query.winnerOffset)
          .limit(query.winnerLimit)
          .lean(),
        LeaderboardResultModel.countDocuments(winnerFilter!),
      ])
    : [[], [], 0];
  const paid = paidUp[0] ?? null;
  // Names for the winners too: an operator reading "usr_8f2c…" cannot tell
  // whether a prize went to the person who complained about it.
  const winners = new Map(
    (
      await UserModel.find(
        { _id: { $in: lastResults.map(row => row.userId) } },
        { name: 1, deletedAt: 1 },
      ).lean()
    ).map(user => [user._id, user]),
  );
  const nameOf = (userId: string, people: Map<string, { name?: string | null; deletedAt?: Date | null }>) => {
    const person = people.get(userId);
    return person && !person.deletedAt ? person.name || userId : DELETED_MEMBER;
  };

  return {
    countries,
    country,
    scope,
    zone,
    /** The leaderboard config in force — what the forms are filled from. */
    config: board,
    /**
     * The words as the app will receive them for this country, placeholders
     * filled by the server's own filling of them (`rulesFor`) — the only
     * preview that cannot disagree with what a member reads.
     */
    preview: rulesFor(config, country),
    period: {
      id: week.id,
      start: week.start,
      end: week.end,
      /** When the week ends in the board's own zone. */
      resetsAt: localMidnightUtc(week.end, zone).toISOString(),
      /** And how far into Monday the close waits, so Sunday's late syncs count. */
      closeAfterHours: board.closeAfterHours,
      ranked,
    },
    /**
     * Prizes are step-derived, so they wait on ⚙ `coins.steps.enabled`
     * (D-46): a board can look perfect and pay nobody, and that is worth
     * saying on the page rather than discovering on a Monday.
     */
    payable: config.coins.steps.enabled,
    totals: {
      /** The coins one week costs if every paid place is filled. */
      coinsPerWeek: board.tiers.reduce((sum, tier) => sum + tier.coins * (tier.toRank - tier.fromRank + 1), 0),
      /** The last place that wins anything. */
      lastPaidRank: lastPaid,
      /** How many of those places have somebody in them this week. */
      paidPlacesFilled: Math.min(ranked, lastPaid),
      /** Everyone scoring this week, paid or not. */
      ranked,
    },
    total: ranked,
    limit: query.limit,
    offset: query.offset,
    standings,
    lastClosed: last
      ? {
          id: last.periodId,
          start: last.start,
          end: last.end,
          closedAt: iso(last.closedAt),
          ranked: last.ranked,
          coinsPaid: paid?.coinsPaid ?? 0,
          /** Owed by the tiers but not credited — the step-rewards switch again. */
          coinsOwed: paid?.coinsOwed ?? 0,
          /** Places skipped for an open fraud flag (L9); nobody moved up into them. */
          excluded: paid?.excluded ?? 0,
          /** How many places the week paid anything to, of which `winners` is a page. */
          winnersTotal,
          winnerLimit: query.winnerLimit,
          winnerOffset: query.winnerOffset,
          winners: lastResults
            .map(row => ({
              rank: row.rank,
              userId: row.userId,
              /** The member's own name — this is the operator's screen. */
              name: nameOf(row.userId, winners),
              /** As the app writes it on the board, for comparison. */
              publicName: publicName(nameOf(row.userId, winners)),
              score: row.score,
              coins: row.coins,
              granted: row.granted ?? 0,
              perks: row.perks,
              excluded: Boolean(row.excluded),
              paid: Boolean(row.paid),
            })),
        }
      : null,
  };
}
