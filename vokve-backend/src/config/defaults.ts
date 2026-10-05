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
    /**
     * 0.095 coins per 100 verified steps (D-26). Both knobs are config.
     * `enabled` is what lets a scored day mint at all: off through Phase 2,
     * while steps are ingested and scored in shadow mode (D-05) — the rollup
     * then records the day and holds nothing.
     */
    steps: { enabled: false, unitSteps: 100, coinsPerUnit: 0.095 },
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
    /**
     * 20 to each side once the invitee's first plausible workout is saved
     * (RULES F3, C2). The invitee may apply a code for `applyWindowDays`
     * after sign-up (F2); the inviter is paid for at most
     * `monthlyInviterCap` referrals a calendar month (F4).
     */
    referral: { inviter: 20, invitee: 20, monthlyInviterCap: 10, applyWindowDays: 7 },
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
    /**
     * The score's arithmetic (RULES T1): an EWMA of daily plausibility, less
     * a penalty per open flag of the last 30 days (capped), plus bonuses. A
     * tier moves down at once and up only after `upgradeCleanDays` without
     * a new flag (T6).
     */
    ewmaAlpha: 0.3,
    flagPenalty: 5,
    maxFlagPenalty: 30,
    upgradeCleanDays: 7,
    /** Shadow mode: score and tier are computed but never enforced (RULES T9). */
    shadow: true,
  },
  /** The streak (RULES §S). */
  streak: {
    /** Coins a restore costs, debited with `source: 'streak'` (S7, E13). */
    restoreCost: 50,
    /** A run that ended longer ago than this cannot be restored (S6). */
    restoreWindowDays: 7,
    /**
     * What earns a day (S1, S9). `stepGoal`: verified steps at or above the
     * user's own daily goal — on by default because the app's only way to
     * log a workout is not reachable yet, and a streak nothing can earn
     * would be a dead screen (D-44, owner to confirm D-07).
     */
    earnedBy: { workout: true, stepGoal: true },
    /** Freeze grants (S5): held on sign-up, one more per `everyDays` of an unbroken run, never more than `maxHeld`. */
    freezes: { initial: 1, everyDays: 30, maxHeld: 3 },
    /** Local hour at which a streak not yet covered today is warned about (S10). */
    atRiskHour: 19,
  },
  /** Vitals and the health score (RULES §V). */
  health: {
    /** What a reading may be (V2) — sanity bounds, not medical ranges. */
    bounds: {
      heart_rate: { min: 30, max: 220 },
      systolic: { min: 60, max: 250 },
      diastolic: { min: 30, max: 150 },
      weight: { min: 20, max: 350 },
    },
    /** The health score's parts and the points each is worth (V8, D-14). */
    scoreWeights: { activity: 30, hydration: 20, vitals: 20, bmi: 15, consistency: 15 },
    /** The line every vitals answer carries (V9). */
    disclaimer: 'VOKVE is not a medical device. These figures are for general wellness, not medical advice.',
  },
  /** Food (RULES §N). */
  nutrition: {
    /** A new member's targets and preferences (N4). */
    defaultGoals: { calories: 2200, proteinG: 120, carbsG: 300, fatsG: 70 },
    defaultPreferences: {
      dietType: 'vegetarian' as 'vegetarian' | 'vegan' | 'eggetarian' | 'non_vegetarian',
      mealPlan: 'balanced' as 'balanced' | 'high_protein' | 'low_carb' | 'keto',
      goal: 'gain_weight' as 'lose_weight' | 'maintain' | 'gain_weight' | 'build_muscle',
    },
    /** The most foods one save may log. */
    maxEntriesPerSave: 30,
    /** How far back food may still be logged, in days. */
    maxAgeDays: 30,
    /** How many search results `GET /foods` returns at most. */
    searchLimit: 25,
  },
  /** Water (RULES §Y). */
  hydration: {
    /** The smallest and largest single drink the server accepts, ml (Y1, X9). */
    minMl: 10,
    maxMl: 3000,
    /** How far back a drink may still be logged. */
    maxAgeDays: 7,
    /** The most times one reminder plan may hold. */
    maxReminders: 24,
    /** A new member's reminder plan (Y5): presets by block, every day, on. */
    defaultPlan: {
      enabled: true,
      sound: 'Default',
      vibration: true,
      repeatDays: [0, 1, 2, 3, 4, 5, 6],
      times: {
        morning: ['07:00', '08:30', '10:00'],
        afternoon: ['13:00', '15:30'],
        evening: ['18:00', '20:00'],
      } as Record<'morning' | 'afternoon' | 'evening', string[]>,
    },
  },
  /** The weekly country board (RULES §L). */
  leaderboard: {
    /** The zone each country's week runs in, Monday to Sunday (L1); a country not listed uses `locale.timezone`. */
    timezones: { IN: 'Asia/Kolkata' } as Record<string, string>,
    /** What a country is called on its board. */
    countryNames: { IN: 'India' } as Record<string, string>,
    /** Score = ⌊verified steps ÷ stepsPerPoint⌋ + workouts × perWorkout + challenges × perChallenge (L3, D-10). */
    score: { stepsPerPoint: 100, perWorkout: 50, perChallenge: 100 },
    /** What each place pays (L7). Leaderboard coins are exempt from the daily ceiling (E8d). */
    tiers: [
      { fromRank: 1, toRank: 1, coins: 5000, perks: ['Premium T-Shirt', 'Water Bottle'] },
      { fromRank: 2, toRank: 3, coins: 3000, perks: ['Premium T-Shirt', 'Fitness Mat'] },
      { fromRank: 4, toRank: 10, coins: 1000, perks: ['Fitness Mat'] },
    ] as { fromRank: number; toRank: number; coins: number; perks: string[] }[],
    /** Hours into Monday before last week is closed and paid, so Sunday's late syncs count (L6, L10). */
    closeAfterHours: 6,
    /** How many places `GET /leaderboard` serves. */
    boardSize: 50,
  },
  /** The challenge board (RULES §C). */
  challenges: {
    /** How far ahead the board lists challenges that have not opened yet. */
    upcomingDays: 30,
  },
  /**
   * The shop's money side (RULES R1, R11–R13). Prices are paise; a coin is
   * worth `coinValuePaise` at the till, and at most `coinShareMax` of the
   * goods (0.3 = 30%) may be paid with coins — the rest is money. Set the
   * share to 1 and an order can be coins alone; set it to 0 and the shop is
   * cash only. Changed from `app_config` without a deploy, like every ⚙.
   */
  commerce: {
    currency: 'INR',
    coinValuePaise: 25,
    coinShareMax: 0.3,
    shippingFeePaise: 4900,
    freeShippingAbovePaise: 99900,
    maxQuantityPerLine: 5,
    /** How long an unpaid order holds its stock and coins before it is released. */
    paymentWindowMinutes: 30,
  },
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
  /**
   * Step ingestion and the fraud layers (BACKEND §7, RULES A1–A21). Every
   * threshold, weight and list is a starting point to tune on shadow data;
   * a change in production is dated in MEMORY.md §5 (RULES A21).
   */
  activity: {
    /**
     * How the phone's step tracker (react-native-step-tracker-pro) is set
     * up, served by `GET /activity/config` and passed to it as they are —
     * so counting, Health Connect and the on-phone checks change without an
     * app release. Health Connect is read for a watch's steps and written
     * with the phone's own; checks flag and remove nothing.
     */
    tracker: {
      healthConnectReadTypes: ['steps', 'distance'] as ('steps' | 'distance' | 'totalCalories')[],
      /**
       * Write the steps this phone counts into Health Connect (D-57), so the
       * user's other fitness apps see them. Steps only — the app declares
       * `WRITE_STEPS` and nothing else, since distance and calories here are
       * estimates. Only this phone's own count goes in: never a watch's
       * steps read back out, nor the user's other phones', and nothing from
       * before the sign-in (D-56). A day a watch already answers for is not
       * written, so other apps never see the same walk twice.
       */
      healthConnectWriteEnabled: true,
      /** A record per minute with steps, as Health Connect's guidance for steps asks; `day` writes one per day. */
      healthConnectWriteGranularity: 'minute' as 'day' | 'minute',
      healthConnectIgnoreManualEntries: true,
      wearableTrust: 'catalog' as 'metadata' | 'catalog',
      /**
       * Apps the tracker trusts as a watch's relay on top of its own catalog
       * (D-51). Google Fit carries Wear OS and many budget watches into
       * Health Connect, but the catalog files it as a phone-side app, so
       * under `catalog` it could only fill the hours before the phone began
       * counting — a walk with the watch never showed. Listed, it is used
       * whenever it counted more than the phone. This is what is shown;
       * what verifies is still `provenance` below.
       */
      wearableAllowlist: ['com.google.android.apps.fitness'],
      gapRecovery: 'split' as 'split' | 'today' | 'today_capped' | 'drop',
      /** A year for the analytics year view, and a month to spare. */
      historyRetentionDays: 400,
      /** Three days of windows at five minutes, so a day that waited offline still goes up with its evidence. */
      motionWindowRetention: 864,
      fraudDetection: { enabled: true, mode: 'flag' as 'flag' | 'exclude' },
      motionSampling: { enabled: true, windowSeconds: 10, intervalMinutes: 5 },
    },
    /** When and what the phone sends (BACKEND §7.3). */
    sync: {
      /** Minutes between syncs of today while the app is open. */
      intervalMinutes: 5,
      /** The least seconds between two syncs of today nobody asked for. */
      minGapSeconds: 120,
      /** The evidence each signed snapshot carries. */
      include: ['minutes', 'motionWindows', 'healthConnectRecords'] as ('minutes' | 'motionWindows' | 'healthConnectRecords')[],
      healthConnectRecordTypes: ['steps', 'distance'] as ('steps' | 'distance')[],
    },
    /**
     * Whether `GET /activity/sources` also shows the fraud layers' scores
     * and flags. They tell a cheater exactly which check caught them, so
     * null — the default — means "outside production only"; set true or
     * false to decide it.
     */
    inspector: { showChecks: null as boolean | null },
    /**
     * The daily step goal (D-55): the range a member may set it in, the step
     * the goal screen's − and + move by, and how `GET /activity/goal`
     * suggests one — where the member walks now (their recent days, or the
     * activity level in their profile until there are enough of those), one
     * stretch further, up to where the benefit levels off for their age and
     * BMI. A member already past that keeps what they walk.
     */
    goal: {
      min: 3000,
      max: 20_000,
      increment: 500,
      recommend: {
        /** Days read for where the member walks now — today left out — and how many must have steps. */
        historyDays: 14,
        minDaysWithSteps: 5,
        /** A day's steps typical of each activity level, used until there are enough days. */
        typicalByLevel: { sedentary: 4000, light: 6000, moderate: 8500, active: 11_000, athlete: 13_000 },
        /** How far past where the member walks now a suggestion goes. */
        stretch: 2000,
        /** Where the benefit levels off, by age: the last band whose `from` the member has reached. */
        targetByAge: [
          { from: 0, steps: 12_000 },
          { from: 18, steps: 10_000 },
          { from: 60, steps: 8000 },
          { from: 70, steps: 7000 },
        ],
        /** The target without a date of birth. */
        defaultTarget: 10_000,
        /** Added to the target by BMI band: more walking where weight is the thing to work on. */
        bmiAdjust: { underweight: 0, healthy: 0, overweight: 1000, obese: 1000 },
      },
    },
    /** A day older than this, in the phone's own zone, is refused (RULES A8). */
    maxAgeDays: 7,
    /** A snapshot signed further ahead of the server's clock than this is flagged (A8). */
    futureSkewMinutes: 5,
    /** Timed steps in one minute that make it an active minute. */
    activeMinuteSteps: 60,
    /** How long the latest signed snapshot of a device-day is kept verbatim. */
    rawSnapshotRetentionDays: 30,
    /** At or above this day score, and with no hard reject, a day is verified (A20). */
    verifiedMinScore: 50,
    /** Layer weights for the day score (A20); a layer with no data drops out. */
    weights: { L0: 25, L1: 20, L2: 20, L3: 15, L4: 10, L5: 5, L6: 5 },
    provenance: {
      /**
       * Health Connect origins whose steps count (A14). A trailing `*`
       * matches a prefix — Android's own counter writes as `android` or as
       * `com.android.healthconnect.phone.<hash>`.
       */
      allow: [
        'android',
        'com.android.healthconnect.phone.*',
        'com.google.android.apps.fitness',
        'com.fitbit.FitbitMobile',
        'com.sec.android.app.shealth',
        'com.garmin.android.apps.connectmobile',
        'com.huawei.health',
        'com.xiaomi.wearable',
        'com.huami.watch.hmwatchmanager',
        'com.ouraring.oura',
        'com.withings.wiscale2',
        'fi.polar.polarflow',
        'com.stt.android.suunto',
      ],
      /** Known step-fabrication packages (A14): never counted, and their presence is flagged. */
      deny: [] as string[],
      /** Also count a source the tracker's own wearable catalog trusts (`trustedWearable`). */
      trustTrackerCatalog: true,
      /** Count steps whose recording method is unstated. Off: unknown is unverified (BACKEND §7.4). */
      countUnknownMethod: false,
    },
    thresholds: {
      /** A5. */
      maxDailySteps: 45_000,
      /** Share of a day's steps the phone could not place in a minute before it reads as low confidence. */
      untimedShare: 0.5,
      /** Share of a day's steps the tracker's own checks flagged before the day is rejected. */
      suspectShareHard: 0.5,
      /** A15: external ÷ phone outside min–max flags; above `hard` the external count is not trusted. */
      pedometerRatio: { min: 0.7, max: 1.3, hard: 2.0 },
      /** A16: dominant frequency bands, Hz, and the non-walk share that rejects a day. */
      motion: { walkMinHz: 1.2, walkMaxHz: 2.8, shakeMinHz: 3, shakeMinVariance: 15, stillMaxHz: 1, nonWalkHardShare: 0.4 },
      /** A17: share of steps between 01:00 and 05:00 local. */
      nightShare: 0.2,
      /** A17: steps within 24 h of a device's first registration that read as farming. */
      newInstallSteps: 20_000,
      /** A17: round thousands on this many of the last 7 days. */
      roundTotalDays: 3,
      /** A7: metres per step a measured distance must fall within. */
      strideMeters: { min: 0.35, max: 1.2 },
      /** A clock moved by more than this, in minutes, is logged as a jump. */
      clockJumpMinutes: 5,
    },
  },
  /**
   * What a device has to prove before its steps are trusted (RULES A2, DV9):
   * a hardware-attested Keystore key for every snapshot, and a fresh Play
   * Integrity verdict now and then.
   */
  integrity: {
    android: {
      /** The package the attestation and the Play verdict must name. */
      packageName: 'com.vokve',
      /** SHA-256 (hex) of the release signing certificate(s). Empty skips the check — dev builds. */
      signingCertSha256: [] as string[],
    },
    playIntegrity: {
      /**
       * The Cloud project linked to the app in Play Console. Null, with no
       * `PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER` either, means a verdict is
       * never asked for.
       */
      cloudProjectNumber: null as number | null,
      /** A device's last verdict older than this is refreshed on its next upload. */
      freshHours: 6,
      /** How old a token may be when it arrives. */
      maxTokenAgeMinutes: 10,
    },
    /** How long an attestation challenge and an ingest nonce stay live. */
    challengeTtlSeconds: 600,
    nonceTtlSeconds: 600,
  },
  app: {
    minVersion: { ios: '1.0.0', android: '1.0.0' },
    storeUrl: {
      ios: 'https://apps.apple.com/app/vokve',
      android: 'https://play.google.com/store/apps/details?id=com.vokve',
    },
  },
  /**
   * The account's own knobs: how long a deletion can be called off for
   * (RULES P5), and how often a member may ask for their data.
   */
  account: {
    deletionGraceDays: 14,
    exportCooldownHours: 24,
    /**
     * The biggest avatar the API will store, in kilobytes, measured on the
     * decoded image. The app downscales to 512px before it uploads, which
     * lands well under this; the cap is what stops a hand-rolled client
     * posting a 12-megapixel photo.
     */
    avatarMaxKb: 512,
  },
  /** Where the About and Help screens point. Changed without a deploy, like every ⚙. */
  support: {
    email: 'support@vokve.app',
    company: 'VOKVE Fitness',
    links: {
      privacy: 'https://vokve.app/privacy',
      terms: 'https://vokve.app/terms',
      licenses: 'https://vokve.app/licenses',
      website: 'https://vokve.app',
    },
  },
  locale: { country: 'IN', timezone: 'Asia/Kolkata' },
};

export type AppConfig = typeof CONFIG_DEFAULTS;
