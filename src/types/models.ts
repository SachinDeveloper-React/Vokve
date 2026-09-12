import { z } from 'zod';

/**
 * Domain models are defined as zod schemas first and the TypeScript types are
 * inferred from them. A single definition then covers both compile-time safety
 * and runtime validation of anything crossing the network boundary — an API
 * that quietly changes a field shows up as a caught parse error rather than an
 * `undefined` deep inside a screen.
 */

export const unitSystemSchema = z.enum(['metric', 'imperial']);
export type UnitSystem = z.infer<typeof unitSystemSchema>;

export const fitnessGoalSchema = z.enum([
  'lose_weight',
  'build_muscle',
  'gain_strength',
  'improve_endurance',
  'stay_active',
]);
export type FitnessGoal = z.infer<typeof fitnessGoalSchema>;

export const activityLevelSchema = z.enum([
  'sedentary',
  'light',
  'moderate',
  'active',
  'athlete',
]);
export type ActivityLevel = z.infer<typeof activityLevelSchema>;

/**
 * Deliberately not an open string: the value drives calorie and body-composition
 * estimates, so it has to be one the model can actually branch on. `other` is a
 * real option rather than a missing answer — it means the user told us their
 * gender is none of the two, and the estimator falls back to a neutral average.
 */
export const genderSchema = z.enum(['male', 'female', 'other']);
export type Gender = z.infer<typeof genderSchema>;

export const muscleGroupSchema = z.enum([
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'legs',
  'glutes',
  'core',
  'full_body',
  'cardio',
]);
export type MuscleGroup = z.infer<typeof muscleGroupSchema>;

export const equipmentSchema = z.enum([
  'none',
  'barbell',
  'dumbbell',
  'kettlebell',
  'machine',
  'cable',
  'band',
  'bodyweight',
]);
export type Equipment = z.infer<typeof equipmentSchema>;

export const exerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  muscleGroup: muscleGroupSchema,
  equipment: equipmentSchema,
  /** Present for cardio work, absent for lifts measured in reps. */
  isTimed: z.boolean().default(false),
  imageUrl: z.string().nullable().default(null),
});
export type Exercise = z.infer<typeof exerciseSchema>;

export const workoutSetSchema = z.object({
  id: z.string(),
  reps: z.number().int().nonnegative(),
  /** Stored in kilograms; converted for display when the user prefers lbs. */
  weightKg: z.number().nonnegative(),
  /** Rate of perceived exertion, 1-10. Null until the user records it. */
  rpe: z.number().min(1).max(10).nullable().default(null),
  durationSeconds: z.number().int().nonnegative().nullable().default(null),
  completed: z.boolean().default(false),
});
export type WorkoutSet = z.infer<typeof workoutSetSchema>;

export const workoutExerciseSchema = z.object({
  id: z.string(),
  exercise: exerciseSchema,
  sets: z.array(workoutSetSchema),
  restSeconds: z.number().int().nonnegative().default(90),
  notes: z.string().nullable().default(null),
});
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;

export const workoutSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** ISO-8601. Null while the session is still in progress. */
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  exercises: z.array(workoutExerciseSchema),
  totalVolumeKg: z.number().nonnegative().default(0),
  caloriesBurned: z.number().nonnegative().default(0),
});
export type Workout = z.infer<typeof workoutSchema>;

export const workoutTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  estimatedMinutes: z.number().int().positive(),
  muscleGroups: z.array(muscleGroupSchema),
  exercises: z.array(exerciseSchema),
});
export type WorkoutTemplate = z.infer<typeof workoutTemplateSchema>;

export const dailyActivitySchema = z.object({
  /** ISO date, `YYYY-MM-DD`. */
  date: z.string(),
  steps: z.number().int().nonnegative().default(0),
  activeMinutes: z.number().int().nonnegative().default(0),
  caloriesBurned: z.number().nonnegative().default(0),
  workoutsCompleted: z.number().int().nonnegative().default(0),
});
export type DailyActivity = z.infer<typeof dailyActivitySchema>;

export const bodyMeasurementSchema = z.object({
  id: z.string(),
  recordedAt: z.string(),
  weightKg: z.number().positive(),
  bodyFatPercent: z.number().min(0).max(100).nullable().default(null),
});
export type BodyMeasurement = z.infer<typeof bodyMeasurementSchema>;

