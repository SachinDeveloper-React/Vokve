import { create } from 'zustand';
import { authApi } from '../services/api/endpoints';
import { setOnSessionExpired } from '../services/api/client';
import { ApiError, toApiError } from '../services/api/errors';
import { secureStorage } from '../services/secureStorage';
import type { User, VerificationChallenge } from '../types/models';
import type {
  CompleteProfilePayload,
  SignUpPayload,
} from '../types/forms';
import { logger } from '../utils/logger';

export type AuthStatus = 'idle' | 'hydrating' | 'authenticated' | 'signed_out';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /**
   * The half-finished sign-up waiting on a code from the user's phone. Set by
   * `signUp`, consumed by `verifyOtp`, and the only thing that makes the OTP
   * screen reachable.
   */
  pendingVerification: VerificationChallenge | null;
  /** Set while a sign-in / sign-up / verification request is in flight. */
  isSubmitting: boolean;
  error: ApiError | null;

  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (payload: SignUpPayload) => Promise<boolean>;
  verifyOtp: (code: string) => Promise<boolean>;
  resendOtp: () => Promise<boolean>;
  /** Finishes onboarding and unlocks the main app. */
  completeProfile: (payload: CompleteProfilePayload) => Promise<boolean>;
  /** Abandons the pending sign-up — going back from the OTP screen. */
  cancelVerification: () => void;
  signOut: () => Promise<void>;
  clearError: () => void;
}

/**
 * Session state is deliberately *not* persisted through MMKV — the tokens live
 * in the Keychain and the user object is re-fetched on launch. Persisting a
 * `user` to plain-text storage would leak profile data and let a stale record
 * outlive a revoked session.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,
  pendingVerification: null,
  isSubmitting: false,
  error: null,

  hydrate: async () => {
    set({ status: 'hydrating' });
    const tokens = await secureStorage.readTokens();

    if (!tokens) {
      set({ status: 'signed_out', user: null });
      return;
    }

    try {
      const { userApi } = await import('../services/api/endpoints');
      const user = await userApi.me();
      set({ status: 'authenticated', user });
    } catch (error) {
      logger.warn('authStore', 'Session restore failed', error);
      await secureStorage.clearTokens();
      set({ status: 'signed_out', user: null });
    }
  },

  signIn: async (email, password) => {
    set({ isSubmitting: true, error: null });
    try {
      const { user, tokens } = await authApi.signIn(email, password);
      await secureStorage.saveTokens(tokens);
      set({ status: 'authenticated', user, isSubmitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), isSubmitting: false });
      return false;
    }
  },

  /**
   * Registers the account but does *not* sign the user in — the number still
   * has to be proven. `status` deliberately stays `signed_out` so the root
   * navigator keeps the auth stack mounted and the OTP screen can be pushed
   * on top of the form; flipping to `authenticated` here would swap the whole
   * stack out and the code would never be asked for.
   */
  signUp: async payload => {
    set({ isSubmitting: true, error: null });
    try {
      const pendingVerification = await authApi.signUp(payload);
      set({ pendingVerification, isSubmitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), isSubmitting: false });
      return false;
    }
  },

  verifyOtp: async code => {
    const pending = get().pendingVerification;
    if (!pending) {
      return false;
    }

    set({ isSubmitting: true, error: null });
    try {
      const { user, tokens } = await authApi.verifyOtp(
        pending.verificationId,
        code,
      );
      await secureStorage.saveTokens(tokens);
      set({
        status: 'authenticated',
        user,
        pendingVerification: null,
        isSubmitting: false,
      });
      return true;
    } catch (error) {
      // The challenge is kept: a wrong digit should leave the user on the
      // screen with the same code still live, not send them back to the form.
      set({ error: toApiError(error), isSubmitting: false });
      return false;
    }
  },

  resendOtp: async () => {
    const pending = get().pendingVerification;
    if (!pending) {
      return false;
    }

    set({ isSubmitting: true, error: null });
    try {
      const pendingVerification = await authApi.resendOtp(
        pending.verificationId,
      );
      set({ pendingVerification, isSubmitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), isSubmitting: false });
      return false;
    }
  },

  cancelVerification: () => {
    set({ pendingVerification: null, error: null });
  },

  completeProfile: async payload => {
    set({ isSubmitting: true, error: null });
    try {
      const { userApi } = await import('../services/api/endpoints');
      const user = await userApi.completeProfile(payload);
      // Replacing the whole user rather than patching fields: the server's
      // copy is the one carrying `profileCompletedAt`, and that stamp is what
      // the navigator reads to decide the app is reachable.
      set({ user, isSubmitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), isSubmitting: false });
      return false;
    }
  },

  signOut: async () => {
    // Tell the server if we can, but never block the user from leaving.
    try {
      await authApi.signOut();
    } catch (error) {
      logger.warn('authStore', 'Server sign-out failed, clearing locally', error);
    }
    await secureStorage.clearTokens();
    set({
      status: 'signed_out',
      user: null,
      pendingVerification: null,
      error: null,
    });
  },

  clearError: () => {
    if (get().error) {
      set({ error: null });
    }
  },
}));

// When a refresh fails mid-session the API layer cannot import this store
// without creating a cycle, so it calls back through this handler instead.
setOnSessionExpired(() => {
  useAuthStore.setState({ status: 'signed_out', user: null });
});

/**
 * Granular selectors. Subscribing to the slice you actually use keeps a screen
 * from re-rendering every time an unrelated field changes.
 */
export const useAuthStatus = () => useAuthStore(s => s.status);
export const useCurrentUser = () => useAuthStore(s => s.user);
export const usePendingVerification = () =>
  useAuthStore(s => s.pendingVerification);

/**
 * Whether onboarding is behind the user.
 *
 * Read from the server's stamp rather than from whether the fields look
 * filled, so a user who never enters a weight is not marched through
 * onboarding on every launch.
 */
export const useIsProfileComplete = () =>
  useAuthStore(s => s.user?.profileCompletedAt != null);
export const useIsAuthenticated = () =>
  useAuthStore(s => s.status === 'authenticated');
