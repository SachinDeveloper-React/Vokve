import { create } from 'zustand';
import {
  flushEvents,
  setAnalyticsIdentity,
  track,
} from '../services/analytics';
import { authApi, userApi } from '../services/api/endpoints';
import { setOnSessionExpired } from '../services/api/client';
import { ApiError, toApiError } from '../services/api/errors';
import { setErrorIdentity } from '../services/errorReporting';
import { secureStorage } from '../services/secureStorage';
import { registerDevice } from '../services/device';
import { cancelHydrationReminders } from '../services/notifications';
import { registerForPush, unregisterFromPush } from '../services/push';
import {
  flushStepsForSignOut,
  stopStepsForSignOut,
  stopStepsWhenSignedOut,
} from '../services/steps';
import { clearServerReads } from '../hooks/useServerRead';
import { useAccountStore } from './accountStore';
import { useAddressesStore } from './addressesStore';
import { useCartStore } from './cartStore';
import { useCheckoutStore } from './checkoutStore';
import { useCoinsStore } from './coinsStore';
import { useNotificationSettingsStore } from './notificationSettingsStore';
import { useNotificationsStore } from './notificationsStore';
import { useOrdersStore } from './ordersStore';
import { useReferralStore } from './referralStore';
import { useSettingsStore } from './settingsStore';
import { useStreakStore } from './streakStore';
import { useHydrationStore } from './hydrationStore';
import { useRemindersStore } from './remindersStore';
import { useNutritionStore } from './nutritionStore';
import { useVitalsStore } from './vitalsStore';
import { useWishlistStore } from './wishlistStore';
import type { AuthTokens, User, VerificationChallenge } from '../types/models';
import type { CompleteProfilePayload, SignUpPayload } from '../types/forms';
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
  /**
   * The proof that a step-up code just passed (RULES O8), waiting for the
   * one action that asked for it. Taken with `takeStepUpToken` so it is used
   * once; cleared on sign-out. Never persisted — ten minutes is its life.
   */
  stepUpToken: string | null;
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
  /**
   * Saves a profile edit (`PATCH /me`). Throws the `ApiError` rather than
   * swallowing it into `error`: the edit form puts the server's field
   * messages on its own fields, which a flat store error cannot do.
   */
  updateProfile: (patch: Partial<User>) => Promise<User>;
  /**
   * Re-reads the signed-in member from the server (`GET /me`).
   *
   * The session's copy of the user is taken at launch and then only replaced
   * by the writes this app makes — but the server moves it too: a weight
   * logged on the health screen becomes the profile's weight (RULES V4), and
   * another phone can save a profile edit. Any screen that *shows the
   * member's own figures back to them* asks for them again rather than
   * trusting that snapshot. Silent: a screen that already has something to
   * show must not be emptied because the network was busy.
   */
  refreshUser: () => Promise<User | null>;
  /**
   * Replaces the profile photo, or drops it when passed null (RULES P10).
   * Throws the `ApiError` so the picker can word a refusal — a photo too
   * large is something the member can act on.
   */
  setAvatar: (
    image: {
      data: string;
      contentType: 'image/jpeg' | 'image/png' | 'image/webp';
    } | null,
  ) => Promise<User>;
  /** True while a photo is being uploaded or removed. */
  isSavingAvatar: boolean;
  /** Abandons the pending sign-up — going back from the OTP screen. */
  cancelVerification: () => void;
  /**
   * Parks a challenge another screen asked for — a contact change — so the
   * root navigator opens the OTP screen over it and the code lands in the
   * one place that knows how to take codes.
   */
  setPendingVerification: (challenge: VerificationChallenge) => void;
  /** Sends a new email code and makes it the pending challenge. */
  requestEmailVerification: () => Promise<boolean>;
  /**
   * Asks for a second factor before a sensitive action. The challenge
   * becomes the pending one, so the root navigator opens the OTP screen;
   * when the code passes, `stepUpToken` is set and the screen closes.
   */
  requestStepUp: () => Promise<boolean>;
  /** Hands over the token and forgets it — one action, once. */
  takeStepUpToken: () => string | null;
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
  stepUpToken: null,
  isSavingAvatar: false,
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
      // A service outlives the app that started it, so a phone signed out
      // before this fix shipped — or by anything that cleared the tokens
      // without going through `endSession` — can still be counting. Asking
      // costs one native call on a launch that has nothing else to do.
      await stopStepsWhenSignedOut().catch(() => {});
      return;
    }

    try {
      // The server answers 428 to anything from an install it does not know,
      // so the device is (re-)registered before the first real call.
      await registerDevice(tokens);
      const user = await userApi.me();
      set({ status: 'authenticated', user, error: null, isSubmitting: false });
      hydrateUserCaches();
    } catch (error) {
      const apiError = toApiError(error);
      logger.warn(
        'authStore',
        `Session restore failed: ${apiError.code ?? apiError.kind}`,
        apiError,
      );

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
        // The same ending as the button: tokens gone, counting stopped,
        // caches emptied. Before this it only cleared the tokens, which left
        // the service counting for an account the phone is no longer in.
        await endSession(noticeForRejection(apiError));
        set({ isSubmitting: false });
        return;
      }
      set({
        status: 'unreachable',
        user: null,
        error: apiError,
        isSubmitting: false,
      });
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
      hydrateUserCaches();
      track('sign_in', { method: 'password' });
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
      const { user, tokens, nextVerification, stepUpToken } =
        await authApi.verifyOtp(pending.verificationId, code);
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
        // Only a step-up code carries one; every other code leaves what was
        // there alone, so a token taken earlier is not wiped by an unrelated
        // verification in between.
        stepUpToken: stepUpToken ?? get().stepUpToken,
        isSubmitting: false,
      });
      hydrateUserCaches();
      track('otp_verified', { channel: pending.channel });
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

  setPendingVerification: challenge => {
    set({ pendingVerification: challenge, error: null });
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

  requestStepUp: async () => {
    set({ isSubmitting: true, error: null, stepUpToken: null });
    try {
      const pendingVerification = await authApi.stepUp();
      set({ pendingVerification, isSubmitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), isSubmitting: false });
      return false;
    }
  },

  takeStepUpToken: () => {
    const token = get().stepUpToken;
    if (token !== null) {
      set({ stepUpToken: null });
    }
    return token;
  },

  setAvatar: async image => {
    set({ isSavingAvatar: true });
    try {
      const user = image
        ? await userApi.uploadAvatar(image)
        : await userApi.removeAvatar();
      set({ user, isSavingAvatar: false });
      return user;
    } catch (error) {
      set({ isSavingAvatar: false });
      throw toApiError(error);
    }
  },

  refreshUser: async () => {
    // No session, nothing to read: the splash is what asks in that case.
    if (!get().user) return null;
    try {
      const user = await userApi.me();
      // An answer that is not a user is not a reason to forget who is signed
      // in: the screens reading `user` would blank out mid-session.
      if (!user) return null;
      set({ user });
      return user;
    } catch (error) {
      logger.warn(
        'authStore',
        `Profile refresh failed: ${toApiError(error).code ?? 'unknown'}`,
      );
      return null;
    }
  },

  updateProfile: async patch => {
    set({ isSubmitting: true, error: null });
    try {
      const user = await userApi.updateProfile(patch);
      set({ user, isSubmitting: false });
      return user;
    } catch (error) {
      set({ isSubmitting: false });
      throw toApiError(error);
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
    // What they did goes up first, while this session can still be used to
    // send it: afterwards the tokens are gone and the batch would be refused.
    track('sign_out');
    await flushEvents();
    // And what they walked, for the same reason and a worse consequence
    // (D-56): counting stops here, so the stretch between the last sync and
    // now is the account's and nothing else will ever send it. Signing in on
    // another phone would otherwise show a day with this phone's tail
    // missing. Bounded inside, so a slow network cannot hold the user here —
    // and caught out here, because no failure to send steps is a reason to
    // refuse somebody the sign-out they asked for.
    await flushStepsForSignOut().catch(error => {
      logger.warn('authStore', 'Could not send this phone’s steps on sign-out', error);
    });
    // Tell the server if we can, but never block the user from leaving. The
    // push token goes first, while the session can still say whose it was.
    try {
      await unregisterFromPush();
      await authApi.signOut();
    } catch (error) {
      logger.warn(
        'authStore',
        'Server sign-out failed, clearing locally',
        error,
      );
    }
    await endSession(null);
  },

  clearError: () => {
    if (get().error) {
      set({ error: null });
    }
  },
}));

