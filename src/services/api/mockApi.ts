import { config } from '../../constants/config';
import {
  seedCoinTransactions,
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
  type AuthResponse,
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
import type { ActivityApi, AuthApi, DeviceApi, UserApi, WalletApi, WorkoutApi } from './contracts';

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
      payload: pending.payload,
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
