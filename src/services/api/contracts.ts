import type {
  AuthResponse,
  DailyActivity,
  User,
  VerificationChallenge,
  Workout,
  WorkoutTemplate,
} from '../../types/models';
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
  signOut(): Promise<{ ok: boolean }>;
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
  history(cursor?: string): Promise<Workout[]>;
  save(workout: Workout): Promise<Workout>;
}

export interface ActivityApi {
  weekly(): Promise<DailyActivity[]>;
}
