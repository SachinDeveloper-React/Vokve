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
 * The catalogue: what you wear, what you train with, what you play with,
 * and the small things that go with any of them. Prices are paise (RULES
 * R11) with the list price they are struck against where there is one;
 * coins go towards them at the till (⚙ `commerce.coinShareMax` of the
 * goods, ⚙ `commerce.coinValuePaise` each), so at 30% and ₹0.25 a coin a
 * ₹799 tee takes up to 958 coins — about a fortnight of training.
 * `popularity` is a starting figure; every order adds to it.
 */
const listed = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

export const SHOP_ITEMS = [
  // ── Clothing ─────────────────────────────────────────────────────────────
  { _id: 'tee', title: 'VOKVE Training Tee', description: 'Breathable training tee with the wordmark across the chest. Sizes S–XXL.', price: 79900, mrp: 119900, category: 'clothing', subcategory: 'T-shirts', emoji: '👕', badge: 'bestseller', isDeal: false, featured: true, tags: ['tshirt', 't-shirt', 'top', 'gym wear'], sizes: ['S', 'M', 'L', 'XL', 'XXL'], popularity: 320, listedAt: listed(120), sort: 1 },
  { _id: 'tank-top', title: 'Mesh Tank Top', description: 'Lightweight mesh-back tank for leg day and summer runs.', price: 59900, mrp: 89900, category: 'clothing', subcategory: 'T-shirts', emoji: '🎽', badge: null, isDeal: false, featured: false, tags: ['vest', 'sleeveless', 'tank'], sizes: ['S', 'M', 'L', 'XL'], popularity: 140, listedAt: listed(60), sort: 2 },
  { _id: 'hoodie', title: 'VOKVE Hoodie', description: 'Heavyweight cotton hoodie for the walk to the gym.', price: 149900, mrp: 219900, category: 'clothing', subcategory: 'Hoodies', emoji: '🧥', badge: null, isDeal: false, featured: true, tags: ['sweatshirt', 'jumper', 'winter'], sizes: ['S', 'M', 'L', 'XL', 'XXL'], popularity: 210, listedAt: listed(90), sort: 3 },
  { _id: 'shorts', title: 'Training Shorts', description: 'Quick-dry shorts with a zipped phone pocket.', price: 69900, mrp: 99900, category: 'clothing', subcategory: 'Bottoms', emoji: '🩳', badge: null, isDeal: true, featured: true, tags: ['gym shorts', 'running'], sizes: ['S', 'M', 'L', 'XL'], popularity: 260, listedAt: listed(80), sort: 4 },
  { _id: 'joggers', title: 'Tapered Joggers', description: 'Four-way stretch joggers with a cuffed ankle.', price: 109900, mrp: null, category: 'clothing', subcategory: 'Bottoms', emoji: '👖', badge: 'new_arrival', isDeal: false, featured: false, tags: ['track pants', 'trousers', 'sweatpants'], sizes: ['S', 'M', 'L', 'XL'], popularity: 90, listedAt: listed(7), sort: 5 },
  { _id: 'sports-bra', title: 'Support Sports Bra', description: 'Medium-support bra with a racerback and wide underband.', price: 89900, mrp: 129900, category: 'clothing', subcategory: 'Tops', emoji: '🩱', badge: null, isDeal: false, featured: false, tags: ['bra', 'women', 'top'], sizes: ['S', 'M', 'L', 'XL'], popularity: 170, listedAt: listed(45), sort: 6 },
  { _id: 'cap', title: 'VOKVE Cap', description: 'Curved-peak cap, one size, embroidered logo.', price: 44900, mrp: 59900, category: 'clothing', subcategory: 'Headwear', emoji: '🧢', badge: 'limited', isDeal: false, featured: false, tags: ['hat', 'sun'], sizes: [], popularity: 180, listedAt: listed(100), sort: 7 },
  { _id: 'socks', title: 'Cushioned Socks · 3 pack', description: 'Ankle socks with a cushioned sole and arch band.', price: 29900, mrp: 44900, category: 'clothing', subcategory: 'Socks', emoji: '🧦', badge: null, isDeal: true, featured: false, tags: ['ankle socks', 'pack'], sizes: [], popularity: 300, listedAt: listed(30), sort: 8 },

  // ── Gym ──────────────────────────────────────────────────────────────────
  { _id: 'yoga-mat', title: 'Yoga Mat', description: '6mm non-slip mat with a carry strap.', price: 99900, mrp: 149900, category: 'gym', subcategory: 'Mats', emoji: '🧘', badge: 'popular', isDeal: false, featured: true, tags: ['exercise mat', 'stretching', 'pilates'], sizes: [], popularity: 290, listedAt: listed(110), sort: 10 },
  { _id: 'resistance-bands', title: 'Resistance Band Set', description: 'Five loops, light through extra heavy.', price: 64900, mrp: 89900, category: 'gym', subcategory: 'Bands', emoji: '🔗', badge: null, isDeal: false, featured: true, tags: ['loop bands', 'booty bands', 'home workout'], sizes: [], popularity: 240, listedAt: listed(70), sort: 11 },
  { _id: 'wrist-wraps', title: 'Wrist Wraps', description: 'Elastic wraps for press days.', price: 34900, mrp: 49900, category: 'gym', subcategory: 'Support', emoji: '🧤', badge: null, isDeal: true, featured: false, tags: ['lifting', 'bench', 'support'], sizes: [], popularity: 120, listedAt: listed(50), sort: 12 },
  { _id: 'lifting-straps', title: 'Lifting Straps', description: 'Padded cotton straps for deadlifts and rows.', price: 39900, mrp: null, category: 'gym', subcategory: 'Support', emoji: '🪢', badge: null, isDeal: false, featured: false, tags: ['deadlift', 'grip', 'straps'], sizes: [], popularity: 110, listedAt: listed(40), sort: 13 },
  { _id: 'gym-gloves', title: 'Grip Gym Gloves', description: 'Half-finger gloves with a silicone palm.', price: 49900, mrp: 69900, category: 'gym', subcategory: 'Support', emoji: '🥊', badge: null, isDeal: false, featured: false, tags: ['gloves', 'grip', 'weights'], sizes: ['S', 'M', 'L', 'XL'], popularity: 130, listedAt: listed(65), sort: 14 },
  { _id: 'foam-roller', title: 'Foam Roller', description: 'High-density 45cm roller for recovery days.', price: 69900, mrp: 99900, category: 'gym', subcategory: 'Recovery', emoji: '🧻', badge: null, isDeal: false, featured: false, tags: ['recovery', 'massage', 'mobility'], sizes: [], popularity: 150, listedAt: listed(55), sort: 15 },
  { _id: 'kettlebell-8', title: 'Kettlebell 8 kg', description: 'Cast-iron kettlebell with a powder-coat grip.', price: 179900, mrp: null, category: 'gym', subcategory: 'Weights', emoji: '🏋️', badge: 'new_arrival', isDeal: false, featured: false, tags: ['kettlebell', 'weights', 'strength'], sizes: [], popularity: 60, listedAt: listed(10), sort: 16 },
  { _id: 'jump-rope', title: 'Speed Rope', description: 'Ball-bearing speed rope, adjustable length.', price: 29900, mrp: 44900, category: 'gym', subcategory: 'Cardio', emoji: '➰', badge: null, isDeal: true, featured: false, tags: ['skipping rope', 'jump rope', 'cardio'], sizes: [], popularity: 200, listedAt: listed(85), sort: 17 },

  // ── Sports ───────────────────────────────────────────────────────────────
  { _id: 'football', title: 'Match Football · Size 5', description: 'Machine-stitched size 5 ball for turf and grass.', price: 94900, mrp: 129900, category: 'sports', subcategory: 'Football', emoji: '⚽', badge: 'popular', isDeal: false, featured: true, tags: ['soccer', 'ball', 'football'], sizes: [], popularity: 230, listedAt: listed(75), sort: 20 },
  { _id: 'badminton-set', title: 'Badminton Racket Set', description: 'Two aluminium rackets with a carry sleeve.', price: 119900, mrp: 169900, category: 'sports', subcategory: 'Badminton', emoji: '🏸', badge: null, isDeal: false, featured: true, tags: ['racket', 'racquet', 'badminton'], sizes: [], popularity: 160, listedAt: listed(35), sort: 21 },
  { _id: 'shuttlecocks', title: 'Feather Shuttlecocks · 6', description: 'Tournament-grade feather shuttles, tube of six.', price: 39900, mrp: 54900, category: 'sports', subcategory: 'Badminton', emoji: '🪶', badge: null, isDeal: true, featured: false, tags: ['shuttle', 'birdie', 'badminton'], sizes: [], popularity: 190, listedAt: listed(20), sort: 22 },
  { _id: 'cricket-ball', title: 'Leather Cricket Ball', description: 'Four-piece leather ball, 156 g.', price: 54900, mrp: 69900, category: 'sports', subcategory: 'Cricket', emoji: '🏏', badge: null, isDeal: false, featured: false, tags: ['cricket', 'ball', 'leather'], sizes: [], popularity: 170, listedAt: listed(60), sort: 23 },
  { _id: 'tennis-balls', title: 'Tennis Balls · 3', description: 'Pressurised felt balls in a can of three.', price: 34900, mrp: null, category: 'sports', subcategory: 'Tennis', emoji: '🎾', badge: null, isDeal: false, featured: false, tags: ['tennis', 'ball', 'can'], sizes: [], popularity: 100, listedAt: listed(25), sort: 24 },
  { _id: 'swim-goggles', title: 'Anti-fog Swim Goggles', description: 'Mirrored lenses with a split silicone strap.', price: 49900, mrp: 74900, category: 'sports', subcategory: 'Swimming', emoji: '🥽', badge: null, isDeal: false, featured: false, tags: ['swimming', 'goggles', 'pool'], sizes: [], popularity: 80, listedAt: listed(15), sort: 25 },
  { _id: 'running-belt', title: 'Running Belt', description: 'Slim waist belt with a stretch pocket for a phone and keys.', price: 44900, mrp: 64900, category: 'sports', subcategory: 'Running', emoji: '🏃', badge: null, isDeal: true, featured: false, tags: ['running', 'waist bag', 'phone holder'], sizes: [], popularity: 140, listedAt: listed(28), sort: 26 },

  // ── Accessories ──────────────────────────────────────────────────────────
  { _id: 'steel-bottle', title: 'VOKVE Steel Bottle', description: '750ml double-wall steel — cold for 24 hours.', price: 59900, mrp: 89900, category: 'accessories', subcategory: 'Bottles', emoji: '🍶', badge: 'popular', isDeal: false, featured: true, tags: ['water bottle', 'flask', 'hydration'], sizes: [], popularity: 310, listedAt: listed(115), sort: 30 },
  { _id: 'shaker', title: 'Protein Shaker 600 ml', description: 'Leak-proof shaker with a mixing ball.', price: 24900, mrp: 34900, category: 'accessories', subcategory: 'Bottles', emoji: '🥤', badge: null, isDeal: false, featured: false, tags: ['shaker', 'protein', 'bottle'], sizes: [], popularity: 220, listedAt: listed(95), sort: 31 },
  { _id: 'gym-towel', title: 'Microfibre Towel', description: 'Quick-dry, with a clip for the rack.', price: 24900, mrp: null, category: 'accessories', subcategory: 'Towels', emoji: '🧺', badge: null, isDeal: false, featured: false, tags: ['towel', 'sweat'], sizes: [], popularity: 150, listedAt: listed(105), sort: 32 },
  { _id: 'gym-bag', title: 'Duffel Gym Bag', description: '30 L duffel with a shoe compartment and wet pocket.', price: 129900, mrp: 179900, category: 'accessories', subcategory: 'Bags', emoji: '🎒', badge: 'new_arrival', isDeal: false, featured: false, tags: ['bag', 'duffel', 'kit bag'], sizes: [], popularity: 70, listedAt: listed(5), sort: 33 },
  { _id: 'sweatbands', title: 'Sweatband Set', description: 'Headband and two wristbands in cotton terry.', price: 19900, mrp: 29900, category: 'accessories', subcategory: 'Wearables', emoji: '🎗️', badge: null, isDeal: true, featured: false, tags: ['headband', 'wristband', 'sweat'], sizes: [], popularity: 90, listedAt: listed(48), sort: 34 },
] as const;

/** A demo quantity to start; the limited cap with three, and one sold-out line so that state can be seen. */
export const SHOP_STOCK = SHOP_ITEMS.map(item => ({
  _id: item._id,
  onHand: item._id === 'gym-towel' ? 0 : item.badge === 'limited' ? 3 : 25,
  lowStockAt: 5,
}));