/**
 * Everything the app shows about the signed-in user is a cache of the
 * server's, filled the moment a session exists — on launch, sign-in and
 * verification alike, so no path forgets one. Each sync resolves on its own
 * and records its own failure; none of them holds up the others.
 */
function hydrateUserCaches(): void {
  // The trail is attributed before anything else is fetched, so the events
  // those fetches cause belong to the member who caused them. The privacy
  // switches come with them, since one of them decides whether there is a
  // trail at all (RULES P7).
  setAnalyticsIdentity(useAuthStore.getState().user?.id ?? null);
  // And whose faults they are (RULES P17). Not part of the trail: this one
  // is set whatever the privacy switches say, because a crash is the record
  // of the app failing them rather than of what they were interested in.
  setErrorIdentity(useAuthStore.getState().user?.id ?? null);
  useAccountStore.getState().loadPrivacy();
  useCoinsStore.getState().hydrateFromServer();
  useNotificationsStore.getState().hydrateFromServer();
  useNotificationSettingsStore.getState().hydrateFromServer();
  registerForPush();
  useOrdersStore.getState().hydrateFromServer();
  useAddressesStore.getState().hydrateFromServer();
  useCartStore.getState().hydrateFromServer();
  useWishlistStore.getState().hydrateFromServer();
  useAccountStore.getState().hydrateFromServer();
  useSettingsStore.getState().hydrateFromServer();
  useStreakStore.getState().hydrateFromServer();
  useHydrationStore.getState().hydrateFromServer();
  useRemindersStore.getState().hydrateFromServer();
  useNutritionStore.getState().hydrateFromServer();
  useVitalsStore.getState().hydrateFromServer();
}

