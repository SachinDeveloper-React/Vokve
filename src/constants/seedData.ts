import type {
  Achievement,
  AppNotification,
  Challenge,
  CoinTransaction,
  FoodEntry,
  FoodItem,
  LeaderboardEntry,
  PaymentMode,
  PlannedMeal,
  Referral,
  ShopItem,
  ShopSpec,
  VitalReading,
  WorkoutTemplate,
} from '../types/models';

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
      {
        id: 'bench',
        name: 'Barbell Bench Press',
        muscleGroup: 'chest',
        equipment: 'barbell',
        isTimed: false,
        imageUrl: null,
      },
      {
        id: 'ohp',
        name: 'Overhead Press',
        muscleGroup: 'shoulders',
        equipment: 'barbell',
        isTimed: false,
        imageUrl: null,
      },
      {
        id: 'incline-db',
        name: 'Incline Dumbbell Press',
        muscleGroup: 'chest',
        equipment: 'dumbbell',
        isTimed: false,
        imageUrl: null,
      },
      {
        id: 'pushdown',
        name: 'Cable Tricep Pushdown',
        muscleGroup: 'triceps',
        equipment: 'cable',
        isTimed: false,
        imageUrl: null,
      },
    ],
  },
  {
    id: 'pull-day',
    title: 'Pull Day',
    description: 'Back and biceps, built around the deadlift.',
    estimatedMinutes: 60,
    muscleGroups: ['back', 'biceps'],
    exercises: [
      {
        id: 'deadlift',
        name: 'Deadlift',
        muscleGroup: 'back',
        equipment: 'barbell',
        isTimed: false,
        imageUrl: null,
      },
      {
        id: 'pullup',
        name: 'Pull-up',
        muscleGroup: 'back',
        equipment: 'bodyweight',
        isTimed: false,
        imageUrl: null,
      },
      {
        id: 'row',
        name: 'Barbell Row',
        muscleGroup: 'back',
        equipment: 'barbell',
        isTimed: false,
        imageUrl: null,
      },
      {
        id: 'curl',
        name: 'Dumbbell Curl',
        muscleGroup: 'biceps',
        equipment: 'dumbbell',
        isTimed: false,
        imageUrl: null,
      },
    ],
  },
  {
    id: 'leg-day',
    title: 'Leg Day',
    description: 'Squat-focused lower body with posterior chain work.',
    estimatedMinutes: 65,
    muscleGroups: ['legs', 'glutes', 'core'],
    exercises: [
      {
        id: 'squat',
        name: 'Back Squat',
        muscleGroup: 'legs',
        equipment: 'barbell',
        isTimed: false,
        imageUrl: null,
      },
      {
        id: 'rdl',
        name: 'Romanian Deadlift',
        muscleGroup: 'glutes',
        equipment: 'barbell',
        isTimed: false,
        imageUrl: null,
      },
      {
        id: 'legpress',
        name: 'Leg Press',
        muscleGroup: 'legs',
        equipment: 'machine',
        isTimed: false,
        imageUrl: null,
      },
      {
        id: 'plank',
        name: 'Plank',
        muscleGroup: 'core',
        equipment: 'bodyweight',
        isTimed: true,
        imageUrl: null,
      },
    ],
  },
  {
    id: 'conditioning',
    title: 'Conditioning',
    description: 'Twenty minutes of intervals to finish the week.',
    estimatedMinutes: 25,
    muscleGroups: ['cardio', 'full_body'],
    exercises: [
      {
        id: 'row-erg',
        name: 'Rowing Intervals',
        muscleGroup: 'cardio',
        equipment: 'machine',
        isTimed: true,
        imageUrl: null,
      },
      {
        id: 'burpee',
        name: 'Burpees',
        muscleGroup: 'full_body',
        equipment: 'bodyweight',
        isTimed: true,
        imageUrl: null,
      },
    ],
  },
];

/** Local `YYYY-MM-DD` for `days` days before today. */
function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
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
  {
    id: 'c-1',
    title: '6 245 steps walked',
    source: 'steps',
    amount: 60,
    createdAt: daysAgo(0),
  },
  {
    id: 'c-2',
    title: 'Resistance band',
    source: 'purchase',
    amount: -450,
    createdAt: daysAgo(1),
  },
  {
    id: 'c-3',
    title: 'Push Day completed',
    source: 'workout',
    amount: 100,
    createdAt: daysAgo(1),
  },
  {
    id: 'c-4',
    title: '7 day streak bonus',
    source: 'streak',
    amount: 175,
    createdAt: daysAgo(2),
  },
  {
    id: 'c-5',
    title: '10 000 steps challenge',
    source: 'challenge',
    amount: 500,
    createdAt: daysAgo(4),
  },
  {
    id: 'c-6',
    title: 'Leg Day completed',
    source: 'workout',
    amount: 100,
    createdAt: daysAgo(5),
  },
  {
    id: 'c-7',
    title: 'Friend joined vokve',
    source: 'referral',
    amount: 300,
    createdAt: daysAgo(8),
  },
  {
    id: 'c-8',
    title: 'Protein sample pack',
    source: 'purchase',
    amount: -250,
    createdAt: daysAgo(11),
  },
  {
    id: 'c-9',
    title: 'Conditioning completed',
    source: 'workout',
    amount: 100,
    createdAt: daysAgo(12),
  },
  {
    id: 'c-10',
    title: 'Welcome bonus',
    source: 'challenge',
    amount: 605,
    createdAt: daysAgo(20),
  },
];

/**
 * The catalogue the shop paints with before the server answers — the same
 * rows the backend seeds, in the same order it ranks them, so the first
 * frame and the first sync agree. Four shelves: what you wear, what you
 * train with, what you play with, and what goes with any of them. Prices
 * are paise; `coinsMax` is the server's figure at its defaults (30% of the
 * price at ₹0.25 a coin) and is replaced by whatever the server says on
 * the first sync. `isDeal` and `featured` are flags on an item rather than
 * shelves of their own, because a deal is still a bottle or a mat (R9).
 */
const shopItemRows: Omit<
  ShopItem,
  DetailKey | 'coinsMin' | 'coinPrice' | 'paymentMode'
