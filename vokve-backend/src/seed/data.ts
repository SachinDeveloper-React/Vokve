/**
 * Catalogue fixtures, copied from the client's `seedData.workoutTemplates` so
 * a fresh database renders the same Workouts screen the mock did. Exercises
 * are flattened once — templates reference them by id.
 */
export const EXERCISES = [
  { _id: 'bench', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', isTimed: false },
  { _id: 'ohp', name: 'Overhead Press', muscleGroup: 'shoulders', equipment: 'barbell', isTimed: false },
  { _id: 'incline-db', name: 'Incline Dumbbell Press', muscleGroup: 'chest', equipment: 'dumbbell', isTimed: false },
  { _id: 'pushdown', name: 'Cable Tricep Pushdown', muscleGroup: 'triceps', equipment: 'cable', isTimed: false },
  { _id: 'deadlift', name: 'Deadlift', muscleGroup: 'back', equipment: 'barbell', isTimed: false },
  { _id: 'pullup', name: 'Pull-up', muscleGroup: 'back', equipment: 'bodyweight', isTimed: false },
  { _id: 'row', name: 'Barbell Row', muscleGroup: 'back', equipment: 'barbell', isTimed: false },
  { _id: 'curl', name: 'Dumbbell Curl', muscleGroup: 'biceps', equipment: 'dumbbell', isTimed: false },
  { _id: 'squat', name: 'Back Squat', muscleGroup: 'legs', equipment: 'barbell', isTimed: false },
  { _id: 'rdl', name: 'Romanian Deadlift', muscleGroup: 'glutes', equipment: 'barbell', isTimed: false },
  { _id: 'legpress', name: 'Leg Press', muscleGroup: 'legs', equipment: 'machine', isTimed: false },
  { _id: 'plank', name: 'Plank', muscleGroup: 'core', equipment: 'bodyweight', isTimed: true },
  { _id: 'row-erg', name: 'Rowing Intervals', muscleGroup: 'cardio', equipment: 'machine', isTimed: true },
  { _id: 'burpee', name: 'Burpees', muscleGroup: 'full_body', equipment: 'bodyweight', isTimed: true },
  { _id: 'goblet-squat', name: 'Goblet Squat', muscleGroup: 'legs', equipment: 'kettlebell', isTimed: false },
  { _id: 'band-pull-apart', name: 'Band Pull-Apart', muscleGroup: 'shoulders', equipment: 'band', isTimed: false },
  { _id: 'lat-pulldown', name: 'Lat Pulldown', muscleGroup: 'back', equipment: 'cable', isTimed: false },
  { _id: 'lunge', name: 'Walking Lunge', muscleGroup: 'legs', equipment: 'bodyweight', isTimed: false },
];

export const WORKOUT_TEMPLATES = [
  { _id: 'push-day', title: 'Push Day', description: 'Chest, shoulders and triceps. Heavy compounds first.', estimatedMinutes: 55,
    muscleGroups: ['chest', 'shoulders', 'triceps'], exerciseIds: ['bench', 'ohp', 'incline-db', 'pushdown'], sort: 1 },
  { _id: 'pull-day', title: 'Pull Day', description: 'Back and biceps, built around the deadlift.', estimatedMinutes: 60,
    muscleGroups: ['back', 'biceps'], exerciseIds: ['deadlift', 'pullup', 'row', 'curl'], sort: 2 },
  { _id: 'leg-day', title: 'Leg Day', description: 'Squat-focused lower body with posterior chain work.', estimatedMinutes: 65,
    muscleGroups: ['legs', 'glutes', 'core'], exerciseIds: ['squat', 'rdl', 'legpress', 'plank'], sort: 3 },
  { _id: 'conditioning', title: 'Conditioning', description: 'Twenty minutes of intervals to finish the week.', estimatedMinutes: 25,
    muscleGroups: ['cardio', 'full_body'], exerciseIds: ['row-erg', 'burpee'], sort: 4 },
];

export const APP_RELEASES = [
  { platform: 'ios', version: '1.0.0', build: '1', status: 'current', releasedAt: new Date('2026-09-01') },
  { platform: 'android', version: '1.0.0', build: '1', status: 'current', releasedAt: new Date('2026-09-01') },
];

/**
 * The reward catalogue, copied from the client's `seedData.shopItems` so the
 * shop looks the same against a fresh database as it did against the seed.
 * Stock is a starting figure for a demo; fulfilment adjusts it.
 */
export const SHOP_ITEMS = [
  { _id: 'tee', title: 'VOKVE T-Shirt', description: 'Breathable training tee with the wordmark across the chest.', priceCoins: 1200, category: 'apparel', emoji: '👕', badge: 'bestseller', isDeal: false, sort: 1 },
  { _id: 'steel-bottle', title: 'VOKVE Steel Bottle', description: '750ml double-wall steel — cold for 24 hours.', priceCoins: 850, category: 'accessories', emoji: '🍶', badge: 'popular', isDeal: false, sort: 2 },
  { _id: 'yoga-mat', title: 'Yoga Mat', description: '6mm non-slip mat with a carry strap.', priceCoins: 1500, category: 'gear', emoji: '🧘', badge: 'new_arrival', isDeal: false, sort: 3 },
  { _id: 'cap', title: 'VOKVE Cap', description: 'Curved-peak cap, one size, embroidered logo.', priceCoins: 650, category: 'apparel', emoji: '🧢', badge: 'limited', isDeal: false, sort: 4 },
  { _id: 'hoodie', title: 'VOKVE Hoodie', description: 'Heavyweight cotton hoodie for the walk to the gym.', priceCoins: 2200, category: 'apparel', emoji: '🧥', badge: null, isDeal: false, sort: 5 },
  { _id: 'shorts', title: 'Training Shorts', description: 'Quick-dry shorts with a zipped phone pocket.', priceCoins: 1100, category: 'apparel', emoji: '🩳', badge: null, isDeal: true, sort: 6 },
  { _id: 'gym-towel', title: 'Microfibre Towel', description: 'Quick-dry, with a clip for the rack.', priceCoins: 350, category: 'accessories', emoji: '🧺', badge: null, isDeal: false, sort: 7 },
  { _id: 'wrist-wraps', title: 'Wrist Wraps', description: 'Elastic wraps for press days.', priceCoins: 500, category: 'accessories', emoji: '🧤', badge: null, isDeal: true, sort: 8 },
  { _id: 'resistance-bands', title: 'Resistance Band Set', description: 'Five loops, light through extra heavy.', priceCoins: 950, category: 'gear', emoji: '🎽', badge: null, isDeal: false, sort: 9 },
  { _id: 'jump-rope', title: 'Speed Rope', description: 'Ball-bearing speed rope, adjustable length.', priceCoins: 400, category: 'gear', emoji: '🪢', badge: null, isDeal: true, sort: 10 },
  { _id: 'streak-freeze', title: 'Streak Freeze', description: 'Keeps your streak alive for one rest day.', priceCoins: 300, category: 'lifestyle', emoji: '🧊', badge: null, isDeal: false, sort: 11 },
  { _id: 'pro-month', title: 'One Month of Pro', description: 'Advanced analytics and custom plans.', priceCoins: 3000, category: 'lifestyle', emoji: '⭐', badge: null, isDeal: false, sort: 12 },
] as const;

/** Digital rewards never run out; physical ones start with a demo quantity, the limited cap with three. */
export const SHOP_STOCK = SHOP_ITEMS.map(item => ({
  _id: item._id,
  onHand: item.category === 'lifestyle' ? 1_000_000 : item.badge === 'limited' ? 3 : 25,
  lowStockAt: 5,
}));