/** The caches above, emptied: what the next user must not see of this one. */
function resetUserCaches(): void {
  // Nothing more is attributed to the member who left, and what they did
  // has already been sent (see `signOut`).
  setAnalyticsIdentity(null);
  setErrorIdentity(null);
  useCoinsStore.getState().reset();
  useNotificationsStore.getState().reset();
  useOrdersStore.getState().reset();
  useAddressesStore.getState().reset();
  useCartStore.getState().reset();
  useWishlistStore.getState().reset();
  useAccountStore.getState().reset();
  useCheckoutStore.getState().reset();
  useReferralStore.getState().reset();
  useNotificationSettingsStore.getState().reset();
  useSettingsStore.getState().reset();
  useStreakStore.getState().reset();
  useHydrationStore.getState().reset();
  useRemindersStore.getState().reset();
  useNutritionStore.getState().reset();
  useVitalsStore.getState().reset();
  clearServerReads();
}

// When a refresh fails mid-session the API layer cannot import this store
// without creating a cycle, so it calls back through this handler instead.
setOnSessionExpired(() => {
  // Every request in flight can land here at once, and the ending is
  // asynchronous: without this guard the second one re-runs it while the
  // first is still stopping the service.
  if (useAuthStore.getState().status === 'signed_out') {
    return;
  }
  // Nothing awaits this: the handler is called from the API layer's error
  // path, which has its own error to throw.
  endSession('Your session has expired. Please sign in again.').catch(error => {
    logger.warn('authStore', 'Ending an expired session did not finish', error);
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
/**
 * Everything that has to happen when a session ends, whoever ended it.
 *
 * There are three ways out — the user pressing Sign out, the server
 * rejecting the stored session on launch, and a refresh failing
 * mid-session — and they used to end it three different ways. Only the
 * first stopped counting, so an automatic sign-out left the foreground
 * service running: the app showed the sign-in screen while the notification
 * went on counting steps for nobody, and the next person to sign in
 * inherited the last one's cached wallet and feed until the fetches landed.
 *
 * So the ending is one function, and every path calls it. Local work only:
 * the server is told by whoever can still talk to it (see `signOut`), and on
 * the automatic paths every request is already being refused.
 */
async function endSession(notice: string | null): Promise<void> {
  // The state goes first, and synchronously. Every request in flight can
  // land on the expiry handler at once, and a guard that waited for the work
  // below would let all of them through — three sign-outs racing to stop one
  // service. It is also what the user should see straight away: the sign-in
  // screen, rather than a held screen while a foreground service is asked to
  // stop.
  useAuthStore.setState({
    status: 'signed_out',
    user: null,
    pendingVerification: null,
    pendingReset: null,
    stepUpToken: null,
    error: null,
    notice,
  });
  // Nothing may use this session again, whatever happens below.
  await secureStorage.clearTokens();
  // Nobody is left to count for, and a notification that says otherwise is
  // untrue. Never throws: counting that would not stop is not a reason to
  // keep somebody signed in.
  await stopStepsForSignOut().catch(error => {
    logger.warn('authStore', 'Could not stop counting while ending the session', error);
  });
  // The alarms this phone holds are the account's own reminders. Local, so
  // this works on the automatic paths too — and an app left holding them
  // would go on waking the next person on this phone at seven.
  await cancelHydrationReminders().catch(() => {});
  // The caches are this user's: the next sign-in hydrates its own, but until
  // it does the wallet and the feed must not show the last user's.
  resetUserCaches();
}

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

/** The step-up proof, for the screen waiting to spend it. */
export const useStepUpToken = () => useAuthStore(s => s.stepUpToken);

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
