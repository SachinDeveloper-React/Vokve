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

/**
 * Where a day's steps came from. `device` is the phone's own step sensor,
 * counted by the app; the other two are a health store another app or a
 * watch wrote to.
 */
export const activitySourceSchema = z.enum([
  'device',
  'health_connect',
  'healthkit',
  'manual',
]);
export type ActivitySource = z.infer<typeof activitySourceSchema>;

export const dailyActivitySchema = z.object({
  /** ISO date, `YYYY-MM-DD`. */
  date: z.string(),
  steps: z.number().int().nonnegative().default(0),
  /** Steps that passed provenance + plausibility and may earn coins. */
  verifiedSteps: z.number().int().nonnegative().default(0),
  distanceKm: z.number().nonnegative().default(0),
  activeMinutes: z.number().int().nonnegative().default(0),
  caloriesBurned: z.number().nonnegative().default(0),
  workoutsCompleted: z.number().int().nonnegative().default(0),
  source: activitySourceSchema.nullable().default(null),
  verified: z.boolean().default(false),
});
export type DailyActivity = z.infer<typeof dailyActivitySchema>;

/**
 * `POST /activity/ingest/nonce`: the value the next signed step snapshot
 * carries inside what it signs, so a snapshot cannot be sent twice. Single
 * use, and short-lived — taken right before the snapshot, never stored.
 */
export const ingestNonceSchema = z.object({
  nonce: z.string().min(1).max(512),
  /** ISO-8601. */
  expiresAt: z.string(),
});
export type IngestNonce = z.infer<typeof ingestNonceSchema>;

/** `POST /activity/ingest`: the day as the server holds it once the snapshot is in. */
export const stepIngestResultSchema = z.object({
  day: dailyActivitySchema,
  /** The server already had this exact snapshot; the answer is the first one's. */
  duplicate: z.boolean().default(false),
  /** Step coins this snapshot put in escrow. 0 while step coins are off. */
  coinsHeld: z.number().nonnegative().default(0),
  /** ISO-8601: when those coins are due out of escrow, or null. */
  releaseAfter: z.string().nullable().default(null),
  /** This snapshot took the day to the step goal and earned it for the streak. */
  streakEarned: z.boolean().default(false),
});
export type StepIngestResult = z.infer<typeof stepIngestResultSchema>;

/**
 * `GET /activity/config`: how the phone's step tracker is set up and when it
 * syncs — the server's to change without a release. The record types are
 * only those the app's manifest declares: a type the app has not declared
 * would make Health Connect refuse the whole permission sheet.
 */
export const activityConfigSchema = z.object({
  tracker: z.object({
    healthConnectReadTypes: z.array(z.enum(['steps', 'distance'])).min(1),
    /** The phone's own steps written into Health Connect (D-57). */
    healthConnectWriteEnabled: z.boolean(),
    /** A record per minute with steps, or one per day. */
    healthConnectWriteGranularity: z.enum(['day', 'minute']).catch('day'),
    healthConnectIgnoreManualEntries: z.boolean(),
    wearableTrust: z.enum(['metadata', 'catalog']).catch('catalog'),
    /** Apps trusted as a watch's relay on top of the tracker's own catalog. */
    wearableAllowlist: z.array(z.string()).default([]),
    gapRecovery: z.enum(['split', 'today', 'today_capped', 'drop']).catch('split'),
    historyRetentionDays: z.number().int().positive(),
    motionWindowRetention: z.number().int().positive(),
    fraudDetection: z.object({
      enabled: z.boolean(),
      mode: z.enum(['flag', 'exclude']).catch('flag'),
    }),
    motionSampling: z.object({
      enabled: z.boolean(),
      windowSeconds: z.number().int().positive(),
      intervalMinutes: z.number().int().positive(),
    }),
    /** Where Health Connect sends someone who asks why the app wants their steps. */
    privacyPolicyUrl: z.string(),
  }),
  sync: z.object({
    /** Minutes between syncs of today while the app is open. */
    intervalMinutes: z.number().positive(),
    /** The least seconds between two syncs of today nobody asked for. */
    minGapSeconds: z.number().nonnegative(),
    /** How many days back the server still takes. */
    maxAgeDays: z.number().int().positive(),
    /** The evidence each signed snapshot carries. */
    include: z.array(
      z.enum(['minutes', 'motionWindows', 'healthConnectRecords']),
    ),
    healthConnectRecordTypes: z.array(z.enum(['steps', 'distance'])),
  }),
  playIntegrity: z.object({
    /** Null while the server asks for no Play Integrity verdicts. */
    cloudProjectNumber: z.number().int().positive().nullable(),
  }),
});
export type ActivityConfig = z.infer<typeof activityConfigSchema>;

/**
 * `hour` is one day's 24 hours; `day` one point a day; `week` consecutive
 * seven-day blocks counted from `from` — from the 1st of a month, W1 to
 * W5; `month` calendar months.
 */
export const activityGranularitySchema = z.enum([
  'hour',
  'day',
  'week',
  'month',
]);
export type ActivityGranularity = z.infer<typeof activityGranularitySchema>;

export const activityRangePointSchema = z.object({
  /** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:00` for an hour — local, inclusive. */
  start: z.string(),
  /** Inclusive, in the same form. */
  end: z.string(),
  steps: z.number().int().nonnegative(),
  verifiedSteps: z.number().int().nonnegative(),
});
export type ActivityRangePoint = z.infer<typeof activityRangePointSchema>;

/** `GET /activity/range`: a period's steps at one grain, with its totals. */
export const activityRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  granularity: activityGranularitySchema,
  points: z.array(activityRangePointSchema),
  totals: z.object({
    steps: z.number().int().nonnegative(),
    verifiedSteps: z.number().int().nonnegative(),
    distanceKm: z.number().nonnegative(),
    caloriesBurned: z.number().nonnegative(),
    activeMinutes: z.number().int().nonnegative(),
    /** Days with at least one step. */
    activeDays: z.number().int().nonnegative(),
  }),
  /** The day with the most steps in the range; null when none had any. */
  best: z
    .object({ date: z.string(), steps: z.number().int().nonnegative() })
    .nullable(),
});
export type ActivityRange = z.infer<typeof activityRangeSchema>;

/**
 * `GET /activity/goal`: the daily step goal — the user's own, the one the
 * server suggests, and the range a goal may be set in (D-55). The goal is
 * saved through `PUT /me/settings`, like every other setting.
 */
export const stepGoalSchema = z.object({
  /** The goal now, as `/me/settings` holds it. */
  goal: z.number().int().positive(),
  /**
   * The suggestion: a stretch past what the user walks now, up to where the
   * benefit levels off for their age and BMI — inside the range, on its
   * increment.
   */
  recommended: z.number().int().positive(),
  /** What the suggestion could be worked out from. */
  basedOn: z.object({
    /** There was a date of birth. */
    age: z.boolean(),
    /** There were a height and a weight. */
    bmi: z.boolean(),
    /** Enough recent days with steps; without them the profile's activity level stood in. */
    recentSteps: z.boolean(),
  }),
  /** The range a goal may be set in, and the step the screen moves by (⚙ `activity.goal`). */
  min: z.number().int().positive(),
  max: z.number().int().positive(),
  increment: z.number().int().positive(),
  /** ISO-8601: when the user last chose a goal; null while it is the one every account starts on. */
  chosenAt: z.string().nullable(),
});
export type StepGoal = z.infer<typeof stepGoalSchema>;

/**
 * What became of one Health Connect source on one phone's day:
 * `used` — it answered for the day; `lower` — trusted, and something else
 * counted more; `not_counted` — far above what the phone itself saw;
 * `unverified` — an app the server does not trust, shown but never paid;
 * `blocked` — known to fabricate steps; `not_computed` — typed-in steps
 * could not be told apart.
 */
export const stepSourceStatusSchema = z.enum([
  'used',
  'lower',
  'not_counted',
  'unverified',
  'blocked',
  'not_computed',
]);
export type StepSourceStatus = z.infer<typeof stepSourceStatusSchema>;

export const stepSourceRowSchema = z.object({
  packageName: z.string(),
  appName: z.string(),
  /** `watch`, `fitness_band`, `ring`, `phone`, `app`… — what wrote it. */
  kind: z.string(),
  isWearable: z.boolean(),
  /** Android's own step count, kept by Health Connect. */
  isPlatform: z.boolean(),
  /** Everything the app wrote for the day. */
  steps: z.number().int().nonnegative(),
  /** Typed in by hand; null when it could not be told apart. */
  manualSteps: z.number().int().nonnegative().nullable(),
  /** What could count, once typed-in steps are taken out. */
  countable: z.number().int().nonnegative().nullable(),
  /** `countable` against the phone's own count. */
  ratioToPhone: z.number().nonnegative().nullable(),
  status: stepSourceStatusSchema,
  /** One line on why, from the server. */
  note: z.string(),
});
export type StepSourceRow = z.infer<typeof stepSourceRowSchema>;

export const stepSourceDeviceSchema = z.object({
  deviceId: z.string(),
  /** "Pixel 8" — the phone as its maker names it. */
  name: z.string(),
  /** The phone asking. */
  isCurrent: z.boolean(),
  /** This phone's count is the one the day was decided on. */
  answeredForDay: z.boolean(),
  /** ISO-8601: when the server last heard from it about this day. */
  syncedAt: z.string().nullable(),
  /** The phone's own sensor, and what was taken off it before it competed. */
  phone: z.object({
    counted: z.number().int().nonnegative(),
    /** Credited in one go after the phone had stopped counting. */
    recovered: z.number().int().nonnegative(),
    /** Flagged by the phone's own checks. */
    flagged: z.number().int().nonnegative(),
    clean: z.number().int().nonnegative(),
  }),
  /** The best count this phone's evidence supports. */
  counted: z.number().int().nonnegative(),
  source: activitySourceSchema,
  verified: z.boolean(),
  /** One line on how Health Connect was read, or null when it was. */
  sourcesNote: z.string().nullable(),
  sources: z.array(stepSourceRowSchema),
  proof: z.object({
    /** The signing key was vouched for by the phone's secure hardware. */
    keyAttested: z.boolean().nullable(),
    /** Locked bootloader and the maker's own OS. */
    bootVerified: z.boolean().nullable(),
    /** The last Play Integrity verdict: `pass`, `fail`, `unavailable`… */
    playIntegrity: z.string().nullable(),
  }),
});
export type StepSourceDevice = z.infer<typeof stepSourceDeviceSchema>;