/**
 * Where a coin movement came from.
 *
 * An enum rather than free text: the source picks the icon and the wording a
 * ledger row is drawn with, so a typo would show up as a blank row at runtime
 * instead of as a type error here.
 */
export const coinSourceSchema = z.enum([
  'steps',
  'workout',
  'streak',
  'challenge',
  'referral',
  'purchase',
  'refund',
]);
export type CoinSource = z.infer<typeof coinSourceSchema>;

export const coinTransactionSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: coinSourceSchema,
  /**
   * Signed: positive when coins were earned, negative when they were spent.
   * One signed number rather than an amount plus a direction flag, so a row
   * cannot claim to be a purchase worth +250.
   */
  amount: z.number().int(),
  /** ISO-8601. */
  createdAt: z.string(),
});
export type CoinTransaction = z.infer<typeof coinTransactionSchema>;

export const shopCategorySchema = z.enum([
  'apparel',
  'accessories',
  'gear',
  'lifestyle',
]);
export type ShopCategory = z.infer<typeof shopCategorySchema>;

/**
 * The flag a reward can carry on its card. An enum rather than a free string:
 * each one has its own colour on the card, and a label the server spelled
 * differently ("New" against "New Arrival") would otherwise fall through to
 * the default tint and quietly lose its meaning.
 */
export const shopBadgeSchema = z.enum([
  'bestseller',
  'popular',
  'new_arrival',
  'limited',
]);
export type ShopBadge = z.infer<typeof shopBadgeSchema>;

export const shopItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  /** Coins only — the shop has no cash price to fall back on. */
  priceCoins: z.number().int().positive(),
  category: shopCategorySchema,
  /** Stands in for product art until the catalogue ships real images. */
  emoji: z.string().default('🎁'),
  /** Null when the item carries no flag. */
  badge: shopBadgeSchema.nullable().default(null),
  /** Surfaces the item under the shop's "Deals" filter. */
  isDeal: z.boolean().default(false),
  inStock: z.boolean().default(true),
});
export type ShopItem = z.infer<typeof shopItemSchema>;

/**
 * What a challenge is counted in.
 *
 * The metric picks the unit a progress line is written in and the colour the
 * challenge is drawn with, here and on the achievement it pays out — an enum
 * rather than a free unit string, so the same challenge cannot be green with a
 * "Cal" suffix in one place and blue with "calories" in another.
 */
export const challengeMetricSchema = z.enum([
  'steps',
  'calories',
  'minutes',
  'days',
  'workouts',
]);
export type ChallengeMetric = z.infer<typeof challengeMetricSchema>;

/** How often a challenge resets, and the filter it answers to. */
export const challengeCadenceSchema = z.enum(['daily', 'weekly', 'monthly']);
export type ChallengeCadence = z.infer<typeof challengeCadenceSchema>;

export const challengeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  /** Stands in for challenge art until the catalogue ships real images. */
  emoji: z.string().default('🏅'),
  metric: challengeMetricSchema,
  cadence: challengeCadenceSchema,
  /** What the challenge asks for, in the metric's own unit. */
  goal: z.number().positive(),
  /** How far the user has got. Zero for one that has not opened yet. */
  progress: z.number().nonnegative().default(0),
  rewardCoins: z.number().int().nonnegative(),
  /** Some challenges pay a badge on top of the coins. */
  rewardsBadge: z.boolean().default(false),
  /**
   * ISO date the challenge opens on, or null while it is running.
   *
   * One nullable date rather than an `active | upcoming` flag beside it: a
   * status field could claim a challenge was running while its start date sat
   * a week in the future, and the screen splits its two lists on exactly this.
   */
  startsAt: z.string().nullable().default(null),
});
export type Challenge = z.infer<typeof challengeSchema>;

export const achievementSchema = z.object({
  id: z.string(),
  /** What the ring shows — "10K", "500", "30". Already abbreviated. */
  value: z.string(),
  /** What it was won for — "10K Steps", "Cal Burner". */
  label: z.string(),
  /** Borrowed from challenges: an achievement is what one pays out. */
  metric: challengeMetricSchema,
  /** ISO-8601, or null while the achievement is still locked. */
  achievedAt: z.string().nullable().default(null),
});
export type Achievement = z.infer<typeof achievementSchema>;

/**
 * One drink, as the day's log lists it.
 *
 * Entries rather than a running total alone: the log has to be able to take a
 * row back out again, and a total with no history behind it can only be
 * corrected by guessing what was added.
 */
