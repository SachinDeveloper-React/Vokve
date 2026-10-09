import { getConfig } from '../../config/remote.js';
import {
  achievementDetailSchema,
  achievementSchema,
  challengeDetailSchema,
  challengeSchema,
  type Achievement,
  type AchievementBasis,
  type AchievementCta,
  type AchievementDetail,
  type Challenge,
  type ChallengeCta,
  type ChallengeDetail,
  type ChallengeFocus,
  type ChallengeRule,
} from '../../contracts/index.js';
import { addDays, formatDay, formatDayRange, localDayOf, localMidnightUtc, type IsoDate } from '../../lib/dates.js';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { DELETED_MEMBER, publicName } from '../../lib/names.js';
import { ActivityDailyModel } from '../activity/models.js';
import { credit } from '../economy/service.js';
import { UserModel, UserSettingsModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { StreakDayModel } from '../streak/models.js';
import { daysBetween, longestStreakOf } from '../streak/rules.js';
import { WorkoutModel } from '../training/models.js';
import {
  AchievementDefinitionModel,
  ChallengeCompletionModel,
  ChallengeDefinitionModel,
  UserAchievementModel,
  type AchievementRule,
  type ChallengeCadence,
  type ChallengeMetric,
} from './models.js';

/**
 * Challenges and achievements (RULES §C), on the server: the catalogue,
 * each member's progress worked out from verified activity for the period
 * a day falls in (C3), completions recorded and paid once per (user,
 * challenge, period) (C4), and the badges they and their own rules unlock.
 * Everyone is enrolled in every open challenge (C5, D-08); there is nothing
 * to join and nothing to claim.
 */

// ─── Periods (RULES C6) ────────────────────────────────────────────────────

export interface Period {
  start: IsoDate;
  end: IsoDate;
}

/** 0 for Monday … 6 for Sunday. */
function weekdayOf(day: IsoDate): number {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The day, the Monday-to-Sunday week, or the calendar month that `day` falls in. */
export function periodOf(cadence: ChallengeCadence, day: IsoDate): Period {
  if (cadence === 'daily') return { start: day, end: day };
  if (cadence === 'weekly') {
    const start = addDays(day, -weekdayOf(day));
    return { start, end: addDays(start, 6) };
  }
  const start = `${day.slice(0, 7)}-01`;
  const [y, m] = day.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start, end: addDays(nextMonth, -1) };
}

interface DefinitionRow {
  _id: string;
  title: string;
  description?: string | null;
  emoji?: string | null;
  metric: ChallengeMetric;
  cadence: ChallengeCadence;
  goal: number;
  rewardCoins: number;
  rewardsBadge?: boolean | null;
  badgeId?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
}

function isOpenOn(def: DefinitionRow, day: IsoDate): boolean {
  return (!def.startsOn || def.startsOn <= day) && (!def.endsOn || def.endsOn >= day);
}

// ─── Progress (RULES C3) ───────────────────────────────────────────────────

/**
 * What one day of `activity_daily` contributes to a metric, as an aggregation
 * expression: verified steps; workout calories plus the walking calories of
 * verified days; the active minutes of verified days.
 *
 * Declared once because two readers need the same answer — a member's own
 * progress and everyone's standings — and a copy of this in each is a copy
 * free to count an unverified day in one place and not the other.
 */
const DAILY_SUM = {
  steps: '$verifiedSteps',
  calories: { $add: [{ $ifNull: ['$caloriesBurned', 0] }, { $cond: ['$verified', { $ifNull: ['$stepCalories', 0] }, 0] }] },
  minutes: { $cond: ['$verified', { $ifNull: ['$activeMinutes', 0] }, 0] },
} as const satisfies Partial<Record<ChallengeMetric, unknown>>;

type DailyMetric = keyof typeof DAILY_SUM;

/**
 * How far a member has got with one metric over one period, from verified
 * activity only: verified steps; workout calories plus the walking calories
 * of verified days; the active minutes of verified days; days the streak
 * counted as earned; plausible workouts.
 */
async function progressOf(userId: string, metric: ChallengeMetric, period: Period): Promise<number> {
  const days = { $gte: period.start, $lte: period.end };
  switch (metric) {
    case 'days':
      return StreakDayModel.countDocuments({ userId, kind: 'earned', localDay: days });
    case 'workouts':
      return WorkoutModel.countDocuments({ userId, plausible: true, deletedAt: null, localDay: days });
    default: {
      const [row] = await ActivityDailyModel.aggregate<{ total: number }>([
        { $match: { userId, localDay: days } },
        { $group: { _id: null, total: { $sum: DAILY_SUM[metric as DailyMetric] } } },
      ]);
      return Math.round(row?.total ?? 0);
    }
  }
}

/** `progressOf`, asked once per (metric, period) however many challenges share it. */
function progressCache(userId: string) {
  const cache = new Map<string, Promise<number>>();
  return (metric: ChallengeMetric, period: Period) => {
    const key = `${metric}:${period.start}:${period.end}`;
    let value = cache.get(key);
    if (!value) {
      value = progressOf(userId, metric, period);
      cache.set(key, value);
    }
    return value;
  };
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/**
 * `GET /challenges?date=`: the board for one day — every challenge open on
 * it with the progress of the period it falls in (`startsAt: null`), then
 * the ones opening within ⚙ `challenges.upcomingDays` (`startsAt` set,
 * soonest first). A past day shows what that day's periods came to.
 */
export async function getChallenges(userId: string, date: IsoDate): Promise<Challenge[]> {
  const config = await getConfig();
  const defs = (await ChallengeDefinitionModel.find({ active: true }).sort({ sort: 1, _id: 1 }).lean()) as DefinitionRow[];
  const open = defs.filter(def => isOpenOn(def, date));
  const upcoming = defs
    .filter(def => def.startsOn && def.startsOn > date && daysBetween(date, def.startsOn) <= config.challenges.upcomingDays)
    .sort((a, b) => a.startsOn!.localeCompare(b.startsOn!));

  const periods = new Map(open.map(def => [def._id, periodOf(def.cadence, date)]));
  const completions = await ChallengeCompletionModel.find({
    _id: { $in: open.map(def => `${userId}:${def._id}:${periods.get(def._id)!.start}`) },
  }).lean();
  const completedAt = new Map(completions.map(c => [c.challengeId, c.completedAt.toISOString()]));
  const progress = progressCache(userId);

  const active = await Promise.all(
    open.map(async def => {
      const period = periods.get(def._id)!;
      return challengeSchema.parse({
        id: def._id,
        title: def.title,
        description: def.description ?? '',
        emoji: def.emoji ?? '🏅',
        metric: def.metric,
        cadence: def.cadence,
        goal: def.goal,
        progress: await progress(def.metric, period),
        rewardCoins: def.rewardCoins,
        rewardsBadge: Boolean(def.rewardsBadge),
        startsAt: null,
        endsOn: period.end,
        completedAt: completedAt.get(def._id) ?? null,
      });
    }),
  );

  const later = upcoming.map(def =>
    challengeSchema.parse({
      id: def._id,
      title: def.title,
      description: def.description ?? '',
      emoji: def.emoji ?? '🏅',
      metric: def.metric,
      cadence: def.cadence,
      goal: def.goal,
      progress: 0,
      rewardCoins: def.rewardCoins,
      rewardsBadge: Boolean(def.rewardsBadge),
      startsAt: def.startsOn,
      endsOn: null,
      completedAt: null,
    }),
  );

  return [...active, ...later];
}

/** `GET /achievements`: the whole shelf, in catalogue order, with the date each was unlocked. */
export async function getAchievements(userId: string): Promise<Achievement[]> {
  const [defs, mine] = await Promise.all([
    AchievementDefinitionModel.find().sort({ sort: 1, _id: 1 }).lean(),
    UserAchievementModel.find({ userId }).lean(),
  ]);
  const achievedAt = new Map(mine.map(row => [row.achievementId, row.achievedAt.toISOString()]));
  return defs.map(def =>
    achievementSchema.parse({
      id: def._id,
      value: def.value,
      label: def.label,
      metric: def.metric,
      achievedAt: achievedAt.get(def._id) ?? null,
    }),
  );
}

// ─── One challenge in full (RULES C3, C5) ──────────────────────────────────

const fmt = (value: number) => Math.round(value).toLocaleString('en-IN');

/** How a metric reads in a sentence. */
const METRIC_WORDS: Record<ChallengeMetric, { one: string; many: string }> = {
  steps: { one: 'step', many: 'steps' },
  calories: { one: 'calorie', many: 'calories' },
  minutes: { one: 'active minute', many: 'active minutes' },
  days: { one: 'day', many: 'days' },
  workouts: { one: 'workout', many: 'workouts' },
};

/** "10,000 steps", "1 workout". */
function units(value: number, metric: ChallengeMetric): string {
  const words = METRIC_WORDS[metric];
  return `${fmt(value)} ${value === 1 ? words.one : words.many}`;
}

const CADENCE_WORD: Record<ChallengeCadence, string> = { daily: 'day', weekly: 'week', monthly: 'month' };

/** The member's daily step goal — what a `days` challenge counts a day against. */
async function stepGoalOf(userId: string): Promise<number> {
  const settings = await UserSettingsModel.findById(userId, { dailyStepGoal: 1 }).lean();
  return settings?.dailyStepGoal ?? 10_000;
}

interface DetailPeriod extends Period {
  /** 1-based, for "Day 3 of 7". */
  day: number;
  days: number;
}

/**
 * The period a day falls in, clipped to the challenge's own dates.
 *
 * A weekly challenge that opens on a Wednesday runs four days in its first
 * week, not seven, and "Day 3 of 7" over a challenge that closes on day four
 * is a promise the server would then break.
 */
function detailPeriodOf(def: DefinitionRow, date: IsoDate): DetailPeriod {
  const base = periodOf(def.cadence, date);
  const start = def.startsOn && def.startsOn > base.start ? def.startsOn : base.start;
  const end = def.endsOn && def.endsOn < base.end ? def.endsOn : base.end;
  const days = Math.max(1, daysBetween(start, end) + 1);
  return { start, end, days, day: Math.min(days, Math.max(1, daysBetween(start, date) + 1)) };
}

/**
 * What the detail screen's ring counts.
 *
 * A day's share of the goal wherever that is a figure a member can act on
 * today — which is every metric that accumulates, plus `days`, where the day
 * itself is won by hitting the member's own step goal. A workout challenge
 * spread over a week has no daily share worth drawing (two workouts over
 * seven days is 0.3 of one), so it shows the period instead.
 */
async function focusOf(
  userId: string,
  def: DefinitionRow,
  period: DetailPeriod,
  date: IsoDate,
  today: IsoDate,
  timeZone: string,
  progress: number,
  stepGoal: number,
  upcoming: boolean,
): Promise<ChallengeFocus> {
  const closesAt = (day: IsoDate) => localMidnightUtc(addDays(day, 1), timeZone).toISOString();
  const build = (scope: 'today' | 'period', label: string, value: number, target: number, endsAt: string, caption: string) => ({
    scope,
    label,
    value: Math.round(value),
    target: Math.max(1, Math.round(target)),
    remaining: Math.max(0, Math.round(target) - Math.round(value)),
    endsAt,
    caption,
  });

  if (upcoming) {
    return build('period', 'Challenge Goal', 0, def.goal, localMidnightUtc(def.startsOn!, timeZone).toISOString(), 'Challenge Starts In');
  }

  // A day in the past has no clock left to run: the caption says so, and the
  // app drops the pill once `endsAt` is behind it either way.
  const whole = date === today ? "Today's Challenge Ends In" : 'That Day Has Closed';

  if (def.metric === 'days') {
    const [row] = await ActivityDailyModel.aggregate<{ total: number }>([
      { $match: { userId, localDay: date } },
      { $group: { _id: null, total: { $sum: '$verifiedSteps' } } },
    ]);
    return build('today', 'Daily Goal', row?.total ?? 0, stepGoal, closesAt(date), whole);
  }

  if (def.metric === 'workouts' && period.days > 1) {
    return build('period', 'Challenge Goal', progress, def.goal, closesAt(period.end), 'Challenge Ends In');
  }

  const value = await progressOf(userId, def.metric, { start: date, end: date });
  const target = period.days === 1 ? def.goal : Math.ceil(def.goal / period.days);
  return build('today', 'Daily Goal', value, target, closesAt(date), whole);
}

/** The collection a metric's standings are counted from, and the stages that total them per member. */
function standingsSource(metric: ChallengeMetric, period: Period) {
  const localDay = { $gte: period.start, $lte: period.end };
  if (metric === 'days') {
    return {
      model: StreakDayModel,
      stages: [{ $match: { kind: 'earned', localDay } }, { $group: { _id: '$userId', total: { $sum: 1 } } }],
    };
  }
  if (metric === 'workouts') {
    return {
      model: WorkoutModel,
      stages: [
        { $match: { plausible: true, deletedAt: null, localDay } },
        { $group: { _id: '$userId', total: { $sum: 1 } } },
      ],
    };
  }
  return {
    model: ActivityDailyModel,
    stages: [{ $match: { localDay } }, { $group: { _id: '$userId', total: { $sum: DAILY_SUM[metric as DailyMetric] } } }],
  };
}

/** Ranked order: more progress, then the lower id. The same order both reads below use. */
const STANDINGS_ORDER = { total: -1 as const, _id: 1 as const };

/**
 * The rule sheet, worded from the definition and the config in force.
 *
 * The server's wording rather than the app's, for the same reason the
 * leaderboard's "how it works" is: these are the rules the server actually
 * enforces, and a copy of them in the app goes stale the first time an owner
 * rebalances a reward (D-32).
 */
function rulesOf(def: DefinitionRow, period: DetailPeriod, stepGoal: number): ChallengeRule[] {
  const cadence = CADENCE_WORD[def.cadence];
  const goalLine =
    def.metric === 'days'
      ? `Walk at least ${fmt(stepGoal)} steps on each of the ${fmt(def.goal)} days`
      : period.days > 1
        ? `Reach ${units(def.goal, def.metric)} over the ${cadence}`
        : `Reach ${units(def.goal, def.metric)} in the day`;

  const reward =
    def.rewardCoins > 0
      ? `${completionCaption(def, period)} ${fmt(def.rewardCoins)} coins${def.rewardsBadge ? ' and a badge for your shelf' : ''}`
      : `${completionCaption(def, period)} a badge for your shelf`;

  return [
    { id: 'goal', icon: 'goal', text: goalLine, tone: 'default' },
    {
      id: 'duration',
      icon: 'duration',
      text:
        period.days === 1
          ? `Challenge duration: one day (${formatDay(period.start)})`
          : `Challenge duration: ${period.days} days (${formatDayRange(period.start, period.end)})`,
      tone: 'default',
    },
    {
      id: 'verified',
      icon: 'verified',
      text: `Only verified ${METRIC_WORDS[def.metric].many} count — the ones we can confirm came from you`,
      tone: 'default',
    },
    { id: 'reward', icon: 'reward', text: reward, tone: 'default' },
    {
      id: 'repeat',
      icon: 'repeat',
      text: `It resets every ${cadence}, so a ${cadence} you miss is a ${cadence} you can win back`,
      tone: 'default',
    },
    {
      id: 'integrity',
      icon: 'warning',
      text: 'Faked or tampered activity is not counted and can cost you the reward',
      tone: 'caution',
    },
  ];
}

/** "Complete all 7 days to earn", "Finish today's goal to earn". */
function completionCaption(def: DefinitionRow, period: DetailPeriod): string {
  if (def.metric === 'days') return `Complete all ${fmt(def.goal)} days to earn`;
  if (period.days === 1) return "Finish today's goal to earn";
  return `Finish the ${CADENCE_WORD[def.cadence]} to earn`;
}

/**
 * `GET /challenges/:id?date=`: one challenge in full for the period `date`
 * falls in — the board's row, the day's share of the goal, the rule sheet,
 * who is ahead, and where the button at the foot goes.
 *
 * The standings are worked out from activity rather than read from stored
 * scores, which is the one expensive thing on this screen: two aggregations
 * over the period, bounded by ⚙ `challenges.boardSize` for the list and by a
 * count for the caller's own rank. Everyone is enrolled (RULES C5), so
 * `joined` is the membership and there is nothing to join.
 */
export async function getChallengeDetail(
  userId: string,
  challengeId: string,
  date: IsoDate,
  timeZone: string,
  now = new Date(),
): Promise<ChallengeDetail> {
  const config = await getConfig();
  const def = (await ChallengeDefinitionModel.findOne({ _id: challengeId, active: true }).lean()) as DefinitionRow | null;
  if (!def) throw Errors.notFound('That challenge');

  const today = localDayOf(now, timeZone);
  const upcoming = Boolean(def.startsOn && def.startsOn > date);
  // An upcoming challenge is shown for the period it opens in: the week the
  // user is looking at has nothing of it to show, and a ring counting their
  // current steps towards a challenge that has not started would be a lie.
  const anchor = upcoming ? def.startsOn! : date;
  const period = detailPeriodOf(def, anchor);

  const [progress, stepGoal, joined, finished, completion] = await Promise.all([
    upcoming ? Promise.resolve(0) : progressOf(userId, def.metric, period),
    stepGoalOf(userId),
    UserModel.countDocuments({ deletedAt: null }),
    ChallengeCompletionModel.countDocuments({ challengeId: def._id, periodStart: period.start }),
    ChallengeCompletionModel.findById(`${userId}:${def._id}:${period.start}`).lean(),
  ]);

  const { model, stages } = standingsSource(def.metric, period);
  const [top, counts, focus] = await Promise.all([
    upcoming
      ? Promise.resolve([] as { _id: string; total: number }[])
      : model.aggregate<{ _id: string; total: number }>([
          ...stages,
          { $match: { total: { $gt: 0 } } },
          { $sort: STANDINGS_ORDER },
          { $limit: config.challenges.boardSize },
        ]),
    upcoming
      ? Promise.resolve([] as { ranked: number; ahead: number }[])
      : model.aggregate<{ ranked: number; ahead: number }>([
          ...stages,
          { $match: { total: { $gt: 0 } } },
          {
            $facet: {
              ranked: [{ $count: 'n' }],
              // The same tie-break the sort above uses, so the rank this
              // gives the caller is the rank the list would have put them at.
              ahead: [{ $match: { $or: [{ total: { $gt: progress } }, { total: progress, _id: { $lt: userId } }] } }, { $count: 'n' }],
            },
          },
          {
            $project: {
              ranked: { $ifNull: [{ $arrayElemAt: ['$ranked.n', 0] }, 0] },
              ahead: { $ifNull: [{ $arrayElemAt: ['$ahead.n', 0] }, 0] },
            },
          },
        ]),
    focusOf(userId, def, period, anchor, today, timeZone, progress, stepGoal, upcoming),
  ]);

  const people = new Map(
    (await UserModel.find({ _id: { $in: [...top.map(row => row._id), userId] } }, { name: 1, avatarUrl: 1, deletedAt: 1 }).lean())
      .map(user => [user._id, user]),
  );
  const named = (id: string) => {
    const person = people.get(id);
    return person && !person.deletedAt
      ? { name: publicName(person.name), avatarUrl: person.avatarUrl ?? null }
      : { name: DELETED_MEMBER, avatarUrl: null };
  };

  const standings = top.map((row, index) => ({
    id: row._id,
    ...named(row._id),
    rank: index + 1,
    progress: Math.round(row.total),
    completed: Math.round(row.total) >= def.goal,
    isCurrentUser: row._id === userId,
  }));

  const challenge = challengeSchema.parse({
    id: def._id,
    title: def.title,
    description: def.description ?? '',
    emoji: def.emoji ?? '🏅',
    metric: def.metric,
    cadence: def.cadence,
    goal: def.goal,
    progress,
    rewardCoins: def.rewardCoins,
    rewardsBadge: Boolean(def.rewardsBadge),
    startsAt: upcoming ? def.startsOn : null,
    endsOn: upcoming ? null : period.end,
    completedAt: completion?.completedAt.toISOString() ?? null,
  });

  const badge = def.rewardsBadge && def.badgeId ? await badgeOf(userId, def.badgeId) : null;

  return challengeDetailSchema.parse({
    challenge,
    period: {
      start: period.start,
      end: period.end,
      day: upcoming ? 1 : period.day,
      days: period.days,
      endsAt: localMidnightUtc(addDays(period.end, 1), timeZone).toISOString(),
    },
    focus,
    reward: { coins: def.rewardCoins, caption: completionCaption(def, period), badge },
    rules: rulesOf(def, period, stepGoal),
    joined,
    finished,
    ranked: counts[0]?.ranked ?? 0,
    standings,
    me: progress > 0
      ? {
          id: userId,
          ...named(userId),
          rank: (counts[0]?.ahead ?? 0) + 1,
          progress,
          completed: progress >= def.goal,
          isCurrentUser: true,
        }
      : null,
    cta: ctaOf(def, challenge, upcoming),
    shareText: shareTextOf(def, challenge, period, upcoming),
  });
}

/** The badge a challenge pays, with the caller's own state of it. */
async function badgeOf(userId: string, badgeId: string): Promise<Achievement | null> {
  const [def, mine] = await Promise.all([
    AchievementDefinitionModel.findById(badgeId).lean(),
    UserAchievementModel.findById(`${userId}:${badgeId}`).lean(),
  ]);
  if (!def) return null;
  return achievementSchema.parse({
    id: def._id,
    value: def.value,
    label: def.label,
    metric: def.metric,
    achievedAt: mine?.achievedAt.toISOString() ?? null,
  });
}

/**
 * The button at the foot.
 *
 * There is nothing to join and nothing to claim (RULES C5, C4), so it is
 * never a submit: it is the way to the screen where the member moves the
 * figure the challenge counts.
 */
function ctaOf(def: DefinitionRow, challenge: Challenge, upcoming: boolean): ChallengeCta {
  if (upcoming) return { label: `Opens ${formatDay(def.startsOn!)}`, action: 'none' };
  if (challenge.completedAt) return { label: 'Challenge Complete', action: 'view_board' };
  if (def.metric === 'workouts') return { label: 'Start a Workout', action: 'go_home' };
  return { label: 'Continue Challenge', action: 'track_steps' };
}

function shareTextOf(def: DefinitionRow, challenge: Challenge, period: DetailPeriod, upcoming: boolean): string {
  if (upcoming) {
    return `${def.title} opens on ${formatDay(def.startsOn!)} on VOKVE. ${def.description || 'Join me.'}`;
  }
  if (challenge.completedAt) {
    return `I finished the ${def.title} challenge on VOKVE — ${units(def.goal, def.metric)} done. Your turn!`;
  }
  return `I'm on day ${period.day} of ${period.days} of the ${def.title} challenge on VOKVE — ${units(
    challenge.progress,
    def.metric,
  )} of ${fmt(def.goal)} so far. Join me!`;
}

// ─── One achievement in full (RULES C7) ────────────────────────────────────

interface AchievementRow {
  _id: string;
  label: string;
  title?: string | null;
  value: number;
  metric: ChallengeMetric;
  rule?: string | null;
  threshold?: number | null;
  rewardCoins?: number | null;
}

/** What the badge's figure is, in words. */
const BASIS_LABEL: Record<AchievementBasis, string> = {
  best_day: 'Your best day',
  longest_streak: 'Your longest streak',
  total_workouts: 'Workouts finished',
  challenges_completed: 'Challenges completed',
  challenge: 'Challenge progress',
};

function basisOf(rule: string | null | undefined): AchievementBasis | null {
  if (!rule) return null;
  if (rule === 'longest_streak') return 'longest_streak';
  if (rule === 'total_workouts') return 'total_workouts';
  if (rule === 'challenges_completed') return 'challenges_completed';
  return 'best_day';
}

/** "Walk 10,000 steps in a single day." — what the badge asks for, in one line. */
function requirementOf(
  def: AchievementRow,
  basis: AchievementBasis,
  target: number,
  challengeTitle: string | null,
): string {
  switch (basis) {
    case 'longest_streak':
      return `Keep your streak going for ${fmt(target)} days in a row.`;
    case 'total_workouts':
      return `Finish ${units(target, 'workouts')}.`;
    case 'challenges_completed':
      return `Complete ${fmt(target)} challenge${target === 1 ? '' : 's'}.`;
    case 'challenge':
      return challengeTitle ? `Finish the ${challengeTitle} challenge.` : `Reach ${units(target, def.metric)}.`;
    default:
      if (def.metric === 'calories') return `Burn ${fmt(target)} calories in a single day.`;
      if (def.metric === 'minutes') return `Stay active for ${fmt(target)} minutes in a single day.`;
      return `Walk ${fmt(target)} steps in a single day.`;
  }
}

/** What is left, in the badge's own unit — "1,572 steps to go". */
function remainingLine(def: AchievementRow, basis: AchievementBasis, value: number, target: number): string {
  const left = Math.max(0, target - value);
  if (basis === 'longest_streak') return `${fmt(left)} more day${left === 1 ? '' : 's'} in a row to go`;
  if (basis === 'total_workouts') return `${units(left, 'workouts')} to go`;
  if (basis === 'challenges_completed') return `${fmt(left)} more challenge${left === 1 ? '' : 's'} to go`;
  return `${units(left, def.metric)} to go`;
}

/**
 * The button at the foot.
 *
 * A badge is never claimed, so the button is only ever a way on: to the next
 * rung of the same ladder while there is one, and back to the shelf once the
 * member has the lot.
 */
function achievementCtaOf(def: AchievementRow, unlocked: boolean, hasNext: boolean): AchievementCta {
  if (unlocked && !hasNext) return { label: 'View All Achievements', action: 'view_shelf' };
  return def.metric === 'workouts'
    ? { label: 'Start a Workout', action: 'go_home' }
    : { label: 'Keep Going', action: 'track_steps' };
}

/**
 * `GET /achievements/:id`: one badge in full — what it takes, how close the
 * member is, what it pays, and the rest of its family.
 *
 * The figure is the member's best on record rather than today's (RULES C7),
 * so a badge never slides backwards the day after it was nearly won. A badge
 * a challenge gives has no rule and so no figure of its own; it borrows that
 * challenge's current period instead, which is the thing the member can
 * actually act on.
 */
export async function getAchievementDetail(
  userId: string,
  achievementId: string,
  timeZone: string,
  now = new Date(),
): Promise<AchievementDetail> {
  const def = (await AchievementDefinitionModel.findById(achievementId).lean()) as AchievementRow | null;
  if (!def) throw Errors.notFound('That achievement');

  const config = await getConfig();
  // The whole family in one read: the row under "Related" and the member's
  // own state of this badge are the same question asked about more badges.
  const [family, awardedBy] = await Promise.all([
    AchievementDefinitionModel.find({ metric: def.metric }).sort({ value: 1, _id: 1 }).lean(),
    ChallengeDefinitionModel.findOne({ badgeId: achievementId, active: true }).lean(),
  ]);
  const held = await UserAchievementModel.find(
    { userId, achievementId: { $in: family.map(row => row._id) } },
    { achievementId: 1, achievedAt: 1 },
  ).lean();
  const heldAt = new Map(held.map(row => [row.achievementId, row.achievedAt.toISOString()]));

  const unlockedAt = heldAt.get(achievementId) ?? null;
  const unlocked = unlockedAt !== null;

  // A badge with a rule is measured against its own threshold; one a
  // challenge gives is measured against that challenge.
  const ruleBasis = basisOf(def.rule);
  const basis: AchievementBasis = ruleBasis ?? (awardedBy ? 'challenge' : 'best_day');
  const target = Math.max(1, (ruleBasis ? def.threshold : awardedBy?.goal) ?? def.value);

  const value =
    ruleBasis !== null
      ? await figureOf(userId, def.rule as AchievementRule)
      : awardedBy
        ? await progressOf(
            userId,
            awardedBy.metric as ChallengeMetric,
            periodOf(awardedBy.cadence as ChallengeCadence, localDayOf(now, timeZone)),
          )
        : 0;

  // A 10,428-step day against a 10,000 goal is 100%, not 104: the bar says
  // how much of the badge is done, and nothing is more than done.
  const percent = Math.min(100, Math.round((value / target) * 100));
  const completedOn = unlockedAt ? localDayOf(new Date(unlockedAt), timeZone) : null;

  const challengeTitle = awardedBy?.title ?? null;
  const requirement = requirementOf(def, basis, target, challengeTitle);
  const hasNext = family.some(row => row.value > def.value && !heldAt.has(row._id));

  // The badge's own coins if it has any; failing that, the challenge that
  // gives it is what unlocking it is actually worth.
  const own = def.rewardCoins ?? 0;
  const reward =
    own > 0
      ? {
          coins: own,
          via: 'achievement' as const,
          caption: !config.coins.achievements.enabled
            ? 'Coins for badges start soon'
            : unlocked
              ? 'Paid when you unlocked it'
              : 'Paid when you unlock it',
          paid: unlocked && config.coins.achievements.enabled,
        }
      : awardedBy && awardedBy.rewardCoins > 0
        ? {
            coins: awardedBy.rewardCoins,
            via: 'challenge' as const,
            caption: `Paid by the ${awardedBy.title} challenge`,
            paid: false,
          }
        : { coins: 0, via: 'none' as const, caption: 'A badge for your shelf', paid: false };

  return achievementDetailSchema.parse({
    achievement: {
      id: def._id,
      value: def.value,
      label: def.label,
      metric: def.metric,
      achievedAt: unlockedAt,
    },
    title: def.title || def.label,
    description: requirement,
    // The requirement again, as the middle of a sentence: one wording to keep
    // current rather than two that can drift apart.
    about: `This achievement is awarded when you ${requirement.charAt(0).toLowerCase()}${requirement.slice(1, -1)}. It shows your dedication towards an active lifestyle.`,
    note: unlocked
      ? 'You did it! Consistency leads to a healthier you.'
      : `${remainingLine(def, basis, value, target)} — keep moving and it is yours.`,
    unlocked,
    unlockedAt,
    progress: {
      basis,
      label: basis === 'challenge' && challengeTitle ? challengeTitle : BASIS_LABEL[basis],
      value,
      target,
      percent,
      caption: completedOn ? `Goal completed on ${formatDay(completedOn)}` : remainingLine(def, basis, value, target),
      completedOn,
    },
    reward,
    cheer: unlocked
      ? { title: 'Great job!', message: "You're one step closer to a fitter, healthier you." }
      : { title: 'Keep going', message: 'Every day you move brings this one closer.' },
    related: family.map(row =>
      achievementSchema.parse({
        id: row._id,
        value: row.value,
        label: row.label,
        metric: row.metric,
        achievedAt: heldAt.get(row._id) ?? null,
      }),
    ),
    cta: achievementCtaOf(def, unlocked, hasNext),
    shareText: unlocked
      ? `I just unlocked the ${def.title || def.label} badge on VOKVE. ${requirement} Your turn!`
      : `I'm ${percent}% of the way to the ${def.title || def.label} badge on VOKVE. ${requirement}`,
  });
}

// ─── Writes ────────────────────────────────────────────────────────────────

/**
 * Re-counts every challenge open on `localDay` after something that moves
 * its progress — a day's steps scored, a workout saved, a streak day earned
 * — and completes the ones that have reached their goal (RULES C4). A
 * completion is recorded once per (user, challenge, period); the coins go
 * through `economy.credit()` like any other, so the daily ceiling applies and
 * a replay pays nothing.
 *
 * Rewards a challenge earns from steps — steps, calories, active minutes,
 * goal days — wait for ⚙ `coins.steps.enabled`, exactly as step coins do
 * (D-05, D-46): while it is off the completion is recorded and nothing is
 * paid. Workout challenges pay whenever workouts do.
 */
export async function evaluateChallenges(userId: string, localDay: IsoDate, timeZone: string, now = new Date()): Promise<string[]> {
  const config = await getConfig();
  const defs = (await ChallengeDefinitionModel.find({ active: true }).lean()) as DefinitionRow[];
  const progress = progressCache(userId);
  const today = localDayOf(now, timeZone);
  const completed: string[] = [];

  for (const def of defs.filter(d => isOpenOn(d, localDay))) {
    const period = periodOf(def.cadence, localDay);
    const reached = await progress(def.metric, period);
    if (reached < def.goal) continue;

    const id = `${userId}:${def._id}:${period.start}`;
    const payable = def.rewardCoins > 0 && (def.metric === 'workouts' || config.coins.steps.enabled);
    try {
      await ChallengeCompletionModel.create({
        _id: id,
        userId,
        challengeId: def._id,
        cadence: def.cadence,
        periodStart: period.start,
        periodEnd: period.end,
        progress: reached,
        goal: def.goal,
        rewardCoins: def.rewardCoins,
        status: payable ? 'paid' : 'unpaid',
        completedAt: now,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue;
      throw err;
    }
    completed.push(def._id);

    let granted = 0;
    if (payable) {
      const result = await credit({
        userId,
        source: 'challenge',
        referenceType: 'challenge',
        referenceId: `${def._id}:${period.start}`,
        amount: def.rewardCoins,
        title: `${def.title} completed`,
        localDay: today,
      });
      granted = result.granted;
      await ChallengeCompletionModel.updateOne(
        { _id: id },
        { $set: { granted, ledgerId: result.ledgerId ?? null, status: result.capped > 0 || result.status === 'cap_reached' ? 'capped' : 'paid' } },
      );
    }

    if (def.rewardsBadge && def.badgeId) {
      await unlockAchievement(userId, def.badgeId, `challenge:${def._id}`, now, timeZone);
    }

    await notify({
      userId,
      topic: 'challenge',
      title: `${def.title} complete! 🏆`,
      message: !payable
        ? 'Goal reached. Coins for challenges like this start soon.'
        : granted > 0
          ? `You earned ${granted.toLocaleString('en-IN')} coins.`
          : 'Goal reached. Today’s coin limit is already met.',
      dedupeKey: `challenge:${id}`,
      now,
    });
  }

  await evaluateAchievements(userId, timeZone, now);
  return completed;
}

/**
 * Unlocks one badge, once, and pays what it is worth. Returns whether it was
 * new.
 *
 * The coins wait for ⚙ `coins.achievements.enabled`, exactly as step-derived
 * rewards wait for `coins.steps.enabled` (D-46): the badge is unlocked either
 * way, and the member is told plainly which of the two happened rather than
 * being promised coins that were never minted.
 *
 * They go out under `source: 'challenge'` with `referenceType: 'achievement'`,
 * which is the route leaderboard prizes already take (RULES E13 — the source
 * is a category, not a literal), so the daily ceiling applies and a replay
 * pays nothing.
 */
async function unlockAchievement(
  userId: string,
  achievementId: string,
  via: string,
  now: Date,
  timeZone: string,
): Promise<boolean> {
  const def = await AchievementDefinitionModel.findById(achievementId).lean();
  if (!def) {
    logger.warn({ achievementId }, 'challenges.unknown_badge');
    return false;
  }
  try {
    await UserAchievementModel.create({ _id: `${userId}:${achievementId}`, userId, achievementId, achievedAt: now, via });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }

  const config = await getConfig();
  const payable = (def.rewardCoins ?? 0) > 0 && config.coins.achievements.enabled;
  let granted = 0;
  if (payable) {
    const result = await credit({
      userId,
      source: 'challenge',
      referenceType: 'achievement',
      referenceId: achievementId,
      amount: def.rewardCoins,
      title: `${def.label} badge unlocked`,
      localDay: localDayOf(now, timeZone),
    });
    granted = result.granted;
  }

  await notify({
    userId,
    topic: 'challenge',
    title: `New badge: ${def.label} 🏅`,
    message:
      granted > 0
        ? `It’s on your shelf, and you earned ${granted.toLocaleString('en-IN')} coins.`
        : 'It’s on your achievements shelf.',
    dedupeKey: `achievement:${userId}:${achievementId}`,
    now,
  });
  return true;
}

/**
 * Unlocks every badge whose own rule the member now meets (RULES C7). Each
 * figure is the member's best on record, not today's, so a day synced late
 * or a streak restored still counts. Never takes a badge back.
 */
export async function evaluateAchievements(userId: string, timeZone: string, now = new Date()): Promise<string[]> {
  const [defs, mine] = await Promise.all([
    AchievementDefinitionModel.find().lean(),
    UserAchievementModel.find({ userId }, { achievementId: 1 }).lean(),
  ]);
  const have = new Set(mine.map(row => row.achievementId));
  const pending = defs.filter(def => !have.has(def._id) && def.rule);
  if (pending.length === 0) return [];

  const figures = new Map<AchievementRule, Promise<number>>();
  const figure = (rule: AchievementRule) => {
    let value = figures.get(rule);
    if (!value) {
      value = figureOf(userId, rule);
      figures.set(rule, value);
    }
    return value;
  };

  const unlocked: string[] = [];
  for (const def of pending) {
    // A badge with no rule of its own is a challenge's to give.
    if (!def.rule || def.threshold == null) continue;
    if ((await figure(def.rule as AchievementRule)) >= def.threshold && (await unlockAchievement(userId, def._id, 'rule', now, timeZone))) {
      unlocked.push(def._id);
    }
  }
  return unlocked;
}

async function figureOf(userId: string, rule: AchievementRule): Promise<number> {
  switch (rule) {
    case 'longest_streak': {
      const days = await StreakDayModel.find({ userId }, { localDay: 1 }).lean();
      return longestStreakOf(new Set(days.map(d => d.localDay)))?.length ?? 0;
    }
    case 'total_workouts':
      return WorkoutModel.countDocuments({ userId, plausible: true, deletedAt: null });
    case 'challenges_completed':
      return ChallengeCompletionModel.countDocuments({ userId });
    default: {
      const value =
        rule === 'best_day_steps'
          ? '$verifiedSteps'
          : rule === 'best_day_calories'
            ? { $add: [{ $ifNull: ['$caloriesBurned', 0] }, { $cond: ['$verified', { $ifNull: ['$stepCalories', 0] }, 0] }] }
            : { $cond: ['$verified', { $ifNull: ['$activeMinutes', 0] }, 0] };
      const [row] = await ActivityDailyModel.aggregate<{ best: number }>([
        { $match: { userId } },
        { $group: { _id: null, best: { $max: value } } },
      ]);
      return Math.round(row?.best ?? 0);
    }
  }
}
