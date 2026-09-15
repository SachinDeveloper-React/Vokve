import { z } from 'zod';
import {
  authResponseSchema,
  coinTransactionSchema,
  dailyActivitySchema,
  deviceRegistrationSchema,
  earnRuleSchema,
  pageSchema,
  verificationChallengeSchema,
  userSchema,
  walletSchema,
  workoutSchema,
  workoutTemplateSchema,
  type AuthResponse,
  type DailyActivity,
  type VerificationChallenge,
  type User,
  type Workout,
  type WorkoutTemplate,
} from '../../types/models';
import type {
  CompleteProfilePayload,
  SignUpPayload,
} from '../../types/forms';
import { config } from '../../constants/config';
import { logger } from '../../utils/logger';
import { request } from './client';
import type { ActivityApi, AuthApi, DeviceApi, UserApi, WalletApi, WorkoutApi } from './contracts';
import {
  MOCK_RULES,
  mockActivityApi,
  mockAuthApi,
  mockDeviceApi,
  mockUserApi,
  mockWalletApi,
  mockWorkoutApi,
} from './mockApi';

/**
 * Whether this call is served from `mockApi` instead of the network.
 *
 * `__DEV__` is the actual guard, exactly as it is for `bypassAuthInDev`: it
 * compiles to `false` in a release build, so a config flag left switched on
 * cannot ship an app that signs people in against fake data.
 *
 * Evaluated per call rather than once at module scope, so the choice stays
 * assertable in a test instead of being frozen at import time.
 */
export function shouldUseMockApi(): boolean {
  return __DEV__ && config.useMockApi;
}

/**
 * One function per endpoint, each returning parsed and validated data.
 * Screens and stores call these; nothing else should touch `apiClient`.
 */
const realAuthApi: AuthApi = {
  signIn: (email: string, password: string): Promise<AuthResponse> =>
    request(authResponseSchema, client =>
      client.post('/auth/sign-in', { email, password }),
    ),

  // Takes the whole payload rather than positional arguments: sign-up collects
  // six fields, and six positional strings is a call nobody can read or safely
  // reorder.
  //
  // Returns a verification challenge, not a session. The account is not usable
  // until the number is proven, so issuing tokens here would hand a working
  // login to anyone who typed a number they do not own.
  signUp: (payload: SignUpPayload): Promise<VerificationChallenge> =>
    request(verificationChallengeSchema, client =>
      client.post('/auth/sign-up', payload),
    ),

  verifyOtp: (verificationId: string, code: string): Promise<AuthResponse> =>
    request(authResponseSchema, client =>
      client.post('/auth/verify-otp', { verificationId, code }),
    ),

  // Returns a fresh challenge rather than nothing: the new code has its own
  // lifetime and its own resend cooldown, and the screen's two clocks are only
  // honest if the server is the one setting them.
  resendOtp: (verificationId: string): Promise<VerificationChallenge> =>
    request(verificationChallengeSchema, client =>
      client.post('/auth/resend-otp', { verificationId }),
    ),

  sendEmailOtp: (): Promise<VerificationChallenge> =>
    request(verificationChallengeSchema, client =>
      client.post('/auth/email/send-otp'),
    ),

  forgotPassword: (identifier: string): Promise<VerificationChallenge> =>
    request(verificationChallengeSchema, client =>
      client.post('/auth/forgot-password', { identifier }),
    ),

  resetPassword: (verificationId, code, password): Promise<{ ok: boolean }> =>
    request(z.object({ ok: z.boolean() }), client =>
      client.post('/auth/reset-password', { verificationId, code, password }),
    ),

  signOut: (): Promise<{ ok: boolean }> =>
    request(z.object({ ok: z.boolean() }), client =>
      client.post('/auth/sign-out'),
    ),
};

const realDeviceApi: DeviceApi = {
  register: (profile, refreshToken) =>
    request(deviceRegistrationSchema, client =>
      client.post('/devices/register', profile, {
        // Lets the server bind the session that just started to this device.
        headers: refreshToken ? { 'X-Vokve-Refresh-Token': refreshToken } : {},
      }),
    ),
};

const realWalletApi: WalletApi = {
  get: () => request(walletSchema, client => client.get('/wallet')),
  // axios drops undefined params, so an unset filter sends no `source=`.
  transactions: (query = {}) =>
    request(pageSchema(coinTransactionSchema), client =>
      client.get('/wallet/transactions', {
        params: { cursor: query.cursor, limit: query.limit, source: query.source },
      }),
    ),
  earnRules: () =>
    request(pageSchema(earnRuleSchema), client =>
      client.get('/wallet/earn-rules'),
    ).then(page => page.data),
};

