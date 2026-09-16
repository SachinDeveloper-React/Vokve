import { config } from '../../constants/config';
import {
  seedCoinTransactions,
  seedNotifications,
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
  type Address,
  type AppNotification,
  type AuthResponse,
  type Order,
  type CoinTransaction,
  type DailyActivity,
  type User,
  type VerificationChallenge,
  type Workout,
  type WorkoutTemplate,
} from '../../types/models';
import type {
  CompleteProfilePayload,
  SignUpPayload,
} from '../../types/forms';
import { logger } from '../../utils/logger';
import { ApiError } from './errors';
import type {
  ActivityApi,
  AddressApi,
  AuthApi,
  DeviceApi,
  NotificationApi,
  OrderApi,
  ShopApi,
  UserApi,
  WalletApi,
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
  /** A step-up code proves the user, not a contact: it answers with a token. */
  purpose?: 'step_up';
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

function makeUser(payload?: SignUpPayload, provenBy: 'email' | 'sms' = 'email'): User {
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
        ? `${pending.payload.email.slice(0, 1)}•••@${pending.payload.email.split('@')[1] ?? ''}`
        : `${pending.payload.phone.slice(0, 3)}••••••${pending.payload.phone.slice(-4)}`,
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
    logger.info('mockApi', `Reset code for ${identifier} is ${MOCK_RULES.otp} (mock backend)`);
    return makeChallenge(id, pending);
  },

  async resetPassword(verificationId, code) {
    await delay();
    const pending = pendingSignUps.get(verificationId);
    if (!pending) {
      throw new ApiError('not_found', 'This code is no longer valid. Request a new one.', 404);
    }
    if (code !== MOCK_RULES.otp) {
      throw new ApiError('validation', 'That code is not right. Check it and try again.', 422);
    }
    pendingSignUps.delete(verificationId);
    return { ok: true };
  },

  async signOut() {
    await delay();
    currentUser = null;
    pendingSignUps.clear();
    mockFeed = seedNotifications.map(entry => ({ ...entry }));
    mockStock = new Map(shopItems.map(item => [item.id, item.inStock ? 25 : 0]));
    mockOrders = [];
    mockAddresses = [];
    mockBalance = null;
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
    if (at.getMonth() !== now.getMonth() || at.getFullYear() !== now.getFullYear()) {
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
    const earned = seedCoinTransactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
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
    const limit = Math.min(100, Math.max(1, query.limit ?? TRANSACTION_PAGE_SIZE));
    const rows = query.source
      ? seedCoinTransactions.filter(t => t.source === query.source)
      : seedCoinTransactions;
    const after = query.cursor ? rows.findIndex(t => t.id === query.cursor) : -1;
    const data = rows.slice(after + 1, after + 1 + limit);
    const last = data[data.length - 1];
    const hasMore = last !== undefined && rows.indexOf(last) < rows.length - 1;
    return { data, nextCursor: hasMore ? last.id : null };
  },
  async earnRules() {
    await delay();
    return [
      { source: 'steps' as const, title: 'Walk', detail: 'Per 100 verified steps', reward: 0.095 },
      { source: 'workout' as const, title: 'Finish a workout', detail: 'Any logged session', reward: 100 },
      { source: 'streak' as const, title: 'Keep a streak', detail: '7 days in a row', reward: 50 },
      { source: 'referral' as const, title: 'Invite a friend', detail: 'Once they verify their number and email', reward: 20 },
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
const MOCK_FEED_CATEGORY: Record<AppNotification['topic'], 'activity' | 'reward' | 'system'> = {
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
let mockFeed: AppNotification[] = seedNotifications.map(entry => ({ ...entry }));

export const mockNotificationApi: NotificationApi = {
  async list(query = {}) {
    await delay();
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const rows = query.category
      ? mockFeed.filter(n => MOCK_FEED_CATEGORY[n.topic] === query.category)
      : mockFeed;
    const after = query.cursor ? rows.findIndex(n => n.id === query.cursor) : -1;
    const data = rows.slice(after + 1, after + 1 + limit).map(n => ({ ...n }));
    const last = data[data.length - 1];
    const hasMore = last !== undefined && rows.findIndex(n => n.id === last.id) < rows.length - 1;
    return { data, nextCursor: hasMore ? last.id : null };
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

// ─── Commerce ──────────────────────────────────────────────────────────────

/** The price at and above which the mock, like the server, asks for a step-up. */
export const MOCK_STEP_UP_THRESHOLD = 1000;

let mockStock = new Map(shopItems.map(item => [item.id, item.inStock ? 25 : 0]));
let mockOrders: Order[] = [];
let mockAddresses: Address[] = [];
/**
 * The mock's own wallet balance for redemptions, seeded from the ledger the
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

function withStock(item: (typeof shopItems)[number]) {
  return { ...item, inStock: (mockStock.get(item.id) ?? 0) > 0 };
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

export const mockShopApi: ShopApi = {
  async items(query = {}) {
    await delay();
    return shopItems
      .filter(item => !query.category || item.category === query.category)
      .filter(item => !query.deals || item.isDeal)
      .map(withStock);
  },
  async item(id) {
    await delay();
    const item = shopItems.find(entry => entry.id === id);
    if (!item) throw new ApiError('not_found', 'That reward could not be found.', 404);
    return withStock(item);
  },
  async redeem(payload) {
    await delay();
    if (!currentUser) {
      throw new ApiError('unauthorized', 'Your session has expired.', 401);
    }
    const item = shopItems.find(entry => entry.id === payload.itemId);
    if (!item) throw new ApiError('not_found', 'That reward could not be found.', 404);
    const quantity = payload.quantity ?? 1;
    const total = item.priceCoins * quantity;

    const address = mockAddresses.find(entry => entry.id === payload.addressId);
    if (!address) {
      throw new ApiError('validation', 'Add a shipping address to redeem rewards.', 422, { addressId: payload.addressId }, 'ADDRESS_REQUIRED');
    }
    if (total >= MOCK_STEP_UP_THRESHOLD) {
      if (!payload.stepUpToken) {
        throw new ApiError('forbidden', 'Confirm it is you to redeem this reward.', 403, null, 'STEP_UP_REQUIRED');
      }
      if (!mockStepUps.delete(payload.stepUpToken)) {
        throw new ApiError('forbidden', 'That confirmation has expired. Please confirm again.', 403, null, 'STEP_UP_INVALID');
      }
    }
    const balance = currentBalance();
    if (balance < total) {
      throw new ApiError('validation', `You need ${total - balance} more coins for this.`, 422, { required: total, balance }, 'INSUFFICIENT_COINS');
    }
    const onHand = mockStock.get(item.id) ?? 0;
    if (onHand < quantity) {
      throw new ApiError('unknown', `${item.title} is sold out.`, 409, { itemId: item.id }, 'OUT_OF_STOCK');
    }

    mockStock.set(item.id, onHand - quantity);
    mockBalance = balance - total;
    const now = new Date().toISOString();
    const order: Order = {
      id: nextId('ord'),
      status: 'placed',
      items: [{ itemId: item.id, title: item.title, emoji: item.emoji, quantity, priceCoins: item.priceCoins }],
      totalCoins: total,
      address: snapshotOf(address),
      placedAt: now,
      updatedAt: now,
      trackingRef: null,
      cancellable: true,
    };
    mockOrders = [order, ...mockOrders];
    return { order, balance: mockBalance };
  },
};

export const mockOrderApi: OrderApi = {
  async list(cursor) {
    await delay();
    const after = cursor ? mockOrders.findIndex(o => o.id === cursor) : -1;
    const data = mockOrders.slice(after + 1, after + 1 + 20);
    const last = data[data.length - 1];
    const hasMore = last !== undefined && mockOrders.indexOf(last) < mockOrders.length - 1;
    return { data, nextCursor: hasMore ? last.id : null };
  },
  async get(id) {
    await delay();
    const order = mockOrders.find(entry => entry.id === id);
    if (!order) throw new ApiError('not_found', 'That order could not be found.', 404);
    return order;
  },
  async count() {
    await delay();
    return mockOrders.length;
  },
  async cancel(id) {
    await delay();
    const order = mockOrders.find(entry => entry.id === id);
    if (!order) throw new ApiError('not_found', 'That order could not be found.', 404);
    if (order.status === 'cancelled') return { order, balance: currentBalance() };
    if (!order.cancellable) {
      throw new ApiError('unknown', `An order that is ${order.status} can no longer be cancelled.`, 409, { status: order.status }, 'ORDER_NOT_CANCELLABLE');
    }
    for (const line of order.items) {
      mockStock.set(line.itemId, (mockStock.get(line.itemId) ?? 0) + line.quantity);
    }
    mockBalance = currentBalance() + order.totalCoins;
    const cancelled: Order = { ...order, status: 'cancelled', cancellable: false, updatedAt: new Date().toISOString() };
    mockOrders = mockOrders.map(entry => (entry.id === id ? cancelled : entry));
    return { order: cancelled, balance: mockBalance };
  },
};

export const mockAddressApi: AddressApi = {
  async list() {
    await delay();
    return [...mockAddresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  },
  async create(input) {
    await delay();
    const isDefault = mockAddresses.length === 0 || input.isDefault;
    if (isDefault) mockAddresses = mockAddresses.map(a => ({ ...a, isDefault: false }));
    const created: Address = { ...input, id: nextId('adr'), isDefault };
    mockAddresses = [created, ...mockAddresses];
    return created;
  },
  async update(id, patch) {
    await delay();
    const existing = mockAddresses.find(a => a.id === id);
    if (!existing) throw new ApiError('not_found', 'That address could not be found.', 404);
    const isDefault = existing.isDefault || (patch.isDefault ?? false);
    if (patch.isDefault) mockAddresses = mockAddresses.map(a => ({ ...a, isDefault: false }));
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
    if (!removed) throw new ApiError('not_found', 'That address could not be found.', 404);
    mockAddresses = mockAddresses.filter(a => a.id !== id);
    if (removed.isDefault && mockAddresses[0]) {
      mockAddresses = mockAddresses.map((a, index) => ({ ...a, isDefault: index === 0 }));
    }
    return { ok: true };
  },
};
