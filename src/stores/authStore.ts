import { create } from 'zustand';
import { authApi, userApi } from '../services/api/endpoints';
import { setOnSessionExpired } from '../services/api/client';
import { ApiError, toApiError } from '../services/api/errors';
import { secureStorage } from '../services/secureStorage';
import { registerDevice } from '../services/device';
import { useCoinsStore } from './coinsStore';
import type { AuthTokens, User, VerificationChallenge } from '../types/models';
import type {
  CompleteProfilePayload,
  SignUpPayload,
} from '../types/forms';
import { logger } from '../utils/logger';

/**
 * `unreachable` is a session that exists but could not be confirmed — the
 * tokens are there, the server was not. It is neither signed in (there is no
 * user to show) nor signed out (nothing has been revoked), and the root
 * navigator gives it a retry screen rather than either stack.
 */
export type AuthStatus =
  | 'idle'
  | 'hydrating'
  | 'authenticated'
  | 'unreachable'
  | 'signed_out';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /**
   * The half-finished sign-up waiting on a code from the user's phone. Set by
   * `signUp`, consumed by `verifyOtp`, and the only thing that makes the OTP
   * screen reachable.
   */
  pendingVerification: VerificationChallenge | null;
  /**
   * The password reset in progress: the challenge forgot-password produced.
   * Kept apart from `pendingVerification` because the two can overlap — a
   * signed-out user resetting a password is not the same state as a
   * signed-in one verifying an email — and the reset screen reads only this.
   */
  pendingReset: VerificationChallenge | null;
  /** Set while a sign-in / sign-up / verification request is in flight. */
  isSubmitting: boolean;
  error: ApiError | null;
  /**
   * A one-line explanation for the sign-in screen: why the user is looking
   * at it when they did not ask to — the session expired, the reset went
   * through, the sign-up code ran out. Cleared when the user dismisses it.
   */
  notice: string | null;

  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (payload: SignUpPayload) => Promise<boolean>;
  verifyOtp: (code: string) => Promise<boolean>;
  resendOtp: () => Promise<boolean>;
  /** Finishes onboarding and unlocks the main app. */
  completeProfile: (payload: CompleteProfilePayload) => Promise<boolean>;
  /** Abandons the pending sign-up — going back from the OTP screen. */
  cancelVerification: () => void;
  /** Sends a new email code and makes it the pending challenge. */
  requestEmailVerification: () => Promise<boolean>;
  /** Starts a reset; the challenge lands in `pendingReset`. Always succeeds for a well-formed identifier. */
  forgotPassword: (identifier: string) => Promise<boolean>;
  resendResetOtp: () => Promise<boolean>;
  /** Finishes the reset. On success `pendingReset` is cleared. */
  resetPassword: (code: string, password: string) => Promise<boolean>;
  cancelReset: () => void;
  setNotice: (notice: string | null) => void;
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
  pendingReset: null,
  isSubmitting: false,
  error: null,
  notice: null,

  setNotice: notice => set({ notice }),

  hydrate: async () => {
    // A retry from the connection screen stays `unreachable` — the splash
    // would replace the screen the user is pressing a button on — and shows
    // its progress through `isSubmitting` instead.
    if (get().status === 'unreachable') {
      set({ isSubmitting: true, error: null });
    } else {
      set({ status: 'hydrating' });
    }
    const tokens = await secureStorage.readTokens();

    if (!tokens) {
      set({ status: 'signed_out', user: null, isSubmitting: false });
      return;
    }

    try {
      // The server answers 428 to anything from an install it does not know,
      // so the device is (re-)registered before the first real call.
      await registerDevice(tokens);
      const user = await userApi.me();
      set({ status: 'authenticated', user, error: null, isSubmitting: false });
      useCoinsStore.getState().hydrateFromServer();
    } catch (error) {
      const apiError = toApiError(error);
      logger.warn('authStore', `Session restore failed: ${apiError.code ?? apiError.kind}`, apiError);

      // Only a rejection ends the session. The server saying "no" — the
      // refresh token revoked, the device limit hit, the account gone — means
      // the tokens are worthless and should go. The server saying nothing —
      // no connection, a timeout, a 5xx — means nothing about the session,
      // and throwing the tokens away would sign a user out for being on a
      // train. That case gets a retry screen instead.
      const rejected =
        apiError.kind === 'unauthorized' ||
        apiError.kind === 'forbidden' ||
        apiError.kind === 'not_found';
      if (rejected) {
        await secureStorage.clearTokens();
        set({
          status: 'signed_out',
          user: null,
          error: null,
          isSubmitting: false,
          notice: noticeForRejection(apiError),
        });
        return;
      }
      set({ status: 'unreachable', user: null, error: apiError, isSubmitting: false });
    }
  },

  signIn: async (email, password) => {
    set({ isSubmitting: true, error: null });
    try {
      const { user, tokens } = await authApi.signIn(email, password);
      await secureStorage.saveTokens(tokens);
      const registered = await registerOrExplain(tokens);
      if (registered !== true) {
        set({ error: registered, isSubmitting: false });
        return false;
      }
      set({ status: 'authenticated', user, isSubmitting: false, notice: null });
      useCoinsStore.getState().hydrateFromServer();
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
      const { user, tokens, nextVerification } = await authApi.verifyOtp(
        pending.verificationId,
        code,
      );
      await secureStorage.saveTokens(tokens);
      // The phone code is the one that starts a session; the device is
      // registered against it. The email code that follows only refreshes
      // tokens on a session that already exists.
      if (get().status !== 'authenticated') {
        const registered = await registerOrExplain(tokens);
        if (registered !== true) {
          set({ error: registered, isSubmitting: false });
          return false;
        }
      }
      // The other contact is proven next, on the same screen (BACKEND.md
      // §13.3): the server sends that code the moment the first passes and
      // hands the challenge back here, so it becomes the pending one. Null
      // once both are verified, when that channel cannot deliver yet, or
      // when the user chooses to skip for now.
      set({
        status: 'authenticated',
        user,
        pendingVerification: nextVerification ?? null,
        isSubmitting: false,
      });
      useCoinsStore.getState().hydrateFromServer();
      return true;
    } catch (error) {
      const apiError = toApiError(error);
      // The challenge is kept: a wrong digit should leave the user on the
      // screen with the same code still live, not send them back to the form.
      // A challenge the server has finished with — expired, burned, gone —
      // is different: the screen shows it as expired so the only live
      // control is "send a new code".
      set({
        error: apiError,
        isSubmitting: false,
        pendingVerification: apiError.isOtpChallengeDead
          ? { ...pending, expiresInSeconds: 0 }
          : pending,
      });
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
      const apiError = toApiError(error);
      set({
        error: apiError,
        isSubmitting: false,
        pendingVerification: afterResendFailure(pending, apiError),
        // A sign-up whose challenge is gone has to start over; the screen
        // leaves when the challenge does, and this says why.
        notice:
          apiError.code === 'OTP_NOT_FOUND' && pending.channel !== 'email'
            ? 'That sign-up timed out. Please start again.'
            : get().notice,
      });
      return false;
    }
  },

  cancelVerification: () => {
    set({ pendingVerification: null, error: null });
  },

  /**
   * Asks for a fresh email code when there is no live challenge to resend —
   * the banner on Wallet and Shop uses this after the user skipped the step.
   */
  forgotPassword: async identifier => {
    set({ isSubmitting: true, error: null });
    try {
      const pendingReset = await authApi.forgotPassword(identifier.trim());
      set({ pendingReset, isSubmitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), isSubmitting: false });
      return false;
    }
  },

  resendResetOtp: async () => {
    const pending = get().pendingReset;
    if (!pending) {
      return false;
    }
    set({ isSubmitting: true, error: null });
    try {
      const pendingReset = await authApi.resendOtp(pending.verificationId);
      set({ pendingReset, isSubmitting: false });
      return true;
    } catch (error) {
      const apiError = toApiError(error);
      set({
        error: apiError,
        isSubmitting: false,
        pendingReset: afterResendFailure(pending, apiError),
      });
      return false;
    }
  },

  resetPassword: async (code, password) => {
    const pending = get().pendingReset;
    if (!pending) {
      return false;
    }
    set({ isSubmitting: true, error: null });
    try {
      await authApi.resetPassword(pending.verificationId, code, password);
      set({ pendingReset: null, isSubmitting: false });
      return true;
    } catch (error) {
      const apiError = toApiError(error);
      // The challenge is kept, as with sign-up: a wrong digit should leave
      // the user on the screen with the same code still live. A dead one is
      // shown as expired so the user reaches for a new code, not a new digit.
      set({
        error: apiError,
        isSubmitting: false,
        pendingReset: apiError.isOtpChallengeDead
          ? { ...pending, expiresInSeconds: 0 }
          : pending,
      });
      return false;
    }
  },

  cancelReset: () => {
    set({ pendingReset: null, error: null });
  },

  requestEmailVerification: async () => {
    set({ isSubmitting: true, error: null });
    try {
      const pendingVerification = await authApi.sendEmailOtp();
      set({ pendingVerification, isSubmitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), isSubmitting: false });
      return false;
    }
  },

  completeProfile: async payload => {
    set({ isSubmitting: true, error: null });
    try {
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
      pendingReset: null,
      error: null,
      notice: null,
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
  useAuthStore.setState({
    status: 'signed_out',
    user: null,
    pendingVerification: null,
    notice: 'Your session has expired. Please sign in again.',
  });
});

