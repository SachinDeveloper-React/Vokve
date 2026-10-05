import { config } from '../../constants/config';
import {
  REFERRAL_REWARD_COINS,
  dietPlanRotation,
  healthHighlights,
  foodLibrary,
  quickAddFoodIds,
  seedFoodEntries,
  healthTip,
  hydrationHighlights,
  hydrationTip,
  nutritionTip,
  leaderboardHighlights,
  referralCode,
  seedCoinTransactions,
  seedNotifications,
  seedAchievements,
  seedChallenges,
  seedLeaderboard,
  seedReferrals,
  seedStreak,
  seedVitals,
  shopItems,
  workoutTemplates,
} from '../../constants/seedData';
import {
  achievementSchema,
  dietPlanDaySchema,
  healthScoreSchema,
  nutritionDaySchema,
  nutritionProfileSchema,
  contentTipSchema,
  hydrationDaySchema,
  hydrationReminderPlanSchema,
  hydrationStatsSchema,
  activityConfigSchema,
  activityRangeSchema,
  authResponseSchema,
  challengeSchema,
  dailyActivitySchema,
  deviceAttestationResultSchema,
  leaderboardBoardSchema,
  leaderboardHistorySchema,
  leaderboardRulesSchema,
  stepGoalSchema,
  stepIngestResultSchema,
  stepSourcesReportSchema,
  streakRestoreResultSchema,
  streakSummarySchema,
  userSchema,
  userSettingsSchema,
  verificationChallengeSchema,
  vitalReadingSchema,
  vitalsLatestSchema,
  workoutSchema,
  type AccountSession,
  type ActivityLevel,
  type Address,
  type AppNotification,
  type AuthResponse,
  type Cart,
  type Challenge,
  type CheckoutResult,
  type ContentTopic,
  type FoodEntry,
  type HydrationReminderPlan,
  type NutritionProfile,
  type VitalReading,
  type NotificationPreferences,
  type Order,
  type PrivacySettings,
  type ProfileBadge,
  type ProfileSummary,
  type PurchaseLine,
  type Quote,
  type ReferralProgram,
  type Review,
  type ShopConfig,
  type ShopItem,
  type SupportFaq,
  type SupportTicket,
  type CoinTransaction,
  type DailyActivity,
  type StepIngestResult,
  type StreakRun,
  type StreakSummary,
  type User,
  type UserSettings,
  type VerificationChallenge,
  type Workout,
  type WorkoutTemplate,
} from '../../types/models';
import type { CompleteProfilePayload, SignUpPayload } from '../../types/forms';
import { logger } from '../../utils/logger';
import { ApiError } from './errors';
import type {
  AccountApi,
  ActivityApi,
  AddressApi,
  AppApi,
  AuthApi,
  CartApi,
  ChallengeApi,
  CheckoutApi,
  ContentApi,
  HydrationApi,
  DeviceApi,
  LeaderboardApi,
  NotificationApi,
  NotificationPreferencesApi,
  NutritionApi,
  OrderApi,
  ReferralApi,
  SettingsApi,
  ShopApi,
  StreakApi,
  SupportApi,
  UserApi,
  VitalsApi,
  WalletApi,
  WishlistApi,
  WorkoutApi,
} from './contracts';

/**
 * An in-memory stand-in for the backend, so the whole app can be built and
 * demonstrated before there is one.
 *
 * Two rules keep it from becoming a liability. It implements the same
 * contracts as the real endpoints, so it cannot drift out of step with them
 * unnoticed; and every response it returns is parsed through the very same zod
 * schemas the real client validates against, so a mock that has gone stale
 * fails loudly here rather than producing a screen full of `undefined`.
 *
 * State lives in module scope, which means it resets on every reload — that is
 * the intent. Persisted fake data is the thing that eventually gets mistaken
 * for real data.
 */

/** Everything the mock will and will not accept, in one place. */
export const MOCK_RULES = {
  /** The only code `verifyOtp` accepts. Any other six digits are rejected. */
  otp: '123456',
  /**
   * An email or phone containing this is treated as already registered, so the
   * "that number is taken" path can be seen without a second account.
   */
  takenMarker: 'taken',
  /** Sign in with this password to exercise the failure path. */
  rejectedPassword: 'wrongpass',
} as const;

/** Mirrors the real challenge's timings so both clocks can be watched run out. */
const OTP_LIFETIME_SECONDS = 105;
const RESEND_COOLDOWN_SECONDS = 27;

const SESSION_HOURS = 12;

interface PendingSignUp {
  payload: SignUpPayload;
  expiresAt: number;
  resendAt: number;
  /** Which code this is — the phone's, or the email's that follows it. */
  channel?: 'sms' | 'email';
  /**
   * What passing it unlocks. A step-up code proves the user, not a contact,
   * and answers with a token; a contact change moves the address it was
   * sent to onto the account.
   */
  purpose?: 'step_up' | 'change_email' | 'change_phone';
}

const pendingSignUps = new Map<string, PendingSignUp>();