const realUserApi: UserApi = {
  me: (): Promise<User> =>
    request(userSchema, client => client.get('/me')),

  updateProfile: (patch: Partial<User>): Promise<User> =>
    request(userSchema, client => client.patch('/me', patch)),

  completeProfile: (payload: CompleteProfilePayload): Promise<User> =>
    request(userSchema, client => client.post('/me/complete-profile', payload)),
};

const realWorkoutApi: WorkoutApi = {
  templates: (): Promise<WorkoutTemplate[]> =>
    request(z.array(workoutTemplateSchema), client =>
      client.get('/workout-templates'),
    ),

  history: cursor =>
    request(pageSchema(workoutSchema), client =>
      client.get('/workouts', { params: { cursor } }),
    ),

  save: (workout: Workout): Promise<Workout> =>
    request(workoutSchema, client => client.post('/workouts', workout)),
};

const realActivityApi: ActivityApi = {
  weekly: (): Promise<DailyActivity[]> =>
    request(z.array(dailyActivitySchema), client =>
      client.get('/activity/weekly'),
    ),
  today: (): Promise<DailyActivity> =>
    request(dailyActivitySchema, client => client.get('/activity/today')),
};

/**
 * The implementations screens and stores actually call.
 *
 * Each method forwards to whichever side the flag selects at call time. The
 * indirection is one line per endpoint and buys the thing that matters: no
 * caller anywhere knows whether there is a backend, so turning the real one on
 * is a single boolean and no other edit.
 */
let hasAnnouncedMock = false;

const pick = <T>(mock: T, real: T): T => {
  if (!shouldUseMockApi()) {
    return real;
  }

  // Loud, but only once, and only when a call is actually served from the
  // mock. A mock backend nobody remembers is switched on is how a "working"
  // build reaches someone who then reports that nothing saves.
  if (!hasAnnouncedMock) {
    hasAnnouncedMock = true;
    logger.warn(
      'endpoints',
      `Mock API is ON — no network calls. OTP is ${MOCK_RULES.otp}. ` +
        'Set config.useMockApi = false to use the real backend.',
    );
  }

  return mock;
};

export const authApi: AuthApi = {
  signIn: (email, password) =>
    pick(mockAuthApi, realAuthApi).signIn(email, password),
  signUp: payload => pick(mockAuthApi, realAuthApi).signUp(payload),
  verifyOtp: (verificationId, code) =>
    pick(mockAuthApi, realAuthApi).verifyOtp(verificationId, code),
  resendOtp: verificationId =>
    pick(mockAuthApi, realAuthApi).resendOtp(verificationId),
  sendEmailOtp: () => pick(mockAuthApi, realAuthApi).sendEmailOtp(),
  forgotPassword: identifier =>
    pick(mockAuthApi, realAuthApi).forgotPassword(identifier),
  resetPassword: (verificationId, code, password) =>
    pick(mockAuthApi, realAuthApi).resetPassword(verificationId, code, password),
  signOut: () => pick(mockAuthApi, realAuthApi).signOut(),
};

export const deviceApi: DeviceApi = {
  register: (profile, refreshToken) =>
    pick(mockDeviceApi, realDeviceApi).register(profile, refreshToken),
};

export const walletApi: WalletApi = {
  get: () => pick(mockWalletApi, realWalletApi).get(),
  transactions: query => pick(mockWalletApi, realWalletApi).transactions(query),
  earnRules: () => pick(mockWalletApi, realWalletApi).earnRules(),
};

export const userApi: UserApi = {
  me: () => pick(mockUserApi, realUserApi).me(),
  updateProfile: patch => pick(mockUserApi, realUserApi).updateProfile(patch),
  completeProfile: payload =>
    pick(mockUserApi, realUserApi).completeProfile(payload),
};

export const workoutApi: WorkoutApi = {
  templates: () => pick(mockWorkoutApi, realWorkoutApi).templates(),
  history: cursor => pick(mockWorkoutApi, realWorkoutApi).history(cursor),
  save: workout => pick(mockWorkoutApi, realWorkoutApi).save(workout),
};

export const activityApi: ActivityApi = {
  weekly: () => pick(mockActivityApi, realActivityApi).weekly(),
  today: () => pick(mockActivityApi, realActivityApi).today(),
};

