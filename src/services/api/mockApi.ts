import { config } from '../../constants/config';
import {
  REFERRAL_REWARD_COINS,
  referralCode,
  seedCoinTransactions,
  seedNotifications,
  seedReferrals,
  shopItems,
  todayActivity,
  weeklySteps,
  workoutTemplates,
} from '../../constants/seedData';
import {
  authResponseSchema,
  dailyActivitySchema,
  userSchema,
  verificationChallengeSchema,
  workoutSchema,
  type AccountSession,
  type Address,
  type AppNotification,
  type AuthResponse,
  type Cart,
  type CheckoutResult,
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
  type User,
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
  CheckoutApi,
  DeviceApi,
  NotificationApi,
  NotificationPreferencesApi,
  OrderApi,
  ReferralApi,
  ShopApi,
  SupportApi,
  UserApi,
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

export const mockActivityApi: ActivityApi = {
  async today(): Promise<DailyActivity> {
    await delay();
    return dailyActivitySchema.parse({
      date: new Date().toISOString().slice(0, 10),
      steps: todayActivity.steps,
      verifiedSteps: todayActivity.steps,
      distanceKm: todayActivity.distanceKm,
      activeMinutes: todayActivity.activeMinutes,
      caloriesBurned: todayActivity.caloriesBurned,
      source: 'manual',
      verified: false,
    });
  },

  async weekly(): Promise<DailyActivity[]> {
    await delay();

    const today = new Date();
    return weeklySteps.map((day, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (weeklySteps.length - 1 - index));

      return dailyActivitySchema.parse({
        date: date.toISOString().slice(0, 10),
        steps: day.steps,
        // Scaled off the step count so the week reads as one consistent story
        // rather than four unrelated random series.
        activeMinutes: Math.round(
          (day.steps / todayActivity.steps) * todayActivity.activeMinutes,
        ),
        caloriesBurned: Math.round(
          (day.steps / todayActivity.steps) * todayActivity.caloriesBurned,
        ),
        workoutsCompleted: day.steps > 8000 ? 1 : 0,
      });
    });
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
 * from the seeded ledger, the badges from the seeded streak and steps. It
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
  const totalSteps = weeklySteps.reduce((sum, day) => sum + day.steps, 0) * 12;
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