/** The account the mock is currently pretending exists. */
let currentUser: User | null = null;

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${(idCounter += 1)}`;

const delay = () =>
  new Promise<void>(resolve => setTimeout(resolve, config.mockLatencyMs));

const secondsUntil = (timestamp: number) =>
  Math.max(0, Math.round((timestamp - Date.now()) / 1000));

function makeUser(
  payload?: SignUpPayload,
  provenBy: 'email' | 'sms' = 'email',
): User {
  const now = new Date().toISOString();
  return userSchema.parse({
    id: nextId('usr'),
    createdAt: now,
    // A fresh sign-up has proven exactly the contact its code went to; a
    // returning mock user has done both.
    emailVerifiedAt: payload ? (provenBy === 'email' ? now : null) : now,
    phoneVerifiedAt: payload ? (provenBy === 'sms' ? now : null) : now,
    // Sign-up has no name field, so one is derived from the email local part
    // rather than left blank — a greeting reading "Welcome, !" is the kind of
    // thing that ships.
    name: payload
      ? payload.email.split('@')[0].replace(/[._-]+/g, ' ')
      : 'Sachin Kumar',
    email: payload?.email ?? 'sachin@example.com',
    dateOfBirth: payload?.dateOfBirth ?? '1995-04-17',
    phone: payload?.phone ?? '+919876543210',
    gender: payload?.gender ?? 'male',
    // Left blank on purpose for a fresh sign-up: onboarding is what fills
    // these in, and seeding them would skip the step being built.
    heightCm: payload ? null : 175,
    weightKg: payload ? null : 72,
    profileCompletedAt: payload ? null : new Date().toISOString(),
    streakDays: 5,
  });
}

function makeAuthResponse(user: User): AuthResponse {
  return authResponseSchema.parse({
    user,
    tokens: {
      accessToken: nextId('mock.access'),
      refreshToken: nextId('mock.refresh'),
      expiresAt: Date.now() + SESSION_HOURS * 3600_000,
    },
  });
}

function makeChallenge(
  verificationId: string,
  pending: PendingSignUp,
): VerificationChallenge {
  const channel = pending.channel ?? 'sms';
  return verificationChallengeSchema.parse({
    verificationId,
    phone: channel === 'sms' ? pending.payload.phone : '',
    channel,
    target:
      channel === 'email'
        ? `${pending.payload.email.slice(0, 1)}•••@${
            pending.payload.email.split('@')[1] ?? ''
          }`
        : `${pending.payload.phone.slice(
            0,
            3,
          )}••••••${pending.payload.phone.slice(-4)}`,
    codeLength: MOCK_RULES.otp.length,
    expiresInSeconds: secondsUntil(pending.expiresAt),
    resendInSeconds: secondsUntil(pending.resendAt),
    purpose: pending.purpose ?? null,
    // The mock's one code, surfaced the way the dev server surfaces its own.
    devCode: MOCK_RULES.otp,
  });
}

export const mockAuthApi: AuthApi = {
  async signIn(email, password) {
    await delay();

    if (password === MOCK_RULES.rejectedPassword) {
      throw new ApiError(
        'unauthorized',
        'That email or password is not right.',
        401,
      );
    }

    currentUser = currentUser ?? makeUser();
    return makeAuthResponse(currentUser);
  },

  async signUp(payload) {
    await delay();

    const marker = MOCK_RULES.takenMarker;
    if (payload.email.includes(marker) || payload.phone.includes(marker)) {
      throw new ApiError(
        'validation',
        'An account with those details already exists.',
        422,
      );
    }
    // A code is checked on the form, on its field, the way the server does —
    // before any code goes out.
    if (payload.referralCode && !MOCK_FRIEND_CODES.has(payload.referralCode)) {
      throw new ApiError(
        'validation',
        'Check the highlighted fields.',
        422,
        {
          referralCode:
            'That code does not match anyone. Check it with your friend.',
        },
        'VALIDATION_FAILED',
      );
    }

    // Email first, as the server does while there is no SMS provider
    // (`otp.signupChannel`); the phone is asked for later, once there is.
    const verificationId = nextId('ver');
    pendingSignUps.set(verificationId, {
      payload,
      channel: 'email',
      expiresAt: Date.now() + OTP_LIFETIME_SECONDS * 1000,
      resendAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
    });

    logger.info(
      'mockApi',
      `OTP for ${payload.email} is ${MOCK_RULES.otp} (mock backend)`,
    );

    return makeChallenge(verificationId, pendingSignUps.get(verificationId)!);
  },

  async verifyOtp(verificationId, code) {
    await delay();

    const pending = pendingSignUps.get(verificationId);
    if (!pending) {
      throw new ApiError(
        'not_found',
        'That sign-up has expired. Please start again.',
        404,
      );
    }

    if (Date.now() > pending.expiresAt) {
      throw new ApiError(
        'validation',
        'That code has expired. Ask for a new one.',
        422,
      );
    }

    if (code !== MOCK_RULES.otp) {
      throw new ApiError(
        'validation',
        'That code is not right. Check it and try again.',
        422,
      );
    }

    pendingSignUps.delete(verificationId);

    // A contact change: passing the code is what moves the address onto the
    // account, exactly as the server does it.
    if (
      currentUser &&
      (pending.purpose === 'change_email' || pending.purpose === 'change_phone')
    ) {
      currentUser =
        pending.purpose === 'change_email'
          ? {
              ...currentUser,
              email: pending.payload.email,
              emailVerifiedAt: new Date().toISOString(),
            }
          : {
              ...currentUser,
              phone: pending.payload.phone,
              phoneVerifiedAt: new Date().toISOString(),
            };
      return makeAuthResponse(currentUser);
    }

    // A step-up: the session is refreshed and the proof rides with it,
    // remembered so the redeem that follows can recognise and spend it.
    if (currentUser && pending.purpose === 'step_up') {
      const stepUpToken = nextId('mock.stepup');
      mockStepUps.add(stepUpToken);
      return authResponseSchema.parse({
        ...makeAuthResponse(currentUser),
        stepUpToken,
      });
    }

    // A verification on an account that already exists — the email asked
    // for by the banner, or a phone once SMS exists — stamps that contact.
    if (currentUser && pending.channel === 'email') {
      currentUser = userSchema.parse({
        ...currentUser,
        emailVerifiedAt: new Date().toISOString(),
      });
      return makeAuthResponse(currentUser);
    }

    // The sign-up code: the account exists from here, with the contact the
    // code went to proven. The server would now send the other contact its
    // code if that channel could deliver; the mock has no SMS, so it does
    // what the server does without one — nothing, and no `nextVerification`.
    currentUser = makeUser(pending.payload, pending.channel ?? 'email');
    // The friend's code the form carried opens the referral with the account.
    if (pending.payload.referralCode) {
      mockApplied = {
        code: pending.payload.referralCode,
        inviterName:
          pending.payload.referralCode === 'ASHA2K7' ? 'Asha' : 'Ravi',
        status: 'pending',
        rewardCoins: REFERRAL_REWARD_COINS,
        appliedAt: new Date().toISOString(),
      };
    }
    return makeAuthResponse(currentUser);
  },

  async sendEmailOtp() {
    await delay();
    if (!currentUser) {
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    }
    const emailId = nextId('ver');
    const pending: PendingSignUp = {
      payload: {
        email: currentUser.email,
        phone: currentUser.phone ?? '',
        password: '',
        dateOfBirth: currentUser.dateOfBirth ?? '',
        gender: currentUser.gender ?? 'other',
      },
      channel: 'email',
      expiresAt: Date.now() + OTP_LIFETIME_SECONDS * 1000,
      resendAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
    };
    pendingSignUps.set(emailId, pending);
    return makeChallenge(emailId, pending);
  },

  async stepUp() {
    await delay();
    if (!currentUser) {
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    }
    const id = nextId('ver');
    const pending: PendingSignUp = {
      payload: {
        email: currentUser.email,
        phone: currentUser.phone ?? '',
        password: '',
        dateOfBirth: currentUser.dateOfBirth ?? '',
        gender: currentUser.gender ?? 'other',
      },
      channel: 'email',
      purpose: 'step_up',
      expiresAt: Date.now() + OTP_LIFETIME_SECONDS * 1000,
      resendAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
    };
    pendingSignUps.set(id, pending);
    return makeChallenge(id, pending);
  },

  async resendOtp(verificationId) {
    await delay();

    const pending = pendingSignUps.get(verificationId);
    if (!pending) {
      throw new ApiError(
        'not_found',
        'That sign-up has expired. Please start again.',
        404,
      );
    }

    // Both clocks restart, exactly as a real resend would: the new code has its
    // own lifetime, and the cooldown begins again from now.
    const refreshed: PendingSignUp = {
      ...pending,
      expiresAt: Date.now() + OTP_LIFETIME_SECONDS * 1000,
      resendAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
    };
    pendingSignUps.set(verificationId, refreshed);

    logger.info(
      'mockApi',
      `OTP resent for ${refreshed.payload.phone}, still ${MOCK_RULES.otp}`,
    );

    return makeChallenge(verificationId, refreshed);
  },

  async forgotPassword(identifier) {
    await delay();
    const isEmail = identifier.includes('@');
    const id = nextId('ver');
    const pending: PendingSignUp = {
      payload: {
        email: isEmail ? identifier.toLowerCase() : 'sachin@example.com',
        phone: isEmail ? '+919876543210' : identifier.replace(/[\s-]/g, ''),
        password: '',
        dateOfBirth: '',
        gender: 'other',
      },
      channel: isEmail ? 'email' : 'sms',
      expiresAt: Date.now() + OTP_LIFETIME_SECONDS * 1000,
      resendAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
    };
    pendingSignUps.set(id, pending);
    logger.info(
      'mockApi',
      `Reset code for ${identifier} is ${MOCK_RULES.otp} (mock backend)`,
    );
    return makeChallenge(id, pending);
  },

  async resetPassword(verificationId, code) {
    await delay();
    const pending = pendingSignUps.get(verificationId);
    if (!pending) {
      throw new ApiError(
        'not_found',
        'This code is no longer valid. Request a new one.',
        404,
      );
    }
    if (code !== MOCK_RULES.otp) {
      throw new ApiError(
        'validation',
        'That code is not right. Check it and try again.',
        422,
      );
    }
    pendingSignUps.delete(verificationId);
    return { ok: true };
  },

  async signOut() {
    await delay();
    currentUser = null;
    pendingSignUps.clear();
    mockFeed = seedNotifications.map(entry => ({ ...entry }));
    mockStock = new Map(
      shopItems.map(item => [item.id, item.inStock ? 25 : 0]),
    );
    mockOrders = [];
    mockAddresses = [];
    mockBalance = null;
    mockCart = [];
    mockWishlist = [];
    mockReviews = [];
    mockPrivacy = {
      analytics: true,
      personalisedOffers: true,
      shareNameWithReferrer: true,
    };
    mockDeletion = { scheduledAt: null, purgeAt: null, reason: null };
    mockTickets = [];
    mockApplied = null;
    mockAttestationChallenges = new Map();
    mockAttestedKeys = new Set();
    mockActivityDays = new Map();
    mockNonces = new Map();
    mockIngested = new Map();
    mockIntegrityAt = 0;
    mockSnapshots = new Map();
    mockSettings = { ...MOCK_DEFAULT_SETTINGS };
    mockGoalChosenAt = null;
    mockStreak = mockFreshStreak();
    mockWater = new Map();
    mockPlan = mockDefaultPlan();
    mockNutritionProfile = mockDefaultNutrition();
    mockFood = new Map(seedFoodEntries.map(entry => [entry.id, entry]));
    mockVitals = new Map(
      seedVitals
        .filter(reading => reading.kind !== 'bmi')
        .map(reading => [reading.id, reading]),
    );
    return { ok: true };
  },
};

export const mockUserApi: UserApi = {
  async me() {
    await delay();

    if (!currentUser) {
      // The same 401 the real API returns for a dead token, so the store's
      // session-restore path is exercised rather than bypassed.
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    }
    return currentUser;
  },

  async updateProfile(patch) {
    await delay();

    if (!currentUser) {
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    }
    currentUser = userSchema.parse({ ...currentUser, ...patch });
    return currentUser;
  },

  async completeProfile(payload: CompleteProfilePayload) {
    await delay();

    if (!currentUser) {
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    }

    currentUser = userSchema.parse({
      ...currentUser,
      name: payload.name,
      heightCm: payload.heightCm,
      weightKg: payload.weightKg,
      units: payload.units,
      // The stamp is the whole point of this call: it is what moves the app
      // past onboarding on the next launch.
      profileCompletedAt: new Date().toISOString(),
    });
    return currentUser;
  },
  async uploadAvatar({ data, contentType }) {
    await delay();
    if (!currentUser) {
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    }
    // The mock keeps the bytes as a data URL, which is what a real server's
    // media URL stands in for: the `Avatar` renders either without caring.
    currentUser = {
      ...currentUser,
      avatarUrl: `data:${contentType};base64,${data}`,
    };
    return currentUser;
  },

  async removeAvatar() {
    await delay();
    if (!currentUser) {
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    }
    currentUser = { ...currentUser, avatarUrl: null };
    return currentUser;
  },
};

/** A new account's settings, as the server creates them. */
const MOCK_DEFAULT_SETTINGS: UserSettings = {
  units: 'metric',
  dailyStepGoal: 10_000,
  dailyWaterGoalMl: 2500,
  restTimerSeconds: 90,
  hapticsEnabled: true,
  workoutRemindersEnabled: true,
  keepAwakeDuringWorkout: true,
};
let mockSettings: UserSettings = { ...MOCK_DEFAULT_SETTINGS };

/** ⚙ `activity.goal` as the server ships it (D-55). */
const MOCK_GOAL = {
  min: 3000,
  max: 20_000,
  increment: 500,
  historyDays: 14,
  minDaysWithSteps: 5,
  typicalByLevel: {
    sedentary: 4000,
    light: 6000,
    moderate: 8500,
    active: 11_000,
    athlete: 13_000,
  } as Record<ActivityLevel, number>,
  stretch: 2000,
};
/** When the goal was last saved; null while it is the default. */
let mockGoalChosenAt: string | null = null;

export const mockSettingsApi: SettingsApi = {
  async get() {
    await delay();
    return mockSettings;
  },
  /**
   * Validated by the same schema the server's clamps mirror, and the step
   * goal against its range as the server checks it; saving a goal marks it
   * chosen.
   */
  async update(patch) {
    await delay();
    const next = userSettingsSchema.safeParse({ ...mockSettings, ...patch });
    const goal = patch.dailyStepGoal;
    if (goal !== undefined && (goal < MOCK_GOAL.min || goal > MOCK_GOAL.max)) {
      throw new ApiError('validation', 'Check the highlighted fields.', 422, {
        dailyStepGoal: `Choose a goal between ${MOCK_GOAL.min.toLocaleString(
          'en-IN',
        )} and ${MOCK_GOAL.max.toLocaleString('en-IN')} steps.`,
      });
    }
    if (!next.success) {
      throw new ApiError('validation', 'Check the highlighted fields.', 422);
    }
    if (goal !== undefined) {
      mockGoalChosenAt = new Date().toISOString();
    }
    mockSettings = next.data;
    return mockSettings;
  },
};

/** Built from the same seed the workout screens already read. */
export const mockWorkoutApi: WorkoutApi = {
  async templates(): Promise<WorkoutTemplate[]> {
    await delay();
    return workoutTemplates;
  },

  async history() {
    await delay();
    // Nothing yet: a fresh account has no history, and inventing one makes the
    // empty state impossible to look at.
    return { data: [] as Workout[], nextCursor: null };
  },

  async save(workout): Promise<Workout> {
    await delay();
    // Echoed back through the schema, the way a real save returns the stored
    // record rather than the one that was sent.
    return workoutSchema.parse(workout);
  },
};

/**
 * The attestation the mock holds: the challenge each device was last handed,
 * and every key a device has proven. Keys rather than devices, because a
 * snapshot names the key that signed it and not the device it came from.
 */
let mockAttestationChallenges = new Map<string, string>();
let mockAttestedKeys = new Set<string>();

/** How long a challenge or a nonce stays live, as the server keeps them. */
const MOCK_CHALLENGE_TTL_MS = 10 * 60_000;

export const mockDeviceApi: DeviceApi = {
  async register(profile) {
    await delay();
    return {
      deviceId: `dev_mock_${profile.installId.slice(0, 8)}`,
      trustTier: 'normal' as const,
      mustUpgrade: false,
      minVersion: '1.0.0',
    };
  },
  async setPushToken() {
    await delay();
    return { ok: true };
  },
  async attestationChallenge(deviceId) {
    await delay();
    const challenge = nextId('chl');
    mockAttestationChallenges.set(deviceId, challenge);
    return {
      challenge,
      expiresAt: new Date(Date.now() + MOCK_CHALLENGE_TTL_MS).toISOString(),
    };
  },
  /**
   * Takes the key on trust: the real server checks the chain up to Google's
   * root and finds its own challenge inside the leaf, which a mock cannot.
   * It does insist a challenge was asked for first, so the order of the two
   * calls is exercised.
   */
  async submitAttestation(deviceId, attestation) {
    await delay();
    if (!mockAttestationChallenges.has(deviceId)) {
      throw new ApiError(
        'unknown',
        'That attestation has no challenge behind it. Ask for a new one.',
        409,
        null,
        'ATTESTATION_CHALLENGE_INVALID',
      );
    }
    mockAttestationChallenges.delete(deviceId);
    mockAttestedKeys.add(attestation.keyId);
    return deviceAttestationResultSchema.parse({
      keyId: attestation.keyId,
      attested: attestation.attested && attestation.certificateChain.length > 0,
      securityLevel: attestation.securityLevel,
    });
  },
};

/** The server's default page size, so the mock pages exactly where it would. */
const TRANSACTION_PAGE_SIZE = 20;

/**
 * The same calendar-month rule the server applies (RULES E12), so the figure
 * the mock hands back is the one the wallet would show against a backend —
 * a lifetime total labelled "this month" is the kind of mock drift the
 * contracts exist to catch.
 */
function monthSummaryOf(transactions: CoinTransaction[]) {
  const now = new Date();
  let earned = 0;
  let spent = 0;
  for (const entry of transactions) {
    const at = new Date(entry.createdAt);
    if (
      at.getMonth() !== now.getMonth() ||
      at.getFullYear() !== now.getFullYear()
    ) {
      continue;
    }
    if (entry.amount > 0) earned += entry.amount;
    else spent += -entry.amount;
  }
  return { earned, spent, net: earned - spent };
}

export const mockWalletApi: WalletApi = {
  async get() {
    await delay();
    const balance = seedCoinTransactions.reduce((sum, t) => sum + t.amount, 0);
    const earned = seedCoinTransactions
      .filter(t => t.amount > 0)
      .reduce((s, t) => s + t.amount, 0);
    return {
      balance,
      pending: 0,
      lifetimeEarned: earned,
      expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      expiryDaysLeft: 90,
      expiryWindowDays: 90,
      expiryWarnDays: [14, 3],
      monthSummary: monthSummaryOf(seedCoinTransactions),
      dailyCap: 300,
      earnedToday: 60,
      remainingToday: 240,
      stepUpThreshold: MOCK_STEP_UP_THRESHOLD,
    };
  },
  /**
   * Pages the way the server does: the cursor is the id of the last row
   * handed out, and the next page starts just after it. An unknown cursor
   * starts from the top rather than failing — the real one would 400, but a
   * mock that refuses stale cursors only ever gets in the way of a demo.
   */
  async transactions(query = {}) {
    await delay();
    const limit = Math.min(
      100,
      Math.max(1, query.limit ?? TRANSACTION_PAGE_SIZE),
    );
    const rows = query.source
      ? seedCoinTransactions.filter(t => t.source === query.source)
      : seedCoinTransactions;
    const after = query.cursor
      ? rows.findIndex(t => t.id === query.cursor)
      : -1;
    const data = rows.slice(after + 1, after + 1 + limit);
    const last = data[data.length - 1];
    const hasMore = last !== undefined && rows.indexOf(last) < rows.length - 1;
    return { data, nextCursor: hasMore ? last.id : null };
  },
  async earnRules() {
    await delay();
    return [
      {
        source: 'steps' as const,
        title: 'Walk',
        detail: 'Per 100 verified steps',
        reward: 0.095,
      },
      {
        source: 'workout' as const,
        title: 'Finish a workout',
        detail: 'Any logged session',
        reward: 100,
      },
      {
        source: 'streak' as const,
        title: 'Keep a streak',
        detail: '7 days in a row',
        reward: 50,
      },
      {
        source: 'referral' as const,
        title: 'Invite a friend',
        detail: 'Once they verify their number and email',
        reward: 20,
      },
    ];
  },
};

// ─── Challenges ────────────────────────────────────────────────────────────

/** The last day of the period `date` falls in — the server's rule (RULES C6). */
function mockPeriodEnd(cadence: Challenge['cadence'], date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (cadence === 'daily') return date;
  if (cadence === 'weekly') {
    const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return new Date(Date.UTC(y, m - 1, d + 6 - weekday))
      .toISOString()
      .slice(0, 10);
  }
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export const mockChallengeApi: ChallengeApi = {
  async board(date) {
    await delay();
    const open = seedChallenges.filter(
      c => c.startsAt === null || c.startsAt <= date,
    );
    const upcoming = seedChallenges
      .filter(c => c.startsAt !== null && c.startsAt > date)
      .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
    return [
      ...open.map(c =>
        challengeSchema.parse({
          ...c,
          startsAt: null,
          endsOn: mockPeriodEnd(c.cadence, date),
          completedAt: c.progress >= c.goal ? new Date().toISOString() : null,
        }),
      ),
      ...upcoming.map(c =>
        challengeSchema.parse({ ...c, progress: 0, endsOn: null }),
      ),
    ];
  },
  async achievements() {
    await delay();
    return seedAchievements.map(a => achievementSchema.parse(a));
  },
};

// ─── Streak ────────────────────────────────────────────────────────────────

/** The server's defaults (⚙ `streak`, `coins.streakMilestones`). */
const MOCK_STREAK_RULES = {
  restoreCost: 50,
  restoreWindowDays: 7,
  maxFreezes: 3,
  milestones: [
    { days: 7, coins: 50 },
    { days: 15, coins: 150 },
    { days: 30, coins: 300 },
    { days: 90, coins: 1000 },
    { days: 180, coins: 2000 },
  ],
} as const;

const mockFreshStreak = () => ({
  completed: new Set<string>(seedStreak.completedDays),
  protectedDays: new Set<string>(seedStreak.protectedDays),
  freezes: seedStreak.freezesAvailable,
});

let mockStreak = mockFreshStreak();

/** Local `YYYY-MM-DD` — the mock's today, in the phone's own zone. */
function mockToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}`;
}

