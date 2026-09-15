import type {
  AuthResponse,
  CoinSource,
  CoinTransaction,
  DailyActivity,
  DeviceRegistration,
  EarnRule,
  User,
  VerificationChallenge,
  Wallet,
  Workout,
  WorkoutTemplate,
} from '../../types/models';
import type { DeviceProfile } from '../device';
import type {
  CompleteProfilePayload,
  SignUpPayload,
} from '../../types/forms';

/**
 * The shape of every API group, written once.
 *
 * The real implementation and the in-memory one in `mockApi.ts` both have to
 * satisfy these, which is what stops the mock quietly drifting out of step
 * with the endpoints it stands in for — a mock that has fallen behind is worse
 * than no mock, because it makes a broken screen look like a working one.
 */
export interface AuthApi {
  signIn(email: string, password: string): Promise<AuthResponse>;
  signUp(payload: SignUpPayload): Promise<VerificationChallenge>;
  verifyOtp(verificationId: string, code: string): Promise<AuthResponse>;
  resendOtp(verificationId: string): Promise<VerificationChallenge>;
  /**
   * Asks for a fresh email code. The first one is sent by the server the
   * moment the phone is verified and rides back on that `AuthResponse`, so
   * this is only the resend (BACKEND.md §13.3).
   */
  sendEmailOtp(): Promise<VerificationChallenge>;
  /**
   * Starts a password reset. Always answers with a challenge — a decoy for an
   * unknown identifier — so the shape never says whether the account exists.
   */
  forgotPassword(identifier: string): Promise<VerificationChallenge>;
  /** Finishes it: the code proves the identifier, the password replaces the old one. */
  resetPassword(verificationId: string, code: string, password: string): Promise<{ ok: boolean }>;
  signOut(): Promise<{ ok: boolean }>;
}

/** A page of anything: opaque cursor, `null` on the last page (BACKEND.md §3.7). */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface DeviceApi {
  /**
   * Registers this install and returns the server's id for it. Takes the
   * refresh token so the server can bind the session to the device.
   */
  register(profile: DeviceProfile, refreshToken: string | null): Promise<DeviceRegistration>;
}

/**
 * What `GET /wallet/transactions` can be asked for. Every field is optional,
 * so a bare call is the newest page of everything — which is all the wallet's
 * own card needs. The history screen is what uses the rest.
 */
export interface TransactionQuery {
  cursor?: string;
  /** Rows per page. The server caps it at 100 and defaults to 20. */
  limit?: number;
  /** Only movements from this source — the history screen's filter. */
  source?: CoinSource;
}

export interface WalletApi {
  get(): Promise<Wallet>;
  transactions(query?: TransactionQuery): Promise<Page<CoinTransaction>>;
  earnRules(): Promise<EarnRule[]>;
}

export interface UserApi {
  me(): Promise<User>;
  updateProfile(patch: Partial<User>): Promise<User>;
  /**
   * Finishes onboarding. Separate from `updateProfile` because only this one
   * stamps `profileCompletedAt`, and that stamp is what decides whether the
   * app opens on the onboarding step or on the home screen.
   */
  completeProfile(payload: CompleteProfilePayload): Promise<User>;
}

export interface WorkoutApi {
  templates(): Promise<WorkoutTemplate[]>;
  history(cursor?: string): Promise<Page<Workout>>;
  save(workout: Workout): Promise<Workout>;
}

export interface ActivityApi {
  weekly(): Promise<DailyActivity[]>;
  today(): Promise<DailyActivity>;
}