/**
 * `GET /activity/sources?date=`: where a day's steps came from and how the
 * server matched them — every phone, every Health Connect app, the raw
 * records it holds, and each upload. `checks` is the fraud layers' own view,
 * and only present where the server chooses to show it.
 */
export const stepSourcesReportSchema = z.object({
  date: z.string(),
  /** ISO-8601: when the day was last judged; null before its first upload. */
  scoredAt: z.string().nullable(),
  day: dailyActivitySchema,
  /** How the day's figure was reached, in plain words, from the server. */
  explanation: z.array(z.string()),
  devices: z.array(stepSourceDeviceSchema),
  /** The raw Health Connect records the server holds for the day, by app. */
  records: z.array(
    z.object({
      packageName: z.string(),
      appName: z.string(),
      records: z.number().int().nonnegative(),
      steps: z.number().int().nonnegative(),
      manualSteps: z.number().int().nonnegative(),
      unknownMethodSteps: z.number().int().nonnegative(),
    }),
  ),
  /** The day's uploads, newest first. */
  uploads: z.array(
    z.object({
      at: z.string(),
      deviceName: z.string(),
      phoneSteps: z.number().int().nonnegative(),
      shownSteps: z.number().int().nonnegative(),
      playIntegrity: z.string().nullable(),
    }),
  ),
  checks: z
    .object({
      plausibility: z.number().nullable(),
      layers: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          score: z.number().nullable(),
        }),
      ),
      flags: z.array(
        z.object({
          kind: z.string(),
          layer: z.string(),
          severity: z.enum(['hard', 'soft', 'info']).catch('info'),
          message: z.string(),
        }),
      ),
    })
    .nullable(),
});
export type StepSourcesReport = z.infer<typeof stepSourcesReportSchema>;

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
   *
   * Decimal to three places (D-27): the server stores integer milli-coins and
   * exposes coins, so 0.095 per 100 steps is exact.
   */
  amount: z.number(),
  /** ISO-8601. */
  createdAt: z.string(),
});
export type CoinTransaction = z.infer<typeof coinTransactionSchema>;

/**
 * The four shelves of the shop (RULES R9): what you wear, what you train
 * with, what you play with, and the small things that go with any of them.
 * A closed enum — a new shelf ships behind a client release.
 */
export const shopCategorySchema = z.enum([
  'clothing',
  'gym',
  'sports',
  'accessories',
]);
export type ShopCategory = z.infer<typeof shopCategorySchema>;

/** How a catalogue list may be ordered. `popular` is the default everywhere. */
export const shopSortSchema = z.enum([
  'popular',
  'price_asc',
  'price_desc',
  'newest',
  'rating',
]);
export type ShopSort = z.infer<typeof shopSortSchema>;

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

/** The star average and how many stars it rests on, as the catalogue carries them. */
export const ratingSummarySchema = z.object({
  /** 0 with no reviews; otherwise 1–5 to one decimal. */
  average: z.number().min(0).max(5),
  count: z.number().int().nonnegative(),
});
export type RatingSummary = z.infer<typeof ratingSummarySchema>;

/**
 * A colour an item comes in. The name is what a line and an order record
 * and what the packer reads; the hex only draws the swatch.
 */
export const shopColorSchema = z.object({
  name: z.string().min(1).max(24),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type ShopColor = z.infer<typeof shopColorSchema>;

/**
 * The glyph a fact about an item is drawn with. Closed so each has its own
 * icon on the page; a key this build does not know falls back to `info`
 * rather than failing the whole item.
 */
export const shopSpecIconSchema = z
  .enum([
    'category',
    'fabric',
    'material',
    'care',
    'fit',
    'sizes',
    'weight',
    'dimensions',
    'capacity',
    'warranty',
    'info',
  ])
  .catch('info');
export type ShopSpecIcon = z.infer<typeof shopSpecIconSchema>;

/** One labelled fact about an item: "Fabric · Dry Fit Polyester". */
export const shopSpecSchema = z.object({
  icon: shopSpecIconSchema,
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(80),
});
export type ShopSpec = z.infer<typeof shopSpecSchema>;

/** The glyph a key feature is drawn with; unknown keys fall back to `check`. */
export const shopFeatureIconSchema = z
  .enum([
    'breathable',
    'lightweight',
    'stretch',
    'durable',
    'quick_dry',
    'grip',
    'cushioned',
    'waterproof',
    'insulated',
    'check',
  ])
  .catch('check');
export type ShopFeatureIcon = z.infer<typeof shopFeatureIconSchema>;

/** A selling point under "Key Features": a word, and a line under it. */
export const shopFeatureSchema = z.object({
  icon: shopFeatureIconSchema,
  title: z.string().min(1).max(24),
  caption: z.string().max(60).default(''),
});
export type ShopFeature = z.infer<typeof shopFeatureSchema>;

/**
 * How the shop takes payment (RULES R11), the server's call: coins alone,
 * money alone, or a split between them. A mode this build does not know
 * is drawn as a split, which shows both.
 */
export const paymentModeSchema = z
  .enum(['coins', 'money', 'mixed'])
  .catch('mixed');
export type PaymentMode = z.infer<typeof paymentModeSchema>;

/**
 * How an order's money is taken (RULES R12), and what the payment page
 * lists. `coins` takes the whole bill from the wallet; `coins_upi` takes
 * what coins the order allows and collects the rest through the gateway;
 * the other three are the gateway alone and name the tab its checkout
 * opens on, so a member who came to pay by UPI is not shown cards first.
 */
export const paymentMethodSchema = z.enum([
  'coins',
  'coins_upi',
  'upi',
  'card',
  'netbanking',
]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const shopItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  /** The selling price, in paise (RULES R1, R11). */
  price: z.number().int().positive(),
  /** The list price it is struck through against, in paise; null when there is no discount. */
  mrp: z.number().int().positive().nullable().default(null),
  currency: z.string().length(3).default('INR'),
  /**
   * The most coins that may go towards one unit of this item (⚙
   * `commerce.coinShareMax` of the price, at ⚙ `commerce.coinValuePaise`
   * each) — what the card means by "or ₹349 + 150 coins". Computed by the
   * server so a share change is live on the next fetch. In a coins-only
   * shop it is the whole price in coins; in a money-only one, 0.
   */
  coinsMax: z.number().int().nonnegative(),
  /** The least coins one unit must take (⚙ `commerce.coinShareMin`); 0 when coins are optional. */
  coinsMin: z.number().int().nonnegative().default(0),
  /**
   * What one unit costs in coins alone: the price at ⚙
   * `commerce.coinValuePaise` a coin, rounded up. The price a coins-only
   * shop shows.
   */
  coinPrice: z.number().int().nonnegative().default(0),
  /**
   * How this item may be bought (RULES R11): `coins` takes coins alone,
   * `money` takes no coins at all, and `mixed` takes the shop's share of
   * each. Resolved by the server — an item's own setting, or the shop's
   * ⚙ `commerce.paymentMode` where it has none — so the card, the basket
   * and the till all read one answer.
   */
  paymentMode: paymentModeSchema.default('mixed'),
  category: shopCategorySchema,
  /** Stands in for product art until the catalogue ships real images. */
  emoji: z.string().default('🎁'),
  /** Null when the item carries no flag. */
  badge: shopBadgeSchema.nullable().default(null),
  /** Surfaces the item under the shop's "Deals" filter. */
  isDeal: z.boolean().default(false),
  inStock: z.boolean().default(true),
  /** On the home shelf. A catalogue flag like `isDeal`, not a category. */
  featured: z.boolean().default(false),
  /**
   * A finer grouping inside the category — "T-shirts", "Rackets" — for the
   * chips on a category page. Null where the category is grouping enough.
   */
  subcategory: z.string().nullable().default(null),
  /** Search words the title does not carry: "tee", "vest", "rope". */
  tags: z.array(z.string()).default([]),
  /** The sizes it comes in — clothes, mostly. Empty when it comes in one. */
  sizes: z.array(z.string()).default([]),
  rating: ratingSummarySchema,
  /**
   * Product photos, the cover first. Empty until the catalogue has them;
   * the page draws `emoji` in their place.
   */
  images: z.array(z.string().min(1)).default([]),
  /** A short line on a chip by the title — "Premium Quality". Null for none. */
  ribbon: z.string().max(32).nullable().default(null),
  /**
   * The colours it comes in; empty when it comes in one. A line names the
   * one chosen, the way it names a size.
   */
  colors: z.array(shopColorSchema).default([]),
  /** The fact or two that sit by the price: a tee's fabric, a kettlebell's weight. */
  highlights: z.array(shopSpecSchema).default([]),
  /** "Key Features": a few selling points, each with its own glyph. */
  features: z.array(shopFeatureSchema).default([]),
  /** "Product Information": the remaining facts, in the catalogue's order. */
  specs: z.array(shopSpecSchema).default([]),
});
export type ShopItem = z.infer<typeof shopItemSchema>;

/** `GET /shop/categories`: what each shelf holds, for tiles and filters. */
export const shopCategorySummarySchema = z.object({
  category: shopCategorySchema,
  /** Every active item on the shelf. */
  count: z.number().int().nonnegative(),
  /** Of those, the ones that can be redeemed right now. */
  inStock: z.number().int().nonnegative(),
  /** The shelf's subcategories, with counts, in catalogue order. */
  subcategories: z.array(
    z.object({ name: z.string(), count: z.number().int().nonnegative() }),
  ),
});
export type ShopCategorySummary = z.infer<typeof shopCategorySummarySchema>;

/**
 * `GET /shop/config`: the till's rules, so the app can draw a price split
 * and a shipping line before asking for a quote. Every value is a ⚙ the
 * server owns (RULES R11–R13); the app never hardcodes one.
 */
export const shopConfigSchema = z.object({
  currency: z.string().length(3),
  /** What one coin is worth at checkout, in paise. */
  coinValuePaise: z.number().int().positive(),
  /** How orders are paid; the two shares say what that means in practice. */
  paymentMode: paymentModeSchema.default('mixed'),
  /** The least of the goods coins must cover: 0 lets the member choose; 1 in a coins-only shop. */
  coinShareMin: z.number().min(0).max(1).default(0),
  /** The most of the goods total that coins may cover: 0.3 is 30%, 1 is all of it. */
  coinShareMax: z.number().min(0).max(1),
  shippingFeePaise: z.number().int().nonnegative(),
  /** Goods at or above this ship free; null means shipping is always charged. */
  freeShippingAbovePaise: z.number().int().nonnegative().nullable(),
  maxQuantityPerLine: z.number().int().positive(),
  /** Who collects the money; `mock` captures at once and exists only outside production. */
  paymentProvider: z.enum(['mock', 'razorpay']),
  /** The gateway's public key, for the app to open its checkout with; null for the mock. */
  paymentKeyId: z.string().nullable(),
  /**
   * The ways this shop takes money, in the order the payment page lists
   * them (⚙ `commerce.paymentMethods`, narrowed to what the mode and the
   * gateway actually allow). Empty is a shop that cannot be paid.
   */
  paymentMethods: z.array(paymentMethodSchema).default([]),
  /** Coins at or above this in one order ask for a code first (RULES O8). */
  stepUpThreshold: z.number().nonnegative(),
  /** How long delivery takes, as the product page words it. Null hides the row. */
  deliveryEstimate: z.string().max(60).nullable().default(null),
  /** The returns promise in one line, as the product page words it. Null hides the row. */
  returnPolicy: z.string().max(80).nullable().default(null),
  /** Whether the basket offers a coupon box (RULES R16). */
  couponsEnabled: z.boolean().default(false),
  /** The line under the delivery preferences — what the courier may do. Null hides it. */
  deliveryNotice: z.string().max(140).nullable().default(null),
  /**
   * Whether the shipping page offers "Notify me on WhatsApp" — only where
   * the server can actually deliver WhatsApp messages (RULES R17).
   */
  offersWhatsAppUpdates: z.boolean().default(false),
});
export type ShopConfig = z.infer<typeof shopConfigSchema>;

/** One thing in a basket or an order: which item, how many, which size and colour. */
export const purchaseLineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
  /** One of the item's `sizes`, or null for an item that comes in one. */
  size: z.string().max(12).nullable().default(null),
  /** One of the item's `colors` by name, or null for an item that comes in one. */
  color: z.string().max(24).nullable().default(null),
});
export type PurchaseLine = z.infer<typeof purchaseLineSchema>;

