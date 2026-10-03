import { Schema, model } from 'mongoose';

/**
 * A member's score for one week on their country's board (RULES L3),
 * recounted from verified activity whenever it moves. `scoreReachedAt` is
 * the tie-break (L5): of two equal scores, the one reached first ranks first.
 */
const leaderboardScoreSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${periodId}:${country}:${userId}`
    periodId: { type: String, required: true },
    country: { type: String, required: true },
    userId: { type: String, required: true },
    steps: { type: Number, default: 0 },
    workouts: { type: Number, default: 0 },
    challenges: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    scoreReachedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'leaderboard_scores', versionKey: false },
);
leaderboardScoreSchema.index({ periodId: 1, country: 1, score: -1, scoreReachedAt: 1, userId: 1 });
leaderboardScoreSchema.index({ userId: 1, periodId: -1 });
export const LeaderboardScoreModel = model('LeaderboardScore', leaderboardScoreSchema);

/** A closed week (RULES L6): written once, when its standings were frozen. */
const leaderboardPeriodSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${periodId}:${country}`
    periodId: { type: String, required: true },
    country: { type: String, required: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
    ranked: { type: Number, required: true },
    closedAt: { type: Date, required: true },
  },
  { collection: 'leaderboard_periods', versionKey: false },
);
export const LeaderboardPeriodModel = model('LeaderboardPeriod', leaderboardPeriodSchema);

/**
 * Each ranked member's place in a closed week, frozen at close — what the
 * payout and the member's history read (L6). `excluded` is a place skipped
 * for an open fraud flag (L9): kept, not paid, nobody moved up into it.
 */
const leaderboardResultSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${periodId}:${country}:${userId}`
    periodId: { type: String, required: true },
    country: { type: String, required: true },
    userId: { type: String, required: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
    rank: { type: Number, required: true },
    score: { type: Number, required: true },
    /** What the place pays by the tiers in force at close. */
    coins: { type: Number, default: 0 },
    perks: { type: [String], default: [] },
    excluded: { type: Boolean, default: false },
    /** What the economy actually paid: 0 while step-derived rewards wait (D-46). */
    granted: { type: Number, default: 0 },
    paid: { type: Boolean, default: false },
    ledgerId: { type: String, default: null },
  },
  { collection: 'leaderboard_results', versionKey: false },
);
leaderboardResultSchema.index({ userId: 1, periodId: -1 });
leaderboardResultSchema.index({ periodId: 1, country: 1, rank: 1 });
export const LeaderboardResultModel = model('LeaderboardResult', leaderboardResultSchema);