>[] = [
  {
    id: 'tee',
    title: 'VOKVE Training Tee',
    description:
      'Breathable training tee with the wordmark across the chest. Sizes S–XXL.',
    price: 79900,
    mrp: 119900,
    currency: 'INR',
    coinsMax: 958,
    category: 'clothing',
    subcategory: 'T-shirts',
    emoji: '👕',
    badge: 'bestseller',
    isDeal: false,
    featured: true,
    tags: ['tshirt', 't-shirt', 'top', 'gym wear'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'tank-top',
    title: 'Mesh Tank Top',
    description: 'Lightweight mesh-back tank for leg day and summer runs.',
    price: 59900,
    mrp: 89900,
    currency: 'INR',
    coinsMax: 718,
    category: 'clothing',
    subcategory: 'T-shirts',
    emoji: '🎽',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['vest', 'sleeveless', 'tank'],
    sizes: ['S', 'M', 'L', 'XL'],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'hoodie',
    title: 'VOKVE Hoodie',
    description: 'Heavyweight cotton hoodie for the walk to the gym.',
    price: 149900,
    mrp: 219900,
    currency: 'INR',
    coinsMax: 1798,
    category: 'clothing',
    subcategory: 'Hoodies',
    emoji: '🧥',
    badge: null,
    isDeal: false,
    featured: true,
    tags: ['sweatshirt', 'jumper', 'winter'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'shorts',
    title: 'Training Shorts',
    description: 'Quick-dry shorts with a zipped phone pocket.',
    price: 69900,
    mrp: 99900,
    currency: 'INR',
    coinsMax: 838,
    category: 'clothing',
    subcategory: 'Bottoms',
    emoji: '🩳',
    badge: null,
    isDeal: true,
    featured: true,
    tags: ['gym shorts', 'running'],
    sizes: ['S', 'M', 'L', 'XL'],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'joggers',
    title: 'Tapered Joggers',
    description: 'Four-way stretch joggers with a cuffed ankle.',
    price: 109900,
    mrp: null,
    currency: 'INR',
    coinsMax: 1318,
    category: 'clothing',
    subcategory: 'Bottoms',
    emoji: '👖',
    badge: 'new_arrival',
    isDeal: false,
    featured: false,
    tags: ['track pants', 'trousers', 'sweatpants'],
    sizes: ['S', 'M', 'L', 'XL'],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'sports-bra',
    title: 'Support Sports Bra',
    description: 'Medium-support bra with a racerback and wide underband.',
    price: 89900,
    mrp: 129900,
    currency: 'INR',
    coinsMax: 1078,
    category: 'clothing',
    subcategory: 'Tops',
    emoji: '🩱',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['bra', 'women', 'top'],
    sizes: ['S', 'M', 'L', 'XL'],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'cap',
    title: 'VOKVE Cap',
    description: 'Curved-peak cap, one size, embroidered logo.',
    price: 44900,
    mrp: 59900,
    currency: 'INR',
    coinsMax: 538,
    category: 'clothing',
    subcategory: 'Headwear',
    emoji: '🧢',
    badge: 'limited',
    isDeal: false,
    featured: false,
    tags: ['hat', 'sun'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'socks',
    title: 'Cushioned Socks · 3 pack',
    description: 'Ankle socks with a cushioned sole and arch band.',
    price: 29900,
    mrp: 44900,
    currency: 'INR',
    coinsMax: 358,
    category: 'clothing',
    subcategory: 'Socks',
    emoji: '🧦',
    badge: null,
    isDeal: true,
    featured: false,
    tags: ['ankle socks', 'pack'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'yoga-mat',
    title: 'Yoga Mat',
    description: '6mm non-slip mat with a carry strap.',
    price: 99900,
    mrp: 149900,
    currency: 'INR',
    coinsMax: 1198,
    category: 'gym',
    subcategory: 'Mats',
    emoji: '🧘',
    badge: 'popular',
    isDeal: false,
    featured: true,
    tags: ['exercise mat', 'stretching', 'pilates'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'resistance-bands',
    title: 'Resistance Band Set',
    description: 'Five loops, light through extra heavy.',
    price: 64900,
    mrp: 89900,
    currency: 'INR',
    coinsMax: 778,
    category: 'gym',
    subcategory: 'Bands',
    emoji: '🔗',
    badge: null,
    isDeal: false,
    featured: true,
    tags: ['loop bands', 'booty bands', 'home workout'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'wrist-wraps',
    title: 'Wrist Wraps',
    description: 'Elastic wraps for press days.',
    price: 34900,
    mrp: 49900,
    currency: 'INR',
    coinsMax: 418,
    category: 'gym',
    subcategory: 'Support',
    emoji: '🧤',
    badge: null,
    isDeal: true,
    featured: false,
    tags: ['lifting', 'bench', 'support'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'lifting-straps',
    title: 'Lifting Straps',
    description: 'Padded cotton straps for deadlifts and rows.',
    price: 39900,
    mrp: null,
    currency: 'INR',
    coinsMax: 478,
    category: 'gym',
    subcategory: 'Support',
    emoji: '🪢',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['deadlift', 'grip', 'straps'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'gym-gloves',
    title: 'Grip Gym Gloves',
    description: 'Half-finger gloves with a silicone palm.',
    price: 49900,
    mrp: 69900,
    currency: 'INR',
    coinsMax: 598,
    category: 'gym',
    subcategory: 'Support',
    emoji: '🥊',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['gloves', 'grip', 'weights'],
    sizes: ['S', 'M', 'L', 'XL'],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'foam-roller',
    title: 'Foam Roller',
    description: 'High-density 45cm roller for recovery days.',
    price: 69900,
    mrp: 99900,
    currency: 'INR',
    coinsMax: 838,
    category: 'gym',
    subcategory: 'Recovery',
    emoji: '🧻',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['recovery', 'massage', 'mobility'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'kettlebell-8',
    title: 'Kettlebell 8 kg',
    description: 'Cast-iron kettlebell with a powder-coat grip.',
    price: 179900,
    mrp: null,
    currency: 'INR',
    coinsMax: 2158,
    category: 'gym',
    subcategory: 'Weights',
    emoji: '🏋️',
    badge: 'new_arrival',
    isDeal: false,
    featured: false,
    tags: ['kettlebell', 'weights', 'strength'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'jump-rope',
    title: 'Speed Rope',
    description: 'Ball-bearing speed rope, adjustable length.',
    price: 29900,
    mrp: 44900,
    currency: 'INR',
    coinsMax: 358,
    category: 'gym',
    subcategory: 'Cardio',
    emoji: '➰',
    badge: null,
    isDeal: true,
    featured: false,
    tags: ['skipping rope', 'jump rope', 'cardio'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'football',
    title: 'Match Football · Size 5',
    description: 'Machine-stitched size 5 ball for turf and grass.',
    price: 94900,
    mrp: 129900,
    currency: 'INR',
    coinsMax: 1138,
    category: 'sports',
    subcategory: 'Football',
    emoji: '⚽',
    badge: 'popular',
    isDeal: false,
    featured: true,
    tags: ['soccer', 'ball', 'football'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'badminton-set',
    title: 'Badminton Racket Set',
    description: 'Two aluminium rackets with a carry sleeve.',
    price: 119900,
    mrp: 169900,
    currency: 'INR',
    coinsMax: 1438,
    category: 'sports',
    subcategory: 'Badminton',
    emoji: '🏸',
    badge: null,
    isDeal: false,
    featured: true,
    tags: ['racket', 'racquet', 'badminton'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'shuttlecocks',
    title: 'Feather Shuttlecocks · 6',
    description: 'Tournament-grade feather shuttles, tube of six.',
    price: 39900,
    mrp: 54900,
    currency: 'INR',
    coinsMax: 478,
    category: 'sports',
    subcategory: 'Badminton',
    emoji: '🪶',
    badge: null,
    isDeal: true,
    featured: false,
    tags: ['shuttle', 'birdie', 'badminton'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'cricket-ball',
    title: 'Leather Cricket Ball',
    description: 'Four-piece leather ball, 156 g.',
    price: 54900,
    mrp: 69900,
    currency: 'INR',
    coinsMax: 658,
    category: 'sports',
    subcategory: 'Cricket',
    emoji: '🏏',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['cricket', 'ball', 'leather'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'tennis-balls',
    title: 'Tennis Balls · 3',
    description: 'Pressurised felt balls in a can of three.',
    price: 34900,
    mrp: null,
    currency: 'INR',
    coinsMax: 418,
    category: 'sports',
    subcategory: 'Tennis',
    emoji: '🎾',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['tennis', 'ball', 'can'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'swim-goggles',
    title: 'Anti-fog Swim Goggles',
    description: 'Mirrored lenses with a split silicone strap.',
    price: 49900,
    mrp: 74900,
    currency: 'INR',
    coinsMax: 598,
    category: 'sports',
    subcategory: 'Swimming',
    emoji: '🥽',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['swimming', 'goggles', 'pool'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'running-belt',
    title: 'Running Belt',
    description: 'Slim waist belt with a stretch pocket for a phone and keys.',
    price: 44900,
    mrp: 64900,
    currency: 'INR',
    coinsMax: 538,
    category: 'sports',
    subcategory: 'Running',
    emoji: '🏃',
    badge: null,
    isDeal: true,
    featured: false,
    tags: ['running', 'waist bag', 'phone holder'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'steel-bottle',
    title: 'VOKVE Steel Bottle',
    description: '750ml double-wall steel — cold for 24 hours.',
    price: 59900,
    mrp: 89900,
    currency: 'INR',
    coinsMax: 718,
    category: 'accessories',
    subcategory: 'Bottles',
    emoji: '🍶',
    badge: 'popular',
    isDeal: false,
    featured: true,
    tags: ['water bottle', 'flask', 'hydration'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'shaker',
    title: 'Protein Shaker 600 ml',
    description: 'Leak-proof shaker with a mixing ball.',
    price: 24900,
    mrp: 34900,
    currency: 'INR',
    coinsMax: 298,
    category: 'accessories',
    subcategory: 'Bottles',
    emoji: '🥤',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['shaker', 'protein', 'bottle'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'gym-towel',
    title: 'Microfibre Towel',
    description: 'Quick-dry, with a clip for the rack.',
    price: 24900,
    mrp: null,
    currency: 'INR',
    coinsMax: 298,
    category: 'accessories',
    subcategory: 'Towels',
    emoji: '🧺',
    badge: null,
    isDeal: false,
    featured: false,
    tags: ['towel', 'sweat'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: false,
  },
  {
    id: 'gym-bag',
    title: 'Duffel Gym Bag',
    description: '30 L duffel with a shoe compartment and wet pocket.',
    price: 129900,
    mrp: 179900,
    currency: 'INR',
    coinsMax: 1558,
    category: 'accessories',
    subcategory: 'Bags',
    emoji: '🎒',
    badge: 'new_arrival',
    isDeal: false,
    featured: false,
    tags: ['bag', 'duffel', 'kit bag'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
  {
    id: 'sweatbands',
    title: 'Sweatband Set',
    description: 'Headband and two wristbands in cotton terry.',
    price: 19900,
    mrp: 29900,
    currency: 'INR',
    coinsMax: 238,
    category: 'accessories',
    subcategory: 'Wearables',
    emoji: '🎗️',
    badge: null,
    isDeal: true,
    featured: false,
    tags: ['headband', 'wristband', 'sweat'],
    sizes: [],
    rating: { average: 0, count: 0 },
    inStock: true,
  },
];

/** What the product page shows beyond the card, as the server seeds it. */
type DetailKey =
  | 'images'
  | 'ribbon'
  | 'colors'
  | 'highlights'
  | 'features'
  | 'specs';

const BLACK = { name: 'Black', hex: '#111111' };
const NAVY = { name: 'Navy', hex: '#1E2B5C' };
const GREY = { name: 'Grey', hex: '#8C8C8C' };
const CHARCOAL = { name: 'Charcoal', hex: '#2B2F38' };
const WHITE = { name: 'White', hex: '#F2F2F2' };
const CARE_COLD: ShopSpec = {
  icon: 'care',
  label: 'Care Instructions',
  value: 'Machine wash cold, do not bleach',
};

const shopItemDetails: Record<string, Partial<Pick<ShopItem, DetailKey>>> = {
  tee: {
    ribbon: 'Premium Quality',
    colors: [BLACK, NAVY, GREY, CHARCOAL],
    highlights: [
      { icon: 'fabric', label: 'Fabric', value: 'Dry Fit Polyester' },
    ],
    features: [
      {
        icon: 'breathable',
        title: 'Breathable',
        caption: 'Keeps you cool and dry',
      },
      {
        icon: 'lightweight',
        title: 'Lightweight',
        caption: 'Ultra light for maximum comfort',
      },
      {
        icon: 'stretch',
        title: 'Stretchable',
        caption: 'Flexible fabric for better movement',
      },
      { icon: 'durable', title: 'Durable', caption: 'Long lasting and strong' },
    ],
    specs: [
      { icon: 'category', label: 'Category', value: 'Unisex Activewear' },
      { icon: 'material', label: 'Material', value: '100% Polyester' },
      CARE_COLD,
    ],
  },
  'tank-top': {
    colors: [BLACK, WHITE, { name: 'Olive', hex: '#556B2F' }],
    highlights: [
      { icon: 'fabric', label: 'Fabric', value: 'Mesh-back Polyester' },
    ],
    features: [
      {
        icon: 'breathable',
        title: 'Breathable',
        caption: 'Mesh back lets heat out',
      },
      {
        icon: 'lightweight',
        title: 'Lightweight',
        caption: 'Barely there on a run',
      },
      {
        icon: 'quick_dry',
        title: 'Quick Dry',
        caption: 'Sweat dries off fast',
      },
    ],
    specs: [
      { icon: 'category', label: 'Category', value: 'Unisex Activewear' },
      {
        icon: 'material',
        label: 'Material',
        value: '92% Polyester, 8% Elastane',
      },
      CARE_COLD,
    ],
  },
  hoodie: {
    ribbon: 'Heavyweight Cotton',
    colors: [BLACK, { name: 'Grey Melange', hex: '#9A9A9A' }, NAVY],
    highlights: [
      { icon: 'fabric', label: 'Fabric', value: '400 GSM Cotton Fleece' },
    ],
    features: [
      { icon: 'insulated', title: 'Warm', caption: 'Brushed fleece inside' },
      { icon: 'durable', title: 'Durable', caption: 'Double-stitched seams' },
      { icon: 'check', title: 'Pocket', caption: 'Fits a phone and keys' },
    ],
    specs: [
      { icon: 'category', label: 'Category', value: 'Unisex Outerwear' },
      {
        icon: 'material',
        label: 'Material',
        value: '80% Cotton, 20% Polyester',
      },
      {
        icon: 'care',
        label: 'Care Instructions',
        value: 'Wash inside out, tumble dry low',
      },
    ],
  },
  shorts: {
    colors: [BLACK, NAVY],
    highlights: [
      { icon: 'fabric', label: 'Fabric', value: 'Quick-dry Polyester' },
    ],
    features: [
      {
        icon: 'quick_dry',
        title: 'Quick Dry',
        caption: 'Sweat dries off fast',
      },
      { icon: 'stretch', title: 'Stretchable', caption: 'Four-way stretch' },
      { icon: 'check', title: 'Zip Pocket', caption: 'Your phone stays put' },
    ],
    specs: [
      { icon: 'category', label: 'Category', value: 'Unisex Activewear' },
      {
        icon: 'material',
        label: 'Material',
        value: '88% Polyester, 12% Spandex',
      },
      CARE_COLD,
    ],
  },
  joggers: {
    colors: [BLACK, CHARCOAL],
    highlights: [
      { icon: 'fabric', label: 'Fabric', value: 'Four-way Stretch Knit' },
    ],
    features: [
      {
        icon: 'stretch',
        title: 'Stretchable',
        caption: 'Moves the way you do',
      },
      {
        icon: 'lightweight',
        title: 'Lightweight',
        caption: 'Warm without the weight',
      },
    ],
    specs: [
      { icon: 'category', label: 'Category', value: 'Unisex Activewear' },
      {
        icon: 'material',
        label: 'Material',
        value: '75% Polyester, 25% Elastane',
      },
      CARE_COLD,
    ],
  },
  'sports-bra': {
    colors: [BLACK, { name: 'Berry', hex: '#8E2C48' }],
    highlights: [{ icon: 'fit', label: 'Support', value: 'Medium' }],
    features: [
      {
        icon: 'breathable',
        title: 'Breathable',
        caption: 'Ventilated racerback',
      },
      { icon: 'stretch', title: 'Stretchable', caption: 'Moves with you' },
      { icon: 'quick_dry', title: 'Quick Dry', caption: 'Wicks sweat away' },
    ],
    specs: [
      { icon: 'category', label: 'Category', value: "Women's Activewear" },
      { icon: 'material', label: 'Material', value: '78% Nylon, 22% Spandex' },
      { icon: 'care', label: 'Care Instructions', value: 'Hand wash cold' },
    ],
  },
  cap: {
    highlights: [
      { icon: 'fit', label: 'Fit', value: 'One size, adjustable strap' },
    ],
    features: [
      {
        icon: 'breathable',
        title: 'Breathable',
        caption: 'Vented crown panels',
      },
      {
        icon: 'lightweight',
        title: 'Lightweight',
        caption: 'Unstructured crown',
      },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: '100% Cotton twill' },
      { icon: 'care', label: 'Care Instructions', value: 'Spot clean only' },
    ],
  },
  socks: {
    highlights: [
      { icon: 'material', label: 'Material', value: 'Cotton blend' },
    ],
    features: [
      { icon: 'cushioned', title: 'Cushioned', caption: 'Padded sole' },
      { icon: 'breathable', title: 'Breathable', caption: 'Mesh top' },
    ],
    specs: [
      { icon: 'sizes', label: 'Fits', value: 'UK 6–11' },
      { icon: 'info', label: 'Pack', value: '3 pairs' },
      CARE_COLD,
    ],
  },
  'yoga-mat': {
    ribbon: 'Non-slip',
    highlights: [
      { icon: 'dimensions', label: 'Size', value: '183 × 61 cm, 6 mm' },
    ],
    features: [
      { icon: 'grip', title: 'Non-slip', caption: 'Grips on both sides' },
      { icon: 'cushioned', title: 'Cushioned', caption: '6 mm of padding' },
      { icon: 'lightweight', title: 'Lightweight', caption: '1 kg with strap' },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: 'TPE, latex-free' },
      {
        icon: 'care',
        label: 'Care Instructions',
        value: 'Wipe clean with a damp cloth',
      },
    ],
  },
  'resistance-bands': {
    highlights: [{ icon: 'info', label: 'Set', value: '5 loops, 2–20 kg' }],
    features: [
      {
        icon: 'stretch',
        title: 'Five Levels',
        caption: 'Light to extra heavy',
      },
      { icon: 'durable', title: 'Durable', caption: 'Layered latex' },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: 'Natural latex' },
      {
        icon: 'care',
        label: 'Care Instructions',
        value: 'Keep out of direct sun',
      },
    ],
  },
  'gym-gloves': {
    colors: [BLACK, GREY],
    features: [
      { icon: 'grip', title: 'Grip', caption: 'Silicone palm' },
      { icon: 'breathable', title: 'Breathable', caption: 'Mesh back' },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: 'Neoprene and silicone' },
      { icon: 'care', label: 'Care Instructions', value: 'Hand wash, air dry' },
    ],
  },
  'foam-roller': {
    highlights: [{ icon: 'dimensions', label: 'Size', value: '45 × 15 cm' }],
    features: [
      { icon: 'durable', title: 'Firm', caption: 'Holds its shape' },
      { icon: 'lightweight', title: 'Lightweight', caption: 'Easy to carry' },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: 'High-density EVA foam' },
    ],
  },
  'kettlebell-8': {
    highlights: [{ icon: 'weight', label: 'Weight', value: '8 kg' }],
    features: [
      { icon: 'durable', title: 'Durable', caption: 'Solid cast iron' },
      { icon: 'grip', title: 'Grip', caption: 'Powder-coat handle' },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: 'Cast iron, powder coat' },
    ],
  },
  football: {
    highlights: [{ icon: 'sizes', label: 'Size', value: '5 (official)' }],
    features: [
      { icon: 'durable', title: 'Durable', caption: 'Machine-stitched panels' },
      { icon: 'check', title: 'All Surfaces', caption: 'Turf and grass' },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: 'PU leather' },
      { icon: 'weight', label: 'Weight', value: '410–450 g' },
    ],
  },
  'steel-bottle': {
    ribbon: 'Cold for 24 hours',
    colors: [
      BLACK,
      { name: 'Steel', hex: '#A7ADB4' },
      { name: 'Orange', hex: '#E8572A' },
    ],
    highlights: [{ icon: 'capacity', label: 'Capacity', value: '750 ml' }],
    features: [
      { icon: 'insulated', title: 'Insulated', caption: 'Cold 24 h, hot 12 h' },
      { icon: 'waterproof', title: 'Leak-proof', caption: 'Screw-top seal' },
      { icon: 'durable', title: 'Durable', caption: 'Food-grade 18/8 steel' },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: 'Stainless steel 18/8' },
      { icon: 'care', label: 'Care Instructions', value: 'Hand wash only' },
    ],
  },
  shaker: {
    highlights: [{ icon: 'capacity', label: 'Capacity', value: '600 ml' }],
    features: [
      { icon: 'waterproof', title: 'Leak-proof', caption: 'Snap-lock lid' },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: 'BPA-free plastic' },
      {
        icon: 'care',
        label: 'Care Instructions',
        value: 'Dishwasher safe, top rack',
      },
    ],
  },
  'gym-bag': {
    colors: [BLACK, NAVY],
    highlights: [{ icon: 'capacity', label: 'Capacity', value: '30 L' }],
    features: [
      { icon: 'waterproof', title: 'Water-resistant', caption: 'Coated base' },
      { icon: 'durable', title: 'Durable', caption: 'Ripstop polyester' },
    ],
    specs: [
      { icon: 'material', label: 'Material', value: '600D Polyester' },
      { icon: 'dimensions', label: 'Size', value: '50 × 28 × 25 cm' },
    ],
  },
};

/**
 * The items the catalogue sells one way only, as the backend seeds them
 * (RULES R11): the small things a member walks their way to are bought
 * with coins alone, the ones that are not a reward with money alone.
 * Everything else follows the shop and takes coins towards part of it.
 */
const ITEM_PAYMENT_MODE: Record<string, PaymentMode> = {
  socks: 'coins',
  'wrist-wraps': 'coins',
  'jump-rope': 'coins',
  joggers: 'money',
  'foam-roller': 'money',
};

export const shopItems: ShopItem[] = shopItemRows.map(row => {
  const paymentMode = ITEM_PAYMENT_MODE[row.id] ?? 'mixed';
  // The server's figures at its defaults, ₹0.25 a coin: all of a
  // coins-only item, none of a money-only one, the share of the rest.
  const coinPrice = Math.ceil(row.price / 25);
  return {
    images: [],
    ribbon: null,
    colors: [],
    highlights: [],
    features: [],
    specs: [],
    ...shopItemDetails[row.id],
    ...row,
    paymentMode,
    coinPrice,
    coinsMin: paymentMode === 'coins' ? coinPrice : 0,
    coinsMax:
      paymentMode === 'coins'
        ? coinPrice
        : paymentMode === 'money'
        ? 0
        : row.coinsMax,
  };
});

/**
 * ISO timestamp at a clock time on a day in the recent past — `at(1, 18, 30)`
 * is yesterday at 6:30 pm.
 *
 * The ledger's `daysAgo` only had to land on the right day. A notification row
 * states the time it arrived and is filed under a day heading, so the fixture
 * has to pin both, or the same seed would read as a different morning on every
 * launch.
 */
function at(days: number, hours: number, minutes: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

/**
 * The notification centre's placeholder feed, newest first.
 *
 * Twelve rows across the three filters — four activity, three reward, five
 * system — so every chip in the filter row lands on something and the counts
 * beside them are a real total rather than a number typed into the design.
 * Today's three are unread; everything older has been seen, which is what
 * gives the blue dot something to mean on first launch.
 */
export const seedNotifications: AppNotification[] = [
  {
    id: 'n-1',
    topic: 'steps',
    title: 'Step Goal Achieved! 🎉',
    message: "Congratulations! You've completed your daily step goal.",
    createdAt: at(0, 10, 30),
    read: false,
  },
  {
    id: 'n-2',
    topic: 'coins',
    title: 'You earned 28 coins!',
    message: 'Great job! Keep staying active and earning more coins.',
    createdAt: at(0, 10, 30),
    read: false,
  },
  {
    id: 'n-3',
    topic: 'streak',
    title: '15 Days Streak! 🔥',
    message: "You're on fire! Keep it up to unlock bigger rewards.",
    createdAt: at(0, 9, 15),
    read: false,
  },
  {
    id: 'n-4',
    topic: 'hydration',
    title: 'Hydration Logged 💧',
    message: 'Great! You added 500 ml of water. Keep hydrated!',
    createdAt: at(1, 20, 45),
    read: true,
  },
  {
    id: 'n-5',
    topic: 'challenge',
    title: 'Challenge Completed! 🏆',
    message: "You've completed the 10K Steps Challenge and earned 200 coins.",
    createdAt: at(1, 18, 30),
    read: true,
  },
  {
    id: 'n-6',
    topic: 'health',
    title: 'Health Checkup Reminder',
    message: 'Time for your daily health checkup. Track your vitals now.',
    createdAt: at(1, 9, 0),
    read: true,
  },
  {
    id: 'n-7',
    topic: 'workout',
    title: 'Workout Completed 💪',
    message: 'Push Day logged — six exercises and 4 520 kg of volume.',
    createdAt: at(2, 19, 20),
    read: true,
  },
  {
    id: 'n-8',
    topic: 'reward',
    title: 'Reward Unlocked! 🎁',
    message: 'A Streak Freeze is waiting for you. Save it for a rest day.',
    createdAt: at(2, 11, 5),
    read: true,
  },
  {
    id: 'n-9',
    topic: 'health',
    title: 'Health Data Connected',
    message: 'Vokve is now reading your steps straight from your phone.',
    createdAt: at(3, 16, 45),
    read: true,
  },
  {
    id: 'n-10',
    topic: 'system',
    title: 'Weekly Summary Ready 📊',
    message: 'Your training week is wrapped up. See how the seven days went.',
    createdAt: at(3, 8, 0),
    read: true,
  },
  {
    id: 'n-11',
    topic: 'system',
    title: 'App Updated',
    message: 'Faster charts, a redesigned shop and fixes across the app.',
    createdAt: at(4, 10, 15),
    read: true,
  },
  {
    id: 'n-12',
    topic: 'system',
    title: 'Privacy Policy Updated',
    message: "We've refreshed how we describe the data Vokve keeps.",
    createdAt: at(5, 12, 30),
    read: true,
  },
];

/**
 * ISO date `days` days from now — what an upcoming challenge starts on. The
 * mirror of `dateDaysAgo`, which only ever looks backwards.
 */
function inDays(days: number): string {
  return dateDaysAgo(-days);
}

/**
 * The challenge board, running and upcoming.
 *
 * `startsAt: null` is what makes a challenge active; everything with a date is
 * still to open. Spread across the three cadences so every filter chip lands
 * on something in both lists — a "Monthly" filter that emptied the screen
 * would read as a broken control rather than an empty month.
 */
export const seedChallenges: Challenge[] = [
  {
    id: 'ch-10k-steps',
    title: '10K Steps Challenge',
    description: 'Walk 10,000 steps in a day',
    emoji: '👟',
    metric: 'steps',
    cadence: 'daily',
    goal: 10_000,
    progress: 7_543,
    rewardCoins: 200,
    rewardsBadge: true,
    startsAt: null,
    endsOn: null,
    completedAt: null,
  },
  {
    id: 'ch-burn-500',
    title: 'Burn 500 Calories',
    description: 'Burn 500 calories in a day',
    emoji: '🔥',
    metric: 'calories',
    cadence: 'daily',
    goal: 500,
    progress: 312,
    rewardCoins: 150,
    rewardsBadge: true,
    startsAt: null,
    endsOn: null,
    completedAt: null,
  },
  {
    id: 'ch-30-min-active',
    title: '30 Min Active Time',
    description: 'Be active for 30 minutes',
    emoji: '⏱️',
    metric: 'minutes',
    cadence: 'daily',
    goal: 30,
    progress: 22,
    rewardCoins: 100,
    rewardsBadge: true,
    startsAt: null,
    endsOn: null,
    completedAt: null,
  },
  {
    id: 'ch-week-step-master',
    title: 'Weekly Step Master',
    description: 'Walk 70,000 steps this week',
    emoji: '🚶',
    metric: 'steps',
    cadence: 'weekly',
    goal: 70_000,
    progress: 42_350,
    rewardCoins: 800,
    rewardsBadge: true,
    startsAt: null,
    endsOn: null,
    completedAt: null,
  },
  {
    id: 'ch-month-mover',
    title: 'Monthly Mover',
    description: 'Log 900 active minutes this month',
    emoji: '🗓️',
    metric: 'minutes',
    cadence: 'monthly',
    goal: 900,
    progress: 540,
    rewardCoins: 2_000,
    rewardsBadge: true,
    startsAt: null,
    endsOn: null,
    completedAt: null,
  },
  {
    id: 'ch-15k-steps',
    title: '15K Steps Challenge',
    description: 'Walk 15,000 steps in a day',
    emoji: '🏃',
    metric: 'steps',
    cadence: 'daily',
    goal: 15_000,
    progress: 0,
    rewardCoins: 300,
    rewardsBadge: false,
    startsAt: inDays(1),
    endsOn: null,
    completedAt: null,
  },
  {
    id: 'ch-7-day-consistency',
    title: '7 Days Consistency',
    description: 'Hit your daily goal for 7 days',
    emoji: '⭐',
    metric: 'days',
    cadence: 'weekly',
    goal: 7,
    progress: 0,
    rewardCoins: 500,
    rewardsBadge: true,
    startsAt: inDays(2),
    endsOn: null,
    completedAt: null,
  },
  {
    id: 'ch-weekend-warrior',
    title: 'Weekend Warrior',
    description: 'Complete your goal on both days',
    emoji: '🎯',
    metric: 'workouts',
    cadence: 'weekly',
    goal: 2,
    progress: 0,
    rewardCoins: 200,
    rewardsBadge: false,
    startsAt: inDays(5),
    endsOn: null,
    completedAt: null,
  },
  {
    id: 'ch-monthly-marathon',
    title: 'Monthly Marathon',
    description: 'Cover 300,000 steps in a month',
    emoji: '🏅',
    metric: 'steps',
    cadence: 'monthly',
    goal: 300_000,
    progress: 0,
    rewardCoins: 1_500,
    rewardsBadge: true,
    startsAt: inDays(9),
    endsOn: null,
    completedAt: null,
  },
];

/**
 * The achievement shelf, in the order it is shown.
 *
 * Fifteen of them so the strip pages rather than ending after one screenful:
 * the row holds five, and the dots under it are only worth drawing when there
 * is a second page behind them. The locked ones are the point of the shelf —
 * a wall of earned badges says nothing about what to do next.
 */
export const seedAchievements: Achievement[] = [
  {
    id: 'a-10k-steps',
    value: 10_000,
    label: '10K Steps',
    metric: 'steps',
    achievedAt: daysAgo(2),
  },
  {
    id: 'a-cal-burner',
    value: 500,
    label: 'Cal Burner',
    metric: 'calories',
    achievedAt: daysAgo(5),
  },
  {
    id: 'a-active-30',
    value: 30,
    label: 'Active 30',
    metric: 'minutes',
    achievedAt: daysAgo(9),
  },
  {
    id: 'a-7-day-streak',
    value: 7,
    label: '7 Days Streak',
    metric: 'days',
    achievedAt: daysAgo(14),
  },
  {
    id: 'a-first-challenge',
    value: 1,
    label: 'First Challenge',
    metric: 'workouts',
    achievedAt: null,
  },
  {
    id: 'a-15k-steps',
    value: 15_000,
    label: '15K Steps',
    metric: 'steps',
    achievedAt: daysAgo(21),
  },
  {
    id: 'a-cal-crusher',
    value: 1_000,
    label: 'Cal Crusher',
    metric: 'calories',
    achievedAt: null,
  },
  {
    id: 'a-active-60',
    value: 60,
    label: 'Active 60',
    metric: 'minutes',
    achievedAt: daysAgo(30),
  },
  {
    id: 'a-30-day-streak',
    value: 30,
    label: '30 Days Streak',
    metric: 'days',
    achievedAt: null,
  },
  {
    id: 'a-ten-workouts',
    value: 10,
    label: 'Ten Workouts',
    metric: 'workouts',
    achievedAt: daysAgo(40),
  },
  {
    id: 'a-20k-steps',
    value: 20_000,
    label: '20K Steps',
    metric: 'steps',
    achievedAt: null,
  },
  {
    id: 'a-cal-machine',
    value: 2_000,
    label: 'Cal Machine',
    metric: 'calories',
    achievedAt: null,
  },
  {
    id: 'a-active-120',
    value: 120,
    label: 'Active 120',
    metric: 'minutes',
    achievedAt: null,
  },
  {
    id: 'a-90-day-streak',
    value: 90,
    label: '90 Days Streak',
    metric: 'days',
    achievedAt: null,
  },
  {
    id: 'a-fifty-workouts',
    value: 50,
    label: 'Fifty Workouts',
    metric: 'workouts',
    achievedAt: null,
  },
];

/**
 * This week's top of the leaderboard, in rank order.
 *
 * Twelve rows: the reward tiers pay down to tenth place, so the list runs two
 * past it — the card shows the top five and the full board shows the lot,
 * which is what makes the paid places and the unpaid ones visibly different.
 * The coins each row states match the tiers exactly, so the table above the
 * list and the people below it cannot disagree.
 */
export const seedLeaderboard: LeaderboardEntry[] = [
  {
    id: 'lb-1',
    name: 'Rahul Verma',
    location: 'Delhi, India',
    rank: 1,
    coins: 5_000,
    perk: 'T-Shirt + Bottle',
    avatarUrl: null,
    isCurrentUser: false,
    score: 2_480,
  },
  {
    id: 'lb-2',
    name: 'Priya Sharma',
    location: 'Mumbai, India',
    rank: 2,
    coins: 3_000,
    perk: 'T-Shirt + Mat',
    avatarUrl: null,
    isCurrentUser: false,
    score: 2_215,
  },
  {
    id: 'lb-3',
    name: 'Arjun Mehta',
    location: 'Bangalore, India',
    rank: 3,
    coins: 3_000,
    perk: 'T-Shirt + Mat',
    avatarUrl: null,
    isCurrentUser: false,
    score: 2_190,
  },
  {
    id: 'lb-4',
    name: 'Neha Singh',
    location: 'Pune, India',
    rank: 4,
    coins: 1_000,
    perk: 'Fitness Mat',
    avatarUrl: null,
    isCurrentUser: false,
    score: 1_960,
  },
  {
    id: 'lb-5',
    name: 'Vikram Yadav',
    location: 'Chennai, India',
    rank: 5,
    coins: 1_000,
    perk: 'Fitness Mat',
    avatarUrl: null,
    isCurrentUser: false,
    score: 1_875,
  },

  {
    id: 'lb-6',
    name: 'Ananya Iyer',
    location: 'Hyderabad, India',
    rank: 6,
    coins: 1_000,
    perk: 'Fitness Mat',
    avatarUrl: null,
    isCurrentUser: false,
    score: 1_790,
  },
  {
    id: 'lb-7',
    name: 'Rohit Nair',
    location: 'Kochi, India',
    rank: 7,
    coins: 1_000,
    perk: 'Fitness Mat',
    avatarUrl: null,
    isCurrentUser: false,
    score: 1_704,
  },
  {
    id: 'lb-8',
    name: 'Sneha Joshi',
    location: 'Jaipur, India',
    rank: 8,
    coins: 1_000,
    perk: 'Fitness Mat',
    avatarUrl: null,
    isCurrentUser: false,
    score: 1_612,
  },
  {
    id: 'lb-9',
    name: 'Imran Qureshi',
    location: 'Lucknow, India',
    rank: 9,
    coins: 1_000,
    perk: 'Fitness Mat',
    avatarUrl: null,
    isCurrentUser: false,
    score: 1_544,
  },
  {
    id: 'lb-10',
    name: 'Meera Pillai',
    location: 'Ahmedabad, India',
    rank: 10,
    coins: 1_000,
    perk: 'Fitness Mat',
    avatarUrl: null,
    isCurrentUser: false,
    score: 1_470,
  },
  {
    id: 'lb-11',
    name: 'Kabir Chawla',
    location: 'Chandigarh, India',
    rank: 11,
    coins: 0,
    perk: '',
    avatarUrl: null,
    isCurrentUser: false,
    score: 1_388,
  },
  {
    id: 'lb-12',
    name: 'Divya Rao',
    location: 'Indore, India',
    rank: 12,
    coins: 0,
    perk: '',
    avatarUrl: null,
    isCurrentUser: false,
    score: 1_302,
  },
];

/**
 * What the user has to show for their own weeks on the board.
 *
 * Kept here with the other placeholder figures rather than in a store: nothing
 * on the leaderboard screen changes them, and they are replaced wholesale by
 * the ranking endpoint later.
 */
export const leaderboardHighlights = {
  bestRank: 7,
  /** The last day of the week it was won, `YYYY-MM-DD`. */
  bestRankAchievedOn: dateDaysAgo(40),
  topTenFinishes: 3,
  rewardCoinsEarned: 2_350,
  rewardsWon: 1,
};

/**
 * The hydration figures the app cannot work out yet: a best streak, an average
 * and a hit rate all need a history of days, and the store keeps only today.
 * Replaced by the hydration endpoint later, which is why nothing else reads
 * these by name.
 */
export const hydrationHighlights = {
  bestStreakDays: 7,
  dailyAverageMl: 2_400,
  goalHitRatePercent: 85,
  dailyReminders: 3,
};

/** The line at the foot of the hydration screen. */
export const hydrationTip = "Drink water regularly; don't wait until thirsty.";

/**
 * The vitals the checkup screen opens with, newest first.
 *
 * Only the numbers are seeded. Whether each one is normal is worked out at
 * render from the reference ranges, so a fixture cannot claim a pulse of 140
 * is fine — see `components/health/vitals.ts`.
 */
export const seedVitals: VitalReading[] = [
  {
    id: 'v-hr-1',
    kind: 'heart_rate',
    value: 72,
    secondary: null,
    recordedAt: at(0, 9, 30),
  },
  {
    id: 'v-bp-1',
    kind: 'blood_pressure',
    value: 118,
    secondary: 76,
    recordedAt: at(0, 9, 30),
  },
  {
    id: 'v-bp-2',
    kind: 'blood_pressure',
    value: 122,
    secondary: 78,
    recordedAt: at(1, 21, 15),
  },
  {
    id: 'v-bp-3',
    kind: 'blood_pressure',
    value: 116,
    secondary: 74,
    recordedAt: at(2, 10, 20),
  },
  {
    id: 'v-bp-4',
    kind: 'blood_pressure',
    value: 126,
    secondary: 82,
    recordedAt: at(3, 18, 45),
  },
  {
    id: 'v-bp-5',
    kind: 'blood_pressure',
    value: 119,
    secondary: 77,
    recordedAt: at(4, 8, 40),
  },
  {
    id: 'v-bp-6',
    kind: 'blood_pressure',
    value: 114,
    secondary: 72,
    recordedAt: at(5, 9, 10),
  },
  {
    id: 'v-bp-7',
    kind: 'blood_pressure',
    value: 121,
    secondary: 79,
    recordedAt: at(6, 20, 5),
  },
  {
    id: 'v-bmi-1',
    kind: 'bmi',
    value: 22.4,
    secondary: null,
    recordedAt: at(0, 9, 30),
  },
  {
    id: 'v-wt-1',
    kind: 'weight',
    value: 65,
    secondary: null,
    recordedAt: at(0, 8, 15),
  },
  {
    id: 'v-hr-1b',
    kind: 'heart_rate',
    value: 68,
    secondary: null,
    recordedAt: at(1, 21, 15),
  },
  {
    id: 'v-hr-2',
    kind: 'heart_rate',
    value: 74,
    secondary: null,
    recordedAt: at(2, 9, 5),
  },
  {
    id: 'v-hr-0',
    kind: 'heart_rate',
    value: 76,
    secondary: null,
    recordedAt: at(3, 10, 20),
  },
  {
    id: 'v-hr-4',
    kind: 'heart_rate',
    value: 70,
    secondary: null,
    recordedAt: at(4, 18, 45),
  },
  {
    id: 'v-hr-5',
    kind: 'heart_rate',
    value: 79,
    secondary: null,
    recordedAt: at(5, 7, 50),
  },
  {
    id: 'v-hr-6',
    kind: 'heart_rate',
    value: 73,
    secondary: null,
    recordedAt: at(6, 8, 10),
  },
  {
    id: 'v-hr-7',
    kind: 'heart_rate',
    value: 71,
    secondary: null,
    recordedAt: at(7, 9, 30),
  },
  {
    id: 'v-wt-0',
    kind: 'weight',
    value: 65.6,
    secondary: null,
    recordedAt: at(7, 8, 10),
  },
];

/**
 * The health score, until a health service works one out.
 *
 * Seeded rather than derived from the vitals above: a number out of a hundred
 * that claims to summarise somebody's health is a clinical judgement, not an
 * average of four readings, and inventing the arithmetic here would put a
 * figure on screen that nothing could justify. The band under it — "Good" — is
 * presentation and is derived from the score.
 */
export const healthHighlights = {
  score: 82,
  outOf: 100,
};

/** The line at the foot of the checkup screen. */
export const healthTip =
  'Drink enough water, eat balanced meals and sleep well.';

/**
 * What the day's plate looks like when the app is opened cold.
 *
 * Eleven items across four meals. Seeded as the items themselves rather than
 * as four meal totals, because the screen states both — "4 items · 650 kcal" —
 * and a meal whose figure did not match the food under it would be wrong in
 * the one place a user can check it.
 */
export const seedFoodEntries: FoodEntry[] = [
  {
    id: 'f-b1',
    slot: 'breakfast',
    name: 'Oats with milk',
    portion: '',
    calories: 260,
    proteinG: 10,
    carbsG: 38,
    fiberG: 0,
    fatsG: 6,
    loggedAt: at(0, 8, 30),
  },
  {
    id: 'f-b2',
    slot: 'breakfast',
    name: 'Banana',
    portion: '',
    calories: 90,
    proteinG: 1,
    carbsG: 18,
    fiberG: 0,
    fatsG: 0,
    loggedAt: at(0, 8, 35),
  },
  {
    id: 'f-b3',
    slot: 'breakfast',
    name: 'Paneer cubes',
    portion: '',
    calories: 100,
    proteinG: 8,
    carbsG: 2,
    fiberG: 0,
    fatsG: 7,
    loggedAt: at(0, 8, 40),
  },

  {
    id: 'f-l1',
    slot: 'lunch',
    name: 'Dal tadka',
    portion: '',
    calories: 180,
    proteinG: 10,
    carbsG: 22,
    fiberG: 0,
    fatsG: 5,
    loggedAt: at(0, 13, 30),
  },
  {
    id: 'f-l2',
    slot: 'lunch',
    name: 'Brown rice',
    portion: '',
    calories: 220,
    proteinG: 5,
    carbsG: 42,
    fiberG: 0,
    fatsG: 2,
    loggedAt: at(0, 13, 32),
  },
  {
    id: 'f-l3',
    slot: 'lunch',
    name: 'Mixed veg sabzi',
    portion: '',
    calories: 150,
    proteinG: 5,
    carbsG: 14,
    fiberG: 0,
    fatsG: 6,
    loggedAt: at(0, 13, 34),
  },
  {
    id: 'f-l4',
    slot: 'lunch',
    name: 'Curd',
    portion: '',
    calories: 100,
    proteinG: 6,
    carbsG: 12,
    fiberG: 0,
    fatsG: 4,
    loggedAt: at(0, 13, 36),
  },

  {
    id: 'f-s1',
    slot: 'snack',
    name: 'Protein shake',
    portion: '',
    calories: 200,
    proteinG: 25,
    carbsG: 12,
    fiberG: 0,
    fatsG: 3,
    loggedAt: at(0, 17, 0),
  },

  {
    id: 'f-d1',
    slot: 'dinner',
    name: 'Roti',
    portion: '',
    calories: 160,
    proteinG: 6,
    carbsG: 32,
    fiberG: 0,
    fatsG: 2,
    loggedAt: at(0, 20, 0),
  },
  {
    id: 'f-d2',
    slot: 'dinner',
    name: 'Paneer bhurji',
    portion: '',
    calories: 150,
    proteinG: 8,
    carbsG: 5,
    fiberG: 0,
    fatsG: 9,
    loggedAt: at(0, 20, 5),
  },
  {
    id: 'f-d3',
    slot: 'dinner',
    name: 'Salad',
    portion: '',
    calories: 40,
    proteinG: 1,
    carbsG: 8,
    fiberG: 0,
    fatsG: 1,
    loggedAt: at(0, 20, 8),
  },
];

/** The nutrition line the AI strip shows, until a service writes one. */
export const nutritionTip =
  'Add more protein to your dinner for better muscle recovery.';

/**
 * The diet plan, as a three-day rotation.
 *
 * A rotation rather than a plan per date: that is how a dietitian actually
 * writes one, and it means every day the user pages to — forwards or back —
 * has a plan behind it without the seed having to invent a year of them.
 * `dietPlanForDate` in the diet plan store is what maps a date onto a day of
 * the cycle.
 *
 * Day one is the plan the screen was designed around; its four meals add up to
 * 1,250 kcal, which is the figure the ring above them draws.
 */
export const dietPlanRotation: PlannedMeal[][] = [
  [
    {
      id: 'p1-breakfast',
      slot: 'breakfast',
      time: '08:00',
      calories: 320,
      proteinG: 18,
      carbsG: 42,
      fatsG: 9,
      items: [
        { name: 'Oats with banana', quantity: '1 bowl (200g)' },
        { name: 'Boiled eggs', quantity: '2 eggs' },
        { name: 'Green tea', quantity: '1 cup' },
      ],
    },
    {
      id: 'p1-lunch',
      slot: 'lunch',
      time: '13:00',
      calories: 450,
      proteinG: 26,
      carbsG: 58,
      fatsG: 14,
      items: [
        { name: 'Brown rice', quantity: '1 cup (150g)' },
        { name: 'Dal', quantity: '1 bowl (150g)' },
        { name: 'Mixed salad', quantity: '1 bowl' },
        { name: 'Paneer curry', quantity: '100g' },
      ],
    },
    {
      id: 'p1-snack',
      slot: 'snack',
      time: '17:00',
      calories: 180,
      proteinG: 6,
      carbsG: 18,
      fatsG: 11,
      items: [
        { name: 'Mixed nuts', quantity: '30g' },
        { name: 'Apple', quantity: '1 medium' },
        { name: 'Black coffee', quantity: '1 cup' },
      ],
    },
    {
      id: 'p1-dinner',
      slot: 'dinner',
      time: '20:00',
      calories: 300,
      proteinG: 32,
      carbsG: 32,
      fatsG: 11,
      items: [
        { name: 'Grilled chicken', quantity: '100g' },
        { name: 'Steamed veggies', quantity: '1 bowl' },
        { name: 'Quinoa', quantity: '1 cup (100g)' },
      ],
    },
  ],
  [
    {
      id: 'p2-breakfast',
      slot: 'breakfast',
      time: '08:00',
      calories: 350,
      proteinG: 20,
      carbsG: 44,
      fatsG: 10,
      items: [
        { name: 'Poha with peanuts', quantity: '1 plate (200g)' },
        { name: 'Curd', quantity: '1 bowl' },
        { name: 'Black coffee', quantity: '1 cup' },
      ],
    },
    {
      id: 'p2-lunch',
      slot: 'lunch',
      time: '13:00',
      calories: 470,
      proteinG: 28,
      carbsG: 60,
      fatsG: 13,
      items: [
        { name: 'Roti', quantity: '3' },
        { name: 'Rajma', quantity: '1 bowl (150g)' },
        { name: 'Cucumber salad', quantity: '1 bowl' },
      ],
    },
    {
      id: 'p2-snack',
      slot: 'snack',
      time: '17:00',
      calories: 160,
      proteinG: 12,
      carbsG: 14,
      fatsG: 5,
      items: [
        { name: 'Sprouts chaat', quantity: '1 bowl' },
        { name: 'Green tea', quantity: '1 cup' },
      ],
    },
    {
      id: 'p2-dinner',
      slot: 'dinner',
      time: '20:00',
      calories: 320,
      proteinG: 30,
      carbsG: 30,
      fatsG: 12,
      items: [
        { name: 'Grilled fish', quantity: '120g' },
        { name: 'Sautéed spinach', quantity: '1 bowl' },
        { name: 'Millet khichdi', quantity: '1 cup' },
      ],
    },
  ],
  [
    {
      id: 'p3-breakfast',
      slot: 'breakfast',
      time: '08:00',
      calories: 330,
      proteinG: 22,
      carbsG: 38,
      fatsG: 10,
      items: [
        { name: 'Besan chilla', quantity: '2' },
        { name: 'Mint chutney', quantity: '2 tbsp' },
        { name: 'Buttermilk', quantity: '1 glass' },
      ],
    },
    {
      id: 'p3-lunch',
      slot: 'lunch',
      time: '13:00',
      calories: 440,
      proteinG: 25,
      carbsG: 56,
      fatsG: 12,
      items: [
        { name: 'Vegetable pulao', quantity: '1 bowl (180g)' },
        { name: 'Soya chunk curry', quantity: '100g' },
        { name: 'Raita', quantity: '1 bowl' },
      ],
    },
    {
      id: 'p3-snack',
      slot: 'snack',
      time: '17:00',
      calories: 170,
      proteinG: 8,
      carbsG: 20,
      fatsG: 7,
      items: [
        { name: 'Roasted chana', quantity: '40g' },
        { name: 'Orange', quantity: '1 medium' },
      ],
    },
    {
      id: 'p3-dinner',
      slot: 'dinner',
      time: '20:00',
      calories: 310,
      proteinG: 28,
      carbsG: 34,
      fatsG: 10,
      items: [
        { name: 'Paneer tikka', quantity: '120g' },
        { name: 'Stir-fried veggies', quantity: '1 bowl' },
        { name: 'Jowar roti', quantity: '2' },
      ],
    },
  ],
];

/**
 * The food library the add-meal screen searches and quick-adds from.
 *
 * Short on purpose: it is a stand-in for a nutrition database of hundreds of
 * thousands of items, and the screen's job is to show how logging works, not
 * to be that database. Every figure is per the portion beside it.
 */
export const foodLibrary: FoodItem[] = [
  {
    id: 'fl-oats',
    name: 'Oats (Cooked)',
    portion: '1 Cup (150 g)',
    emoji: '🥣',
    calories: 150,
    proteinG: 5,
    carbsG: 27,
    fatsG: 3,
    fiberG: 4,
  },
  {
    id: 'fl-banana',
    name: 'Banana',
    portion: '1 Medium (118 g)',
    emoji: '🍌',
    calories: 89,
    proteinG: 1,
    carbsG: 23,
    fatsG: 0.3,
    fiberG: 2.6,
  },
  {
    id: 'fl-egg',
    name: 'Boiled Egg',
    portion: '1 Large (50 g)',
    emoji: '🥚',
    calories: 78,
    proteinG: 6,
    carbsG: 0.6,
    fatsG: 5,
    fiberG: 0,
  },
  {
    id: 'fl-peanut-butter',
    name: 'Peanut Butter',
    portion: '1 Tbsp (16 g)',
    emoji: '🥜',
    calories: 94,
    proteinG: 4,
    carbsG: 3,
    fatsG: 8,
    fiberG: 1,
  },
  {
    id: 'fl-brown-rice',
    name: 'Brown Rice',
    portion: '1 Cup (150 g)',
    emoji: '🍚',
    calories: 215,
    proteinG: 5,
    carbsG: 45,
    fatsG: 1.8,
    fiberG: 3.5,
  },
  {
    id: 'fl-dal',
    name: 'Dal',
    portion: '1 Bowl (150 g)',
    emoji: '🍲',
    calories: 180,
    proteinG: 10,
    carbsG: 22,
    fatsG: 5,
    fiberG: 6,
  },
  {
    id: 'fl-paneer',
    name: 'Paneer',
    portion: '100 g',
    emoji: '🧀',
    calories: 265,
    proteinG: 18,
    carbsG: 6,
    fatsG: 20,
    fiberG: 0,
  },
  {
    id: 'fl-curd',
    name: 'Curd',
    portion: '1 Bowl (150 g)',
    emoji: '🥛',
    calories: 98,
    proteinG: 6,
    carbsG: 8,
    fatsG: 4,
    fiberG: 0,
  },
  {
    id: 'fl-roti',
    name: 'Roti',
    portion: '1 Piece (40 g)',
    emoji: '🫓',
    calories: 104,
    proteinG: 3,
    carbsG: 20,
    fatsG: 1.5,
    fiberG: 2,
  },
  {
    id: 'fl-chicken',
    name: 'Grilled Chicken',
    portion: '100 g',
    emoji: '🍗',
    calories: 165,
    proteinG: 31,
    carbsG: 0,
    fatsG: 3.6,
    fiberG: 0,
  },
  {
    id: 'fl-salad',
    name: 'Mixed Salad',
    portion: '1 Bowl (120 g)',
    emoji: '🥗',
    calories: 45,
    proteinG: 2,
    carbsG: 8,
    fatsG: 0.5,
    fiberG: 3,
  },
  {
    id: 'fl-almonds',
    name: 'Almonds',
    portion: '10 pieces (12 g)',
    emoji: '🌰',
    calories: 70,
    proteinG: 3,
    carbsG: 2.5,
    fatsG: 6,
    fiberG: 1.5,
  },
  {
    id: 'fl-apple',
    name: 'Apple',
    portion: '1 Medium (180 g)',
    emoji: '🍎',
    calories: 95,
    proteinG: 0.5,
    carbsG: 25,
    fatsG: 0.3,
    fiberG: 4.4,
  },
  {
    id: 'fl-coffee',
    name: 'Black Coffee',
    portion: '1 Cup',
    emoji: '☕',
    calories: 5,
    proteinG: 0.3,
    carbsG: 0,
    fatsG: 0,
    fiberG: 0,
  },
  {
    id: 'fl-protein-shake',
    name: 'Protein Shake',
    portion: '1 Scoop (30 g)',
    emoji: '🥤',
    calories: 120,
    proteinG: 24,
    carbsG: 3,
    fatsG: 1.5,
    fiberG: 0,
  },
];

/** What the quick-add row offers, in the order it draws them. */
export const quickAddFoodIds = [
  'fl-oats',
  'fl-banana',
  'fl-egg',
  'fl-peanut-butter',
];

/** The user's own code. Per user, so it lives with the other placeholders. */
export const referralCode = 'VOKVE123';

/** What one verified referral pays each side. */
export const REFERRAL_REWARD_COINS = 20;

const referral = (
  id: string,
  name: string,
  joinedDaysAgo: number,
  status: Referral['status'] = 'rewarded',
): Referral => ({
  id,
  name,
  joinedAt: dateDaysAgo(joinedDaysAgo),
  status,
  rewardCoins: REFERRAL_REWARD_COINS,
});

/**
 * Who has joined on the user's code, newest first.
 *
 * Twenty rows so the figures at the top of the screen are counts rather than
 * numbers typed in: eighteen rewarded and two still verifying, which at twenty
 * coins each is the 360 the coins figure has to show. The three the design
 * lists are the three most recent.
 */
export const seedReferrals: Referral[] = [
  referral('r-1', 'Arjun Mehta', 0, 'pending'),
  referral('r-2', 'Rohit Sharma', 1),
  referral('r-3', 'Neha Verma', 3),
  referral('r-4', 'Priya Nair', 5, 'pending'),
  referral('r-5', 'Karan Singh', 8),
  referral('r-6', 'Sneha Iyer', 11),
  referral('r-7', 'Vikram Yadav', 14),
  referral('r-8', 'Aisha Khan', 17),
  referral('r-9', 'Dev Patel', 20),
  referral('r-10', 'Meera Joshi', 24),
  referral('r-11', 'Rahul Gupta', 27),
  referral('r-12', 'Tanvi Rao', 31),
  referral('r-13', 'Sameer Ali', 35),
  referral('r-14', 'Pooja Desai', 39),
  referral('r-15', 'Nikhil Bose', 43),
  referral('r-16', 'Ananya Sen', 48),
  referral('r-17', 'Harsh Vora', 52),
  referral('r-18', 'Ritika Jain', 57),
  referral('r-19', 'Aman Chaudhary', 62),
  referral('r-20', 'Divya Menon', 68),
];