function mockStreakDayShift(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The server's run arithmetic (RULES S2, S3, S6), on the mock's days. */
function mockRuns(days: Set<string>, today: string) {
  let cursor = days.has(today) ? today : mockStreakDayShift(today, -1);
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor = mockStreakDayShift(cursor, -1);
  }

  const sorted = [...days].sort();
  let longest: StreakRun | null = null;
  let start = sorted[0];
  let length = 0;
  sorted.forEach((day, i) => {
    const follows = i > 0 && mockStreakDayShift(sorted[i - 1], 1) === day;
    start = follows ? start : day;
    length = follows ? length + 1 : 1;
    if (longest === null || length > longest.length) {
      longest = { length, start, end: day };
    }
  });

  const gap: string[] = [];
  if (current === 0) {
    let back = mockStreakDayShift(today, -2);
    for (let n = 2; n <= MOCK_STREAK_RULES.restoreWindowDays; n++) {
      if (days.has(back)) {
        for (
          let d = mockStreakDayShift(back, 1);
          d < today;
          d = mockStreakDayShift(d, 1)
        ) {
          gap.push(d);
        }
        break;
      }
      back = mockStreakDayShift(back, -1);
    }
  }
  return { current, longest: longest as StreakRun | null, gap };
}

function mockStreakSummary(): StreakSummary {
  const today = mockToday();
  const all = new Set([...mockStreak.completed, ...mockStreak.protectedDays]);
  const { current, longest, gap } = mockRuns(all, today);
  const milestones = MOCK_STREAK_RULES.milestones.map(m => ({
    days: m.days,
    coins: m.coins,
    achieved: (longest?.length ?? 0) >= m.days,
    paid: (longest?.length ?? 0) >= m.days,
  }));
  return streakSummarySchema.parse({
    today,
    currentStreak: current,
    longestStreak: longest,
    completedDays: [...mockStreak.completed].sort(),
    protectedDays: [...mockStreak.protectedDays].sort(),
    freezesAvailable: mockStreak.freezes,
    maxFreezes: MOCK_STREAK_RULES.maxFreezes,
    todayCovered: all.has(today),
    todayFrozen: mockStreak.protectedDays.has(today),
    canRestore: gap.length > 0,
    restoreGap: gap,
    restoreCostCoins: MOCK_STREAK_RULES.restoreCost,
    restoreWindowDays: MOCK_STREAK_RULES.restoreWindowDays,
    milestones,
    nextMilestone: milestones.find(m => m.days > current) ?? null,
    howToEarn: `Finish a workout or walk ${mockSettings.dailyStepGoal.toLocaleString(
      'en-IN',
    )} steps in a day.`,
  });
}

export const mockStreakApi: StreakApi = {
  async get() {
    await delay();
    return mockStreakSummary();
  },
  async freeze() {
    await delay();
    const today = mockToday();
    if (
      mockStreak.completed.has(today) ||
      mockStreak.protectedDays.has(today)
    ) {
      throw new ApiError(
        'unknown',
        'Today already counts — save the freeze for a rest day.',
        409,
        null,
        'STREAK_ALREADY_COVERED',
      );
    }
    if (mockStreak.freezes <= 0) {
      throw new ApiError(
        'unknown',
        'No freezes left. Keep your streak going to earn another.',
        409,
        null,
        'NO_FREEZES_LEFT',
      );
    }
    mockStreak.freezes -= 1;
    mockStreak.protectedDays.add(today);
    return mockStreakSummary();
  },
  async restore() {
    await delay();
    const summary = mockStreakSummary();
    if (!summary.canRestore) {
      throw new ApiError(
        'validation',
        summary.currentStreak > 0
          ? 'Your streak is intact. Keep it going!'
          : 'Your last streak ended too long ago to bring back.',
        422,
        null,
        'NOTHING_TO_RESTORE',
      );
    }
    const balance = currentBalance();
    if (balance < MOCK_STREAK_RULES.restoreCost) {
      throw new ApiError(
        'validation',
        `You need ${
          MOCK_STREAK_RULES.restoreCost - balance
        } more coins for this.`,
        422,
        { required: MOCK_STREAK_RULES.restoreCost, balance },
        'INSUFFICIENT_COINS',
      );
    }
    mockBalance = balance - MOCK_STREAK_RULES.restoreCost;
    summary.restoreGap.forEach(day => mockStreak.protectedDays.add(day));
    return streakRestoreResultSchema.parse({
      streak: mockStreakSummary(),
      balance: mockBalance,
    });
  },
};

// ─── Leaderboard ───────────────────────────────────────────────────────────

/** The server's default prize tiers (⚙ `leaderboard.tiers`). */
const MOCK_TIERS = [
  {
    fromRank: 1,
    toRank: 1,
    coins: 5000,
    perks: ['Premium T-Shirt', 'Water Bottle'],
  },
  {
    fromRank: 2,
    toRank: 3,
    coins: 3000,
    perks: ['Premium T-Shirt', 'Fitness Mat'],
  },
  { fromRank: 4, toRank: 10, coins: 1000, perks: ['Fitness Mat'] },
];

export const mockLeaderboardApi: LeaderboardApi = {
  async board() {
    await delay();
    const today = mockToday();
    const [y, m, d] = today.split('-').map(Number);
    const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const start = mockStreakDayShift(today, -weekday);
    const end = mockStreakDayShift(start, 6);
    return leaderboardBoardSchema.parse({
      period: {
        id: start,
        start,
        end,
        resetsAt: new Date(
          `${mockStreakDayShift(end, 1)}T00:00:00`,
        ).toISOString(),
        country: 'IN',
        status: 'live',
      },
      entries: seedLeaderboard,
      me: { rank: 12, score: 1_240, coins: 0, percentile: 88 },
      ranked: 96,
    });
  },
  async history() {
    await delay();
    const {
      bestRank,
      bestRankAchievedOn,
      topTenFinishes,
      rewardCoinsEarned,
      rewardsWon,
    } = leaderboardHighlights;
    return leaderboardHistorySchema.parse({
      bestRank,
      bestRankAchievedOn,
      topTenFinishes,
      rewardCoinsEarned,
      rewardsWon,
      periods: [],
    });
  },
  async rules() {
    await delay();
    return leaderboardRulesSchema.parse({
      scope: 'India',
      tiers: MOCK_TIERS.map(t => ({
        id: `rank-${t.fromRank}-${t.toRank}`,
        ...t,
        label:
          t.fromRank === t.toRank
            ? `Rank ${t.fromRank}`
            : `Rank ${t.fromRank} – ${t.toRank}`,
      })),
      howItWorks: [
        {
          title: 'Compete every week',
          detail:
            'Verified steps, workouts and completed challenges all count: a point for every 100 steps, 50 for a workout and 100 for a challenge. The week runs Monday to Sunday.',
        },
        {
          title: 'Climb your country board',
          detail:
            'You are ranked against everyone in India, so a place is won against people in the same week as you. A tie goes to whoever reached the score first.',
        },
        {
          title: 'Finish in the top 10',
          detail:
            'Place 1 takes 5,000 coins and Premium T-Shirt + Water Bottle; places 2–3 take 3,000 coins and Premium T-Shirt + Fitness Mat; places 4–10 take 1,000 coins and Fitness Mat.',
        },
        {
          title: 'Rewards land on Monday',
          detail:
            'Coins are credited to your wallet automatically once the week closes. We will be in touch about any gear.',
        },
      ],
      note: 'Rewards are given every week based on leaderboard ranking.',
    });
  },
};

// ─── Hydration ─────────────────────────────────────────────────────────────

/** The server's default reminder plan (⚙ `hydration.defaultPlan`). */
function mockDefaultPlan(): HydrationReminderPlan {
  const times: [
    HydrationReminderPlan['reminders'][number]['slot'],
    string[],
  ][] = [
    ['morning', ['07:00', '08:30', '10:00']],
    ['afternoon', ['13:00', '15:30']],
    ['evening', ['18:00', '20:00']],
  ];
  return {
    enabled: true,
    sound: 'Default',
    vibration: true,
    repeatDays: [0, 1, 2, 3, 4, 5, 6],
    reminders: times.flatMap(([slot, list]) =>
      list.map(time => ({ id: `${slot}-${time}`, time, slot, enabled: true })),
    ),
  };
}

let mockWater = new Map<string, { ml: number; at: string; day: string }>();
let mockPlan: HydrationReminderPlan = mockDefaultPlan();

/** The phone's own local day of an instant — the mock's stand-in for the server's zone. */
function mockLocalDay(at: string): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

function mockWaterDay(day: string) {
  const entries = [...mockWater.entries()]
    .filter(([, drink]) => drink.day === day)
    .map(([id, drink]) => ({ id, ml: drink.ml, at: drink.at }))
    .sort((a, b) => b.at.localeCompare(a.at));
  return hydrationDaySchema.parse({
    date: day,
    consumedMl: entries.reduce((sum, entry) => sum + entry.ml, 0),
    goalMl: mockSettings.dailyWaterGoalMl,
    entries,
  });
}

