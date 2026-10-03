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

/**
 * The help centre's starting articles. Written as answers to what a member
 * would actually type into the search box — "my coins are gone", "wrong
 * size" — rather than as headings from our own org chart.
 */
export const SUPPORT_FAQS = [
  { _id: 'faq-coins-earn', category: 'coins', question: 'How do I earn coins?', sort: 1,
    answer: 'Walking, finishing a workout, keeping a streak, winning a challenge and inviting friends all pay coins. Steps pay a little every 100 you walk, a workout pays a fixed amount, and streak milestones pay a bonus. There is a daily ceiling across everything so one big day cannot pay forever.',
    tags: ['earning', 'steps', 'rewards', 'points'] },
  { _id: 'faq-coins-missing', category: 'coins', question: 'My coins did not arrive. Where are they?', sort: 2,
    answer: 'Step coins are held briefly while we check the day looks real, and appear as "pending" in your wallet until then. If you have hit the daily cap, anything further that day pays nothing — the cap resets at midnight in your timezone. Coin History shows every credit with its reason.',
    tags: ['missing', 'pending', 'not credited', 'cap'] },
  { _id: 'faq-coins-expiry', category: 'coins', question: 'Do my coins expire?', sort: 3,
    answer: 'Coins expire after 90 days without earning anything. Earning even one coin resets the whole window — spending does not. We warn you 14 days and 3 days before.',
    tags: ['expire', 'expiry', 'lost coins'] },
  { _id: 'faq-orders-pay', category: 'payments', question: 'How much can I pay with coins?', sort: 1,
    answer: 'Coins cover up to 30% of the items in an order, at ₹0.25 a coin; the rest, and delivery, is paid by card or UPI. The checkout shows the exact split before you pay and you can use fewer coins if you want to save them.',
    tags: ['discount', 'split', 'upi', 'card', 'price'] },
  { _id: 'faq-orders-track', category: 'orders', question: 'Where is my order?', sort: 1,
    answer: 'My Orders shows every order and where it is. Once it ships you get a tracking reference there and a notification. Most orders reach you in 2–4 working days.',
    tags: ['tracking', 'delivery', 'shipped', 'late'] },
  { _id: 'faq-orders-cancel', category: 'orders', question: 'Can I cancel or return an order?', sort: 2,
    answer: 'You can cancel from the order page any time before it ships — the coins go straight back to your wallet and any money is refunded to where it came from. After it ships, open a support ticket and we will sort out a return.',
    tags: ['cancel', 'return', 'refund'] },
  { _id: 'faq-tracking-steps', category: 'tracking', question: 'My steps are not being counted', sort: 1,
    answer: 'VOKVE reads steps from your phone\u2019s health service. Check that VOKVE still has permission, that battery optimisation is not stopping it in the background, and that you have opened the app at least once today. Steps sync when the app opens.',
    tags: ['steps', 'health connect', 'permission', 'not counting', 'pedometer'] },
  { _id: 'faq-account-email', category: 'account', question: 'How do I change my email or phone number?', sort: 1,
    answer: 'Account \u2192 Security. Enter your password and the new address or number; we send a code to the new one and it only moves once that code passes. The old one keeps working until then.',
    tags: ['email', 'phone', 'number', 'change', 'update'] },
  { _id: 'faq-account-delete', category: 'account', question: 'How do I delete my account?', sort: 2,
    answer: 'Account \u2192 Privacy \u2192 Delete account. Deletion is scheduled 14 days ahead so you can change your mind — cancel it from the same screen any time before then. After that your personal data is erased; order and payment records are kept anonymised for accounting.',
    tags: ['delete', 'close account', 'remove', 'gdpr'] },
  { _id: 'faq-account-data', category: 'account', question: 'Can I get a copy of my data?', sort: 3,
    answer: 'Yes \u2014 Account \u2192 Privacy \u2192 Download my data gives you a JSON file with your profile, activity, workouts, orders, addresses and notifications. You can ask for one once a day.',
    tags: ['export', 'download', 'copy', 'gdpr', 'data'] },
  { _id: 'faq-other-support', category: 'other', question: 'How do I reach a human?', sort: 1,
    answer: 'Open a ticket from Help & Support and we will reply inside the app. Tickets carry your app version and device automatically, so you do not have to describe your phone to us.',
    tags: ['contact', 'human', 'ticket', 'email us'] },
] as const;

