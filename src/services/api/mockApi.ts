import { config } from '../../constants/config';
import {
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
import type { ActivityApi, AuthApi, UserApi, WorkoutApi } from './contracts';

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

function makeUser(payload?: SignUpPayload): User {
  return userSchema.parse({
    id: nextId('usr'),
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
  return verificationChallengeSchema.parse({
    verificationId,
    phone: pending.payload.phone,
    codeLength: MOCK_RULES.otp.length,
    expiresInSeconds: secondsUntil(pending.expiresAt),
    resendInSeconds: secondsUntil(pending.resendAt),
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

    const verificationId = nextId('ver');
    pendingSignUps.set(verificationId, {
      payload,
      expiresAt: Date.now() + OTP_LIFETIME_SECONDS * 1000,
      resendAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
    });

    logger.info(
      'mockApi',
      `OTP for ${payload.phone} is ${MOCK_RULES.otp} (mock backend)`,
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
    currentUser = makeUser(pending.payload);
    return makeAuthResponse(currentUser);
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

  async history(): Promise<Workout[]> {
    await delay();
    // Nothing yet: a fresh account has no history, and inventing one makes the
    // empty state impossible to look at.
    return [];
  },

  async save(workout): Promise<Workout> {
    await delay();
    // Echoed back through the schema, the way a real save returns the stored
    // record rather than the one that was sent.
    return workoutSchema.parse(workout);
  },
};

export const mockActivityApi: ActivityApi = {
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
