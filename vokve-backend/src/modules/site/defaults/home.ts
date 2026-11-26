import type { z } from 'zod';
import type { homeEditSchema } from '../../../contracts/site.js';

/**
 * The home page as it ships (RULES P22). Every figure that is a ⚙ value is a
 * token the server fills on the way out — `{{challengeCount}}`,
 * `{{coinValue}}`, `{{graceDays}}` — so the stats strip cannot drift from
 * what the app does. The challenge board is the live list (`live: true`) and
 * the questions are Help-centre articles picked by id.
 *
 * The shop copy follows D-109: while there is no payment gateway the whole
 * shop is paid in coins, delivery included.
 */
export const DEFAULT_HOME: z.input<typeof homeEditSchema> = {
  seo: {
    title: 'VOKVE — Walk. Earn. Redeem.',
    description:
      'The fitness app that pays you back for walking. Verified steps, streaks, challenges and a rewards shop where your coins buy real products.',
  },
  hero: {
    eyebrow: null,
    title: 'Get paid in coins for the walking you already do',
    highlight: null,
    subtitle:
      'VOKVE counts the steps your phone already records, checks that each day is real walking, and pays you coins to spend in the VOKVE shop',
    primaryCta: { label: 'Get the app', href: '/#download' },
    secondaryCta: { label: 'See how it works', href: '/#how-it-works' },
    trust: ['Health data never sold', 'Works with Health Connect and Apple Health', 'No band or watch needed'],
    scene: {
      dayLabel: 'Today',
      verifiedLabel: 'Verified',
      steps: 8432,
      goal: 10000,
      stepsLabel: 'steps',
      goalLabel: 'of {goal}',
      metrics: [
        { icon: 'route', value: '6.2 km', label: 'Distance' },
        { icon: 'timer', value: '58 min', label: 'Active' },
        { icon: 'flame', value: '342', label: 'kcal' },
      ],
      streak: { value: '12', label: 'day streak' },
      challenge: { title: '10K Steps Challenge', progress: 0.84, reward: '+200 coins' },
      rank: { value: '#3', label: 'this week' },
      coin: { value: '+7.98', label: 'coins' },
    },
  },
  stats: [
    { value: '₹0', label: 'to download and use' },
    { value: '{{challengeCount}}', label: 'challenges, each with a coin reward' },
    { value: '{{coinValue}}', label: 'what one coin is worth in the shop' },
    { value: '{{graceDays}} days', label: 'to undo an account deletion' },
  ],
  howItWorks: {
    eyebrow: 'How it works',
    title: 'Four steps. One of them is walking',
    subtitle: 'No wearable, no subscription. Your phone does the counting and we do the checking.',
    steps: [
      {
        icon: 'footprints',
        title: 'Walk like you already do',
        body: 'Keep your phone with you. VOKVE counts steps through Health Connect on Android and Apple Health on iPhone.',
        status: { text: 'Today · 8,432 steps', state: 'neutral' },
      },
      {
        icon: 'shield-check',
        title: 'We check the day is real',
        body: 'Each day is compared with how genuine walking looks. Step coins wait as pending while we check.',
        status: { text: 'Pending · +7.98 coins', state: 'pending' },
      },
      {
        icon: 'coins',
        title: 'Coins land in your wallet',
        body: 'Steps, workouts, streaks, challenges and invites all pay — up to a daily ceiling that keeps it fair.',
        status: { text: 'Paid · +7.98 coins', state: 'paid' },
      },
      {
        icon: 'shopping-bag',
        title: 'Spend them on real things',
        body: 'Everything in the VOKVE shop is paid in coins, delivery included. The total is shown before you confirm.',
        status: { text: 'Shop order · 2,400 coins', state: 'neutral' },
      },
    ],
  },
  features: {
    eyebrow: 'Features',
    title: 'Built around the daily walk',
    subtitle:
      'Steps are the heart of VOKVE. Around them sit the habits that keep you moving and the rewards that make it worth it.',
    items: [
      {
        icon: 'footprints',
        title: 'Verified step tracking',
        body: 'Counts in the background and syncs when you open the app. Your phone is enough — no band or watch needed.',
      },
      {
        icon: 'trophy',
        title: 'Challenges',
        body: 'Daily, weekly and monthly goals — from 10,000 steps in a day to a month-long marathon — each with its own reward.',
      },
      {
        icon: 'flame',
        title: 'Streaks and freezes',
        body: 'Hit your goal day after day for milestone bonuses. Missed one? A freeze can save the run.',
      },
      {
        icon: 'medal',
        title: 'Weekly leaderboard',
        body: 'See where you rank each week. The board shows a rank and a first name — never your readings.',
      },
      {
        icon: 'shopping-bag',
        title: 'Rewards shop',
        body: 'Real products, paid for in coins. Delivery is in coins too, so nothing is charged to a card.',
      },
      {
        icon: 'droplets',
        title: 'Hydration',
        body: 'Log water in a tap and get reminders at the hours you choose, with quiet hours respected.',
      },
      {
        icon: 'salad',
        title: 'Nutrition and diet plans',
        body: 'Log meals from the food library and follow plans built around your goal.',
      },
      {
        icon: 'heart-pulse',
        title: 'Vitals log',
        body: 'Note down your heart rate and blood pressure readings and watch the trend over time.',
      },
      {
        icon: 'dumbbell',
        title: 'Guided workouts',
        body: 'Follow a workout set by set. Finished sessions pay coins and keep your streak alive.',
      },
      {
        icon: 'gift',
        title: 'Refer and earn',
        body: 'Invite a friend with your code — you both get coins once they join and get moving.',
      },
    ],
  },
  challenges: {
    eyebrow: 'Challenges',
    title: 'Something to aim for, every day of the month',
    subtitle: 'Join as many as you like. Overlapping challenges each pay when you finish them.',
    live: true,
    liveWords: { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', reward: '{coins} coins', badge: '+ badge' },
    items: [
      {
        id: 'ch-10k-steps',
        icon: 'footprints',
        title: '10K Steps Challenge',
        description: 'Walk 10,000 steps in a day',
        cadence: 'Daily',
        rewardLabel: '200 coins',
        badgeLabel: '+ badge',
      },
      {
        id: 'ch-15k-steps',
        icon: 'footprints',
        title: '15K Steps Challenge',
        description: 'Walk 15,000 steps in a day',
        cadence: 'Daily',
        rewardLabel: '300 coins',
        badgeLabel: null,
      },
      {
        id: 'ch-burn-500',
        icon: 'flame',
        title: 'Burn 500 Calories',
        description: 'Burn 500 calories in a day',
        cadence: 'Daily',
        rewardLabel: '150 coins',
        badgeLabel: '+ badge',
      },
      {
        id: 'ch-30-min-active',
        icon: 'timer',
        title: '30 Min Active Time',
        description: 'Be active for 30 minutes',
        cadence: 'Daily',
        rewardLabel: '100 coins',
        badgeLabel: '+ badge',
      },
      {
        id: 'ch-week-step-master',
        icon: 'route',
        title: 'Weekly Step Master',
        description: 'Walk 70,000 steps this week',
        cadence: 'Weekly',
        rewardLabel: '800 coins',
        badgeLabel: '+ badge',
      },
      {
        id: 'ch-7-day-consistency',
        icon: 'target',
        title: '7 Days Consistency',
        description: 'Hit your daily goal for 7 days',
        cadence: 'Weekly',
        rewardLabel: '500 coins',
        badgeLabel: '+ badge',
      },
      {
        id: 'ch-weekend-warrior',
        icon: 'dumbbell',
        title: 'Weekend Warrior',
        description: 'Finish two workouts this week',
        cadence: 'Weekly',
        rewardLabel: '200 coins',
        badgeLabel: null,
      },
      {
        id: 'ch-month-mover',
        icon: 'activity',
        title: 'Monthly Mover',
        description: 'Log 900 active minutes this month',
        cadence: 'Monthly',
        rewardLabel: '2,000 coins',
        badgeLabel: '+ badge',
      },
      {
        id: 'ch-monthly-marathon',
        icon: 'medal',
        title: 'Monthly Marathon',
        description: 'Cover 300,000 steps in a month',
        cadence: 'Monthly',
        rewardLabel: '1,500 coins',
        badgeLabel: '+ badge',
      },
    ],
    note: 'Challenge rewards are paid within the daily coin ceiling explained in our [Coins & Fair Play policy](/rewards-policy).',
  },
  fairPlay: {
    eyebrow: 'Fair play',
    title: 'Coins mean something because cheating doesn’t pay',
    subtitle:
      'A reward is only worth having if everyone earned theirs the same way. So every day passes four layers before it pays.',
    layers: [
      {
        icon: 'smartphone',
        title: 'Counted on your phone',
        body: 'Steps come from your phone’s own step sensor and health service — never from a number anyone types in.',
      },
      {
        icon: 'activity',
        title: 'Checked against real walking',
        body: 'Each day is compared with how genuine walking looks before it pays a single coin.',
      },
      {
        icon: 'hourglass',
        title: 'Held, then released',
        body: 'Step coins wait as pending for a short window and land in your wallet once the day checks out.',
      },
      {
        icon: 'scale',
        title: 'Capped for everyone',
        body: 'A daily ceiling across every way to earn means no single day — and no single trick — pays forever.',
      },
    ],
    note: 'Shaken phones, apps that invent steps and shared devices are spotted and don’t pay. The full rules are in our [Coins & Fair Play policy](/rewards-policy).',
    sample: {
      title: 'One day of walking, hour by hour',
      date: 'Tue 17 Nov',
      hours: [0, 0, 0, 0, 0, 40, 2850, 1920, 310, 420, 260, 380, 510, 290, 220, 340, 280, 460, 720, 390, 180, 90, 20, 0],
      walk: { from: 6, to: 8, label: 'Morning walk' },
      stepsLabel: 'steps',
      status: { text: 'Verified', state: 'paid' },
    },
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'Your health data is personal, and we treat it that way',
    subtitle: null,
    points: [
      {
        icon: 'lock',
        title: 'Never sold',
        body: 'Your steps and workouts are used to pay you and show you your progress. That is all.',
        link: { label: 'Privacy Policy', href: '/privacy' },
      },
      {
        icon: 'sliders-horizontal',
        title: 'Switches that really switch',
        body: 'Turn off usage analytics or personalised offers and the server stops — not just the screen.',
        link: { label: 'Your choices', href: '/privacy#your-choices' },
      },
      {
        icon: 'download',
        title: 'Take a copy any day',
        body: 'Download everything we hold about you as a single file, once every 24 hours.',
        link: { label: 'How to export', href: '/delete-account#export' },
      },
      {
        icon: 'trash-2',
        title: 'Delete with a {{graceDays}}-day undo',
        body: 'Ask from the app and it is scheduled two weeks out, so a slip of the thumb costs nothing.',
        link: { label: 'Delete your account', href: '/delete-account' },
      },
    ],
  },
  faq: {
    eyebrow: 'Questions',
    title: 'Before you ask',
    subtitle: null,
    itemIds: ['faq-coins-earn', 'faq-tracking-steps', 'faq-orders-pay', 'faq-account-delete'],
    cta: { label: 'All questions', href: '/faq' },
  },
  download: {
    eyebrow: null,
    title: 'Start earning on your next walk',
    subtitle: 'Download VOKVE, allow step tracking, and the steps you take from today begin to count',
    note: 'Free to download. Coins have no cash value and can only be spent in the VOKVE shop.',
  },
};