/**
 * The challenge catalogue (RULES §C), from the board the app was designed
 * around. The rewards are the inherited ones (D-32 — the owner rebalances
 * them in `challenge_definitions`; the daily ceiling applies regardless).
 * `startsInDays` sets a challenge's opening day the first time it is seeded,
 * relative to that day; a re-seed never moves it.
 */
export const CHALLENGES = [
  { _id: 'ch-10k-steps', title: '10K Steps Challenge', description: 'Walk 10,000 steps in a day', emoji: '👟', metric: 'steps', cadence: 'daily', goal: 10_000, rewardCoins: 200, rewardsBadge: true, badgeId: 'a-10k-steps', sort: 1, startsInDays: null },
  { _id: 'ch-burn-500', title: 'Burn 500 Calories', description: 'Burn 500 calories in a day', emoji: '🔥', metric: 'calories', cadence: 'daily', goal: 500, rewardCoins: 150, rewardsBadge: true, badgeId: 'a-cal-burner', sort: 2, startsInDays: null },
  { _id: 'ch-30-min-active', title: '30 Min Active Time', description: 'Be active for 30 minutes', emoji: '⏱️', metric: 'minutes', cadence: 'daily', goal: 30, rewardCoins: 100, rewardsBadge: true, badgeId: 'a-active-30', sort: 3, startsInDays: null },
  { _id: 'ch-week-step-master', title: 'Weekly Step Master', description: 'Walk 70,000 steps this week', emoji: '🚶', metric: 'steps', cadence: 'weekly', goal: 70_000, rewardCoins: 800, rewardsBadge: true, badgeId: 'a-step-master', sort: 4, startsInDays: null },
  { _id: 'ch-month-mover', title: 'Monthly Mover', description: 'Log 900 active minutes this month', emoji: '🗓️', metric: 'minutes', cadence: 'monthly', goal: 900, rewardCoins: 2_000, rewardsBadge: true, badgeId: 'a-month-mover', sort: 5, startsInDays: null },
  { _id: 'ch-15k-steps', title: '15K Steps Challenge', description: 'Walk 15,000 steps in a day', emoji: '🏃', metric: 'steps', cadence: 'daily', goal: 15_000, rewardCoins: 300, rewardsBadge: false, badgeId: null, sort: 6, startsInDays: 1 },
  { _id: 'ch-7-day-consistency', title: '7 Days Consistency', description: 'Hit your daily goal for 7 days', emoji: '⭐', metric: 'days', cadence: 'weekly', goal: 7, rewardCoins: 500, rewardsBadge: true, badgeId: 'a-7-day-streak', sort: 7, startsInDays: 2 },
  { _id: 'ch-weekend-warrior', title: 'Weekend Warrior', description: 'Finish two workouts this week', emoji: '🎯', metric: 'workouts', cadence: 'weekly', goal: 2, rewardCoins: 200, rewardsBadge: false, badgeId: null, sort: 8, startsInDays: 5 },
  { _id: 'ch-monthly-marathon', title: 'Monthly Marathon', description: 'Cover 300,000 steps in a month', emoji: '🏅', metric: 'steps', cadence: 'monthly', goal: 300_000, rewardCoins: 1_500, rewardsBadge: true, badgeId: 'a-marathon', sort: 9, startsInDays: 9 },
] as const;

/**
 * The achievement shelf (RULES C7). `rule`/`threshold` unlock a badge on its
 * own — the member's best day, longest streak or running total reaching it;
 * a badge with no rule is a challenge's to give.
 */
