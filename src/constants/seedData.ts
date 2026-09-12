import type { CoinTransaction, ShopItem, WorkoutTemplate } from '../types/models';

/**
 * Local library shown until the backend is wired up. Keeping it in one file
 * means deleting the seed later is a single import to remove, not a hunt
 * through screens for hardcoded arrays.
 */
export const workoutTemplates: WorkoutTemplate[] = [
  {
    id: 'push-day',
    title: 'Push Day',
    description: 'Chest, shoulders and triceps. Heavy compounds first.',
    estimatedMinutes: 55,
    muscleGroups: ['chest', 'shoulders', 'triceps'],
    exercises: [
      { id: 'bench', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', isTimed: false, imageUrl: null },
      { id: 'ohp', name: 'Overhead Press', muscleGroup: 'shoulders', equipment: 'barbell', isTimed: false, imageUrl: null },
      { id: 'incline-db', name: 'Incline Dumbbell Press', muscleGroup: 'chest', equipment: 'dumbbell', isTimed: false, imageUrl: null },
      { id: 'pushdown', name: 'Cable Tricep Pushdown', muscleGroup: 'triceps', equipment: 'cable', isTimed: false, imageUrl: null },
    ],
  },
  {
    id: 'pull-day',
    title: 'Pull Day',
    description: 'Back and biceps, built around the deadlift.',
    estimatedMinutes: 60,
    muscleGroups: ['back', 'biceps'],
    exercises: [
      { id: 'deadlift', name: 'Deadlift', muscleGroup: 'back', equipment: 'barbell', isTimed: false, imageUrl: null },
      { id: 'pullup', name: 'Pull-up', muscleGroup: 'back', equipment: 'bodyweight', isTimed: false, imageUrl: null },
      { id: 'row', name: 'Barbell Row', muscleGroup: 'back', equipment: 'barbell', isTimed: false, imageUrl: null },
      { id: 'curl', name: 'Dumbbell Curl', muscleGroup: 'biceps', equipment: 'dumbbell', isTimed: false, imageUrl: null },
    ],
  },
  {
    id: 'leg-day',
    title: 'Leg Day',
    description: 'Squat-focused lower body with posterior chain work.',
    estimatedMinutes: 65,
    muscleGroups: ['legs', 'glutes', 'core'],
    exercises: [
      { id: 'squat', name: 'Back Squat', muscleGroup: 'legs', equipment: 'barbell', isTimed: false, imageUrl: null },
      { id: 'rdl', name: 'Romanian Deadlift', muscleGroup: 'glutes', equipment: 'barbell', isTimed: false, imageUrl: null },
      { id: 'legpress', name: 'Leg Press', muscleGroup: 'legs', equipment: 'machine', isTimed: false, imageUrl: null },
      { id: 'plank', name: 'Plank', muscleGroup: 'core', equipment: 'bodyweight', isTimed: true, imageUrl: null },
    ],
  },
  {
    id: 'conditioning',
    title: 'Conditioning',
    description: 'Twenty minutes of intervals to finish the week.',
    estimatedMinutes: 25,
    muscleGroups: ['cardio', 'full_body'],
    exercises: [
      { id: 'row-erg', name: 'Rowing Intervals', muscleGroup: 'cardio', equipment: 'machine', isTimed: true, imageUrl: null },
      { id: 'burpee', name: 'Burpees', muscleGroup: 'full_body', equipment: 'bodyweight', isTimed: true, imageUrl: null },
    ],
  },
];

/**
 * Placeholder step history, shown until a health data source is connected.
 * Replace the whole export once HealthKit / Health Connect is wired up.
 */
export const weeklySteps = [
  { day: 'Mon', steps: 4200 },
  { day: 'Tue', steps: 7856 },
  { day: 'Wed', steps: 10245 },
  { day: 'Thu', steps: 8650 },
  { day: 'Fri', steps: 6321 },
  { day: 'Sat', steps: 9125 },
  { day: 'Sun', steps: 6245 },
];

/** Today's figures, matching the last entry above. */
export const todayActivity = {
  steps: 6245,
  distanceKm: 4.2,
  activeMinutes: 48,
  caloriesBurned: 358,
};

/**
 * The profile figures the account screen leads with, none of which the user
 * API carries yet: level and tier title are awarded server-side once the
 * progression rules exist, achievements come from a challenges service that is
 * not built, and lifetime steps need a health data source connected. Seeded
 * here in one object rather than scattered as literals in the screen, so the
 * whole export can be deleted the day those arrive.
 *
 * `streakDays` is deliberately absent — that one *is* on the user record.
 */
export const profileHighlights = {
  level: 18,
  /** The name that goes with the level, shown beside it on the profile panel. */
  tierTitle: 'Athlo Warrior',
  /** Formatted for display: the API has no join date to derive it from. */
  memberSince: 'May 2025',
  achievements: 15,
  totalSteps: 245_600,
};

/** Local `YYYY-MM-DD` for `days` days before today. */
function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every day from `from` days ago down to `to` days ago, inclusive. */
function dayRange(from: number, to: number): string[] {
  return Array.from({ length: from - to + 1 }, (_, i) => dateDaysAgo(from - i));
}

/**
 * The streak the app opens with, until workouts write real days.
 *
 * Two runs, relative to today so the figures never go stale: a fifteen-day
 * run that ended a fortnight ago — the longest on record — and a seven-day
 * run that is still going. The gap between them is what makes "longest" and
 * "current" two different numbers on the streak screen, which is the case
 * that screen has to lay out.
 */
export const seedStreak = {
  completedDays: [...dayRange(25, 11), ...dayRange(6, 0)],
  protectedDays: [] as string[],
  freezesAvailable: 1,
};

/** ISO timestamp `days` days before now, so the seeded ledger never looks stale. */
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

/**
 * The wallet's placeholder history, newest first.
 *
 * The opening balance is not stated anywhere: the coins store adds these rows
 * up instead, so the wallet can never show a balance its own history does not
 * explain. The whole export goes once earning is wired to real activity.
 */
export const seedCoinTransactions: CoinTransaction[] = [
  { id: 'c-1', title: '6 245 steps walked', source: 'steps', amount: 60, createdAt: daysAgo(0) },
  { id: 'c-2', title: 'Resistance band', source: 'purchase', amount: -450, createdAt: daysAgo(1) },
  { id: 'c-3', title: 'Push Day completed', source: 'workout', amount: 100, createdAt: daysAgo(1) },
  { id: 'c-4', title: '7 day streak bonus', source: 'streak', amount: 175, createdAt: daysAgo(2) },
  { id: 'c-5', title: '10 000 steps challenge', source: 'challenge', amount: 500, createdAt: daysAgo(4) },
  { id: 'c-6', title: 'Leg Day completed', source: 'workout', amount: 100, createdAt: daysAgo(5) },
  { id: 'c-7', title: 'Friend joined vokve', source: 'referral', amount: 300, createdAt: daysAgo(8) },
  { id: 'c-8', title: 'Protein sample pack', source: 'purchase', amount: -250, createdAt: daysAgo(11) },
  { id: 'c-9', title: 'Conditioning completed', source: 'workout', amount: 100, createdAt: daysAgo(12) },
  { id: 'c-10', title: 'Welcome bonus', source: 'challenge', amount: 605, createdAt: daysAgo(20) },
];

/**
 * The reward catalogue, priced in coins. Replaced wholesale by the shop
 * endpoint later, which is why nothing else hardcodes an item id.
 */
/**
 * The reward catalogue, until it pages from the server.
 *
 * Spread across all four categories so the shop's category tiles have a
 * count to show and every filter chip lands on something. `isDeal` marks the
 * rows the "Deals" chip surfaces; it is a flag on the item rather than a
 * fifth category because a deal is still a bottle or a mat.
 */
export const shopItems: ShopItem[] = [
  {
    id: 'tee',
    title: 'VOKVE T-Shirt',
    description: 'Breathable training tee with the wordmark across the chest.',
    priceCoins: 1200,
    category: 'apparel',
    emoji: '👕',
    badge: 'bestseller',
    isDeal: false,
    inStock: true,
  },
  {
    id: 'steel-bottle',
    title: 'VOKVE Steel Bottle',
    description: '750ml double-wall steel — cold for 24 hours.',
    priceCoins: 850,
    category: 'accessories',
    emoji: '🍶',
    badge: 'popular',
    isDeal: false,
    inStock: true,
  },
  {
    id: 'yoga-mat',
    title: 'Yoga Mat',
    description: '6mm non-slip mat with a carry strap.',
    priceCoins: 1500,
    category: 'gear',
    emoji: '🧘',
    badge: 'new_arrival',
    isDeal: false,
    inStock: true,
  },
  {
    id: 'cap',
    title: 'VOKVE Cap',
    description: 'Curved-peak cap, one size, embroidered logo.',
    priceCoins: 650,
    category: 'apparel',
    emoji: '🧢',
    badge: 'limited',
    isDeal: false,
    inStock: true,
  },
  {
    id: 'hoodie',
    title: 'VOKVE Hoodie',
    description: 'Heavyweight cotton hoodie for the walk to the gym.',
    priceCoins: 2200,
    category: 'apparel',
    emoji: '🧥',
    badge: null,
    isDeal: false,
    inStock: true,
  },
  {
    id: 'shorts',
    title: 'Training Shorts',
    description: 'Quick-dry shorts with a zipped phone pocket.',
    priceCoins: 1100,
    category: 'apparel',
    emoji: '🩳',
    badge: null,
    isDeal: true,
    inStock: true,
  },
  {
    id: 'gym-towel',
    title: 'Microfibre Towel',
    description: 'Quick-dry, with a clip for the rack.',
    priceCoins: 350,
    category: 'accessories',
    emoji: '🧺',
    badge: null,
    isDeal: false,
    inStock: false,
  },
  {
    id: 'wrist-wraps',
    title: 'Wrist Wraps',
    description: 'Elastic wraps for press days.',
    priceCoins: 500,
    category: 'accessories',
    emoji: '🧤',
    badge: null,
    isDeal: true,
    inStock: true,
  },
  {
    id: 'resistance-bands',
    title: 'Resistance Band Set',
    description: 'Five loops, light through extra heavy.',
    priceCoins: 950,
    category: 'gear',
    emoji: '🎽',
    badge: null,
    isDeal: false,
    inStock: true,
  },
  {
    id: 'jump-rope',
    title: 'Speed Rope',
    description: 'Ball-bearing speed rope, adjustable length.',
    priceCoins: 400,
    category: 'gear',
    emoji: '🪢',
    badge: null,
    isDeal: true,
    inStock: true,
  },
  {
    id: 'streak-freeze',
    title: 'Streak Freeze',
    description: 'Keeps your streak alive for one rest day.',
    priceCoins: 300,
    category: 'lifestyle',
    emoji: '🧊',
    badge: null,
    isDeal: false,
    inStock: true,
  },
  {
    id: 'pro-month',
    title: 'One Month of Pro',
    description: 'Advanced analytics and custom plans.',
    priceCoins: 3000,
    category: 'lifestyle',
    emoji: '⭐',
    badge: null,
    isDeal: false,
    inStock: true,
  },
];
