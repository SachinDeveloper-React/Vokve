import { Schema, model } from 'mongoose';

export const STREAK_DAY_KINDS = ['earned', 'frozen', 'restored'] as const;
export type StreakDayKind = (typeof STREAK_DAY_KINDS)[number];

export const STREAK_DAY_SOURCES = ['workout', 'steps', 'freeze', 'restore'] as const;
export type StreakDaySource = (typeof STREAK_DAY_SOURCES)[number];

/**
 * One row per counting day (RULES S1): earned by a workout or the step goal,
 * or protected by a freeze or a restore. Written when the day is decided and
 * never recomputed (RULES D2) — a goal changed next month does not rewrite
 * last month's calendar. A protected day that is then earned becomes earned;
 * an earned day is never taken back.
 */
const streakDaySchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${localDay}`
    userId: { type: String, required: true },
    localDay: { type: String, required: true },
    kind: { type: String, enum: STREAK_DAY_KINDS, required: true },
    source: { type: String, enum: STREAK_DAY_SOURCES, required: true },
    /** How the day was protected before it was earned, if it was. */
    protectedBy: { type: String, enum: [...STREAK_DAY_SOURCES, null], default: null },
    /** The workout, or the restore's ledger row, behind the day. */
    referenceId: { type: String, default: null },
  },
  { timestamps: true, collection: 'streak_days', versionKey: false },
);
streakDaySchema.index({ userId: 1, localDay: 1 });
streakDaySchema.index({ localDay: 1 });
export const StreakDayModel = model('StreakDay', streakDaySchema);

/**
 * The streak's own counters, one per user: the freezes in hand, and which
 * freeze grants have been made (RULES S5) — keyed by the run and the length
 * that earned them, so a run that reaches 30 days grants once however many
 * times it is recounted.
 */
const streakStateSchema = new Schema(
  {
    _id: { type: String, required: true }, // userId
    freezesAvailable: { type: Number, required: true, min: 0 },
    freezeGrantKeys: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'streak_state', versionKey: false },
);
export const StreakStateModel = model('StreakState', streakStateSchema);