export const ACHIEVEMENTS = [
  { _id: 'a-10k-steps', label: '10K Steps', value: 10_000, metric: 'steps', rule: 'best_day_steps', threshold: 10_000, sort: 1 },
  { _id: 'a-cal-burner', label: 'Cal Burner', value: 500, metric: 'calories', rule: 'best_day_calories', threshold: 500, sort: 2 },
  { _id: 'a-active-30', label: 'Active 30', value: 30, metric: 'minutes', rule: 'best_day_minutes', threshold: 30, sort: 3 },
  { _id: 'a-7-day-streak', label: '7 Days Streak', value: 7, metric: 'days', rule: 'longest_streak', threshold: 7, sort: 4 },
  { _id: 'a-first-challenge', label: 'First Challenge', value: 1, metric: 'workouts', rule: 'challenges_completed', threshold: 1, sort: 5 },
  { _id: 'a-15k-steps', label: '15K Steps', value: 15_000, metric: 'steps', rule: 'best_day_steps', threshold: 15_000, sort: 6 },
  { _id: 'a-cal-crusher', label: 'Cal Crusher', value: 1_000, metric: 'calories', rule: 'best_day_calories', threshold: 1_000, sort: 7 },
  { _id: 'a-active-60', label: 'Active 60', value: 60, metric: 'minutes', rule: 'best_day_minutes', threshold: 60, sort: 8 },
  { _id: 'a-30-day-streak', label: '30 Days Streak', value: 30, metric: 'days', rule: 'longest_streak', threshold: 30, sort: 9 },
  { _id: 'a-ten-workouts', label: 'Ten Workouts', value: 10, metric: 'workouts', rule: 'total_workouts', threshold: 10, sort: 10 },
  { _id: 'a-20k-steps', label: '20K Steps', value: 20_000, metric: 'steps', rule: 'best_day_steps', threshold: 20_000, sort: 11 },
  { _id: 'a-cal-machine', label: 'Cal Machine', value: 2_000, metric: 'calories', rule: 'best_day_calories', threshold: 2_000, sort: 12 },
  { _id: 'a-active-120', label: 'Active 120', value: 120, metric: 'minutes', rule: 'best_day_minutes', threshold: 120, sort: 13 },
  { _id: 'a-90-day-streak', label: '90 Days Streak', value: 90, metric: 'days', rule: 'longest_streak', threshold: 90, sort: 14 },
  { _id: 'a-fifty-workouts', label: 'Fifty Workouts', value: 50, metric: 'workouts', rule: 'total_workouts', threshold: 50, sort: 15 },
  { _id: 'a-step-master', label: 'Step Master', value: 70_000, metric: 'steps', rule: null, threshold: null, sort: 16 },
  { _id: 'a-month-mover', label: 'Month Mover', value: 900, metric: 'minutes', rule: null, threshold: null, sort: 17 },
  { _id: 'a-marathon', label: 'Marathoner', value: 300_000, metric: 'steps', rule: null, threshold: null, sort: 18 },
] as const;

/**
 * The app's standing words, one shown per topic per day in rotation. The
 * seed keeps the wording current, like the help articles; an operator adds
 * or retires a tip in `content_tips` (`active`).
 */