export const hydrationEntrySchema = z.object({
  id: z.string(),
  /** What was drunk, in millilitres. */
  ml: z.number().int().positive(),
  /** ISO-8601. The log shows the clock time it was logged at. */
  at: z.string(),
});
export type HydrationEntry = z.infer<typeof hydrationEntrySchema>;

/**
 * One person on the leaderboard, as a row of it is drawn.
 *
 * The perk is the wording the board shows beside the coins — "T-Shirt +
 * Bottle" — rather than a list of product ids: the prize catalogue is the
 * shop's business, and a leaderboard row only ever states what was won.
 */
export const leaderboardEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** "Delhi, India" — the city and country the rank was earned in. */
  location: z.string(),
  rank: z.number().int().positive(),
  coins: z.number().int().nonnegative(),
  /** Empty when the rank pays coins alone. */
  perk: z.string().default(''),
  avatarUrl: z.string().nullable().default(null),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

/**
 * What a notification is about.
 *
 * The topic picks the glyph and the colour a row is drawn with, and the filter
 * the row falls under, so it is an enum rather than free text: a topic the app
 * has no entry for would otherwise reach the list as a blank disc nobody can
 * filter to.
 */
export const notificationTopicSchema = z.enum([
  'steps',
  'workout',
  'streak',
  'hydration',
  'coins',
  'challenge',
  'reward',
  'health',
  'system',
]);
export type NotificationTopic = z.infer<typeof notificationTopicSchema>;

/**
 * The three groups the notification filter offers, "All" aside.
 *
 * Derived from the topic rather than stored next to it — see
 * `NOTIFICATION_CATEGORY` in the notifications store. A row free to claim it
 * was a coin award filed under System would be unexplainable on screen and
 * invisible in a fixture until someone read the counts.
 */
export const notificationCategorySchema = z.enum([
  'activity',
  'reward',
  'system',
]);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

/**
 * `AppNotification` rather than `Notification`: the DOM lib defines a type of
 * that name, and a screen importing the wrong one would still compile.
 */
export const appNotificationSchema = z.object({
  id: z.string(),
  topic: notificationTopicSchema,
  title: z.string(),
  /** A sentence or two. The row gives it two lines and truncates past that. */
  message: z.string(),
  /** ISO-8601. Drives both the day heading and the clock time on the row. */
  createdAt: z.string(),
  read: z.boolean().default(false),
});
export type AppNotification = z.infer<typeof appNotificationSchema>;

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable().default(null),
  heightCm: z.number().positive().nullable().default(null),
  weightKg: z.number().positive().nullable().default(null),
  dateOfBirth: z.string().nullable().default(null),
  /** E.164, dial code included. Null until the user verifies a number. */
  phone: z.string().nullable().default(null),
  /**
   * When the user finished onboarding, or null while they still owe us the
   * details sign-up does not ask for. Server-set rather than inferred from
   * whether the fields happen to be filled: a user who genuinely leaves their
   * weight blank would otherwise be sent back through onboarding forever.
   */
  profileCompletedAt: z.string().nullable().default(null),
  gender: genderSchema.nullable().default(null),
  goal: fitnessGoalSchema.default('stay_active'),
  activityLevel: activityLevelSchema.default('moderate'),
  units: unitSystemSchema.default('metric'),
  /** Consecutive days with a completed workout. */
  streakDays: z.number().int().nonnegative().default(0),
  weeklyGoalWorkouts: z.number().int().positive().default(4),
});
export type User = z.infer<typeof userSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Epoch milliseconds. */
  expiresAt: z.number(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

/**
 * What sign-up returns instead of a session: the number is not yet proven to
 * belong to whoever filled the form, so no tokens are issued until the code
 * comes back. `verificationId` is the handle for that half-finished sign-up —
 * the code alone is six digits and guessable, so it is never the only thing
 * identifying the attempt.
 */
export const verificationChallengeSchema = z.object({
  verificationId: z.string(),
  /** E.164, echoed back so the screen shows the number the server will text. */
  phone: z.string(),
  codeLength: z.number().int().positive().default(6),
  /** How long the code stays valid. */
  expiresInSeconds: z.number().int().nonnegative(),
  /** How long before another code may be requested. */
  resendInSeconds: z.number().int().nonnegative(),
});
export type VerificationChallenge = z.infer<typeof verificationChallengeSchema>;

export const authResponseSchema = z.object({
  user: userSchema,
  tokens: authTokensSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
