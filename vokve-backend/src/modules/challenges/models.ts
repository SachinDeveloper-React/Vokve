import { Schema, model } from 'mongoose';

export const CHALLENGE_METRICS = ['steps', 'calories', 'minutes', 'days', 'workouts'] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];

export const CHALLENGE_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type ChallengeCadence = (typeof CHALLENGE_CADENCES)[number];

/**
 * The challenge catalogue (RULES C1, C2): one row per challenge, the same
 * for everyone — every member is enrolled in every open challenge (C5,
 * D-08). `startsOn`/`endsOn` bound when it runs; null is "always".
 */
const challengeDefinitionSchema = new Schema(
  {
    _id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    emoji: { type: String, default: '🏅' },
    metric: { type: String, enum: CHALLENGE_METRICS, required: true },
    cadence: { type: String, enum: CHALLENGE_CADENCES, required: true },
    goal: { type: Number, required: true, min: 1 },
    rewardCoins: { type: Number, required: true, min: 0 },
    rewardsBadge: { type: Boolean, default: false },
    /** The achievement a completion unlocks, when `rewardsBadge`. */
    badgeId: { type: String, default: null },
    startsOn: { type: String, default: null },
    endsOn: { type: String, default: null },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'challenge_definitions', versionKey: false },
);
export const ChallengeDefinitionModel = model('ChallengeDefinition', challengeDefinitionSchema);

/**
 * One row per (user, challenge, period) that reached its goal (RULES C4).
 * The id is the anti-double-pay key alongside the ledger's own; `granted`
 * is what the economy actually paid — less than the reward under the daily
 * ceiling, zero while step-derived rewards wait for step coins (D-46).
 */
const challengeCompletionSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${challengeId}:${periodStart}`
    userId: { type: String, required: true },
    challengeId: { type: String, required: true },
    cadence: { type: String, enum: CHALLENGE_CADENCES, required: true },
    periodStart: { type: String, required: true },
    periodEnd: { type: String, required: true },
    progress: { type: Number, required: true },
    goal: { type: Number, required: true },
    rewardCoins: { type: Number, required: true },
    granted: { type: Number, default: 0 },
    status: { type: String, enum: ['paid', 'capped', 'unpaid'], required: true },
    ledgerId: { type: String, default: null },
    completedAt: { type: Date, required: true },
  },
  { collection: 'challenge_completions', versionKey: false },
);
challengeCompletionSchema.index({ userId: 1, periodStart: 1 });
challengeCompletionSchema.index({ userId: 1, completedAt: -1 });
export const ChallengeCompletionModel = model('ChallengeCompletion', challengeCompletionSchema);

export const ACHIEVEMENT_RULES = [
  'best_day_steps',
  'best_day_calories',
  'best_day_minutes',
  'longest_streak',
  'total_workouts',
  'challenges_completed',
] as const;
export type AchievementRule = (typeof ACHIEVEMENT_RULES)[number];

/**
 * The achievement shelf (RULES C7): what each badge is for, the figure it
 * stands for, and the rule that unlocks it. A badge a challenge pays out
 * (`rewardsBadge`) is unlocked by that challenge too; one with no rule of
 * its own is unlocked only that way.
 */
const achievementDefinitionSchema = new Schema(
  {
    _id: { type: String, required: true },
    label: { type: String, required: true },
    value: { type: Number, required: true },
    metric: { type: String, enum: CHALLENGE_METRICS, required: true },
    rule: { type: String, enum: [...ACHIEVEMENT_RULES, null], default: null },
    threshold: { type: Number, default: null },
    sort: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'achievement_definitions', versionKey: false },
);
export const AchievementDefinitionModel = model('AchievementDefinition', achievementDefinitionSchema);

/** A badge one user has: unlocked once, never taken back. */
const userAchievementSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${achievementId}`
    userId: { type: String, required: true },
    achievementId: { type: String, required: true },
    achievedAt: { type: Date, required: true },
    /** What unlocked it: its own rule, or the challenge that pays it. */
    via: { type: String, required: true },
  },
  { collection: 'user_achievements', versionKey: false },
);
userAchievementSchema.index({ userId: 1, achievedAt: -1 });
export const UserAchievementModel = model('UserAchievement', userAchievementSchema);
