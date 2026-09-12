import type {
  Achievement,
  AppNotification,
  Challenge,
  CoinTransaction,
  LeaderboardEntry,
  ShopItem,
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
  { id: 'a-10k-steps', value: '10K', label: '10K Steps', metric: 'steps', achievedAt: daysAgo(2) },
  { id: 'a-cal-burner', value: '500', label: 'Cal Burner', metric: 'calories', achievedAt: daysAgo(5) },
  { id: 'a-active-30', value: '30', label: 'Active 30', metric: 'minutes', achievedAt: daysAgo(9) },
  { id: 'a-7-day-streak', value: '7', label: '7 Days Streak', metric: 'days', achievedAt: daysAgo(14) },
  { id: 'a-first-challenge', value: '1', label: 'First Challenge', metric: 'workouts', achievedAt: null },
  { id: 'a-15k-steps', value: '15K', label: '15K Steps', metric: 'steps', achievedAt: daysAgo(21) },
  { id: 'a-cal-crusher', value: '1K', label: 'Cal Crusher', metric: 'calories', achievedAt: null },
  { id: 'a-active-60', value: '60', label: 'Active 60', metric: 'minutes', achievedAt: daysAgo(30) },
  { id: 'a-30-day-streak', value: '30', label: '30 Days Streak', metric: 'days', achievedAt: null },
  { id: 'a-ten-workouts', value: '10', label: 'Ten Workouts', metric: 'workouts', achievedAt: daysAgo(40) },
  { id: 'a-20k-steps', value: '20K', label: '20K Steps', metric: 'steps', achievedAt: null },
  { id: 'a-cal-machine', value: '2K', label: 'Cal Machine', metric: 'calories', achievedAt: null },
  { id: 'a-active-120', value: '120', label: 'Active 120', metric: 'minutes', achievedAt: null },
  { id: 'a-90-day-streak', value: '90', label: '90 Days Streak', metric: 'days', achievedAt: null },
  { id: 'a-fifty-workouts', value: '50', label: 'Fifty Workouts', metric: 'workouts', achievedAt: null },
];

/**
 * This week's top of the leaderboard, in rank order.
 *
 * Five rows: the reward tiers pay down to tenth place, but the card is a
 * glance at who is winning rather than the board itself — the rest is behind
 * "View Full Leaderboard". The coins each row states match the tiers exactly,
 * so the table above the list and the people below it cannot disagree.
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
  },
  {
    id: 'lb-2',
    name: 'Priya Sharma',
    location: 'Mumbai, India',
    rank: 2,
    coins: 3_000,
    perk: 'T-Shirt + Mat',
    avatarUrl: null,
  },
  {
    id: 'lb-3',
    name: 'Arjun Mehta',
    location: 'Bangalore, India',
    rank: 3,
    coins: 3_000,
    perk: 'T-Shirt + Mat',
    avatarUrl: null,
  },
  {
    id: 'lb-4',
    name: 'Neha Singh',
    location: 'Pune, India',
    rank: 4,
    coins: 1_000,
    perk: 'Fitness Mat',
    avatarUrl: null,
  },
  {
    id: 'lb-5',
    name: 'Vikram Yadav',
    location: 'Chennai, India',
    rank: 5,
    coins: 1_000,
    perk: 'Fitness Mat',
    avatarUrl: null,
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
  /** Already formatted for display — the API has no date to derive it from. */
  bestRankAchievedOn: '12 May 2025',
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
export const hydrationTip =
  "Drink water regularly; don't wait until thirsty.";