export const mockHydrationApi: HydrationApi = {
  async today() {
    await delay();
    return mockWaterDay(mockToday());
  },
  async log(entry) {
    await delay();
    if (entry.ml < 10 || entry.ml > 3000) {
      throw new ApiError(
        'validation',
        'Log between 10 and 3000 ml.',
        422,
        { ml: 'Log between 10 and 3000 ml.' },
        'VALIDATION_FAILED',
      );
    }
    const day = mockLocalDay(entry.at);
    if (!mockWater.has(entry.id)) {
      mockWater.set(entry.id, { ml: entry.ml, at: entry.at, day });
    }
    return mockWaterDay(mockWater.get(entry.id)!.day);
  },
  async remove(id) {
    await delay();
    const drink = mockWater.get(id);
    if (!drink) {
      throw notFound('That drink');
    }
    mockWater.delete(id);
    return mockWaterDay(drink.day);
  },
  async stats() {
    await delay();
    return hydrationStatsSchema.parse({
      bestStreakDays: hydrationHighlights.bestStreakDays,
      dailyAverageMl: hydrationHighlights.dailyAverageMl,
      goalHitRatePercent: hydrationHighlights.goalHitRatePercent,
      reminderCount: mockPlan.enabled
        ? mockPlan.reminders.filter(r => r.enabled).length
        : 0,
    });
  },
  async days(from, to) {
    await delay();
    const days = [];
    for (let day = from; day <= to; day = mockStreakDayShift(day, 1)) {
      const { consumedMl, goalMl } = mockWaterDay(day);
      days.push({ date: day, consumedMl, goalMl });
    }
    return days;
  },
  async reminders() {
    await delay();
    return hydrationReminderPlanSchema.parse(mockPlan);
  },
  async saveReminders(plan) {
    await delay();
    const seen = new Set<string>();
    mockPlan = hydrationReminderPlanSchema.parse({
      ...plan,
      reminders: plan.reminders.filter(r => {
        const key = `${r.time}|${r.slot}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
      repeatDays: [...new Set(plan.repeatDays)].sort((a, b) => a - b),
    });
    return mockPlan;
  },
};

// ─── Nutrition ─────────────────────────────────────────────────────────────

/** The server's defaults (⚙ `nutrition.default*`, RULES N4). */
const mockDefaultNutrition = (): NutritionProfile => ({
  goals: { calories: 2200, proteinG: 120, carbsG: 300, fatsG: 70 },
  preferences: {
    dietType: 'vegetarian',
    mealPlan: 'balanced',
    goal: 'gain_weight',
  },
});

let mockNutritionProfile = mockDefaultNutrition();
/** The diary, by id — today's plate from the seed to start with. */
let mockFood = new Map<string, FoodEntry>(
  seedFoodEntries.map(entry => [entry.id, entry]),
);

function mockFoodDay(date: string) {
  const entries = [...mockFood.values()]
    .filter(entry => mockLocalDay(entry.loggedAt) === date)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const sum = (key: 'calories' | 'proteinG' | 'carbsG' | 'fatsG' | 'fiberG') =>
    Math.round(entries.reduce((total, entry) => total + entry[key], 0) * 10) /
    10;
  return nutritionDaySchema.parse({
    date,
    entries,
    totals: {
      calories: sum('calories'),
      proteinG: sum('proteinG'),
      carbsG: sum('carbsG'),
      fatsG: sum('fatsG'),
      fiberG: sum('fiberG'),
    },
    goals: mockNutritionProfile.goals,
  });
}

function mockPlanFor(date: string) {
  const cycle = dietPlanRotation.length;
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return dietPlanRotation[((days % cycle) + cycle) % cycle];
}

export const mockNutritionApi: NutritionApi = {
  async profile() {
    await delay();
    return nutritionProfileSchema.parse(mockNutritionProfile);
  },
  async updateProfile(patch) {
    await delay();
    mockNutritionProfile = nutritionProfileSchema.parse({
      goals: { ...mockNutritionProfile.goals, ...patch.goals },
      preferences: {
        ...mockNutritionProfile.preferences,
        ...patch.preferences,
      },
    });
    return mockNutritionProfile;
  },
  async day(date) {
    await delay();
    return mockFoodDay(date);
  },
  async days(from, to) {
    await delay();
    const days = [];
    for (let day = from; day <= to; day = mockStreakDayShift(day, 1)) {
      const { entries, totals } = mockFoodDay(day);
      days.push({
        date: day,
        items: entries.length,
        calories: totals.calories,
        proteinG: totals.proteinG,
        carbsG: totals.carbsG,
        fatsG: totals.fatsG,
      });
    }
    return days;
  },
  async log(entries) {
    await delay();
    for (const entry of entries) {
      if (entry.name.trim().length === 0) {
        throw new ApiError(
          'validation',
          'Say what it was.',
          422,
          { name: 'Say what it was.' },
          'VALIDATION_FAILED',
        );
      }
      if (!mockFood.has(entry.id)) {
        mockFood.set(entry.id, { ...entry, name: entry.name.trim() });
      }
    }
    return mockFoodDay(mockLocalDay(entries[0].loggedAt));
  },
  async remove(id) {
    await delay();
    const entry = mockFood.get(id);
    if (!entry) {
      throw notFound('That food');
    }
    mockFood.delete(id);
    return mockFoodDay(mockLocalDay(entry.loggedAt));
  },
  async searchFoods(query) {
    await delay();
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return foodLibrary.filter(item =>
      words.every(word =>
        item.name
          .toLowerCase()
          .split(/[\s(]+/)
          .some(part => part.startsWith(word)),
      ),
    );
  },
  async quickAddFoods() {
    await delay();
    return quickAddFoodIds
      .map(id => foodLibrary.find(item => item.id === id))
      .filter((item): item is (typeof foodLibrary)[number] => !!item);
  },
  async plan(date) {
    await delay();
    const meals = mockPlanFor(date);
    return dietPlanDaySchema.parse({
      date,
      meals,
      totals: {
        calories: meals.reduce((sum, m) => sum + m.calories, 0),
        proteinG: meals.reduce((sum, m) => sum + m.proteinG, 0),
        carbsG: meals.reduce((sum, m) => sum + m.carbsG, 0),
        fatsG: meals.reduce((sum, m) => sum + m.fatsG, 0),
        fiberG: 0,
      },
      cycleLength: dietPlanRotation.length,
      basis: 'Vegetarian · Balanced',
    });
  },
  async planDays(from, to) {
    await delay();
    const days = [];
    for (let day = from; day <= to; day = mockStreakDayShift(day, 1)) {
      const meals = mockPlanFor(day);
      days.push({
        date: day,
        meals: meals.length,
        calories: meals.reduce((sum, m) => sum + m.calories, 0),
      });
    }
    return days;
  },
};

// ─── Vitals ────────────────────────────────────────────────────────────────

const MOCK_DISCLAIMER =
  'VOKVE is not a medical device. These figures are for general wellness, not medical advice.';

let mockVitals = new Map<string, VitalReading>(
  seedVitals
    .filter(reading => reading.kind !== 'bmi')
    .map(reading => [reading.id, reading]),
);

const mockVitalsNewestFirst = () =>
  [...mockVitals.values()].sort((a, b) =>
    b.recordedAt.localeCompare(a.recordedAt),
  );

export const mockVitalsApi: VitalsApi = {
  async list({ kind, limit = 20 }) {
    await delay();
    return mockVitalsNewestFirst()
      .filter(reading => kind === undefined || reading.kind === kind)
      .slice(0, limit);
  },
  async latest() {
    await delay();
    const newest = (kind: VitalReading['kind']) =>
      mockVitalsNewestFirst().find(reading => reading.kind === kind) ?? null;
    const weight = newest('weight');
    const heightCm = currentUser?.heightCm ?? 175;
    return vitalsLatestSchema.parse({
      heart_rate: newest('heart_rate'),
      blood_pressure: newest('blood_pressure'),
      weight,
      bmi: weight
        ? {
            id: 'bmi',
            kind: 'bmi',
            value: Math.round((weight.value / (heightCm / 100) ** 2) * 10) / 10,
            secondary: null,
            recordedAt: weight.recordedAt,
          }
        : null,
      disclaimer: MOCK_DISCLAIMER,
    });
  },
  async log(reading) {
    await delay();
    if (reading.kind === 'bmi') {
      throw new ApiError(
        'validation',
        'BMI is worked out from your weight and height.',
        422,
        { kind: 'BMI is worked out from your weight and height.' },
        'VALIDATION_FAILED',
      );
    }
    if (!mockVitals.has(reading.id)) {
      mockVitals.set(reading.id, vitalReadingSchema.parse(reading));
    }
    return mockVitals.get(reading.id)!;
  },
  async remove(id) {
    await delay();
    if (!mockVitals.delete(id)) {
      throw notFound('That reading');
    }
    return { ok: true };
  },
  async score() {
    await delay();
    return healthScoreSchema.parse({
      score: healthHighlights.score,
      outOf: healthHighlights.outOf,
      band: 'Good',
      factors: [
        {
          id: 'activity',
          label: 'Activity',
          weight: 30,
          points: 24,
          detail:
            'A 7-day average of 8,000 verified steps against your 10,000 goal.',
        },
        {
          id: 'hydration',
          label: 'Hydration',
          weight: 20,
          points: 17,
          detail: 'Your water goal was reached on 6 of the last 7 days.',
        },
        {
          id: 'vitals',
          label: 'Vitals',
          weight: 20,
          points: 20,
          detail: 'Heart rate normal, blood pressure normal.',
        },
        {
          id: 'bmi',
          label: 'BMI',
          weight: 15,
          points: 15,
          detail: 'BMI 22.9 — healthy.',
        },
        {
          id: 'consistency',
          label: 'Consistency',
          weight: 15,
          points: 6,
          detail: 'A current streak of 3 days, of the 7 that count in full.',
        },
      ],
      disclaimer: MOCK_DISCLAIMER,
    });
  },
};

// ─── Content ───────────────────────────────────────────────────────────────

const MOCK_TIPS: Record<ContentTopic, { title: string | null; text: string }> =
  {
    motivation: {
      title: null,
      text: 'Small steps every day lead to big results.',
    },
    hydration: { title: null, text: hydrationTip },
    reminders: {
      title: 'Small sips, big difference',
      text: 'A glass every couple of hours beats a litre in one go — your body can only take in so much at a time.',
    },
    nutrition: { title: null, text: nutritionTip },
    health: { title: null, text: healthTip },
    heart_rate: {
      title: 'Keep Your Heart Healthy',
      text: 'Regular exercise, good sleep and a balanced diet',
    },
    blood_pressure: {
      title: 'Keep Your BP In Check',
      text: 'Stay active, sleep well and monitor regularly',
    },
  };

export const mockContentApi: ContentApi = {
  async tip(topic) {
    await delay();
    return contentTipSchema.parse({
      id: `${topic}-1`,
      topic,
      ...MOCK_TIPS[topic],
    });
  },
};

/**
 * The days the mock has been sent, by date — what `today` and `weekly`
 * answer from, so the server's side of a synced day is the one that was
 * synced and an unsynced day is honestly empty.
 */
let mockActivityDays = new Map<string, DailyActivity>();
let mockNonces = new Map<string, number>();
/** Every snapshot taken, by hash, with the answer it got. */
let mockIngested = new Map<string, StepIngestResult>();
/** The latest snapshot of each day, and when it came — what `sources` explains. */
let mockSnapshots = new Map<
  string,
  { payload: MockSnapshotPayload; at: string }
>();
/** When a Play Integrity verdict last arrived; 0 before the first. */
let mockIntegrityAt = 0;

/** The server's idea of a fresh verdict: older than this and it asks again. */
const MOCK_INTEGRITY_FRESH_MS = 6 * 3_600_000;
/**
 * Stands in for the project the server decodes tokens with. Not a real one,
 * so a debug build's token request fails and reports why — the path a phone
 * without the Play Store takes.
 */
export const MOCK_CLOUD_PROJECT_NUMBER = 123_456_789_012;
/** How far back a day can still be sent, as the server bounds it. */
const MOCK_INGEST_MAX_AGE_DAYS = 7;
/** Steps in a minute that make it an active one. */
const MOCK_ACTIVE_MINUTE_STEPS = 60;

/** Local `YYYY-MM-DD`, `days` before today. */
function mockDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

const emptyDay = (date: string): DailyActivity =>
  dailyActivitySchema.parse({ date });

/** The parts of a signed snapshot the mock reads. */
interface MockSnapshotPayload {
  date?: unknown;
  nonce?: unknown;
  deviceSteps?: unknown;
  recoveredSteps?: unknown;
  suspectSteps?: unknown;
  resolved?: { steps?: unknown; usedExternal?: unknown };
  minutes?: { steps?: unknown }[];
  sources?: {
    packageName?: unknown;
    appName?: unknown;
    kind?: unknown;
    steps?: unknown;
    manualSteps?: unknown;
    isWearable?: unknown;
    isPlatform?: unknown;
    isSelf?: unknown;
  }[];
}

/** The tracker set-up the mock hands out — the real server's defaults. */
const MOCK_ACTIVITY_CONFIG = {
  tracker: {
    healthConnectReadTypes: ['steps', 'distance'],
    healthConnectWriteEnabled: false,
    healthConnectIgnoreManualEntries: true,
    wearableTrust: 'catalog',
    wearableAllowlist: ['com.google.android.apps.fitness'],
    gapRecovery: 'split',
    historyRetentionDays: 400,
    motionWindowRetention: 864,
    fraudDetection: { enabled: true, mode: 'flag' },
    motionSampling: { enabled: true, windowSeconds: 10, intervalMinutes: 5 },
    privacyPolicyUrl: 'https://vokve.app/privacy',
  },
  sync: {
    intervalMinutes: 5,
    minGapSeconds: 120,
    maxAgeDays: 7,
    include: ['minutes', 'motionWindows', 'healthConnectRecords'],
    healthConnectRecordTypes: ['steps', 'distance'],
  },
};

/** `YYYY-MM-DD` arithmetic on local calendar days. */
function mockAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

/** The days of a range grouped as the server groups them. */
function mockBuckets(
  from: string,
  to: string,
  granularity: 'day' | 'week' | 'month',
): { start: string; end: string; days: string[] }[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = mockAddDays(day, 1)) days.push(day);
  if (granularity === 'day') {
    return days.map(day => ({ start: day, end: day, days: [day] }));
  }
  const out: { start: string; end: string; days: string[] }[] = [];
  days.forEach((day, index) => {
    const last = out[out.length - 1];
    const startsNew =
      granularity === 'week'
        ? index % 7 === 0
        : !last || last.start.slice(0, 7) !== day.slice(0, 7);
    if (startsNew || !last) {
      out.push({ start: day, end: day, days: [day] });
    } else {
      last.days.push(day);
      last.end = day;
    }
  });
  return out;
}

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * The day a snapshot describes, judged the simple way: the phone's own count
 * less what it recovered in one go or flagged is what verifies. The real
 * server weighs a trusted watch, the motion windows and the device's
 * history as well; this is enough for every screen to have a number.
 */
function mockDayFrom(
  date: string,
  payload: MockSnapshotPayload,
): DailyActivity {
  const steps = Math.max(0, Math.round(num(payload.resolved?.steps)));
  const clean =
    num(payload.deviceSteps) -
    num(payload.recoveredSteps) -
    num(payload.suspectSteps);
  const verifiedSteps = Math.max(0, Math.min(steps, Math.round(clean)));
  const activeMinutes = (payload.minutes ?? []).filter(
    minute => num(minute.steps) >= MOCK_ACTIVE_MINUTE_STEPS,
  ).length;
  return dailyActivitySchema.parse({
    date,
    steps,
    verifiedSteps,
    distanceKm: Math.round(steps * 0.00075 * 100) / 100,
    activeMinutes,
    caloriesBurned: Math.round(steps * 0.04),
    source:
      payload.resolved?.usedExternal === true ? 'health_connect' : 'device',
    verified: verifiedSteps > 0,
  });
}

export const mockActivityApi: ActivityApi = {
  async today(): Promise<DailyActivity> {
    await delay();
    const date = mockDateDaysAgo(0);
    return mockActivityDays.get(date) ?? emptyDay(date);
  },

  async weekly(): Promise<DailyActivity[]> {
    await delay();
    return Array.from({ length: 7 }, (_, index) => {
      const date = mockDateDaysAgo(6 - index);
      return mockActivityDays.get(date) ?? emptyDay(date);
    });
  },

  async day(date) {
    await delay();
    return mockActivityDays.get(date) ?? emptyDay(date);
  },

  async config() {
    await delay();
    return activityConfigSchema.parse({
      ...MOCK_ACTIVITY_CONFIG,
      playIntegrity: { cloudProjectNumber: MOCK_CLOUD_PROJECT_NUMBER },
    });
  },

  /**
   * The server's suggestion, abridged: where the user walks now (the days
   * synced, or their activity level), one stretch on, up to the target for
   * their age and BMI.
   */
  async goal() {
    await delay();
    const user = currentUser;
    const recent = Array.from(
      { length: MOCK_GOAL.historyDays },
      (_, index) =>
        mockActivityDays.get(mockDateDaysAgo(index + 1))?.steps ?? 0,
    ).filter(steps => steps > 0);
    const recentSteps = recent.length >= MOCK_GOAL.minDaysWithSteps;
    const age = user?.dateOfBirth
      ? new Date().getFullYear() - Number(user.dateOfBirth.slice(0, 4))
      : null;
    const bmi =
      user?.heightCm && user.weightKg
        ? user.weightKg / (user.heightCm / 100) ** 2
        : null;
    const now = recentSteps
      ? recent.reduce((sum, steps) => sum + steps, 0) / recent.length
      : MOCK_GOAL.typicalByLevel[user?.activityLevel ?? 'moderate'];
    const target =
      (age === null || (age >= 18 && age < 60)
        ? 10_000
        : age < 18
        ? 12_000
        : age < 70
        ? 8000
        : 7000) + (bmi !== null && bmi >= 25 ? 1000 : 0);
    const suggested =
      now >= target ? now : Math.min(target, now + MOCK_GOAL.stretch);
    const recommended = Math.min(
      MOCK_GOAL.max,
      Math.max(
        MOCK_GOAL.min,
        Math.round(suggested / MOCK_GOAL.increment) * MOCK_GOAL.increment,
      ),
    );
    return stepGoalSchema.parse({
      goal: mockSettings.dailyStepGoal,
      recommended,
      basedOn: { age: age !== null, bmi: bmi !== null, recentSteps },
      min: MOCK_GOAL.min,
      max: MOCK_GOAL.max,
      increment: MOCK_GOAL.increment,
      chosenAt: mockGoalChosenAt,
    });
  },

  /** The real range's arithmetic, over the days the mock has been sent. */
  async range({ from, to, granularity }) {
    await delay();
    if (from > to || (granularity === 'hour' && from !== to)) {
      throw new ApiError('validation', 'Check the highlighted fields.', 422);
    }
    const dayOf = (date: string) =>
      mockActivityDays.get(date) ?? emptyDay(date);
    const pad = (n: number) => String(n).padStart(2, '0');
    let points;
    if (granularity === 'hour') {
      // The mock keeps no hours; a synced day's steps are put at noon.
      const day = dayOf(from);
      points = Array.from({ length: 24 }, (_, hour) => ({
        start: `${from}T${pad(hour)}:00`,
        end: `${from}T${pad(hour)}:59`,
        steps: hour === 12 ? day.steps : 0,
        verifiedSteps: hour === 12 ? day.verifiedSteps : 0,
      }));
    } else {
      points = mockBuckets(from, to, granularity).map(bucket => ({
        start: bucket.start,
        end: bucket.end,
        steps: bucket.days.reduce((sum, date) => sum + dayOf(date).steps, 0),
        verifiedSteps: bucket.days.reduce(
          (sum, date) => sum + dayOf(date).verifiedSteps,
          0,
        ),
      }));
    }
    const days = [...mockActivityDays.values()].filter(
      day => day.date >= from && day.date <= to,
    );
    const best = days.reduce<{ date: string; steps: number } | null>(
      (top, day) =>
        day.steps > (top?.steps ?? 0)
          ? { date: day.date, steps: day.steps }
          : top,
      null,
    );
    return activityRangeSchema.parse({
      from,
      to,
      granularity,
      points,
      totals: {
        steps: days.reduce((sum, day) => sum + day.steps, 0),
        verifiedSteps: days.reduce((sum, day) => sum + day.verifiedSteps, 0),
        distanceKm: days.reduce((sum, day) => sum + day.distanceKm, 0),
        caloriesBurned: days.reduce((sum, day) => sum + day.caloriesBurned, 0),
        activeMinutes: days.reduce((sum, day) => sum + day.activeMinutes, 0),
        activeDays: days.filter(day => day.steps > 0).length,
      },
      best,
    });
  },

  /**
   * The day's latest snapshot, explained the simple way the mock judges it:
   * the phone's own count less what it recovered or flagged. Every Health
   * Connect source is listed and none of them is used — the real server's
   * matching is what the sources page exists to show.
   */
  async sources(date) {
    await delay();
    const day = mockActivityDays.get(date) ?? emptyDay(date);
    const latest = mockSnapshots.get(date);
    if (!latest) {
      return stepSourcesReportSchema.parse({
        date,
        scoredAt: null,
        day,
        explanation: ['Nothing has been synced for this day yet.'],
        devices: [],
        records: [],
        uploads: [],
        checks: null,
      });
    }
    const { payload, at } = latest;
    const counted = Math.round(num(payload.deviceSteps));
    const recovered = Math.round(num(payload.recoveredSteps));
    const flagged = Math.round(num(payload.suspectSteps));
    const clean = Math.max(0, counted - recovered - flagged);
    const sources = (payload.sources ?? [])
      .filter(source => source.isSelf !== true)
      .map(source => {
        const steps = Math.max(0, Math.round(num(source.steps)));
        const manualSteps = Math.max(0, Math.round(num(source.manualSteps)));
        const countable = Math.max(0, steps - manualSteps);
        return {
          packageName: String(source.packageName ?? 'unknown'),
          appName: String(source.appName ?? source.packageName ?? 'Unknown'),
          kind: String(source.kind ?? 'app'),
          isWearable: source.isWearable === true,
          isPlatform: source.isPlatform === true,
          steps,
          manualSteps,
          countable,
          ratioToPhone:
            counted > 0 ? Math.round((countable / counted) * 100) / 100 : null,
          status: 'lower' as const,
          note: 'Listed by the mock backend, which counts the phone alone.',
        };
      });
    return stepSourcesReportSchema.parse({
      date,
      scoredAt: at,
      day,
      explanation: [
        `This phone counted ${counted.toLocaleString('en-IN')} steps.`,
        `${clean.toLocaleString(
          'en-IN',
        )} of them count, once steps added in one go or flagged are left out.`,
      ],
      devices: [
        {
          deviceId: 'dev_mock',
          name: 'This phone',
          isCurrent: true,
          answeredForDay: true,
          syncedAt: at,
          phone: { counted, recovered, flagged, clean },
          counted: clean,
          source: 'device',
          verified: day.verified,
          sourcesNote: null,
          sources,
          proof: { keyAttested: true, bootVerified: true, playIntegrity: null },
        },
      ],
      records: [],
      uploads: [
        {
          at,
          deviceName: 'This phone',
          phoneSteps: counted,
          shownSteps: Math.round(num(payload.resolved?.steps)),
          playIntegrity: null,
        },
      ],
      checks: null,
    });
  },

  async ingestNonce() {
    await delay();
    const nonce = nextId('nonce');
    const expiresAt = Date.now() + MOCK_CHALLENGE_TTL_MS;
    mockNonces.set(nonce, expiresAt);
    return { nonce, expiresAt: new Date(expiresAt).toISOString() };
  },

  /**
   * The real ingest's checks, in its order: a snapshot seen before is
   * answered as it was the first time; then the key, the nonce and the
   * integrity verdict, every one of them before the nonce is spent — so a
   * refusal can be answered with the same snapshot.
   */
  async ingest(payload) {
    await delay();
    if (!currentUser) {
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    }

    const seen = mockIngested.get(payload.snapshot.payloadSha256);
    if (seen) {
      return { ...seen, duplicate: true };
    }

    let signed: MockSnapshotPayload;
    try {
      signed = JSON.parse(
        payload.snapshot.signedPayload,
      ) as MockSnapshotPayload;
    } catch {
      throw new ApiError(
        'validation',
        'That step snapshot could not be read.',
        422,
        null,
        'SNAPSHOT_INVALID',
      );
    }

    if (!mockAttestedKeys.has(payload.snapshot.keyId)) {
      throw new ApiError(
        'forbidden',
        'This phone needs to confirm it is genuine before steps can sync.',
        403,
        null,
        'ATTESTATION_REQUIRED',
      );
    }

    const nonce = typeof signed.nonce === 'string' ? signed.nonce : '';
    const nonceExpiresAt = mockNonces.get(nonce);
    if (nonceExpiresAt === undefined || nonceExpiresAt < Date.now()) {
      throw new ApiError(
        'unknown',
        'That sync ran out of time. Trying again.',
        409,
        null,
        'NONCE_INVALID',
      );
    }

    if (
      !payload.integrity &&
      Date.now() - mockIntegrityAt > MOCK_INTEGRITY_FRESH_MS
    ) {
      throw new ApiError(
        'forbidden',
        'This phone needs a fresh integrity check.',
        403,
        { cloudProjectNumber: MOCK_CLOUD_PROJECT_NUMBER },
        'INTEGRITY_REQUIRED',
      );
    }
    if (payload.integrity) {
      mockIntegrityAt = Date.now();
    }

    mockNonces.delete(nonce);

    const oldest = mockDateDaysAgo(MOCK_INGEST_MAX_AGE_DAYS);
    const today = mockDateDaysAgo(0);
    if (
      signed.date !== payload.date ||
      payload.date < oldest ||
      payload.date > today
    ) {
      throw new ApiError(
        'validation',
        'That day can no longer be synced.',
        422,
        null,
        'SNAPSHOT_DATE_OUT_OF_RANGE',
      );
    }

    const day = mockDayFrom(payload.date, signed);
    mockActivityDays.set(payload.date, day);
    mockSnapshots.set(payload.date, {
      payload: signed,
      at: new Date().toISOString(),
    });
    const result = stepIngestResultSchema.parse({ day });
    mockIngested.set(payload.snapshot.payloadSha256, result);
    return result;
  },
};

/**
 * The same chip-per-topic map the notifications store keeps; repeated here
 * rather than imported so the mock does not pull a store into the API layer.
 */
const MOCK_FEED_CATEGORY: Record<
  AppNotification['topic'],
  'activity' | 'reward' | 'system'
> = {
  steps: 'activity',
  workout: 'activity',
  streak: 'activity',
  hydration: 'activity',
  coins: 'reward',
  challenge: 'reward',
  reward: 'reward',
  health: 'system',
  system: 'system',
};

/** Read state lives here across calls, so a row read stays read until sign-out. */
let mockFeed: AppNotification[] = seedNotifications.map(entry => ({
  ...entry,
}));

export const mockNotificationApi: NotificationApi = {
  async list(query = {}) {
    await delay();
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const rows = query.category
      ? mockFeed.filter(n => MOCK_FEED_CATEGORY[n.topic] === query.category)
      : mockFeed;
    const after = query.cursor
      ? rows.findIndex(n => n.id === query.cursor)
      : -1;
    const data = rows.slice(after + 1, after + 1 + limit).map(n => ({ ...n }));
    const last = data[data.length - 1];
    const hasMore =
      last !== undefined &&
      rows.findIndex(n => n.id === last.id) < rows.length - 1;
    return { data, nextCursor: hasMore ? last.id : null };
  },
  async counts() {
    await delay();
    const counts = {
      all: mockFeed.length,
      activity: 0,
      reward: 0,
      system: 0,
      unread: 0,
    };
    for (const n of mockFeed) {
      counts[MOCK_FEED_CATEGORY[n.topic]] += 1;
      if (!n.read) counts.unread += 1;
    }
    return counts;
  },
  async markRead(id) {
    await delay();
    mockFeed = mockFeed.map(n => (n.id === id ? { ...n, read: true } : n));
    return { ok: true };
  },
  async markAllRead() {
    await delay();
    mockFeed = mockFeed.map(n => (n.read ? n : { ...n, read: true }));
    return { ok: true };
  },
};

/** The server's defaults: everything on but health, quiet 22:00–07:00, SMS on, email off. */
let mockPreferences: NotificationPreferences = {
  categories: {
    activity: true,
    coins: true,
    challenges: true,
    orders: true,
    offers: true,
    announcements: true,
    referrals: true,
    health: false,
  },
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
  sms: true,
  email: false,
};

export const mockNotificationPreferencesApi: NotificationPreferencesApi = {
  async get() {
    await delay();
    return mockPreferences;
  },
  async update(patch) {
    await delay();
    mockPreferences = {
      categories: { ...mockPreferences.categories, ...patch.categories },
      quietHours: { ...mockPreferences.quietHours, ...patch.quietHours },
      sms: patch.sms ?? mockPreferences.sms,
      email: patch.email ?? mockPreferences.email,
    };
    return mockPreferences;
  },
};

// ─── Commerce ──────────────────────────────────────────────────────────────

/** The till's rules the mock charges by — the server's defaults, so the sums agree with the backend tests. */
export const MOCK_SHOP_CONFIG: ShopConfig = {
  currency: 'INR',
  coinValuePaise: 25,
  coinShareMax: 0.3,
  shippingFeePaise: 4900,
  freeShippingAbovePaise: 99900,
  maxQuantityPerLine: 5,
  paymentProvider: 'mock',
  paymentKeyId: null,
  stepUpThreshold: 1000,
};

/** The coins at and above which the mock, like the server, asks for a step-up. */
export const MOCK_STEP_UP_THRESHOLD = MOCK_SHOP_CONFIG.stepUpThreshold;
/** How long the mock holds an unpaid order. */
const MOCK_PAYMENT_WINDOW_MS = 30 * 60_000;

let mockStock = new Map(
  shopItems.map(item => [item.id, item.inStock ? 25 : 0]),
);
let mockOrders: Order[] = [];
let mockAddresses: Address[] = [];
let mockCart: {
  itemId: string;
  quantity: number;
  size: string | null;
  addedAt: string;
}[] = [];
let mockWishlist: { itemId: string; addedAt: string }[] = [];
let mockReviews: (Review & { userId: string })[] = [];
/**
 * The mock's own wallet balance for purchases, seeded from the ledger the
 * first time it is needed. Null until then so a sign-out resets it with the
 * rest, and so the figure the wallet shows and the one the shop spends
 * against start out equal.
 */
let mockBalance: number | null = null;
/** Step-up tokens handed out and not yet spent. */
const mockStepUps = new Set<string>();

function currentBalance(): number {
  if (mockBalance === null) {
    mockBalance = seedCoinTransactions.reduce((sum, t) => sum + t.amount, 0);
  }
  return mockBalance;
}

/** A review as the app sees it: the row without the account that wrote it. */
function stripUser(review: Review & { userId: string }): Review {
  const visible: Review & { userId?: string } = { ...review };
  delete visible.userId;
  return visible;
}

/** The star average and count the item carries, from the mock's reviews. */
function ratingOf(itemId: string): ShopItem['rating'] {
  const mine = mockReviews.filter(r => r.itemId === itemId);
  if (mine.length === 0) return { average: 0, count: 0 };
  const sum = mine.reduce((total, r) => total + r.rating, 0);
  return {
    average: Math.round((sum / mine.length) * 10) / 10,
    count: mine.length,
  };
}

function withStock(item: (typeof shopItems)[number]): ShopItem {
  return {
    ...item,
    inStock: (mockStock.get(item.id) ?? 0) > 0,
    coinsMax: Math.floor(
      (item.price * MOCK_SHOP_CONFIG.coinShareMax) /
        MOCK_SHOP_CONFIG.coinValuePaise,
    ),
    rating: ratingOf(item.id),
  };
}

const snapshotOf = (address: Address): Order['address'] => ({
  label: address.label,
  name: address.name,
  phone: address.phone,
  line1: address.line1,
  line2: address.line2,
  city: address.city,
  state: address.state,
  postalCode: address.postalCode,
  country: address.country,
});

const notFound = (what: string) =>
  new ApiError('not_found', `${what} could not be found.`, 404);

/**
 * The server's search, sort and paging, on the seed. The seed is already in
 * "popular" order; price and newest sorts reorder it, and a cursor is where
 * the last page ended — the same opaque `offset:` the server hands out.
 */
export const mockShopApi: ShopApi = {
  async items(query = {}) {
    await delay();
    const words = (query.q ?? '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const matches = (item: (typeof shopItems)[number]) =>
      words.every(word =>
        [item.title, item.description, item.subcategory ?? '', ...item.tags]
          .join(' ')
          .toLowerCase()
          .includes(word),
      );
    let rows = shopItems
      .filter(item => !query.category || item.category === query.category)
      .filter(
        item => !query.subcategory || item.subcategory === query.subcategory,
      )
      .filter(item => !query.deals || item.isDeal)
      .filter(item => !query.featured || item.featured)
      .filter(
        item => query.minPrice === undefined || item.price >= query.minPrice,
      )
      .filter(
        item => query.maxPrice === undefined || item.price <= query.maxPrice,
      )
      .filter(matches)
      .map(withStock)
      .filter(
        item =>
          query.minRating === undefined ||
          item.rating.average >= query.minRating,
      )
      .filter(item => !query.inStock || item.inStock);
    if (query.sort === 'price_asc')
      rows = [...rows].sort((a, b) => a.price - b.price);
    if (query.sort === 'price_desc')
      rows = [...rows].sort((a, b) => b.price - a.price);
    if (query.sort === 'newest') rows = [...rows].reverse();
    if (query.sort === 'rating')
      rows = [...rows].sort(
        (a, b) =>
          b.rating.average - a.rating.average ||
          b.rating.count - a.rating.count,
      );
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const offset = query.cursor
      ? Number(query.cursor.replace(/^offset:/, '')) || 0
      : 0;
    const data = rows.slice(offset, offset + limit);
    const end = offset + data.length;
    return {
      data,
      nextCursor: end < rows.length ? `offset:${end}` : null,
      total: rows.length,
    };
  },
  async categories() {
    await delay();
    return (['clothing', 'gym', 'sports', 'accessories'] as const).map(
      category => {
        const mine = shopItems.filter(item => item.category === category);
        const subcategories: { name: string; count: number }[] = [];
        for (const item of mine) {
          if (!item.subcategory) continue;
          const found = subcategories.find(sc => sc.name === item.subcategory);
          if (found) found.count += 1;
          else subcategories.push({ name: item.subcategory, count: 1 });
        }
        return {
          category,
          count: mine.length,
          inStock: mine.filter(item => (mockStock.get(item.id) ?? 0) > 0)
            .length,
          subcategories,
        };
      },
    );
  },
  async config() {
    await delay();
    return MOCK_SHOP_CONFIG;
  },
  async item(id) {
    await delay();
    const item = shopItems.find(entry => entry.id === id);
    if (!item) throw notFound('That item');
    return withStock(item);
  },
  async reviews(itemId, query = {}) {
    await delay();
    if (!shopItems.some(entry => entry.id === itemId))
      throw notFound('That item');
    const readerId = currentUser?.id ?? null;
    const all = mockReviews
      .filter(r => r.itemId === itemId)
      .sort((a, b) =>
        query.sort === 'top'
          ? b.rating - a.rating || b.createdAt.localeCompare(a.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
      )
      .map(({ userId, ...r }) => ({ ...r, mine: userId === readerId }));
    const histogram = [0, 0, 0, 0, 0];
    for (const r of all) histogram[r.rating - 1] += 1;
    const limit = query.limit ?? 10;
    const offset = query.cursor
      ? Number(query.cursor.replace(/^offset:/, '')) || 0
      : 0;
    const data = all.slice(offset, offset + limit);
    return {
      data,
      nextCursor:
        offset + data.length < all.length
          ? `offset:${offset + data.length}`
          : null,
      summary: { ...ratingOf(itemId), histogram },
      mine: all.find(r => r.mine) ?? null,
    };
  },
  async writeReview(itemId, input) {
    await delay();
    if (!currentUser)
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    if (!shopItems.some(entry => entry.id === itemId))
      throw notFound('That item');
    if (input.body.trim().length < 10) {
      throw new ApiError(
        'validation',
        'Say a little more — at least ten characters.',
        422,
        { body: 'Say a little more — at least ten characters.' },
      );
    }
    const now = new Date().toISOString();
    const existing = mockReviews.find(
      r => r.itemId === itemId && r.userId === currentUser!.id,
    );
    const bought = mockOrders.some(
      o =>
        o.status !== 'cancelled' &&
        o.status !== 'pending_payment' &&
        o.items.some(l => l.itemId === itemId),
    );
    const review: Review & { userId: string } = {
      id: existing?.id ?? nextId('rev'),
      itemId,
      userId: currentUser.id,
      rating: input.rating,
      title: input.title?.trim() || null,
      body: input.body.trim(),
      authorName: currentUser.name?.trim().split(/\s+/)[0] || 'A VOKVE member',
      verified: bought,
      mine: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    mockReviews = [review, ...mockReviews.filter(r => r.id !== review.id)];
    return stripUser(review);
  },
  async deleteReview(itemId) {
    await delay();
    const before = mockReviews.length;
    mockReviews = mockReviews.filter(
      r => !(r.itemId === itemId && r.userId === currentUser?.id),
    );
    if (mockReviews.length === before) throw notFound('Your review');
    return { ok: true };
  },
};

export const mockWishlistApi: WishlistApi = {
  async list() {
    await delay();
    return mockWishlist
      .map(entry => shopItems.find(item => item.id === entry.itemId))
      .filter((item): item is (typeof shopItems)[number] => item !== undefined)
      .map(withStock);
  },
  async ids() {
    await delay();
    return mockWishlist.map(entry => entry.itemId);
  },
  async add(itemId) {
    await delay();
    if (!shopItems.some(entry => entry.id === itemId))
      throw notFound('That item');
    if (!mockWishlist.some(entry => entry.itemId === itemId)) {
      mockWishlist = [
        { itemId, addedAt: new Date().toISOString() },
        ...mockWishlist,
      ];
    }
    return { ok: true };
  },
  async remove(itemId) {
    await delay();
    mockWishlist = mockWishlist.filter(entry => entry.itemId !== itemId);
    return { ok: true };
  },
};

/** The server's line checks: the item, its size, the per-line cap. */
function priceLine(line: PurchaseLine): {
  item: ShopItem;
  quantity: number;
  size: string | null;
} {
  const raw = shopItems.find(entry => entry.id === line.itemId);
  if (!raw)
    throw new ApiError(
      'not_found',
      'One of the items is no longer available.',
      404,
      { itemId: line.itemId },
      'ITEM_UNAVAILABLE',
    );
  const item = withStock(raw);
  let size: string | null = null;
  if (item.sizes.length > 0) {
    if (!line.size)
      throw new ApiError(
        'validation',
        `Pick a size for ${item.title}.`,
        422,
        { itemId: item.id, sizes: item.sizes },
        'SIZE_REQUIRED',
      );
    if (!item.sizes.includes(line.size))
      throw new ApiError(
        'validation',
        `${item.title} does not come in ${line.size}.`,
        422,
        { itemId: item.id, sizes: item.sizes },
        'SIZE_INVALID',
      );
    size = line.size;
  }
  if (line.quantity > MOCK_SHOP_CONFIG.maxQuantityPerLine) {
    throw new ApiError(
      'validation',
      `You can order up to ${MOCK_SHOP_CONFIG.maxQuantityPerLine} of ${item.title} at a time.`,
      422,
      { itemId: item.id, max: MOCK_SHOP_CONFIG.maxQuantityPerLine },
      'QUANTITY_LIMIT',
    );
  }
  return { item, quantity: line.quantity, size };
}

/** The server's quote arithmetic (RULES R11–R13), on the mock's balance. */
function quoteFor(lines: PurchaseLine[], coins: number | 'max'): Quote {
  const priced = lines.map(priceLine);
  const cfg = MOCK_SHOP_CONFIG;
  const subtotal = priced.reduce(
    (sum, l) => sum + l.item.price * l.quantity,
    0,
  );
  const mrpTotal = priced.reduce(
    (sum, l) => sum + (l.item.mrp ?? l.item.price) * l.quantity,
    0,
  );
  const shipping =
    priced.length === 0 ||
    (cfg.freeShippingAbovePaise !== null &&
      subtotal >= cfg.freeShippingAbovePaise)
      ? 0
      : cfg.shippingFeePaise;
  const total = subtotal + shipping;
  const coinsMax = Math.max(
    0,
    Math.min(
      Math.floor((subtotal * cfg.coinShareMax) / cfg.coinValuePaise),
      Math.floor(currentBalance()),
    ),
  );
  const coinsApplied =
    coins === 'max'
      ? coinsMax
      : Math.max(0, Math.min(Math.floor(coins), coinsMax));
  const coinsValue = coinsApplied * cfg.coinValuePaise;
  return {
    currency: cfg.currency,
    lines: priced.map(l => ({
      itemId: l.item.id,
      title: l.item.title,
      emoji: l.item.emoji,
      quantity: l.quantity,
      size: l.size,
      price: l.item.price,
      mrp: l.item.mrp,
      lineTotal: l.item.price * l.quantity,
      inStock: (mockStock.get(l.item.id) ?? 0) >= l.quantity,
    })),
    mrpTotal,
    discount: mrpTotal - subtotal,
    subtotal,
    shipping,
    total,
    coinValuePaise: cfg.coinValuePaise,
    coinsMax,
    coinsApplied,
    coinsValue,
    payable: total - coinsValue,
    needsStepUp: coinsApplied > 0 && coinsApplied >= cfg.stepUpThreshold,
  };
}

function cartView(): Cart {
  mockCart = mockCart.filter(line =>
    shopItems.some(item => item.id === line.itemId),
  );
  return {
    lines: mockCart.map(line => ({
      item: withStock(shopItems.find(item => item.id === line.itemId)!),
      quantity: line.quantity,
      size: line.size,
      addedAt: line.addedAt,
    })),
    count: mockCart.reduce((sum, line) => sum + line.quantity, 0),
    quote: quoteFor(
      mockCart.map(l => ({
        itemId: l.itemId,
        quantity: l.quantity,
        size: l.size,
      })),
      'max',
    ),
  };
}

export const mockCartApi: CartApi = {
  async get() {
    await delay();
    return cartView();
  },
  async setLine(line) {
    await delay();
    const size = line.size ?? null;
    if (line.quantity > 0) {
      const priced = priceLine({
        itemId: line.itemId,
        quantity: line.quantity,
        size,
      });
      const index = mockCart.findIndex(
        l => l.itemId === priced.item.id && l.size === priced.size,
      );
      if (index >= 0)
        mockCart[index] = { ...mockCart[index], quantity: priced.quantity };
      else
        mockCart = [
          ...mockCart,
          {
            itemId: priced.item.id,
            quantity: priced.quantity,
            size: priced.size,
            addedAt: new Date().toISOString(),
          },
        ];
    } else {
      mockCart = mockCart.filter(
        l => !(l.itemId === line.itemId && l.size === size),
      );
    }
    return cartView();
  },
  async removeLine(itemId, size) {
    return mockCartApi.setLine({ itemId, quantity: 0, size: size ?? null });
  },
  async clear() {
    await delay();
    mockCart = [];
    return cartView();
  },
};

export const mockCheckoutApi: CheckoutApi = {
  async quote(lines, coins) {
    await delay();
    return quoteFor(lines, coins);
  },
  async place(payload) {
    await delay();
    if (!currentUser)
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    const address = mockAddresses.find(entry => entry.id === payload.addressId);
    if (!address) {
      throw new ApiError(
        'validation',
        'Add a delivery address to place an order.',
        422,
        { addressId: payload.addressId },
        'ADDRESS_REQUIRED',
      );
    }
    const lines = payload.fromCart
      ? mockCart.map(l => ({
          itemId: l.itemId,
          quantity: l.quantity,
          size: l.size,
        }))
      : payload.lines ?? [];
    if (lines.length === 0)
      throw new ApiError(
        'validation',
        'There is nothing to order yet.',
        422,
        null,
        'CART_EMPTY',
      );
    const q = quoteFor(lines, payload.coins);
    if (payload.coins > q.coinsMax) {
      throw new ApiError(
        'validation',
        `Up to ${q.coinsMax} coins can go towards this order.`,
        422,
        { coinsMax: q.coinsMax, requested: payload.coins },
        'COINS_OVER_LIMIT',
      );
    }
    const soldOut = q.lines.find(l => !l.inStock);
    if (soldOut)
      throw new ApiError(
        'unknown',
        `${soldOut.title} is sold out.`,
        409,
        { itemId: soldOut.itemId },
        'OUT_OF_STOCK',
      );
    if (q.needsStepUp) {
      if (!payload.stepUpToken) {
        throw new ApiError(
          'forbidden',
          'Confirm it is you to use this many coins.',
          403,
          null,
          'STEP_UP_REQUIRED',
        );
      }
      if (!mockStepUps.delete(payload.stepUpToken)) {
        throw new ApiError(
          'forbidden',
          'That confirmation has expired. Please confirm again.',
          403,
          null,
          'STEP_UP_INVALID',
        );
      }
    }

    for (const line of q.lines)
      mockStock.set(
        line.itemId,
        (mockStock.get(line.itemId) ?? 0) - line.quantity,
      );
    mockBalance = currentBalance() - q.coinsApplied;
    if (payload.fromCart) mockCart = [];
    const now = new Date();
    const pending = q.payable > 0;
    const orderId = nextId('ord');
    const order: Order = {
      id: orderId,
      status: pending ? 'pending_payment' : 'placed',
      items: q.lines.map(l => ({
        itemId: l.itemId,
        title: l.title,
        emoji: l.emoji,
        quantity: l.quantity,
        size: l.size,
        price: l.price,
        mrp: l.mrp,
      })),
      currency: q.currency,
      subtotal: q.subtotal,
      discount: q.discount,
      shipping: q.shipping,
      total: q.total,
      coinsUsed: q.coinsApplied,
      coinsValue: q.coinsValue,
      payable: q.payable,
      payment: {
        provider: pending ? 'mock' : null,
        status: pending ? 'pending' : 'not_required',
        amount: q.payable,
        currency: q.currency,
        providerOrderId: pending ? `mockord_${orderId}` : null,
        paidAt: null,
        expiresAt: pending
          ? new Date(now.getTime() + MOCK_PAYMENT_WINDOW_MS).toISOString()
          : null,
      },
      address: snapshotOf(address),
      placedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      trackingRef: null,
      cancellable: true,
    };
    mockOrders = [order, ...mockOrders];
    const result: CheckoutResult = {
      order,
      balance: mockBalance,
      payment: pending
        ? {
            provider: 'mock',
            orderId,
            providerOrderId: `mockord_${orderId}`,
            amount: q.payable,
            currency: q.currency,
            keyId: null,
            expiresAt: order.payment.expiresAt!,
          }
        : null,
    };
    return result;
  },
  async pay(orderId, proof) {
    await delay();
    const order = mockOrders.find(entry => entry.id === orderId);
    if (!order) throw notFound('That order');
    if (order.payment.status === 'paid')
      return { order, balance: currentBalance() };
    if (order.status !== 'pending_payment') {
      throw new ApiError(
        'unknown',
        `This order is ${order.status.replace(
          '_',
          ' ',
        )} and has no payment to take.`,
        409,
        { status: order.status },
        'ORDER_NOT_PENDING',
      );
    }
    if (!proof.providerPaymentId)
      throw new ApiError(
        'validation',
        'That payment could not be verified.',
        422,
        null,
        'PAYMENT_INVALID',
      );
    const now = new Date().toISOString();
    const paid: Order = {
      ...order,
      status: 'placed',
      updatedAt: now,
      payment: { ...order.payment, status: 'paid', paidAt: now },
    };
    mockOrders = mockOrders.map(entry => (entry.id === orderId ? paid : entry));
    return { order: paid, balance: currentBalance() };
  },
};

export const mockOrderApi: OrderApi = {
  async list(cursor) {
    await delay();
    const after = cursor ? mockOrders.findIndex(o => o.id === cursor) : -1;
    const data = mockOrders.slice(after + 1, after + 1 + 20);
    const last = data[data.length - 1];
    const hasMore =
      last !== undefined && mockOrders.indexOf(last) < mockOrders.length - 1;
    return { data, nextCursor: hasMore ? last.id : null };
  },
  async get(id) {
    await delay();
    const order = mockOrders.find(entry => entry.id === id);
    if (!order) throw notFound('That order');
    return order;
  },
  async count() {
    await delay();
    return mockOrders.filter(o => o.status !== 'pending_payment').length;
  },
  async cancel(id) {
    await delay();
    const order = mockOrders.find(entry => entry.id === id);
    if (!order) throw notFound('That order');
    if (order.status === 'cancelled')
      return { order, balance: currentBalance() };
    if (!order.cancellable) {
      throw new ApiError(
        'unknown',
        `An order that is ${order.status} can no longer be cancelled.`,
        409,
        { status: order.status },
        'ORDER_NOT_CANCELLABLE',
      );
    }
    for (const line of order.items) {
      mockStock.set(
        line.itemId,
        (mockStock.get(line.itemId) ?? 0) + line.quantity,
      );
    }
    mockBalance = currentBalance() + order.coinsUsed;
    const cancelled: Order = {
      ...order,
      status: 'cancelled',
      cancellable: false,
      updatedAt: new Date().toISOString(),
      payment:
        order.payment.status === 'paid'
          ? { ...order.payment, status: 'refunded' }
          : order.payment,
    };
    mockOrders = mockOrders.map(entry => (entry.id === id ? cancelled : entry));
    return { order: cancelled, balance: mockBalance };
  },
};

export const mockAddressApi: AddressApi = {
  async list() {
    await delay();
    return [...mockAddresses].sort(
      (a, b) => Number(b.isDefault) - Number(a.isDefault),
    );
  },
  async create(input) {
    await delay();
    const isDefault = mockAddresses.length === 0 || input.isDefault;
    if (isDefault)
      mockAddresses = mockAddresses.map(a => ({ ...a, isDefault: false }));
    const created: Address = { ...input, id: nextId('adr'), isDefault };
    mockAddresses = [created, ...mockAddresses];
    return created;
  },
  async update(id, patch) {
    await delay();
    const existing = mockAddresses.find(a => a.id === id);
    if (!existing)
      throw new ApiError('not_found', 'That address could not be found.', 404);
    const isDefault = existing.isDefault || (patch.isDefault ?? false);
    if (patch.isDefault)
      mockAddresses = mockAddresses.map(a => ({ ...a, isDefault: false }));
    const updated: Address = { ...existing, ...patch, isDefault };
    mockAddresses = mockAddresses.map(a => (a.id === id ? updated : a));
    return updated;
  },
  async setDefault(id) {
    return mockAddressApi.update(id, { isDefault: true });
  },
  async remove(id) {
    await delay();
    const removed = mockAddresses.find(a => a.id === id);
    if (!removed)
      throw new ApiError('not_found', 'That address could not be found.', 404);
    mockAddresses = mockAddresses.filter(a => a.id !== id);
    if (removed.isDefault && mockAddresses[0]) {
      mockAddresses = mockAddresses.map((a, index) => ({
        ...a,
        isDefault: index === 0,
      }));
    }
    return { ok: true };
  },
};

// ─── Referrals ─────────────────────────────────────────────────────────────

/** The code this mock user has applied, if any — the invitee's side. */
let mockApplied: ReferralProgram['applied'] = null;

/** A code a friend could plausibly have — anything but the user's own. */
const MOCK_FRIEND_CODES = new Set(['ASHA2K7', 'RAVI9XB']);

function mockProgram(): ReferralProgram {
  const rewarded = seedReferrals.filter(r => r.status === 'rewarded');
  return {
    code: referralCode,
    shareUrl: `https://vokve.app/r/${referralCode}`,
    shareMessage: `Join me on VOKVE — walk, train and earn coins for real rewards. Use my code ${referralCode} when you sign up and you get ${REFERRAL_REWARD_COINS} coins after your first workout: https://vokve.app/r/${referralCode}`,
    rewards: {
      inviter: REFERRAL_REWARD_COINS,
      invitee: REFERRAL_REWARD_COINS,
      qualifier: "your friend's first workout",
      monthlyInviterCap: 10,
    },
    stats: {
      successful: rewarded.length,
      pending: seedReferrals.length - rewarded.length,
      coinsEarned: rewarded.reduce((sum, r) => sum + r.rewardCoins, 0),
      rewardedThisMonth: Math.min(rewarded.length, 3),
    },
    referrals: seedReferrals.slice(0, 20),
    applied: mockApplied,
    canApply: mockApplied === null,
    applyBy:
      mockApplied === null
        ? new Date(Date.now() + 5 * 86_400_000).toISOString()
        : null,
  };
}

export const mockReferralApi: ReferralApi = {
  async me() {
    await delay();
    return mockProgram();
  },
  async list(cursor) {
    await delay();
    const after = cursor ? seedReferrals.findIndex(r => r.id === cursor) : -1;
    const data = seedReferrals.slice(after + 1, after + 1 + 20);
    const last = data[data.length - 1];
    const hasMore =
      last !== undefined &&
      seedReferrals.indexOf(last) < seedReferrals.length - 1;
    return { data, nextCursor: hasMore ? last.id : null };
  },
  async apply(rawCode) {
    await delay();
    const code = rawCode.toUpperCase().replace(/[\s-]/g, '');
    if (mockApplied) {
      throw new ApiError(
        'unknown',
        'You have already joined on a code.',
        409,
        { code: mockApplied.code },
        'REFERRAL_ALREADY_APPLIED',
      );
    }
    if (code === referralCode) {
      throw new ApiError(
        'validation',
        'That is your own code — share it with a friend instead.',
        422,
        null,
        'REFERRAL_SELF',
      );
    }
    if (!MOCK_FRIEND_CODES.has(code)) {
      throw new ApiError(
        'not_found',
        'That code does not match anyone. Check it and try again.',
        404,
        { code },
        'REFERRAL_CODE_INVALID',
      );
    }
    mockApplied = {
      code,
      inviterName: code === 'ASHA2K7' ? 'Asha' : 'Ravi',
      status: 'pending',
      rewardCoins: REFERRAL_REWARD_COINS,
      appliedAt: new Date().toISOString(),
    };
    return mockProgram();
  },
};

// ─── Account, support and about ────────────────────────────────────────────

/** The password the mock account is signed up with; anything else is refused. */
export const MOCK_CURRENT_PASSWORD = 'walk1000steps';
/** How long the mock holds a scheduled deletion, matching the server's default. */
const MOCK_DELETION_GRACE_DAYS = 14;

let mockPrivacy: PrivacySettings = {
  analytics: true,
  personalisedOffers: true,
  shareNameWithReferrer: true,
};
let mockDeletion: {
  scheduledAt: string | null;
  purgeAt: string | null;
  reason: string | null;
} = {
  scheduledAt: null,
  purgeAt: null,
  reason: null,
};
let mockTickets: SupportTicket[] = [];
let mockSessions: AccountSession[] = [
  {
    id: 'dev-current',
    platform: 'android',
    model: 'Pixel 8',
    brand: 'Google',
    osVersion: '14',
    appVersion: config.appVersion,
    firstSeenAt: daysAgoIso(40),
    lastSeenAt: new Date().toISOString(),
    isCurrent: true,
  },
  {
    id: 'dev-old',
    platform: 'ios',
    model: 'iPhone 13',
    brand: 'Apple',
    osVersion: '17.4',
    appVersion: '1.0.0',
    firstSeenAt: daysAgoIso(120),
    lastSeenAt: daysAgoIso(9),
    isCurrent: false,
  },
];

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * The same shape the server computes, on the mock's own figures: the level
 * from the seeded ledger, the badges from the seeded streak and the synced
 * steps. It
 * is deliberately a *calculation* rather than a fixture — a screen that
 * only ever sees one hand-written profile never exercises its own maths.
 */
function mockProfile(): ProfileSummary {
  const lifetimeCoins = seedCoinTransactions
    .filter(t => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  const level = Math.max(1, Math.floor(Math.sqrt(lifetimeCoins / 100)));
  const levelStart = level * level * 100;
  const nextAt = (level + 1) * (level + 1) * 100;
  const titles = [
    'Athlo Rookie',
    'Athlo Runner',
    'Athlo Strider',
    'Athlo Warrior',
    'Athlo Champion',
    'Athlo Legend',
  ];
  // Only what this phone has synced: the mock has no history before that.
  const totalSteps = [...mockActivityDays.values()].reduce(
    (sum, day) => sum + day.steps,
    0,
  );
  const streak = 12;
  const workouts = 34;
  const badge = (
    id: string,
    label: string,
    description: string,
    icon: ProfileBadge['icon'],
    value: number,
    goal: number,
  ): ProfileBadge => ({
    id,
    label,
    description,
    icon,
    unlockedAt: value >= goal ? daysAgoIso(20) : null,
    progress: Math.min(1, value / goal),
    value: Math.min(value, goal),
    goal,
  });

  return {
    level,
    tierTitle: titles[Math.min(Math.floor(level / 5), titles.length - 1)],
    xp: lifetimeCoins,
    xpIntoLevel: Math.max(0, lifetimeCoins - levelStart),
    xpForNextLevel: nextAt - levelStart,
    levelProgress: Math.max(
      0,
      Math.min(1, (lifetimeCoins - levelStart) / (nextAt - levelStart)),
    ),
    memberSince: daysAgoIso(260),
    rank: 412,
    totalMembers: 18_940,
    stats: {
      coins: currentBalance(),
      lifetimeCoins,
      currentStreak: streak,
      longestStreak: 21,
      totalSteps,
      activeDays: 96,
      totalWorkouts: workouts,
      totalWorkoutMinutes: workouts * 48,
      orders: mockOrders.filter(o => o.status !== 'pending_payment').length,
      referrals: seedReferrals.filter(r => r.status === 'rewarded').length,
    },
    badges: [
      badge('streak-7', 'Week One', 'A seven-day streak', 'flame', 21, 7),
      badge(
        'streak-30',
        'Month Strong',
        'A thirty-day streak',
        'flame',
        21,
        30,
      ),
      badge(
        'steps-100k',
        'Hundred K',
        '100,000 steps walked',
        'footprints',
        totalSteps,
        100_000,
      ),
      badge(
        'workouts-25',
        'Regular',
        '25 workouts finished',
        'dumbbell',
        workouts,
        25,
      ),
      badge(
        'coins-5000',
        'Earner',
        '5,000 coins earned',
        'coins',
        lifetimeCoins,
        5_000,
      ),
      badge(
        'orders-1',
        'First Order',
        'Something bought with coins',
        'package',
        mockOrders.length,
        1,
      ),
      badge(
        'referrals-3',
        'Recruiter',
        'Three friends brought along',
        'users',
        seedReferrals.length,
        3,
      ),
    ],
    completeness: currentUser?.avatarUrl ? 100 : 90,
    gaps: currentUser?.avatarUrl
      ? []
      : [{ field: 'avatarUrl', label: 'Add a profile photo', weight: 10 }],
    trustTier: 'normal',
  };
}

/**
 * A pending challenge for a contact the member is moving to. The code goes
 * to the *new* address, as the server sends it, so the OTP screen's copy
 * names where to look.
 */
function contactChallenge(
  next: string,
  channel: 'sms' | 'email',
  purpose: 'change_email' | 'change_phone',
): VerificationChallenge {
  if (!currentUser)
    throw new ApiError('unauthorized', 'Your session has expired.', 401);
  const id = nextId('ver');
  const pending: PendingSignUp = {
    payload: {
      email: channel === 'email' ? next : currentUser.email,
      phone: channel === 'sms' ? next : currentUser.phone ?? '',
      password: '',
      dateOfBirth: currentUser.dateOfBirth ?? '',
      gender: currentUser.gender ?? 'other',
    },
    channel,
    purpose,
    expiresAt: Date.now() + OTP_LIFETIME_SECONDS * 1000,
    resendAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
  };
  pendingSignUps.set(id, pending);
  return makeChallenge(id, pending);
}

const MOCK_FAQS: SupportFaq[] = [
  {
    id: 'faq-coins-earn',
    category: 'coins',
    question: 'How do I earn coins?',
    answer:
      'Walking, finishing a workout, keeping a streak and inviting friends all pay coins. There is a daily ceiling across everything.',
  },
  {
    id: 'faq-coins-expiry',
    category: 'coins',
    question: 'Do my coins expire?',
    answer:
      'Coins expire after 90 days without earning anything. Earning even one coin resets the window; spending does not.',
  },
  {
    id: 'faq-orders-pay',
    category: 'payments',
    question: 'How much can I pay with coins?',
    answer:
      'Coins cover up to 30% of the items in an order, at ₹0.25 a coin. The checkout shows the split before you pay.',
  },
  {
    id: 'faq-orders-track',
    category: 'orders',
    question: 'Where is my order?',
    answer:
      'My Orders shows every order and where it is. Once it ships you get a tracking reference there.',
  },
  {
    id: 'faq-tracking-steps',
    category: 'tracking',
    question: 'My steps are not being counted',
    answer:
      'Check that VOKVE still has permission to read your health data and that battery optimisation is not stopping it in the background.',
  },
  {
    id: 'faq-account-delete',
    category: 'account',
    question: 'How do I delete my account?',
    answer:
      'Account → Privacy → Delete account. Deletion is scheduled 14 days ahead so you can change your mind.',
  },
];

export const mockAccountApi: AccountApi = {
  async profile() {
    await delay();
    if (!currentUser)
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    return mockProfile();
  },
  async privacy() {
    await delay();
    return mockPrivacy;
  },
  async updatePrivacy(patch) {
    await delay();
    mockPrivacy = { ...mockPrivacy, ...patch };
    return mockPrivacy;
  },
  async changePassword({ currentPassword, newPassword }) {
    await delay();
    if (currentPassword !== MOCK_CURRENT_PASSWORD) {
      throw new ApiError(
        'validation',
        'That is not your current password.',
        422,
        { currentPassword: 'That is not your current password.' },
        'PASSWORD_INCORRECT',
      );
    }
    if (newPassword === currentPassword) {
      throw new ApiError(
        'validation',
        'Choose a password you have not used here before.',
        422,
        { newPassword: 'Choose a different password.' },
        'PASSWORD_UNCHANGED',
      );
    }
    const others = mockSessions.filter(s => !s.isCurrent).length;
    mockSessions = mockSessions.filter(s => s.isCurrent);
    return { ok: true, signedOutSessions: others };
  },
  async changeEmail({ email, password }) {
    await delay();
    if (password !== MOCK_CURRENT_PASSWORD) {
      throw new ApiError(
        'validation',
        'That is not your password.',
        422,
        { password: 'That is not your password.' },
        'PASSWORD_INCORRECT',
      );
    }
    if (email.includes(MOCK_RULES.takenMarker)) {
      throw new ApiError('validation', 'Check the highlighted fields.', 422, {
        email: 'That is already registered.',
      });
    }
    return contactChallenge(email, 'email', 'change_email');
  },
  async changePhone({ phone, password }) {
    await delay();
    if (password !== MOCK_CURRENT_PASSWORD) {
      throw new ApiError(
        'validation',
        'That is not your password.',
        422,
        { password: 'That is not your password.' },
        'PASSWORD_INCORRECT',
      );
    }
    if (phone.includes(MOCK_RULES.takenMarker)) {
      throw new ApiError('validation', 'Check the highlighted fields.', 422, {
        phone: 'That is already registered.',
      });
    }
    return contactChallenge(phone, 'sms', 'change_phone');
  },
  async sessions() {
    await delay();
    return mockSessions;
  },
  async revokeOtherSessions() {
    await delay();
    const others = mockSessions.filter(s => !s.isCurrent).length;
    mockSessions = mockSessions.filter(s => s.isCurrent);
    return { signedOut: others };
  },
  async exportData() {
    await delay();
    return {
      exportedAt: new Date().toISOString(),
      format: 'vokve.account.v1',
      profile: currentUser,
      privacy: mockPrivacy,
      coinTransactions: seedCoinTransactions,
      orders: mockOrders,
      addresses: mockAddresses,
      notifications: mockFeed,
      supportTickets: mockTickets,
    };
  },
  async deletion() {
    await delay();
    return { ...mockDeletion, graceDays: MOCK_DELETION_GRACE_DAYS };
  },
  async scheduleDeletion({ password, reason }) {
    await delay();
    if (password !== MOCK_CURRENT_PASSWORD) {
      throw new ApiError(
        'validation',
        'That is not your password.',
        422,
        { password: 'That is not your password.' },
        'PASSWORD_INCORRECT',
      );
    }
    const now = new Date();
    mockDeletion = {
      scheduledAt: now.toISOString(),
      purgeAt: new Date(
        now.getTime() + MOCK_DELETION_GRACE_DAYS * 86_400_000,
      ).toISOString(),
      reason: reason ?? null,
    };
    return { ...mockDeletion, graceDays: MOCK_DELETION_GRACE_DAYS };
  },
  async cancelDeletion() {
    await delay();
    mockDeletion = { scheduledAt: null, purgeAt: null, reason: null };
    return { ...mockDeletion, graceDays: MOCK_DELETION_GRACE_DAYS };
  },
};

export const mockSupportApi: SupportApi = {
  async faqs(query = {}) {
    await delay();
    const words = (query.q ?? '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return MOCK_FAQS.filter(
      faq => !query.category || faq.category === query.category,
    ).filter(faq =>
      words.every(word =>
        `${faq.question} ${faq.answer}`.toLowerCase().includes(word),
      ),
    );
  },
  async tickets() {
    await delay();
    return mockTickets;
  },
  async ticket(id) {
    await delay();
    const found = mockTickets.find(t => t.id === id);
    if (!found)
      throw new ApiError('not_found', 'That ticket could not be found.', 404);
    return found;
  },
  async createTicket({ subject, category, message }) {
    await delay();
    const now = new Date().toISOString();
    const ticket: SupportTicket = {
      id: nextId('tkt'),
      reference: `VK-${nextId('r').slice(-4).toUpperCase()}`,
      subject,
      category,
      status: 'open',
      messages: [
        { id: nextId('msg'), from: 'user', body: message, createdAt: now },
      ],
      createdAt: now,
      updatedAt: now,
    };
    mockTickets = [ticket, ...mockTickets];
    return ticket;
  },
  async reply(id, message) {
    await delay();
    const found = mockTickets.find(t => t.id === id);
    if (!found)
      throw new ApiError('not_found', 'That ticket could not be found.', 404);
    if (found.status === 'closed') {
      throw new ApiError(
        'unknown',
        'This ticket is closed. Open a new one and we will pick it up there.',
        409,
        null,
        'TICKET_CLOSED',
      );
    }
    const replied: SupportTicket = {
      ...found,
      status: found.status === 'resolved' ? 'open' : found.status,
      messages: [
        ...found.messages,
        {
          id: nextId('msg'),
          from: 'user',
          body: message,
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    mockTickets = mockTickets.map(t => (t.id === id ? replied : t));
    return replied;
  },
};

export const mockAppApi: AppApi = {
  async about() {
    await delay();
    return {
      name: 'VOKVE',
      company: 'VOKVE Fitness',
      version: config.appVersion,
      build: '1',
      latestVersion: config.appVersion,
      minVersion: '1.0.0',
      updateRequired: false,
      updateAvailable: false,
      storeUrl: 'https://play.google.com/store/apps/details?id=com.vokve',
      releaseNotes: [
        {
          version: config.appVersion,
          releasedAt: daysAgoIso(3),
          notes: 'Shop, cart and checkout with coins.',
        },
        {
          version: '1.0.0',
          releasedAt: daysAgoIso(60),
          notes: 'First release.',
        },
      ],
      links: {
        privacy: 'https://vokve.app/privacy',
        terms: 'https://vokve.app/terms',
        licenses: 'https://vokve.app/licenses',
        website: 'https://vokve.app',
      },
      supportEmail: 'support@vokve.app',
    };
  },
};