/**
 * A coupon on a basket, a quote or an order (RULES R16): the code, its name
 * as the member reads it, and what it takes off the goods in paise.
 */
export const appliedCouponSchema = z.object({
  code: z.string(),
  title: z.string(),
  /** Paise off the goods; 0 while `problem` stands. */
  discount: z.number().int().nonnegative(),
  /**
   * Why it takes nothing off right now — "Add ₹200 more to use FIT50" — or
   * null when it applies. A basket keeps a coupon that stopped applying, so
   * it comes back when the basket qualifies again.
   */
  problem: z.string().nullable().default(null),
});
export type AppliedCoupon = z.infer<typeof appliedCouponSchema>;

/** An order in coins alone, row by row — what a coins-only shop draws. */
export const coinTotalsSchema = z.object({
  /** The goods at their coin prices. */
  goods: z.number().int().nonnegative(),
  /** The coupon, in coins. */
  discount: z.number().int().nonnegative(),
  shipping: z.number().int().nonnegative(),
  /** Goods less the coupon, plus shipping: what the order takes. */
  total: z.number().int().nonnegative(),
});
export type CoinTotals = z.infer<typeof coinTotalsSchema>;

/**
 * The till's arithmetic for a set of lines (RULES R11–R13), every figure in
 * paise except the coins. The app draws this and never re-derives it: the
 * split between money and coins is the server's call, and a client that
 * summed its own would be one config change away from showing the wrong
 * total.
 */
export const quoteSchema = z.object({
  currency: z.string().length(3),
  lines: z.array(
    z.object({
      itemId: z.string(),
      title: z.string(),
      emoji: z.string(),
      /** The item's first picture, for the till's item rows; null falls back to the emoji. */
      image: z.string().nullable().default(null),
      quantity: z.number().int().positive(),
      size: z.string().nullable(),
      color: z.string().nullable().default(null),
      /** Per unit, in paise. */
      price: z.number().int().positive(),
      mrp: z.number().int().positive().nullable(),
      lineTotal: z.number().int().positive(),
      /** One unit, and the line, in coins alone — what a coins-only shop shows. */
      coinPrice: z.number().int().nonnegative().default(0),
      lineCoins: z.number().int().nonnegative().default(0),
      /**
       * How this line is actually being paid for, at `coinsApplied`
       * (RULES R11): the coins that go to it, what they are worth in
       * paise, and the money left on its goods. The server splits it —
       * the app never divides a total by hand — so a member, and support,
       * can see what each product cost in each currency.
       *
       * Delivery belongs to the order, not to a line, so these cover the
       * goods alone; `payable` remains the order's money figure.
       */
      coinsUsed: z.number().int().nonnegative().default(0),
      coinsValue: z.number().int().nonnegative().default(0),
      moneyPaid: z.number().int().nonnegative().default(0),
      /** How this line may be bought — its item's own mode (RULES R11). */
      paymentMode: paymentModeSchema.default('mixed'),
      inStock: z.boolean(),
    }),
  ),
  /** How this order is paid (⚙ `commerce.paymentMode`). */
  paymentMode: paymentModeSchema.default('mixed'),
  /** The lines at list price, before any discount. */
  mrpTotal: z.number().int().nonnegative(),
  /** How much the selling prices are under the list prices. */
  discount: z.number().int().nonnegative(),
  /** The goods at selling price. */
  subtotal: z.number().int().nonnegative(),
  /** The coupon asked for, and what it takes off the goods; null for none. */
  coupon: appliedCouponSchema.nullable().default(null),
  shipping: z.number().int().nonnegative(),
  /** The goods less the coupon, plus shipping, before coins. */
  total: z.number().int().nonnegative(),
  /** What one coin is worth here, in paise. */
  coinValuePaise: z.number().int().positive(),
  /** The most coins this order may take: the share cap, then the wallet. */
  coinsMax: z.number().int().nonnegative(),
  /**
   * The least coins this order must take: the share floor, and in a
   * coins-only shop all of it. Not clamped to the wallet — see `coinsShort`.
   */
  coinsMin: z.number().int().nonnegative().default(0),
  /** How many coins the wallet lacks for `coinsMin`; above 0, the order cannot be placed. */
  coinsShort: z.number().int().nonnegative().default(0),
  /** The coins the quote was asked for, kept between `coinsMin` and `coinsMax`. */
  coinsApplied: z.number().int().nonnegative(),
  /** What those coins are worth, in paise. */
  coinsValue: z.number().int().nonnegative(),
  /** What is left to pay in money. Zero means no payment step. */
  payable: z.number().int().nonnegative(),
  /**
   * The ways this order can be paid (RULES R12): the shop's menu, kept to
   * the ones its sums allow. The payment page lists exactly these — an
   * order of coins-only goods offers nothing but `coins`.
   */
  paymentMethods: z.array(paymentMethodSchema).default([]),
  /** The order in coins alone, row by row, in a coins-only shop; null otherwise. */
  inCoins: coinTotalsSchema.nullable().default(null),
});
export type Quote = z.infer<typeof quoteSchema>;

