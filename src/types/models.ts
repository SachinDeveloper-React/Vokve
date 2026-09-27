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

export const activitySourceSchema = z.enum([
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
   * server so a share change is live on the next fetch.
   */
  coinsMax: z.number().int().nonnegative(),
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
  /** Coins at or above this in one order ask for a code first (RULES O8). */
  stepUpThreshold: z.number().nonnegative(),
});
export type ShopConfig = z.infer<typeof shopConfigSchema>;

/** One thing in a basket or an order: which item, how many, which size. */
export const purchaseLineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
  /** One of the item's `sizes`, or null for an item that comes in one. */
  size: z.string().max(12).nullable().default(null),
});
export type PurchaseLine = z.infer<typeof purchaseLineSchema>;

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
      quantity: z.number().int().positive(),
      size: z.string().nullable(),
      /** Per unit, in paise. */
      price: z.number().int().positive(),
      mrp: z.number().int().positive().nullable(),
      lineTotal: z.number().int().positive(),
      inStock: z.boolean(),
    }),
  ),
  /** The lines at list price, before any discount. */
  mrpTotal: z.number().int().nonnegative(),
  /** How much the selling prices are under the list prices. */
  discount: z.number().int().nonnegative(),
  /** The goods at selling price. */
  subtotal: z.number().int().nonnegative(),
  shipping: z.number().int().nonnegative(),
  /** Goods plus shipping, before coins. */
  total: z.number().int().nonnegative(),
  /** What one coin is worth here, in paise. */
  coinValuePaise: z.number().int().positive(),
  /** The most coins this order may take: the share cap, then the wallet. */
  coinsMax: z.number().int().nonnegative(),
  /** The coins the quote was asked for, clamped to `coinsMax`. */
  coinsApplied: z.number().int().nonnegative(),
  /** What those coins are worth, in paise. */
  coinsValue: z.number().int().nonnegative(),
  /** What is left to pay in money. Zero means no payment step. */
  payable: z.number().int().nonnegative(),
  /** True when `coinsApplied` is at or above the step-up threshold (RULES O8). */
  needsStepUp: z.boolean(),
});
export type Quote = z.infer<typeof quoteSchema>;

/** A basket line with the item it points at, as the cart screen draws it. */
export const cartLineSchema = z.object({
  item: shopItemSchema,
  quantity: z.number().int().positive(),
  size: z.string().nullable(),
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

export const orderItemSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  emoji: z.string().default('🎁'),
  quantity: z.number().int().positive(),
  size: z.string().nullable().default(null),
  /** Per unit, in paise, at the time of the order — a later price change does not rewrite history. */
  price: z.number().int().positive(),
  mrp: z.number().int().positive().nullable().default(null),
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

export const orderSchema = z.object({
  id: z.string(),
  status: orderStatusSchema,
  items: z.array(orderItemSchema).min(1),
  currency: z.string().length(3),
  /** The goods at selling price, in paise. */
  subtotal: z.number().int().nonnegative(),
  /** How far under list price the goods were, in paise. */
  discount: z.number().int().nonnegative(),
  shipping: z.number().int().nonnegative(),
  /** Goods plus shipping, before coins. */
  total: z.number().int().nonnegative(),
  /** The coins that went towards it, and what they were worth in paise. */
  coinsUsed: z.number().int().nonnegative(),
  coinsValue: z.number().int().nonnegative(),
  /** The money side, in paise. Zero when coins covered it. */
  payable: z.number().int().nonnegative(),
  payment: orderPaymentSchema,
  /** The address as it was when the order was placed (RULES R4). */
  address: addressSchema.omit({ id: true, isDefault: true }),
  /** ISO-8601. */
  placedAt: z.string(),
  /** ISO-8601 of the latest state change; equals `placedAt` on a fresh order. */
  updatedAt: z.string(),
  /** Courier reference once shipped; null before. */
  trackingRef: z.string().nullable().default(null),
  /** Whether the user may still cancel — `pending_payment`, `placed` or `confirmed` (R5). */
  cancellable: z.boolean(),
});
export type Order = z.infer<typeof orderSchema>;

/**
 * What the app needs to collect the money for an order it just placed: the
 * gateway, its order, the amount, and the public key to open the checkout
 * with. Null on the checkout response when coins covered everything.
 */
export const paymentIntentSchema = z.object({
  provider: z.enum(['mock', 'razorpay']),
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

/** Which meal of the day a food entry belongs to. */
export const mealSlotSchema = z.enum(['breakfast', 'lunch', 'snack', 'dinner']);
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
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

/** `GET /notifications/counts`: totals per chip, and the unread figure the bell is drawn from. */
export const notificationCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  activity: z.number().int().nonnegative(),
  reward: z.number().int().nonnegative(),
  system: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
});
export type NotificationCountsSummary = z.infer<
  typeof notificationCountsSchema
>;

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
  purpose: z.string().nullable().optional(),
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
  /**
   * The idle window itself (⚙ `coins.expiryDays`) and the days-before at
   * which the user is warned (E10). Defaulted rather than required so a
   * server from before they were sent still parses; the defaults are the
   * rule card's own numbers.
   */
  expiryWindowDays: z.number().int().positive().default(90),
  expiryWarnDays: z.array(z.number().int().nonnegative()).default([14, 3]),
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
  stepUpThreshold: z.number().nonnegative().default(1000),
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
  'other',
]);
export type SupportCategory = z.infer<typeof supportCategorySchema>;

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