export const CONTENT_TIPS = [
  { _id: 'motivation-1', topic: 'motivation', title: null, text: 'Small steps every day lead to big results.', sort: 1 },
  { _id: 'motivation-2', topic: 'motivation', title: null, text: 'You do not have to be fast. You only have to keep going.', sort: 2 },
  { _id: 'motivation-3', topic: 'motivation', title: null, text: 'Consistency beats intensity, every time.', sort: 3 },
  { _id: 'motivation-4', topic: 'motivation', title: null, text: 'Every step counts — the first one most of all.', sort: 4 },
  { _id: 'motivation-5', topic: 'motivation', title: null, text: 'A walk today is a better day tomorrow.', sort: 5 },
  { _id: 'hydration-1', topic: 'hydration', title: null, text: "Drink water regularly; don't wait until thirsty.", sort: 1 },
  { _id: 'hydration-2', topic: 'hydration', title: null, text: 'Start the day with a glass of water, before tea or coffee.', sort: 2 },
  { _id: 'hydration-3', topic: 'hydration', title: null, text: 'Keep a bottle in sight — you drink more of what you can see.', sort: 3 },
  { _id: 'hydration-4', topic: 'hydration', title: null, text: 'Add a glass for every hour of exercise.', sort: 4 },
  { _id: 'reminders-1', topic: 'reminders', title: 'Small sips, big difference', text: 'A glass every couple of hours beats a litre in one go — your body can only take in so much at a time.', sort: 1 },
  { _id: 'reminders-2', topic: 'reminders', title: 'Pair it with a habit', text: 'Tie a reminder to something you already do — a meeting, a meal — and it sticks.', sort: 2 },
  { _id: 'nutrition-1', topic: 'nutrition', title: null, text: 'Add more protein to your dinner for better muscle recovery.', sort: 1 },
  { _id: 'nutrition-2', topic: 'nutrition', title: null, text: 'Fill half your plate with vegetables at lunch and dinner.', sort: 2 },
  { _id: 'nutrition-3', topic: 'nutrition', title: null, text: 'Swap one sugary drink a day for water or buttermilk.', sort: 3 },
  { _id: 'health-1', topic: 'health', title: null, text: 'Drink enough water, eat balanced meals and sleep well.', sort: 1 },
  { _id: 'health-2', topic: 'health', title: null, text: 'Seven to nine hours of sleep does more for your numbers than any supplement.', sort: 2 },
  { _id: 'health-3', topic: 'health', title: null, text: 'Take readings at the same time of day so they compare fairly.', sort: 3 },
  { _id: 'heart-rate-1', topic: 'heart_rate', title: 'Keep Your Heart Healthy', text: 'Regular exercise, good sleep and a balanced diet', sort: 1 },
  { _id: 'heart-rate-2', topic: 'heart_rate', title: 'Measure at rest', text: 'Sit quietly for five minutes before you take a reading', sort: 2 },
  { _id: 'blood-pressure-1', topic: 'blood_pressure', title: 'Keep Your BP In Check', text: 'Stay active, sleep well and monitor regularly', sort: 1 },
  { _id: 'blood-pressure-2', topic: 'blood_pressure', title: 'Watch the salt', text: 'Less salt in cooking and fewer packaged snacks help keep pressure down', sort: 2 },
] as const;

/**
 * The food library everyone sees (RULES N8), from the add-meal screen's
 * catalogue; `quickAdd` marks its shortcuts. Members' own foods live in the
 * same collection with an owner and are never seeded.
 */
export const FOOD_ITEMS = [
  {"_id": "fl-oats", "name": "Oats (Cooked)", "portion": "1 Cup (150 g)", "emoji": "🥣", "calories": 150, "proteinG": 5, "carbsG": 27, "fatsG": 3, "fiberG": 4, "quickAdd": true, "sort": 1},
  {"_id": "fl-banana", "name": "Banana", "portion": "1 Medium (118 g)", "emoji": "🍌", "calories": 89, "proteinG": 1, "carbsG": 23, "fatsG": 0.3, "fiberG": 2.6, "quickAdd": true, "sort": 2},
  {"_id": "fl-egg", "name": "Boiled Egg", "portion": "1 Large (50 g)", "emoji": "🥚", "calories": 78, "proteinG": 6, "carbsG": 0.6, "fatsG": 5, "fiberG": 0, "quickAdd": true, "sort": 3},
  {"_id": "fl-peanut-butter", "name": "Peanut Butter", "portion": "1 Tbsp (16 g)", "emoji": "🥜", "calories": 94, "proteinG": 4, "carbsG": 3, "fatsG": 8, "fiberG": 1, "quickAdd": true, "sort": 4},
  {"_id": "fl-brown-rice", "name": "Brown Rice", "portion": "1 Cup (150 g)", "emoji": "🍚", "calories": 215, "proteinG": 5, "carbsG": 45, "fatsG": 1.8, "fiberG": 3.5, "quickAdd": false, "sort": 5},
  {"_id": "fl-dal", "name": "Dal", "portion": "1 Bowl (150 g)", "emoji": "🍲", "calories": 180, "proteinG": 10, "carbsG": 22, "fatsG": 5, "fiberG": 6, "quickAdd": false, "sort": 6},
  {"_id": "fl-paneer", "name": "Paneer", "portion": "100 g", "emoji": "🧀", "calories": 265, "proteinG": 18, "carbsG": 6, "fatsG": 20, "fiberG": 0, "quickAdd": false, "sort": 7},
  {"_id": "fl-curd", "name": "Curd", "portion": "1 Bowl (150 g)", "emoji": "🥛", "calories": 98, "proteinG": 6, "carbsG": 8, "fatsG": 4, "fiberG": 0, "quickAdd": false, "sort": 8},
  {"_id": "fl-roti", "name": "Roti", "portion": "1 Piece (40 g)", "emoji": "🫓", "calories": 104, "proteinG": 3, "carbsG": 20, "fatsG": 1.5, "fiberG": 2, "quickAdd": false, "sort": 9},
  {"_id": "fl-chicken", "name": "Grilled Chicken", "portion": "100 g", "emoji": "🍗", "calories": 165, "proteinG": 31, "carbsG": 0, "fatsG": 3.6, "fiberG": 0, "quickAdd": false, "sort": 10},
  {"_id": "fl-salad", "name": "Mixed Salad", "portion": "1 Bowl (120 g)", "emoji": "🥗", "calories": 45, "proteinG": 2, "carbsG": 8, "fatsG": 0.5, "fiberG": 3, "quickAdd": false, "sort": 11},
  {"_id": "fl-almonds", "name": "Almonds", "portion": "10 pieces (12 g)", "emoji": "🌰", "calories": 70, "proteinG": 3, "carbsG": 2.5, "fatsG": 6, "fiberG": 1.5, "quickAdd": false, "sort": 12},
  {"_id": "fl-apple", "name": "Apple", "portion": "1 Medium (180 g)", "emoji": "🍎", "calories": 95, "proteinG": 0.5, "carbsG": 25, "fatsG": 0.3, "fiberG": 4.4, "quickAdd": false, "sort": 13},
  {"_id": "fl-coffee", "name": "Black Coffee", "portion": "1 Cup", "emoji": "☕", "calories": 5, "proteinG": 0.3, "carbsG": 0, "fatsG": 0, "fiberG": 0, "quickAdd": false, "sort": 14},
  {"_id": "fl-protein-shake", "name": "Protein Shake", "portion": "1 Scoop (30 g)", "emoji": "🥤", "calories": 120, "proteinG": 24, "carbsG": 3, "fatsG": 1.5, "fiberG": 0, "quickAdd": false, "sort": 15},
] as const;