/** A basket line with the item it points at, as the cart screen draws it. */
export const cartLineSchema = z.object({
  item: shopItemSchema,
  quantity: z.number().int().positive(),
  size: z.string().nullable(),
  color: z.string().nullable().default(null),
  /** ISO-8601. */
  addedAt: z.string(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

/**
 * The basket (RULES R14): the lines with their items, and a quote for them
 * at the most coins the wallet allows, so the cart can show what checking
 * out would cost before the checkout is opened.
 */
export const cartSchema = z.object({
  lines: z.array(cartLineSchema),
  /** Units across every line — the badge on the cart icon. */
  count: z.number().int().nonnegative(),
  quote: quoteSchema,
});
export type Cart = z.infer<typeof cartSchema>;

/** A review as the product page shows it (RULES R15). */
export const reviewSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  /** 1–5. */
  rating: z.number().int().min(1).max(5),
  title: z.string().max(80).nullable().default(null),
  body: z.string().min(1).max(1000),
  /** The reviewer's first name, or "A VOKVE member" — never the account itself. */
  authorName: z.string(),
  /** They bought it here: an order of theirs holds the item. */
  verified: z.boolean(),
  /** The reader wrote this one — it gets an Edit rather than a byline. */
  mine: z.boolean(),
  /** ISO-8601. */
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;

export const reviewSummarySchema = ratingSummarySchema.extend({
  /** How many reviews gave one star, two, … five — in that order. */
  histogram: z.array(z.number().int().nonnegative()).length(5),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

/** `GET /shop/items/:id/reviews`: a page, the totals, and the reader's own if there is one. */
export const reviewPageSchema = z.object({
  data: z.array(reviewSchema),
  nextCursor: z.string().nullable(),
  summary: reviewSummarySchema,
  mine: reviewSchema.nullable(),
});
export type ReviewPage = z.infer<typeof reviewPageSchema>;

/**
 * Where a reward is sent (RULES R4). Indian addressing — a state and a
 * six-digit PIN — because that is where the shop ships; `country` is carried
 * so the form can grow without a migration. Soft-deleted rather than removed:
 * an order keeps a snapshot, but the row it came from should still resolve.
 */
export const addressSchema = z.object({
  id: z.string(),
  /** "Home", "Office" — what the picker shows first. */
  label: z.string().min(1).max(30),
  name: z.string().min(1).max(80),
  /** E.164, for the courier. */
  phone: z.string().min(8).max(20),
  line1: z.string().min(1).max(120),
  line2: z.string().max(120).default(''),
  city: z.string().min(1).max(60),
  state: z.string().min(1).max(60),
  postalCode: z.string().min(3).max(12),
  country: z.string().length(2).default('IN'),
  isDefault: z.boolean().default(false),
});
export type Address = z.infer<typeof addressSchema>;

/**
 * An order's life (RULES R5): `pending_payment → placed → confirmed →
 * shipped → delivered`; `pending_payment | placed | confirmed → cancelled`;
 * `delivered → refunded` by an admin. An order that needs no money —
 * coins covered it — is born `placed`. Closed, like every enum: a new
 * state ships behind a client release.
 */
export const orderStatusSchema = z.enum([
  'pending_payment',
  'placed',
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/**
 * How a member wants an order handed over (RULES R17): a line for the
 * courier, and two switches. Kept as the member's defaults
 * (`GET/PUT /me/delivery-preferences`) and copied onto every order.
 */
export const deliveryPreferencesSchema = z.object({
  /** For the courier — "Leave at the gate". Empty for none. */
  instructions: z.string().max(120).default(''),
  /** Updates on the order by WhatsApp, to the account's phone. */
  whatsappUpdates: z.boolean().default(false),
  /** The courier may leave it at the door rather than hand it over. */
  leaveAtDoor: z.boolean().default(false),
});
export type DeliveryPreferences = z.infer<typeof deliveryPreferencesSchema>;

export const orderItemSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  emoji: z.string().default('🎁'),
  /** The item's picture as it was; null falls back to the emoji. */
  image: z.string().nullable().default(null),
  /** What one unit cost in coins alone — what a coins order's rows read. */
  coinPrice: z.number().int().nonnegative().default(0),
  quantity: z.number().int().positive(),
  size: z.string().nullable().default(null),
  color: z.string().nullable().default(null),
  /** Per unit, in paise, at the time of the order — a later price change does not rewrite history. */
  price: z.number().int().positive(),
  mrp: z.number().int().positive().nullable().default(null),
  /**
   * What this line was actually paid with (RULES R11), snapshotted when
   * the order was placed: the coins that went to it, what they were worth
   * in paise, and the money on its goods. The three are the answer to
   * "what did this product cost me", which an order-level total cannot
   * give for a basket of several things.
   *
   * Delivery is the order's, not a line's: in a coins-only order the
   * delivery coins are `inCoins.shipping`, and in any other the delivery
   * money is `shipping`.
   */
  coinsUsed: z.number().int().nonnegative().default(0),
  coinsValue: z.number().int().nonnegative().default(0),
  moneyPaid: z.number().int().nonnegative().default(0),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

/** Where the money stands (RULES R12). */
export const paymentStatusSchema = z.enum([
  /** Coins covered the whole order; there was nothing to collect. */
  'not_required',
  'pending',
  'paid',
  'failed',
  /** The money was sent back after a cancellation. */
  'refunded',
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const orderPaymentSchema = z.object({
  provider: z.enum(['mock', 'razorpay']).nullable(),
  /** What the member chose to pay it with; null on orders placed before the page existed. */
  method: paymentMethodSchema.nullable().default(null),
  status: paymentStatusSchema,
  /** In paise — what the gateway was asked to collect. */
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  /** The gateway's own order id, for the app to open its checkout with. */
  providerOrderId: z.string().nullable(),
  /** ISO-8601, once captured. */
  paidAt: z.string().nullable(),
  /** ISO-8601: an unpaid order is released after this (⚙ `commerce.paymentWindowMinutes`). */
  expiresAt: z.string().nullable(),
});
export type OrderPayment = z.infer<typeof orderPaymentSchema>;

/** When the courier should have it, as the order promised at the time. */
export const deliveryWindowSchema = z.object({
  /** ISO-8601 dates, both ends inclusive — "23 – 26 Sep". */
  from: z.string(),
  to: z.string(),
});
export type DeliveryWindow = z.infer<typeof deliveryWindowSchema>;

/** Where an order's news is sent, as the server can actually send it. */
export const trackingChannelSchema = z.enum(['email', 'sms', 'whatsapp']);
export type TrackingChannel = z.infer<typeof trackingChannelSchema>;

/**
 * One stop on an order's journey, as the order page's timeline draws it
 * (RULES R5): the state it stands for, what the member reads, and when it
 * happened — null for a stop still ahead.
 *
 * The server keeps every transition as an event on the order, so this is
 * the only place the app can learn *when* a parcel was packed. A stop with
 * no time yet is still listed, because a timeline that showed only what
 * has happened would never say what is left.
 */
export const orderTimelineEntrySchema = z.object({
  status: orderStatusSchema,
  /** "Packed", not "confirmed": the warehouse word, not ours. */
  title: z.string(),
  /** ISO-8601 of the moment it happened; null for a stop still ahead. */
  at: z.string().nullable(),
  /** Whether the order has made this stop. */
  done: z.boolean(),
});
export type OrderTimelineEntry = z.infer<typeof orderTimelineEntrySchema>;

/**
 * What may still be sent back, and by when (⚙ `commerce.returnWindowDays`).
 * It is a promise, so it is the server's to make and the app only reads it;
 * null where the shop takes no returns.
 */
export const orderReturnsSchema = z.object({
  /** Whether this order is still inside its window. */
  eligible: z.boolean(),
  windowDays: z.number().int().nonnegative(),
  /** ISO-8601 of the last day it may be sent back; null until it is delivered. */
  until: z.string().nullable().default(null),
  /** The promise in one line — "Easy returns within 7 days (as per policy)." */
  note: z.string(),
});
export type OrderReturns = z.infer<typeof orderReturnsSchema>;

/**
 * The tabs the orders list is read through. A grouping, not a state:
 * `processing` is everything between placed and packed, and `cancelled`
 * holds refunds too, because a member looking for an order that never
 * arrived looks in one place for it. Closed, like every enum: a new tab
 * ships behind a client release.
 */
export const orderFilterSchema = z.enum([
  'all',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
]);
export type OrderFilter = z.infer<typeof orderFilterSchema>;

export const orderSchema = z.object({
  id: z.string(),
  /**
   * The reference a member reads out to support — `VKV2609191234`. The id
   * is still what everything keys on; this is for human beings.
   */
  number: z.string(),
  status: orderStatusSchema,
  items: z.array(orderItemSchema).min(1),
  currency: z.string().length(3),
  /** The goods at selling price, in paise. */
  subtotal: z.number().int().nonnegative(),
  /** How far under list price the goods were, in paise. */
  discount: z.number().int().nonnegative(),
  shipping: z.number().int().nonnegative(),
  /** The coupon it was placed with; null for none. */
  coupon: appliedCouponSchema.omit({ problem: true }).nullable().default(null),
  /** The goods less the coupon, plus shipping, before coins. */
  total: z.number().int().nonnegative(),
  /** The order in coins alone, when it was placed in a coins-only shop; null otherwise. */
  inCoins: coinTotalsSchema.nullable().default(null),
  /** The coins that went towards it, and what they were worth in paise. */
  coinsUsed: z.number().int().nonnegative(),
  coinsValue: z.number().int().nonnegative(),
  /** The money side, in paise. Zero when coins covered it. */
  payable: z.number().int().nonnegative(),
  payment: orderPaymentSchema,
  /** The address as it was when the order was placed (RULES R4). */
  address: addressSchema.omit({ id: true, isDefault: true }),
  /** How the member asked for it to be handed over; null on orders from before. */
  delivery: deliveryPreferencesSchema.nullable().default(null),
  /** ISO-8601. */
  placedAt: z.string(),
  /** ISO-8601 of the latest state change; equals `placedAt` on a fresh order. */
  updatedAt: z.string(),
  /** When it should arrive, promised when it was placed; null on older orders. */
  estimatedDelivery: deliveryWindowSchema.nullable().default(null),
  /** Where this order's news will be sent — only channels that work. */
  trackingChannels: z.array(trackingChannelSchema).default([]),
  /** Courier reference once shipped; null before. */
  trackingRef: z.string().nullable().default(null),
  /** Where the courier shows the parcel live; null until there is something to show. */
  trackingUrl: z.string().url().nullable().default(null),
  /** Every stop this order has made, and the ones still ahead (RULES R5). */
  timeline: z.array(orderTimelineEntrySchema).default([]),
  /** The line the tracker leads with — "Your order is on the way!". */
  headline: z.string(),
  /** What the returns row promises for this order; null where returns are off. */
  returns: orderReturnsSchema.nullable().default(null),
  /**
   * Whether the delivery address may still be changed (RULES R5). True
   * until the parcel is packed — after that the label is printed and the
   * change would be a promise the warehouse cannot keep.
   */
  addressChangeable: z.boolean().default(false),
  /** Whether the user may still cancel — `pending_payment`, `placed` or `confirmed` (R5). */
  cancellable: z.boolean(),
});
export type Order = z.infer<typeof orderSchema>;

/**
 * What came of buying an order again: the basket as it now stands, how
 * many of the order's lines went back in, and the ones that could not,
 * each with the reason the member is told.
 *
 * A line is skipped rather than the whole thing refused — an order of
 * three things where one has been delisted still puts two in the basket,
 * which is what a member asking for "buy again" wants.
 */
export const reorderResultSchema = z.object({
  cart: cartSchema,
  added: z.number().int().nonnegative(),
  skipped: z.array(z.object({ title: z.string(), reason: z.string() })).default([]),
});
export type ReorderResult = z.infer<typeof reorderResultSchema>;

/**
 * What the app needs to collect the money for an order it just placed: the
 * gateway, its order, the amount, and the public key to open the checkout
 * with. Null on the checkout response when coins covered everything.
 */
export const paymentIntentSchema = z.object({
  provider: z.enum(['mock', 'razorpay']),
  /** The method the member chose, for the gateway's checkout to open on. */
  method: paymentMethodSchema.nullable().default(null),
  orderId: z.string(),
  providerOrderId: z.string(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  keyId: z.string().nullable(),
  /** ISO-8601: pay by then or the order is released. */
  expiresAt: z.string(),
});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

/** `POST /checkout`: the order, the wallet after it, and the payment to collect if any. */
export const checkoutResultSchema = z.object({
  order: orderSchema,
  balance: z.number().nonnegative(),
  payment: paymentIntentSchema.nullable(),
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

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
  /**
   * The last day of the period the progress counts, `YYYY-MM-DD` — today for
   * a daily challenge, Sunday for a weekly one, the month's last day for a
   * monthly one. Null for an upcoming challenge.
   */
  endsOn: z.string().nullable().default(null),
  /**
   * ISO-8601: when this period's goal was reached and the reward recorded,
   * or null while it has not been. The server completes a challenge on its
   * own (RULES C4, D-08 — everyone is enrolled); there is nothing to claim.
   */
  completedAt: z.string().nullable().default(null),
});
export type Challenge = z.infer<typeof challengeSchema>;

export const achievementSchema = z.object({
  id: z.string(),
  /**
   * The figure the badge stands for — 10000, 500, 30. A number (RULES C7):
   * abbreviating it to "10K" for the ring is the app's job.
   */
  value: z.number().nonnegative(),
  /** What it was won for — "10K Steps", "Cal Burner". */
  label: z.string(),
  /** Borrowed from challenges: an achievement is what one pays out. */
  metric: challengeMetricSchema,
  /** ISO-8601, or null while the achievement is still locked. */
  achievedAt: z.string().nullable().default(null),
});
export type Achievement = z.infer<typeof achievementSchema>;

/** Which meal of the day a food entry belongs to. */
export const mealSlotSchema = z.enum([
  'breakfast',
  'lunch',
  'snack',
  'dinner',
]);
export type MealSlot = z.infer<typeof mealSlotSchema>;

/**
 * One line of a planned meal — what to eat and how much of it.
 *
 * The quantity is text rather than a number and a unit: a plan says "1 bowl
 * (200g)" and "2 eggs", and forcing those through a numeric field would turn
 * a readable instruction into a data-entry exercise nobody finishes.
 */
export const plannedItemSchema = z.object({
  name: z.string(),
  quantity: z.string(),
});
export type PlannedItem = z.infer<typeof plannedItemSchema>;

/**
 * A meal as the diet plan prescribes it, rather than as it was eaten.
 *
 * Deliberately separate from `FoodEntry`: one is the plan and the other is the
 * log, and a model that served both would leave the app unable to say whether
 * a user actually ate what they were meant to.
 */
export const plannedMealSchema = z.object({
  id: z.string(),
  slot: mealSlotSchema,
  /** 24-hour `HH:mm`, in the device's own local time. */
  time: z.string(),
  calories: z.number().nonnegative(),
  proteinG: z.number().nonnegative().default(0),
  carbsG: z.number().nonnegative().default(0),
  fatsG: z.number().nonnegative().default(0),
  items: z.array(plannedItemSchema).default([]),
});
export type PlannedMeal = z.infer<typeof plannedMealSchema>;

/**
 * One thing eaten, with the macros that came with it.
 *
 * Macros live on the entry rather than on the meal: a meal's figures are the
 * sum of what is in it, and storing both would let a meal claim 650 calories
 * while the four items under it added up to something else.
 */
export const foodEntrySchema = z.object({
  id: z.string(),
  slot: mealSlotSchema,
  name: z.string(),
  /** How much of it — "1 Cup (150 g)". Empty when the amount is in the name. */
  portion: z.string().default(''),
  calories: z.number().nonnegative(),
  proteinG: z.number().nonnegative().default(0),
  carbsG: z.number().nonnegative().default(0),
  fatsG: z.number().nonnegative().default(0),
  fiberG: z.number().nonnegative().default(0),
  /** ISO-8601. The meal row shows the time its first item was logged. */
  loggedAt: z.string(),
});
export type FoodEntry = z.infer<typeof foodEntrySchema>;

/**
 * An item in the food library the add-meal screen searches.
 *
 * The catalogue rather than the diary: a library item is a thing that exists,
 * where a `FoodEntry` is a thing that was eaten at a time. Logging one copies
 * its figures into an entry, so editing the catalogue later cannot rewrite
 * what somebody ate last Tuesday.
 */
export const foodItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The serving its figures describe — "1 Medium (118 g)". */
  portion: z.string(),
  emoji: z.string().default('🍽️'),
  calories: z.number().nonnegative(),
  proteinG: z.number().nonnegative().default(0),
  carbsG: z.number().nonnegative().default(0),
  fatsG: z.number().nonnegative().default(0),
  fiberG: z.number().nonnegative().default(0),
});
export type FoodItem = z.infer<typeof foodItemSchema>;

/** What the user will and will not eat, which the meal plan is built from. */
export const dietTypeSchema = z.enum([
  'vegetarian',
  'vegan',
  'eggetarian',
  'non_vegetarian',
]);
export type DietType = z.infer<typeof dietTypeSchema>;

export const mealPlanSchema = z.enum([
  'balanced',
  'high_protein',
  'low_carb',
  'keto',
]);
export type MealPlan = z.infer<typeof mealPlanSchema>;

/**
 * What the eating is *for*.
 *
 * Distinct from `fitnessGoal`, which is about training: a user can be building
 * strength while eating to maintain, and one enum covering both would make
 * those two answers contradict each other.
 */
export const nutritionGoalSchema = z.enum([
  'lose_weight',
  'maintain',
  'gain_weight',
  'build_muscle',
]);
export type NutritionGoal = z.infer<typeof nutritionGoalSchema>;

/**
 * A vital sign the checkup screen tracks.
 *
 * An enum rather than a free label: each kind carries its own unit, its own
 * normal range and its own colour, so a reading that arrived as "heartrate"
 * would render with no unit and no way to say whether it was healthy.
 */
export const vitalKindSchema = z.enum([
  'heart_rate',
  'blood_pressure',
  'bmi',
  'weight',
]);
export type VitalKind = z.infer<typeof vitalKindSchema>;

export const vitalReadingSchema = z.object({
  id: z.string(),
  kind: vitalKindSchema,
  /**
   * The reading, in its kind's own unit — beats per minute, kilograms, the
   * systolic half of a blood pressure.
   *
   * A number rather than the text the tile shows, so a range check is a
   * comparison rather than a parse: whether a reading is normal is derived at
   * render and never stored beside it, and the two therefore cannot disagree.
   */
  value: z.number(),
  /** The diastolic half of a blood pressure. Null for every other kind. */
  secondary: z.number().nullable().default(null),
  /** ISO-8601. */
  recordedAt: z.string(),
});
export type VitalReading = z.infer<typeof vitalReadingSchema>;

/**
 * Which part of the day a reminder belongs to.
 *
 * The three preset blocks are drawn as blocks of chips; `custom` is a time the
 * user set themselves and is drawn as a row it can be switched off or deleted
 * from. One enum rather than two lists, so "how many reminders are on" is a
 * filter rather than a sum of two things that can drift apart.
 */
export const reminderSlotSchema = z.enum([
  'morning',
  'afternoon',
  'evening',
  'custom',
]);
export type ReminderSlot = z.infer<typeof reminderSlotSchema>;

export const hydrationReminderSchema = z.object({
  id: z.string(),
  /**
   * 24-hour `HH:mm`, in the device's own local time.
   *
   * Text rather than minutes-since-midnight because that is what the row
   * shows and what a notification is scheduled from; and local rather than
   * UTC because "remind me at 11" means eleven wherever the user wakes up.
   */
  time: z.string(),
  slot: reminderSlotSchema,
  enabled: z.boolean().default(true),
});
export type HydrationReminder = z.infer<typeof hydrationReminderSchema>;

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
 * Where a referral has got to.
 *
 * Two states rather than a boolean: a friend who has installed but not yet
 * verified is neither a reward nor nothing, and the screen has to be able to
 * say "pending" about them.
 */
export const referralStatusSchema = z.enum(['pending', 'rewarded']);
export type ReferralStatus = z.infer<typeof referralStatusSchema>;

export const referralSchema = z.object({
  id: z.string(),
  /** The friend, as they signed up. */
  name: z.string(),
  /** ISO date, `YYYY-MM-DD` — the day they joined. */
  joinedAt: z.string(),
  status: referralStatusSchema,
  /** What the referral paid, or will pay once verified. */
  rewardCoins: z.number().int().nonnegative(),
});
export type Referral = z.infer<typeof referralSchema>;

/**
 * The code the user joined on, if any — the invitee's side of a referral.
 * `rewardCoins` is what *they* get when they qualify, which is the number
 * the claim section promises before they type anything.
 */
export const appliedReferralSchema = z.object({
  code: z.string(),
  /** The inviter's first name, for "You joined on Asha's code". */
  inviterName: z.string(),
  status: referralStatusSchema,
  rewardCoins: z.number().int().nonnegative(),
  /** ISO-8601 of the apply. */
  appliedAt: z.string(),
});
export type AppliedReferral = z.infer<typeof appliedReferralSchema>;

/**
 * What `GET /referrals/me` returns: everything the Referral & Earn screen
 * shows, from one call. The reward figures are the server's (RULES F3, ⚙
 * `coins.referral`) — the screen never states an amount it did not receive —
 * and so are the share URL and message (F6), which may carry a campaign.
 */
export const referralProgramSchema = z.object({
  code: z.string(),
  shareUrl: z.string(),
  shareMessage: z.string(),
  rewards: z.object({
    /** Coins to the inviter when a friend qualifies. */
    inviter: z.number().nonnegative(),
    /** Coins to the friend when they qualify. */
    invitee: z.number().nonnegative(),
    /** What qualifies, in the user's words — "your friend's first workout". */
    qualifier: z.string(),
    /** Rewarded referrals the inviter is paid for per calendar month (F4). */
    monthlyInviterCap: z.number().int().nonnegative(),
  }),
  stats: z.object({
    successful: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    coinsEarned: z.number().nonnegative(),
    /** How many of this month's cap are used. */
    rewardedThisMonth: z.number().int().nonnegative(),
  }),
  /** Newest first; the first page. `GET /referrals` pages the rest. */
  referrals: z.array(referralSchema),
  /** The code this user joined on, or null. */
  applied: appliedReferralSchema.nullable(),
  /**
   * Whether a code can still be applied: none applied yet and the window
   * since sign-up (F2) still open. `applyBy` is when it closes, ISO-8601,
   * null once it has — or once a code is applied.
   */
  canApply: z.boolean(),
  applyBy: z.string().nullable(),
});
export type ReferralProgram = z.infer<typeof referralProgramSchema>;

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
  coins: z.number().nonnegative(),
  /** Empty when the rank pays coins alone. */
  perk: z.string().default(''),
  avatarUrl: z.string().nullable().default(null),
  isCurrentUser: z.boolean().default(false),
  /** The week's score (RULES L3) — what the rank was won with. */
  score: z.number().nonnegative().default(0),
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
/**
 * What the user has agreed to be told about (BACKEND §5 Notification
 * Settings): eight subject switches, the quiet window and the two other
 * channels. The server enforces these before any push, SMS or email.
 */
export const notificationPreferencesSchema = z.object({
  categories: z.object({
    activity: z.boolean(),
    coins: z.boolean(),
    challenges: z.boolean(),
    orders: z.boolean(),
    offers: z.boolean(),
    announcements: z.boolean(),
    referrals: z.boolean(),
    health: z.boolean(),
  }),
  quietHours: z.object({
    enabled: z.boolean(),
    /** 24-hour `HH:mm`, local. The window may run past midnight. */
    start: z.string(),
    end: z.string(),
  }),
  /** Order and delivery updates by text message. */
  sms: z.boolean(),
  email: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** `GET /notifications/counts`: totals per chip, and the unread figure the bell is drawn from. */
export const notificationCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  activity: z.number().int().nonnegative(),
  reward: z.number().int().nonnegative(),
  system: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
});
export type NotificationCountsSummary = z.infer<typeof notificationCountsSchema>;

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
  /** ISO-8601. Set by the server on account creation. */
  createdAt: z.string().nullable().default(null),
  /** ISO-3166-1 alpha-2. Launch is India-only (D-29). */
  country: z.string().nullable().default('IN'),
  phoneVerifiedAt: z.string().nullable().default(null),
  /** Null until the email OTP is passed. Gates spend and payout (D-20). */
  emailVerifiedAt: z.string().nullable().default(null),
  trustTier: z
    .enum(['trusted', 'normal', 'watch', 'restricted', 'banned'])
    .default('normal'),
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
export const verificationChannelSchema = z.enum(['sms', 'email']);
export type VerificationChannel = z.infer<typeof verificationChannelSchema>;

export const verificationChallengeSchema = z.object({
  verificationId: z.string(),
  /** E.164, echoed back so the screen shows the number the server will text. */
  phone: z.string(),
  /** Which channel the code went to. Email challenges follow phone ones. */
  channel: verificationChannelSchema.default('sms'),
  /** Masked destination — "+91••••••3210" or "a•••@example.com". */
  target: z.string().default(''),
  codeLength: z.number().int().positive().default(6),
  /** How long the code stays valid. */
  expiresInSeconds: z.number().int().nonnegative(),
  /** How long before another code may be requested. */
  resendInSeconds: z.number().int().nonnegative(),
  /**
   * The code itself — development only, when the server runs with
   * `OTP_DEV_ECHO`. Absent in production, always. The app shows it on the
   * OTP screen in dev builds so the flow can be walked without a mailbox.
   */
  devCode: z.string().nullable().default(null),
  /**
   * What the code is for. Only the step-up purpose changes what the screen
   * says — "Confirm it's you" rather than "Verify your email" — so the rest
   * are left as the server names them and never branched on.
   */
  purpose: z.string().nullable().default(null),
});
export type VerificationChallenge = z.infer<typeof verificationChallengeSchema>;

export const authResponseSchema = z.object({
  user: userSchema,
  tokens: authTokensSchema,
  /**
   * Present right after the sign-up code succeeds: the challenge for the
   * *other* contact (phone after email, or email after phone), already sent
   * so the app can ask for it without a second request. Null once both are
   * verified — or when that channel cannot deliver yet, in which case the
   * banner asks again later.
   */
  nextVerification: verificationChallengeSchema.nullable().default(null),
  /**
   * Present when the code that just passed was a step-up (RULES O8): a
   * short-lived token for one sensitive action — a redemption above the
   * threshold. Null on every other verification.
   */
  stepUpToken: z.string().nullable().default(null),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;


// ─── Shapes that exist only on the server side of the contract ──────────────

/** What `GET /wallet` returns. Coins are decimals (D-27). */
export const walletSchema = z.object({
  balance: z.number().nonnegative(),
  /** Step coins held pending verification (escrow). Not spendable. */
  pending: z.number().nonnegative().default(0),
  lifetimeEarned: z.number().nonnegative(),
  /** ISO-8601, or null when there is nothing to expire (RULES E11). */
  expiresAt: z.string().nullable(),
  expiryDaysLeft: z.number().int().nonnegative(),
  /** The idle window itself (⚙ `coins.expiryDays`), so the client never hardcodes it. */
  expiryWindowDays: z.number().int().positive(),
  /** Days-before-expiry at which the user is warned (⚙ `coins.expiryWarnDays`, RULES E10). */
  expiryWarnDays: z.array(z.number().int().nonnegative()),
  monthSummary: z.object({
    earned: z.number().nonnegative(),
    spent: z.number().nonnegative(),
    net: z.number(),
  }),
  /** The hard per-day ceiling and where the user stands against it. */
  dailyCap: z.number().nonnegative(),
  earnedToday: z.number().nonnegative(),
  remainingToday: z.number().nonnegative(),
  /**
   * The price at and above which a redemption asks for a code first
   * (⚙ `coins.stepUpThreshold`, RULES O8), so the checkout can say so before
   * the server does.
   */
  stepUpThreshold: z.number().nonnegative(),
});
export type Wallet = z.infer<typeof walletSchema>;

export const earnRuleSchema = z.object({
  source: coinSourceSchema,
  title: z.string(),
  detail: z.string(),
  reward: z.number().nonnegative(),
});
export type EarnRule = z.infer<typeof earnRuleSchema>;

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });

export const deviceRegistrationSchema = z.object({
  deviceId: z.string(),
  trustTier: z.enum(['trusted', 'normal', 'watch', 'restricted', 'banned']),
  mustUpgrade: z.boolean(),
  minVersion: z.string(),
});
export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;

/**
 * `GET/PUT /me/settings`: the user's own targets and switches, kept by the
 * server so a new phone opens on the same goal (RULES P3). Clamped there
 * the same way the settings store clamps them. The step goal's bounds here
 * are only the outer limit: its range is ⚙ `activity.goal`, checked when
 * one is saved (D-55).
 */
export const userSettingsSchema = z.object({
  units: unitSystemSchema,
  dailyStepGoal: z.number().int().min(1000).max(50000),
  dailyWaterGoalMl: z.number().int().min(500).max(8000),
  restTimerSeconds: z.number().int().min(15).max(600),
  hapticsEnabled: z.boolean(),
  workoutRemindersEnabled: z.boolean(),
  keepAwakeDuringWorkout: z.boolean(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

/**
 * `POST /devices/:id/attestation/challenge`: what the next Keystore key is
 * bound to. The server finds it again in the key's certificate, which is how
 * it knows the key was made just now, for this device, and not replayed.
 */
export const attestationChallengeSchema = z.object({
  /** 1–128 bytes of UTF-8 — what `attestDevice()` accepts. */
  challenge: z.string().min(1).max(128),
  /** ISO-8601. */
  expiresAt: z.string(),
});
export type AttestationChallenge = z.infer<typeof attestationChallengeSchema>;

/** `POST /devices/:id/attestation`: what the server made of the key it was handed. */
export const deviceAttestationResultSchema = z.object({
  keyId: z.string(),
  /** The chain verified up to Google's hardware attestation root. */
  attested: z.boolean(),
  securityLevel: z
    .enum(['strongbox', 'tee', 'software', 'unknown'])
    .catch('unknown'),
});
export type DeviceAttestationResult = z.infer<
  typeof deviceAttestationResultSchema
>;

// ─── Account: profile, privacy, sessions, support ──────────────────────────

/**
 * What the account screen shows about a member, all of it derived from what
 * they have actually done (RULES P4, P6): the level from lifetime coins,
 * the stats from the ledger, the activity days, the workouts and the orders.
 * Nothing here is stored — recomputing costs a handful of counts and can
 * never drift from the rows it is counting.
 */
export const profileStatsSchema = z.object({
  /** Spendable coins, as the wallet holds them. */
  coins: z.number().nonnegative(),
  /** Every coin ever credited — what the level is measured on. */
  lifetimeCoins: z.number().nonnegative(),
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  activeDays: z.number().int().nonnegative(),
  totalWorkouts: z.number().int().nonnegative(),
  totalWorkoutMinutes: z.number().int().nonnegative(),
  /** Orders that are not waiting on a payment (RULES R7). */
  orders: z.number().int().nonnegative(),
  /** Friends who joined on this member's code and qualified (RULES F3). */
  referrals: z.number().int().nonnegative(),
});
export type ProfileStats = z.infer<typeof profileStatsSchema>;

/** The glyph a badge is drawn with. A closed set so the app never has to guess. */
export const profileBadgeIconSchema = z.enum([
  'flame',
  'footprints',
  'dumbbell',
  'coins',
  'package',
  'users',
  'medal',
]);
export type ProfileBadgeIcon = z.infer<typeof profileBadgeIconSchema>;

/**
 * One thing a member has earned, or is on the way to earning. A locked badge
 * carries its progress rather than being hidden: what is nearly won is the
 * reason to come back tomorrow.
 */
export const profileBadgeSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** What it took, in the member's words — "30-day streak". */
  description: z.string(),
  icon: profileBadgeIconSchema,
  /** ISO-8601 when it was earned, or null while it is still locked. */
  unlockedAt: z.string().nullable().default(null),
  /** How far along a locked one is, 0–1. Always 1 once unlocked. */
  progress: z.number().min(0).max(1),
  /** Where the progress stands and what it is counting towards. */
  value: z.number().nonnegative(),
  goal: z.number().positive(),
});
export type ProfileBadge = z.infer<typeof profileBadgeSchema>;

/** A field the profile is still missing, and what filling it is worth. */
export const profileGapSchema = z.object({
  /** Matches a field the edit form knows how to focus. */
  field: z.enum([
    'name',
    'avatarUrl',
    'dateOfBirth',
    'gender',
    'heightCm',
    'weightKg',
    'goal',
    'email',
    'phone',
    'address',
  ]),
  label: z.string(),
  /** Percentage points of completeness this one is worth. */
  weight: z.number().int().positive(),
});
export type ProfileGap = z.infer<typeof profileGapSchema>;

export const profileSummarySchema = z.object({
  /** `floor(sqrt(lifetimeCoins / 100))`, floored at 1 (RULES P4). */
  level: z.number().int().positive(),
  /** The name that goes with the level band — "Athlo Warrior". */
  tierTitle: z.string(),
  /** Lifetime coins, the figure the level is read from. */
  xp: z.number().nonnegative(),
  /** Coins earned since this level started, and what the next one costs. */
  xpIntoLevel: z.number().nonnegative(),
  xpForNextLevel: z.number().positive(),
  /** 0–1 across the current level, for the bar. */
  levelProgress: z.number().min(0).max(1),
  /** ISO-8601 of the account's first day. */
  memberSince: z.string(),
  /** Place by lifetime coins among members who are not hidden; null when unranked. */
  rank: z.number().int().positive().nullable(),
  totalMembers: z.number().int().nonnegative(),
  stats: profileStatsSchema,
  badges: z.array(profileBadgeSchema),
  /** 0–100, and what would raise it (RULES P6). */
  completeness: z.number().int().min(0).max(100),
  gaps: z.array(profileGapSchema),
  trustTier: z.enum(['trusted', 'normal', 'watch', 'restricted', 'banned']),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

/**
 * The choices a member makes about their own data (RULES P7). Deliberately
 * short: every switch here changes something the server actually does, so
 * there is nothing on this screen that only pretends to be a setting.
 */
export const privacySettingsSchema = z.object({
  /** Off drops this account's `POST /events` rows on arrival. */
  analytics: z.boolean(),
  /** Off skips any notification marked as a targeted offer. */
  personalisedOffers: z.boolean(),
  /** Off means a referral never names this member to the friend who invited them. */
  shareNameWithReferrer: z.boolean(),
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

/** A device with a live session, as the security screen lists them. */
export const accountSessionSchema = z.object({
  id: z.string(),
  platform: z.enum(['ios', 'android']),
  model: z.string().nullable().default(null),
  brand: z.string().nullable().default(null),
  osVersion: z.string().nullable().default(null),
  appVersion: z.string().nullable().default(null),
  firstSeenAt: z.string().nullable().default(null),
  lastSeenAt: z.string().nullable().default(null),
  /** The phone asking. It cannot revoke itself — signing out is how that is done. */
  isCurrent: z.boolean().default(false),
});
export type AccountSession = z.infer<typeof accountSessionSchema>;

/**
 * Where a deletion stands (RULES P5). Scheduled rather than immediate: the
 * grace window is what makes a tap in anger recoverable, and signing in
 * during it is enough to call it off.
 */
export const accountDeletionSchema = z.object({
  /** ISO-8601 when it was asked for, or null when nothing is scheduled. */
  scheduledAt: z.string().nullable(),
  /** ISO-8601 when the data actually goes. */
  purgeAt: z.string().nullable(),
  reason: z.string().nullable(),
  graceDays: z.number().int().positive(),
});
export type AccountDeletion = z.infer<typeof accountDeletionSchema>;

export const supportCategorySchema = z.enum([
  'account',
  'coins',
  'orders',
  'tracking',
  'payments',
  /** Data, consent and account safety — the help centre's own shelf for it. */
  'privacy',
  'other',
]);
export type SupportCategory = z.infer<typeof supportCategorySchema>;

/**
 * The glyphs a help topic may wear, and the washes behind them. Closed on
 * purpose: the row is drawn by the app, so a name it cannot draw would be a
 * blank tile. A new glyph ships with a release; the titles, the order and
 * which shelf a row opens do not (⚙ `support.topics`).
 */
export const supportIconSchema = z.enum([
  'question',
  'mail',
  'alert',
  'package',
  'coins',
  'user',
  'shield',
  'guide',
]);
export type SupportIcon = z.infer<typeof supportIconSchema>;

export const supportTintSchema = z.enum([
  'primary',
  'brandAccent',
  'success',
  'warning',
  'destructive',
  'gold',
  'purple',
]);
export type SupportTint = z.infer<typeof supportTintSchema>;

/** What a help row opens when it is tapped. */
export const supportTopicKindSchema = z.enum([
  /** A shelf of articles — all of them, or one category's. */
  'faq',
  /** The ways support can be reached. */
  'contact',
  /** The form that opens a ticket. */
  'report',
  /** The step-by-step guide to the app. */
  'guide',
]);
export type SupportTopicKind = z.infer<typeof supportTopicKindSchema>;

/** One row on the help centre's front page. */
export const supportTopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  kind: supportTopicKindSchema,
  /** Which shelf a `faq` row opens; null for all of them, and for the rest. */
  category: supportCategorySchema.nullable().default(null),
  icon: supportIconSchema,
  tint: supportTintSchema,
  /**
   * How many articles sit behind it, counted as the row is served; null
   * where the row is not a shelf. A row whose shelf is empty is not sent
   * at all, so the page never offers a door onto nothing.
   */
  count: z.number().int().nonnegative().nullable().default(null),
});
export type SupportTopic = z.infer<typeof supportTopicSchema>;

/**
 * A way of reaching support, ready to open: the app hands `url` straight to
 * the OS rather than assembling `mailto:` or `tel:` itself, so a change of
 * number or address never needs a release.
 */
export const supportChannelSchema = z.object({
  kind: z.enum(['email', 'phone', 'whatsapp']),
  label: z.string(),
  /** What the member reads — the address, the number as it is dialled. */
  value: z.string(),
  url: z.string(),
  note: z.string().nullable().default(null),
});
export type SupportChannel = z.infer<typeof supportChannelSchema>;

/**
 * The help centre's front page in one answer (RULES P12): the rows, how to
 * reach a human, and what we promise about answering.
 *
 * The promise is the server's to make — "we usually reply within 24 hours"
 * is a commitment support has to be able to change without an app release,
 * and a screen that invented it could promise what nobody can keep.
 */
export const supportHomeSchema = z.object({
  topics: z.array(supportTopicSchema),
  /** The card at the foot of the page, and what its button does. */
  chat: z.object({
    title: z.string(),
    subtitle: z.string(),
    /** "We usually reply within 24 hours." */
    responseTime: z.string(),
    /**
     * A conversation already going, which "Chat Now" carries on; null when
     * there is none and the button opens a new one.
     */
    openTicketId: z.string().nullable().default(null),
  }),
  channels: z.array(supportChannelSchema),
  /** When support is at their desks; null when the line is always open. */
  hours: z.string().nullable().default(null),
});
export type SupportHome = z.infer<typeof supportHomeSchema>;

/** One step of the app guide: what to do, and what it gets you. */
export const appGuideStepSchema = z.object({
  title: z.string(),
  body: z.string(),
});

/** One chapter of the guide — "Earning coins", in the order it is read. */
export const appGuideSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  icon: supportIconSchema,
  tint: supportTintSchema,
  steps: z.array(appGuideStepSchema),
});
export type AppGuideSection = z.infer<typeof appGuideSectionSchema>;

export const appGuideSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  sections: z.array(appGuideSectionSchema),
});
export type AppGuide = z.infer<typeof appGuideSchema>;

export const supportFaqSchema = z.object({
  id: z.string(),
  category: supportCategorySchema,
  question: z.string(),
  answer: z.string(),
});
export type SupportFaq = z.infer<typeof supportFaqSchema>;

export const supportTicketStatusSchema = z.enum([
  'open',
  'in_progress',
  'resolved',
  'closed',
]);
export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

export const supportMessageSchema = z.object({
  id: z.string(),
  /** Who wrote it. Support replies are written by a human in the admin tool. */
  from: z.enum(['user', 'support']),
  body: z.string(),
  createdAt: z.string(),
});
export type SupportMessage = z.infer<typeof supportMessageSchema>;

export const supportTicketSchema = z.object({
  id: z.string(),
  /** Short, quotable in an email — "VK-7Q2M". */
  reference: z.string(),
  subject: z.string(),
  category: supportCategorySchema,
  status: supportTicketStatusSchema,
  messages: z.array(supportMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SupportTicket = z.infer<typeof supportTicketSchema>;

/** What the About screen shows, judged against the version that asked. */
export const appAboutSchema = z.object({
  name: z.string(),
  company: z.string(),
  /** The caller's own version, echoed so the screen never has to guess. */
  version: z.string(),
  build: z.string().nullable(),
  latestVersion: z.string().nullable(),
  minVersion: z.string(),
  /** The caller is below `minVersion` and the API will refuse it. */
  updateRequired: z.boolean(),
  /** There is a newer release than the caller's, but theirs still works. */
  updateAvailable: z.boolean(),
  storeUrl: z.string(),
  releaseNotes: z.array(
    z.object({
      version: z.string(),
      releasedAt: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  links: z.object({
    privacy: z.string(),
    terms: z.string(),
    licenses: z.string(),
    website: z.string(),
  }),
  supportEmail: z.string(),
});
export type AppAbout = z.infer<typeof appAboutSchema>;

// ─── Streak ────────────────────────────────────────────────────────────────

/** An unbroken run of counting days, both ends included. */
export const streakRunSchema = z.object({
  length: z.number().int().positive(),
  /** `YYYY-MM-DD`. */
  start: z.string(),
  /** `YYYY-MM-DD`. */
  end: z.string(),
});
export type StreakRun = z.infer<typeof streakRunSchema>;

/** One rung of the milestone ladder (⚙ `coins.streakMilestones`, RULES S8). */
export const streakMilestoneSchema = z.object({
  days: z.number().int().positive(),
  coins: z.number().nonnegative(),
  /** Reached by the longest streak on record — once reached, it stays reached. */
  achieved: z.boolean(),
  /** The coins are in the ledger. Can trail `achieved` by a sync. */
  paid: z.boolean(),
});
export type StreakMilestone = z.infer<typeof streakMilestoneSchema>;

/**
 * `GET /streak` — every figure the streak screen shows, worked out by the
 * server from the days it recorded (RULES §S). The calendar and the figures
 * read the same day lists, so they cannot disagree.
 */
export const streakSummarySchema = z.object({
  /** The user's today, `YYYY-MM-DD`, as the server counts it. */
  today: z.string(),
  currentStreak: z.number().int().nonnegative(),
  longestStreak: streakRunSchema.nullable(),
  /** Days earned by the rules in `howToEarn`, `YYYY-MM-DD`, oldest first. */
  completedDays: z.array(z.string()),
  /** Days a freeze or a restore covered, `YYYY-MM-DD`, oldest first. */
  protectedDays: z.array(z.string()),
  freezesAvailable: z.number().int().nonnegative(),
  /** The most freezes that can be held at once (⚙). */
  maxFreezes: z.number().int().nonnegative(),
  /** Today already counts — earned, or frozen. */
  todayCovered: z.boolean(),
  /** Today counts because of a freeze. */
  todayFrozen: z.boolean(),
  /** There is a recent gap a restore would bridge (RULES S6). */
  canRestore: z.boolean(),
  /** The days a restore would cover, `YYYY-MM-DD`. Empty when `canRestore` is false. */
  restoreGap: z.array(z.string()),
  restoreCostCoins: z.number().nonnegative(),
  restoreWindowDays: z.number().int().positive(),
  milestones: z.array(streakMilestoneSchema),
  /** The next rung above the current run, or null past the top. */
  nextMilestone: streakMilestoneSchema.nullable(),
  /** What makes a day count, worded by the server from its rules. */
  howToEarn: z.string(),
});
export type StreakSummary = z.infer<typeof streakSummarySchema>;

/** `POST /streak/restore`: the streak after the restore, and the wallet after the debit. */
export const streakRestoreResultSchema = z.object({
  streak: streakSummarySchema,
  balance: z.number().nonnegative(),
});
export type StreakRestoreResult = z.infer<typeof streakRestoreResultSchema>;

// ─── Leaderboard ───────────────────────────────────────────────────────────

/** One prize rung (⚙ `leaderboard.tiers`, RULES L7). */
export const rewardTierSchema = z.object({
  id: z.string(),
  fromRank: z.number().int().positive(),
  toRank: z.number().int().positive(),
  /** "Rank 1", "Rank 2 – 3". */
  label: z.string(),
  coins: z.number().nonnegative(),
  /** The gear on top of the coins, one item each. */
  perks: z.array(z.string()),
});
export type RewardTierInfo = z.infer<typeof rewardTierSchema>;

/**
 * `GET /leaderboard/reward-tiers`: what each place pays and how a place is
 * won, worded by the server from the rules in force — so a changed prize or
 * score weight never needs a release.
 */
export const leaderboardRulesSchema = z.object({
  /** The board's country, for people — "India". */
  scope: z.string(),
  tiers: z.array(rewardTierSchema),
  /** The rules in the order they happen to the user. */
  howItWorks: z.array(z.object({ title: z.string(), detail: z.string() })),
  /** The line under the tiers. */
  note: z.string(),
});
export type LeaderboardRules = z.infer<typeof leaderboardRulesSchema>;

export const leaderboardPeriodSchema = z.object({
  /** The week's Monday, `YYYY-MM-DD` — the period's id. */
  id: z.string(),
  start: z.string(),
  /** The week's Sunday, `YYYY-MM-DD`. */
  end: z.string(),
  /** ISO-8601: when the week ends in the board's zone. */
  resetsAt: z.string(),
  /** ISO 3166-1 alpha-2 — the country the board is scoped to (RULES L2). */
  country: z.string(),
  status: z.enum(['live', 'closed']),
});
export type LeaderboardPeriod = z.infer<typeof leaderboardPeriodSchema>;

/** `GET /leaderboard`: this week's board, the top of it, and the caller's own place. */
export const leaderboardBoardSchema = z.object({
  period: leaderboardPeriodSchema,
  /** In rank order (RULES L5: no two share a rank). */
  entries: z.array(leaderboardEntrySchema),
  /** The caller's place; null until they have scored this week. */
  me: z
    .object({
      rank: z.number().int().positive(),
      score: z.number().nonnegative(),
      /** What the place would pay if the week ended now. */
      coins: z.number().nonnegative(),
      /** Share of the ranked who are at or below the caller, 0–100. */
      percentile: z.number().min(0).max(100),
    })
    .nullable(),
  /** How many have a score this week. */
  ranked: z.number().int().nonnegative(),
});
export type LeaderboardBoard = z.infer<typeof leaderboardBoardSchema>;

/** `GET /leaderboard/history`: the caller's record over the weeks that have closed. */
export const leaderboardHistorySchema = z.object({
  bestRank: z.number().int().positive().nullable(),
  /** The last day of the week the best rank was won, `YYYY-MM-DD`. */
  bestRankAchievedOn: z.string().nullable(),
  topTenFinishes: z.number().int().nonnegative(),
  /** Leaderboard coins actually paid. */
  rewardCoinsEarned: z.number().nonnegative(),
  /** Weeks that won gear. */
  rewardsWon: z.number().int().nonnegative(),
  /** Newest first. */
  periods: z.array(
    z.object({
      id: z.string(),
      start: z.string(),
      end: z.string(),
      rank: z.number().int().positive(),
      score: z.number().nonnegative(),
      coins: z.number().nonnegative(),
    }),
  ),
});
export type LeaderboardHistory = z.infer<typeof leaderboardHistorySchema>;

// ─── Hydration ─────────────────────────────────────────────────────────────

/** `GET /hydration/today`, and the answer to every log and delete: one day's water. */
export const hydrationDaySchema = z.object({
  /** The user's day, `YYYY-MM-DD`, as the server counts it. */
  date: z.string(),
  consumedMl: z.number().int().nonnegative(),
  /** The user's own goal (`/me/settings`). */
  goalMl: z.number().int().positive(),
  /** Newest first. */
  entries: z.array(hydrationEntrySchema),
});
export type HydrationDay = z.infer<typeof hydrationDaySchema>;

/** `GET /hydration/stats`: the habit rather than the day (RULES Y4). */
export const hydrationStatsSchema = z.object({
  /** The longest run of days at or above the goal. */
  bestStreakDays: z.number().int().nonnegative(),
  /** Over the last 30 days that have any water logged. */
  dailyAverageMl: z.number().int().nonnegative(),
  /** Days at or above the goal ÷ days with any water, last 30 days. */
  goalHitRatePercent: z.number().int().min(0).max(100),
  /** Reminders that will actually arrive today. */
  reminderCount: z.number().int().nonnegative(),
});
export type HydrationStats = z.infer<typeof hydrationStatsSchema>;

/** `GET/PUT /hydration/reminders`: the whole reminder plan (RULES Y5). */
export const hydrationReminderPlanSchema = z.object({
  /** The master switch. */
  enabled: z.boolean(),
  reminders: z.array(hydrationReminderSchema),
  /** The notification sound, by name. */
  sound: z.string(),
  vibration: z.boolean(),
  /** Weekday indices the plan repeats on, 0 = Monday. */
  repeatDays: z.array(z.number().int().min(0).max(6)),
});
export type HydrationReminderPlan = z.infer<typeof hydrationReminderPlanSchema>;

// ─── Content ───────────────────────────────────────────────────────────────

export const contentTopicSchema = z.enum([
  'motivation',
  'hydration',
  'reminders',
  'nutrition',
  'health',
  'heart_rate',
  'blood_pressure',
]);
export type ContentTopic = z.infer<typeof contentTopicSchema>;

/** `GET /content/tips/:topic`: the day's tip or quote for one place in the app. */
export const contentTipSchema = z.object({
  id: z.string(),
  topic: contentTopicSchema,
  /** A heading, where the card has room for one. */
  title: z.string().nullable(),
  text: z.string(),
});
export type ContentTip = z.infer<typeof contentTipSchema>;

// ─── Nutrition ─────────────────────────────────────────────────────────────

/** What a set of food adds up to. */
export const nutritionTotalsSchema = z.object({
  calories: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatsG: z.number().nonnegative(),
  fiberG: z.number().nonnegative().default(0),
});
export type NutritionTotals = z.infer<typeof nutritionTotalsSchema>;

/** The day's targets (RULES N4). */
export const nutritionGoalsSchema = z.object({
  calories: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatsG: z.number().nonnegative(),
});
export type NutritionGoals = z.infer<typeof nutritionGoalsSchema>;

/** How the user eats, which the diet plan is chosen by. */
export const nutritionPreferencesSchema = z.object({
  dietType: dietTypeSchema,
  mealPlan: mealPlanSchema,
  goal: nutritionGoalSchema,
});
export type NutritionPreferences = z.infer<typeof nutritionPreferencesSchema>;

/** `GET/PUT /nutrition/profile`: the targets and the preferences, kept by the server. */
export const nutritionProfileSchema = z.object({
  goals: nutritionGoalsSchema,
  preferences: nutritionPreferencesSchema,
});
export type NutritionProfile = z.infer<typeof nutritionProfileSchema>;

/** `GET /nutrition/day`, and the answer to every log and delete: one day's food. */
export const nutritionDaySchema = z.object({
  /** `YYYY-MM-DD`. */
  date: z.string(),
  /** In the order they were logged. */
  entries: z.array(foodEntrySchema),
  totals: nutritionTotalsSchema,
  goals: nutritionGoalsSchema,
});
export type NutritionDay = z.infer<typeof nutritionDaySchema>;

/** One row of `GET /nutrition/days`: what a day came to. Every day asked for is present. */
export const nutritionDayTotalSchema = z.object({
  date: z.string(),
  /** How many things were logged, across every meal. */
  items: z.number().int().nonnegative(),
  calories: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatsG: z.number().nonnegative(),
});
export type NutritionDayTotal = z.infer<typeof nutritionDayTotalSchema>;

/** `GET /diet-plan?date=`: the plan the server chose for a day, from the user's preferences (RULES N6, N7). */
export const dietPlanDaySchema = z.object({
  date: z.string(),
  /** In clock order. */
  meals: z.array(plannedMealSchema),
  totals: nutritionTotalsSchema,
  /** How many days the plan cycles through before it repeats. */
  cycleLength: z.number().int().positive(),
  /** What the plan was chosen by, for people — "Vegetarian · Balanced". */
  basis: z.string(),
});
export type DietPlanDay = z.infer<typeof dietPlanDaySchema>;

/** One row of `GET /diet-plan/days`: a day's plan in brief. */
export const dietPlanDaySummarySchema = z.object({
  date: z.string(),
  meals: z.number().int().nonnegative(),
  calories: z.number().nonnegative(),
});
export type DietPlanDaySummary = z.infer<typeof dietPlanDaySummarySchema>;

// ─── Vitals and health ─────────────────────────────────────────────────────

/** `GET /vitals/latest`: the newest reading of each kind, and the BMI worked out from them. */
export const vitalsLatestSchema = z.object({
  heart_rate: vitalReadingSchema.nullable(),
  blood_pressure: vitalReadingSchema.nullable(),
  weight: vitalReadingSchema.nullable(),
  /**
   * Derived, never entered (RULES V1, V3): the latest weight over the
   * height on the profile. Null without both.
   */
  bmi: vitalReadingSchema.nullable(),
  /** The wellness line every vitals answer carries (RULES V9). */
  disclaimer: z.string(),
});
export type VitalsLatest = z.infer<typeof vitalsLatestSchema>;

/** One part of the health score (RULES V8). */
export const healthScoreFactorSchema = z.object({
  id: z.enum(['activity', 'hydration', 'vitals', 'bmi', 'consistency']),
  label: z.string(),
  /** The most points this part is worth. */
  weight: z.number().nonnegative(),
  /** The points it earned. */
  points: z.number().nonnegative(),
  /** Why, in a sentence. */
  detail: z.string(),
});
export type HealthScoreFactor = z.infer<typeof healthScoreFactorSchema>;

/** `GET /health/score`: one number for how the user is doing, and what made it (RULES V8). */
export const healthScoreSchema = z.object({
  score: z.number().int().nonnegative(),
  outOf: z.number().int().positive(),
  /** The score in a word — "Good", "Fair", "Needs work". */
  band: z.string(),
  factors: z.array(healthScoreFactorSchema),
  disclaimer: z.string(),
});
export type HealthScore = z.infer<typeof healthScoreSchema>;
