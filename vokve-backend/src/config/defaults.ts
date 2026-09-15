/**
 * Every ⚙ value from RULES.md lives here as a default and can be overridden
 * from the `app_config` collection without a deploy (see remote.ts).
 *
 * Coin amounts are written in coins (decimals); the economy module converts to
 * milli-coins at the boundary (D-27).
 */
export const CONFIG_DEFAULTS = {
  coins: {
    /** Hard per-user per-local-day ceiling across every source (RULES E8). */
    dailyCap: 300,
    /** Optional second ceiling over the calendar month; null = off. */
    monthlyCap: null as number | null,
    /** Per-source ceilings; each must be ≤ dailyCap (RULES E8c). */
    sourceCaps: { steps: 200, workout: 100, streak: 300, challenge: 300, referral: 300 },
    /** 0.095 coins per 100 verified steps (D-26). Both knobs are config. */
    steps: { unitSteps: 100, coinsPerUnit: 0.095 },
    /** Inherited from the client's rate card — see D-32 for rebalancing. */
    workout: 100,
    workoutDailyCount: 2,
    workoutMinMinutes: 10,
    /** Judged against the longest streak, paid once each (RULES S8). */
    streakMilestones: [
      { days: 7, coins: 50 },
      { days: 15, coins: 150 },
      { days: 30, coins: 300 },
      { days: 90, coins: 1000 },
      { days: 180, coins: 2000 },
    ],
    /** 20 to each side, on the invitee's phone + email verification (C2). */
    referral: { inviter: 20, invitee: 20, monthlyInviterCap: 10 },
    /** Idle window; resets on any credit (RULES E9). */
    expiryDays: 90,
    expiryWarnDays: [14, 3],
    stepUpThreshold: 1000,
  },
  trust: {
    tiers: { trusted: 80, normal: 50, watch: 30 },
    holdHours: { trusted: 24, normal: 72, watch: 168, restricted: null as number | null },
    stepCaps: { trusted: 30000, normal: 30000, watch: 15000, restricted: 5000, banned: 0 },
    newAccountScore: 60,
    /** Shadow mode: score and tier are computed but never enforced (RULES T9). */
    shadow: true,
  },
  streak: { restoreCost: 50, restoreWindowDays: 7 },
  otp: {
    /**
     * Where the sign-up code goes. Email while there is no SMS provider
     * (owner's call, 2026-09-14); flip to 'sms' the day one lands. The other
     * channel is asked for right after, if it can be delivered.
     */
    signupChannel: 'email' as 'email' | 'sms',
    length: 6,
    ttlSeconds: 300,
    maxAttempts: 5,
    resendCooldownSeconds: 30,
    maxResendsPerHour: 3,
    maxSendsPerDay: 10,
  },
  devices: { maxPerAccount: 5, flagAtAccountsPerDevice: 3 },
  app: {
    minVersion: { ios: '1.0.0', android: '1.0.0' },
    storeUrl: {
      ios: 'https://apps.apple.com/app/vokve',
      android: 'https://play.google.com/store/apps/details?id=com.vokve',
    },
  },
  locale: { country: 'IN', timezone: 'Asia/Kolkata' },
};

export type AppConfig = typeof CONFIG_DEFAULTS;