/**
 * The diet plan's curated days (RULES N7): the app's three-day rotation and
 * variants of it for each diet type. A member's plan cycles through the
 * days that suit their preferences — the placeholder for plan generation.
 */
export const DIET_PLAN_TEMPLATES = [
  {"_id": "plan-1", "dietTypes": ["non_vegetarian"], "mealPlans": ["balanced", "high_protein"], "meals": [{"slot": "breakfast", "time": "08:00", "calories": 320, "proteinG": 18, "carbsG": 42, "fatsG": 9, "items": [{"name": "Oats with banana", "quantity": "1 bowl (200g)"}, {"name": "Boiled eggs", "quantity": "2 eggs"}, {"name": "Green tea", "quantity": "1 cup"}]}, {"slot": "lunch", "time": "13:00", "calories": 450, "proteinG": 26, "carbsG": 58, "fatsG": 14, "items": [{"name": "Brown rice", "quantity": "1 cup (150g)"}, {"name": "Dal", "quantity": "1 bowl (150g)"}, {"name": "Mixed salad", "quantity": "1 bowl"}, {"name": "Paneer curry", "quantity": "100g"}]}, {"slot": "snack", "time": "17:00", "calories": 180, "proteinG": 6, "carbsG": 18, "fatsG": 11, "items": [{"name": "Mixed nuts", "quantity": "30g"}, {"name": "Apple", "quantity": "1 medium"}, {"name": "Black coffee", "quantity": "1 cup"}]}, {"slot": "dinner", "time": "20:00", "calories": 300, "proteinG": 32, "carbsG": 32, "fatsG": 11, "items": [{"name": "Grilled chicken", "quantity": "100g"}, {"name": "Steamed veggies", "quantity": "1 bowl"}, {"name": "Quinoa", "quantity": "1 cup (100g)"}]}], "sort": 1},
  {"_id": "plan-2", "dietTypes": ["non_vegetarian"], "mealPlans": ["balanced", "high_protein", "low_carb"], "meals": [{"slot": "breakfast", "time": "08:00", "calories": 350, "proteinG": 20, "carbsG": 44, "fatsG": 10, "items": [{"name": "Poha with peanuts", "quantity": "1 plate (200g)"}, {"name": "Curd", "quantity": "1 bowl"}, {"name": "Black coffee", "quantity": "1 cup"}]}, {"slot": "lunch", "time": "13:00", "calories": 470, "proteinG": 28, "carbsG": 60, "fatsG": 13, "items": [{"name": "Roti", "quantity": "3"}, {"name": "Rajma", "quantity": "1 bowl (150g)"}, {"name": "Cucumber salad", "quantity": "1 bowl"}]}, {"slot": "snack", "time": "17:00", "calories": 160, "proteinG": 12, "carbsG": 14, "fatsG": 5, "items": [{"name": "Sprouts chaat", "quantity": "1 bowl"}, {"name": "Green tea", "quantity": "1 cup"}]}, {"slot": "dinner", "time": "20:00", "calories": 320, "proteinG": 30, "carbsG": 30, "fatsG": 12, "items": [{"name": "Grilled fish", "quantity": "120g"}, {"name": "Sautéed spinach", "quantity": "1 bowl"}, {"name": "Millet khichdi", "quantity": "1 cup"}]}], "sort": 2},
  {"_id": "plan-3", "dietTypes": ["vegetarian", "eggetarian", "non_vegetarian"], "mealPlans": ["balanced", "high_protein"], "meals": [{"slot": "breakfast", "time": "08:00", "calories": 330, "proteinG": 22, "carbsG": 38, "fatsG": 10, "items": [{"name": "Besan chilla", "quantity": "2"}, {"name": "Mint chutney", "quantity": "2 tbsp"}, {"name": "Buttermilk", "quantity": "1 glass"}]}, {"slot": "lunch", "time": "13:00", "calories": 440, "proteinG": 25, "carbsG": 56, "fatsG": 12, "items": [{"name": "Vegetable pulao", "quantity": "1 bowl (180g)"}, {"name": "Soya chunk curry", "quantity": "100g"}, {"name": "Raita", "quantity": "1 bowl"}]}, {"slot": "snack", "time": "17:00", "calories": 170, "proteinG": 8, "carbsG": 20, "fatsG": 7, "items": [{"name": "Roasted chana", "quantity": "40g"}, {"name": "Orange", "quantity": "1 medium"}]}, {"slot": "dinner", "time": "20:00", "calories": 310, "proteinG": 28, "carbsG": 34, "fatsG": 10, "items": [{"name": "Paneer tikka", "quantity": "120g"}, {"name": "Stir-fried veggies", "quantity": "1 bowl"}, {"name": "Jowar roti", "quantity": "2"}]}], "sort": 3},
  {"_id": "plan-4", "dietTypes": ["vegetarian", "eggetarian"], "mealPlans": ["balanced", "high_protein"], "meals": [{"slot": "breakfast", "time": "08:00", "calories": 320, "proteinG": 18, "carbsG": 42, "fatsG": 9, "items": [{"name": "Oats with banana", "quantity": "1 bowl (200g)"}, {"name": "Sprouts salad", "quantity": "1 bowl"}, {"name": "Green tea", "quantity": "1 cup"}]}, {"slot": "lunch", "time": "13:00", "calories": 450, "proteinG": 26, "carbsG": 58, "fatsG": 14, "items": [{"name": "Brown rice", "quantity": "1 cup (150g)"}, {"name": "Dal", "quantity": "1 bowl (150g)"}, {"name": "Mixed salad", "quantity": "1 bowl"}, {"name": "Paneer curry", "quantity": "100g"}]}, {"slot": "snack", "time": "17:00", "calories": 180, "proteinG": 6, "carbsG": 18, "fatsG": 11, "items": [{"name": "Mixed nuts", "quantity": "30g"}, {"name": "Apple", "quantity": "1 medium"}, {"name": "Black coffee", "quantity": "1 cup"}]}, {"slot": "dinner", "time": "20:00", "calories": 300, "proteinG": 32, "carbsG": 32, "fatsG": 11, "items": [{"name": "Grilled paneer", "quantity": "100g"}, {"name": "Steamed veggies", "quantity": "1 bowl"}, {"name": "Quinoa", "quantity": "1 cup (100g)"}]}], "sort": 4},
  {"_id": "plan-5", "dietTypes": ["vegetarian", "eggetarian"], "mealPlans": ["balanced", "low_carb"], "meals": [{"slot": "breakfast", "time": "08:00", "calories": 350, "proteinG": 20, "carbsG": 44, "fatsG": 10, "items": [{"name": "Poha with peanuts", "quantity": "1 plate (200g)"}, {"name": "Curd", "quantity": "1 bowl"}, {"name": "Black coffee", "quantity": "1 cup"}]}, {"slot": "lunch", "time": "13:00", "calories": 470, "proteinG": 28, "carbsG": 60, "fatsG": 13, "items": [{"name": "Roti", "quantity": "3"}, {"name": "Rajma", "quantity": "1 bowl (150g)"}, {"name": "Cucumber salad", "quantity": "1 bowl"}]}, {"slot": "snack", "time": "17:00", "calories": 160, "proteinG": 12, "carbsG": 14, "fatsG": 5, "items": [{"name": "Sprouts chaat", "quantity": "1 bowl"}, {"name": "Green tea", "quantity": "1 cup"}]}, {"slot": "dinner", "time": "20:00", "calories": 320, "proteinG": 30, "carbsG": 30, "fatsG": 12, "items": [{"name": "Tofu stir-fry", "quantity": "120g"}, {"name": "Sautéed spinach", "quantity": "1 bowl"}, {"name": "Millet khichdi", "quantity": "1 cup"}]}], "sort": 5},
  {"_id": "plan-6", "dietTypes": ["vegan", "vegetarian", "eggetarian"], "mealPlans": ["balanced"], "meals": [{"slot": "breakfast", "time": "08:00", "calories": 330, "proteinG": 22, "carbsG": 38, "fatsG": 10, "items": [{"name": "Besan chilla", "quantity": "2"}, {"name": "Mint chutney", "quantity": "2 tbsp"}, {"name": "Lemon water", "quantity": "1 glass"}]}, {"slot": "lunch", "time": "13:00", "calories": 440, "proteinG": 25, "carbsG": 56, "fatsG": 12, "items": [{"name": "Vegetable pulao", "quantity": "1 bowl (180g)"}, {"name": "Soya chunk curry", "quantity": "100g"}, {"name": "Cucumber salad", "quantity": "1 bowl"}]}, {"slot": "snack", "time": "17:00", "calories": 170, "proteinG": 8, "carbsG": 20, "fatsG": 7, "items": [{"name": "Roasted chana", "quantity": "40g"}, {"name": "Orange", "quantity": "1 medium"}]}, {"slot": "dinner", "time": "20:00", "calories": 310, "proteinG": 28, "carbsG": 34, "fatsG": 10, "items": [{"name": "Tofu tikka", "quantity": "120g"}, {"name": "Stir-fried veggies", "quantity": "1 bowl"}, {"name": "Jowar roti", "quantity": "2"}]}], "sort": 6},
  {"_id": "plan-7", "dietTypes": ["vegan"], "mealPlans": ["balanced", "low_carb"], "meals": [{"slot": "breakfast", "time": "08:00", "calories": 350, "proteinG": 20, "carbsG": 44, "fatsG": 10, "items": [{"name": "Poha with peanuts", "quantity": "1 plate (200g)"}, {"name": "Soy yogurt", "quantity": "1 bowl"}, {"name": "Black coffee", "quantity": "1 cup"}]}, {"slot": "lunch", "time": "13:00", "calories": 470, "proteinG": 28, "carbsG": 60, "fatsG": 13, "items": [{"name": "Roti", "quantity": "3"}, {"name": "Rajma", "quantity": "1 bowl (150g)"}, {"name": "Cucumber salad", "quantity": "1 bowl"}]}, {"slot": "snack", "time": "17:00", "calories": 160, "proteinG": 12, "carbsG": 14, "fatsG": 5, "items": [{"name": "Sprouts chaat", "quantity": "1 bowl"}, {"name": "Green tea", "quantity": "1 cup"}]}, {"slot": "dinner", "time": "20:00", "calories": 320, "proteinG": 30, "carbsG": 30, "fatsG": 12, "items": [{"name": "Tofu stir-fry", "quantity": "120g"}, {"name": "Sautéed spinach", "quantity": "1 bowl"}, {"name": "Millet khichdi", "quantity": "1 cup"}]}], "sort": 7},
];