/**
 * Registers the device after a session starts, and turns the one failure
 * that should stop the sign-in into an error the screen can show.
 *
 * `TOO_MANY_DEVICES` is the server refusing this install outright; carrying
 * on would leave the user with tokens that every request rejects. Anything
 * else — no connection, a 5xx — is not the user's problem to solve here:
 * the client replays with a fresh registration on the next 428, so the
 * sign-in goes ahead.
 */
async function registerOrExplain(tokens: AuthTokens): Promise<true | ApiError> {
  try {
    await registerDevice(tokens);
    return true;
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.code === 'TOO_MANY_DEVICES') {
      await secureStorage.clearTokens();
      return apiError;
    }
    logger.warn('authStore', 'Device registration deferred', apiError);
    return true;
  }
}

/** What the sign-in screen should say after a restore the server refused. */
function noticeForRejection(error: ApiError): string {
  if (error.code === 'TOO_MANY_DEVICES') {
    return error.message;
  }
  return 'Your session has expired. Please sign in again.';
}

/**
 * The challenge to keep after a resend the server refused.
 *
 * A cooldown the server states restarts the resend clock from its figure; a
 * challenge the server has lost is dropped, which is what sends the screen
 * back; anything else leaves the challenge exactly as it was.
 */
function afterResendFailure(
  pending: VerificationChallenge,
  error: ApiError,
): VerificationChallenge | null {
  if (error.code === 'OTP_NOT_FOUND') {
    return null;
  }
  const wait = error.retryAfterSeconds;
  if (wait !== null) {
    return { ...pending, resendInSeconds: wait };
  }
  return pending;
}

/**
 * Granular selectors. Subscribing to the slice you actually use keeps a screen
 * from re-rendering every time an unrelated field changes.
 */
export const useAuthStatus = () => useAuthStore(s => s.status);
export const useCurrentUser = () => useAuthStore(s => s.user);
export const usePendingVerification = () =>
  useAuthStore(s => s.pendingVerification);
export const usePendingReset = () => useAuthStore(s => s.pendingReset);

/** Whether the email step is still owed (D-20): signed in, but the server has not seen the code. */
export const useIsEmailVerified = () =>
  useAuthStore(s => s.user?.emailVerifiedAt != null);

/**
 * A live challenge for a contact detail on an account that is already signed
 * in — the phone after an email sign-up, or the email after a phone one.
 * What routes the app to the verify screen once, and what the banners read.
 */
export const usePendingContactVerification = () =>
  useAuthStore(s =>
    s.status === 'authenticated' ? s.pendingVerification : null,
  );

/** The email one specifically — the banner offers to request it. */
export const usePendingEmailVerification = () =>
  useAuthStore(s =>
    s.status === 'authenticated' && s.pendingVerification?.channel === 'email'
      ? s.pendingVerification
      : null,
  );

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
