import { create } from 'zustand';
import {
  flushEvents,
  setAnalyticsIdentity,
  track,
} from '../services/analytics';
import { accountApi, authApi, userApi } from '../services/api/endpoints';
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
import { useOnboardingStore } from './onboardingStore';
import { useOrdersStore } from './ordersStore';
import { useReferralStore } from './referralStore';
import { useSettingsStore } from './settingsStore';
import { useStreakStore } from './streakStore';
import { useHydrationStore } from './hydrationStore';
import { useRemindersStore } from './remindersStore';
import { useNutritionStore } from './nutritionStore';
import { useVitalsStore } from './vitalsStore';
import { useWishlistStore } from './wishlistStore';
import {
  signInProviderSchema,
  type AuthResponse,
  type AuthTokens,
  type SignInProvider,
  type User,
  type VerificationChallenge,
} from '../types/models';
import type { CompleteProfilePayload, SignUpPayload } from '../types/forms';
import { logger } from '../utils/logger';
import {
  forgetGoogleSession,
  signInWithGoogle as googleSignIn,
} from '../services/googleSignIn';
import { signInWithApple as appleSignIn } from '../services/appleSignIn';
import { signInWithFacebook as facebookSignIn } from '../services/facebookSignIn';
import { forgetAppleUser, rememberAppleUser } from '../services/appleCredential';

/**
 * `unreachable` is a session that exists, could not be confirmed, and has
 * nothing to show for itself — the tokens are there, the server was not, and
 * there is no stored snapshot of the member to draw the app around (see
 * `isSessionUnconfirmed`). It is neither signed in nor signed out, and the
 * root navigator gives it a retry screen rather than either stack.
 */
export type AuthStatus =
  | 'idle'
  | 'hydrating'
  | 'authenticated'
  | 'unreachable'
  | 'signed_out';

/**
 * A Google, Apple or Facebook identity the server found no account for (RULES O15),
 * held while the member says what it belongs to.
 *
 * `choose` is the sheet asking "new account, or one you already have?".
 * `link` is the answer "I already have one": the token waits for the next
 * sign-in to start a session, which then connects the identity to that
 * account — so the relay address Apple handed over never becomes a second,
 * empty account beside the one with the coins in it.
 */
export interface PendingIdentity {
  provider: SignInProvider;
  /** What the provider shared — a relay address, the real one, or nothing. */
  email: string | null;
  /**
   * The masked address of the account that already has this email, when
   * the provider's email is one that does not prove itself (Facebook,
   * RULES O18). Set means "sign in to it once", not "new to VOKVE?".
   */
  existingAccount?: string | null;
  /**
   * How that account signs in (`google`, `apple`, `password`…), so the
   * sheet can say "Continue with Google" — the one button that opens it.
   */
  existingMethods?: Array<'password' | SignInProvider>;
  linkToken: string;
  /** Epoch ms after which the server will refuse the token. */
  expiresAt: number;
  stage: 'choose' | 'link';
  /**
   * Apple's id for the member, from the sheet that raised this — kept so
   * a session "Create a new account" starts can be checked like any
   * other Apple session (RULES O16). Null for Google, and on Android.
   */
  appleUser?: string | null;
}

/** How connecting a pending identity went, for one toast once the app is open. */
export interface IdentityLinkOutcome {
  tone: 'success' | 'error';
  title: string;
  message: string;
}

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
  /**
   * The session on screen was restored from the stored snapshot rather than
   * confirmed by the server: the member is in the app, on their own figures,
   * with the network down. `useSessionRecovery` asks again as soon as the
   * phone can, and that answer either confirms the session or ends it.
   */
  isSessionUnconfirmed: boolean;
  /** Set while a sign-in / sign-up / verification request is in flight. */
  isSubmitting: boolean;
  error: ApiError | null;
  /**
   * A one-line explanation for the sign-in screen: why the user is looking
   * at it when they did not ask to — the session expired, the reset went
   * through, the sign-up code ran out. Cleared when the user dismisses it.
   */
  notice: string | null;
  pendingIdentity: PendingIdentity | null;
  identityLinkOutcome: IdentityLinkOutcome | null;

  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  /**
   * Signs in with Google (RULES O12). Answers `false` on a cancel exactly
   * as it does on a failure — the screen has nothing to do either way —
   * but leaves `error` null for a cancel, so nothing red appears in
   * front of somebody who simply changed their mind.
   */
  signInWithGoogle: () => Promise<boolean>;
  /**
   * Signs in with Apple (RULES O13) — natively on iOS, through Apple's web
   * flow on Android. Answers exactly as `signInWithGoogle` does, cancel
   * included.
   */
  signInWithApple: () => Promise<boolean>;
  /**
   * Signs in with Facebook (RULES O18), Android and iPhone. Answers exactly as
   * `signInWithGoogle` does. Facebook's email never finds an existing
   * account, so a member who already has one is asked, and says so.
   */
  signInWithFacebook: () => Promise<boolean>;
  /**
   * "Create a new account" for the pending identity: the server makes it
   * from the link token and signs in, as a plain provider sign-in would
   * have before RULES O15.
   */
  createAccountFromIdentity: () => Promise<boolean>;
  /**
   * "I already have an account": keeps the identity until the member signs
   * in another way, and connects it to that account then.
   */
  keepIdentityForExistingAccount: () => void;
  /** Drops the pending identity — the sheet closed, or the banner was dismissed. */
  dismissPendingIdentity: () => void;
  clearIdentityLinkOutcome: () => void;
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
  /**
   * Ends the session. `notice` is the line the sign-in screen opens with
   * when the app, not the member, decided — Apple revoked, say.
   */
  signOut: (notice?: string) => Promise<void>;
  clearError: () => void;
}

/**
 * Session state is deliberately *not* persisted through MMKV — the tokens
 * live in the Keychain and the user object is re-fetched on launch.
 * Persisting a `user` to plain-text storage would leak profile data.
 *
 * The user *is* remembered, in the Keychain beside the tokens, and only as
 * the launch fallback: a phone with no network cannot be told who is signed
 * in, and an app that answers that with a retry screen has thrown away a
 * day's steps it is holding on disk. Nothing reads the snapshot while the
 * server can be reached, it is replaced on every confirmation, and it goes
 * the moment a session ends — so it cannot outlive a revoked one by longer
 * than it takes the phone to get a connection.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,
  pendingVerification: null,
  pendingReset: null,
  stepUpToken: null,
  isSessionUnconfirmed: false,
  isSavingAvatar: false,
  isSubmitting: false,
  error: null,
  notice: null,
  pendingIdentity: null,
  identityLinkOutcome: null,

  setNotice: notice => set({ notice }),

  hydrate: async () => {
    // A launch shows the splash; anything else already has something on
    // screen that the splash would replace — the connection screen the user
    // is pressing a button on, or the whole app, when a session restored
    // from the snapshot is being confirmed. Those show their progress
    // through `isSubmitting` instead.
    const resumed =
      get().status === 'unreachable' || get().status === 'authenticated';
    if (resumed) {
      set({ isSubmitting: true, error: null });
    } else {
      set({ status: 'hydrating' });
    }
    const tokens = await secureStorage.readTokens();

    if (!tokens) {
      set({
        status: 'signed_out',
        user: null,
        isSessionUnconfirmed: false,
        isSubmitting: false,
      });
      // No session, so nothing to remember about it. `endSession` forgets
      // the snapshot itself; this is for the tokens that went without it —
      // cleared by a shape change, or by a build from before they were kept
      // together.
      await secureStorage.clearUser();
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
      set({
        status: 'authenticated',
        user,
        isSessionUnconfirmed: false,
        error: null,
        isSubmitting: false,
      });
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
      // train. That case keeps the session and shows what the phone already
      // has (below), or a retry screen when there is nothing to show.
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

      // Nothing was refused, so the session stands — and if the member can
      // be drawn from the snapshot, the app opens on them. Everything the
      // step screens show is already on this phone: what the tracker has
      // counted today, the days waiting in the sync queue, and the server's
      // last answers in the read cache, each dated by `StaleFigures`. A
      // retry screen in front of all of that is the app refusing to show a
      // walk it is holding, which is the one thing it must never do.
      const restored = await restorableSession();
      if (restored) {
        set({
          status: 'authenticated',
          user: restored,
          isSessionUnconfirmed: true,
          error: null,
          isSubmitting: false,
        });
        logger.info(
          'authStore',
          'Session restored from the stored snapshot; the server will be asked again',
        );
        // The same caches as a confirmed session: each read fails back onto
        // its own stored copy, and the figures are the ones that were there
        // when the network went. The identities go with them, so a fault
        // offline still arrives with an owner.
        hydrateUserCaches();
        return;
      }

      set({
        status: 'unreachable',
        user: null,
        isSessionUnconfirmed: false,
        error: apiError,
        isSubmitting: false,
      });
    }
  },

  signInWithGoogle: async () => {
    set({ isSubmitting: true, error: null });
    const outcome = await googleSignIn();
    // The token goes up untouched. Nothing read out of it here would be a
    // fact anybody had checked.
    // `ask`: an identity with no account comes back as a choice rather
    // than a second account (RULES O15).
    return finishProviderSignIn(set, 'google', outcome, signedIn =>
      authApi.google(signedIn.idToken, 'ask'),
    );
  },

  signInWithApple: async () => {
    set({ isSubmitting: true, error: null });
    const outcome = await appleSignIn();
    // The token and the nonce it was minted for, untouched; the name only
    // exists on the first sign-in, and is lost if it is not sent now.
    const signedIn = await finishProviderSignIn(set, 'apple', outcome, apple =>
      authApi.apple({
        idToken: apple.idToken,
        nonce: apple.nonce,
        fullName: apple.fullName,
        ifNew: 'ask',
      }),
    );
    if (outcome.kind === 'signed_in') {
      if (signedIn) {
        // This session is Apple's, so Apple withdrawing it ends it (O16).
        rememberAppleUser(outcome.appleUser);
      } else if (get().pendingIdentity?.provider === 'apple') {
        set({ pendingIdentity: { ...get().pendingIdentity!, appleUser: outcome.appleUser } });
      }
    }
    return signedIn;
  },

  signInWithFacebook: async () => {
    set({ isSubmitting: true, error: null });
    const outcome = await facebookSignIn();
    // The proof goes up untouched — Android's access token or iOS's
    // Limited Login token — and the server works out whose it is. `ask`,
    // as for Google: no account means a choice (O15).
    return finishProviderSignIn(set, 'facebook', outcome, signedIn =>
      authApi.facebook(signedIn.proof, 'ask'),
    );
  },

  createAccountFromIdentity: async () => {
    const pending = get().pendingIdentity;
    if (!pending) {
      return false;
    }
    set({ isSubmitting: true, error: null });
    try {
      const response = await authApi.createFromIdentity(pending.linkToken);
      set({ pendingIdentity: null });
      const started = await startProviderSession(set, pending.provider, response);
      if (started && pending.provider === 'apple') {
        rememberAppleUser(pending.appleUser ?? null);
      }
      return started;
    } catch (error) {
      // An expired token is the likely one: the sheet closes and the
      // refusal says to press the button again.
      set({ error: toApiError(error), isSubmitting: false, pendingIdentity: null });
      return false;
    }
  },

  keepIdentityForExistingAccount: () => {
    const pending = get().pendingIdentity;
    if (pending) {
      set({ pendingIdentity: { ...pending, stage: 'link' }, error: null });
    }
  },

  dismissPendingIdentity: () => set({ pendingIdentity: null }),

  clearIdentityLinkOutcome: () => set({ identityLinkOutcome: null }),

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
      // Not an Apple session, whatever this phone signed in with last.
      forgetAppleUser();
      connectPendingIdentity();
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
      const startsSession = get().status !== 'authenticated';
      if (startsSession) {
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
      if (startsSession) {
        forgetAppleUser();
        connectPendingIdentity();
      }
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

  signOut: async notice => {
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
    // And the Google session on this phone, or the next person to press
    // the button on a shared handset is signed straight back into the
    // account that just left. Never throws.
    await forgetGoogleSession();
    await endSession(notice ?? null);
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

/**
 * Keeps the Keychain's snapshot of the member in step with the session.
 *
 * Subscribed rather than written at each call site: the user is replaced by
 * seven paths — launch, sign-in, verification, finishing the profile, a
 * profile edit, the avatar and the silent refresh — and the one that forgot
 * to save would be found months later, as somebody's old name on an offline
 * launch. Fire-and-forget: nothing on screen waits for the Keychain.
 *
 * Only writes. Forgetting it belongs to `endSession`, which is the one place
 * a session ends: a `user` going null is not an ending — `unreachable` does
 * it too, and a phone that has just failed to reach the server is the last
 * place that should throw away the member it is holding.
 */
useAuthStore.subscribe((state, previous) => {
  if (state.user === null || state.user === previous.user) {
    return;
  }
  const kept = state.user;
  secureStorage.saveUser(kept).catch(error => {
    logger.warn('authStore', 'The session user was not remembered', error);
  });
});

/**
 * The stored member, when opening the app on them is better than a retry
 * screen — which is to say, when they can actually get anywhere.
 *
 * Two conditions, both about the gates in front of the app. A profile the
 * server never stamped sends them into onboarding, and a phone that has not
 * been through the permission screens stops at the step goal — and both of
 * those end in a request that offline cannot make, so the member would be
 * held in a flow that cannot finish. There the honest answer is the
 * connection screen.
 */
async function restorableSession(): Promise<User | null> {
  const remembered = await secureStorage.readUser();
  if (!remembered || remembered.profileCompletedAt === null) {
    return null;
  }
  const { permissionsDoneFor } = useOnboardingStore.getState();
  return permissionsDoneFor.includes(remembered.id) ? remembered : null;
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
 * The half of a provider sign-in that every provider shares: the
 * provider's sheet has closed, and what it answered is turned into a
 * session — or into nothing at all.
 *
 * A cancel ends quietly. Backing out of the sheet is not a failure, and a
 * message under the button saying so would be the app arguing with a
 * decision the member just made. A failure is wrapped as an `ApiError`
 * because that is what the whole store carries and every form reads;
 * `unauthorized` is the honest kind, since nothing reached the server and
 * the provider would not say who this is.
 */
async function finishProviderSignIn<SignedIn extends { kind: 'signed_in' }>(
  set: (partial: Partial<AuthState>) => void,
  method: SignInProvider,
  outcome: SignedIn | { kind: 'cancelled' } | { kind: 'failed'; message: string },
  exchange: (signedIn: SignedIn) => Promise<AuthResponse>,
): Promise<boolean> {
  if (outcome.kind === 'cancelled') {
    set({ isSubmitting: false });
    return false;
  }
  if (outcome.kind === 'failed') {
    set({
      error: new ApiError('unauthorized', outcome.message, null, null, null),
      isSubmitting: false,
    });
    return false;
  }

  try {
    const response = await exchange(outcome as SignedIn);
    return await startProviderSession(set, method, response);
  } catch (error) {
    const apiError = toApiError(error);
    // No account for this identity yet (RULES O15). Not an error: the
    // sheet asks the member which account it belongs to.
    const pendingIdentity = pendingIdentityFrom(apiError);
    if (pendingIdentity) {
      set({ pendingIdentity, error: null, isSubmitting: false });
      return false;
    }
    set({ error: apiError, isSubmitting: false });
    return false;
  }
}

/** The session a provider (or a link token) answered with, started. */
async function startProviderSession(
  set: (partial: Partial<AuthState>) => void,
  method: SignInProvider,
  { user, tokens }: AuthResponse,
): Promise<boolean> {
  await secureStorage.saveTokens(tokens);
  const registered = await registerOrExplain(tokens);
  if (registered !== true) {
    set({ error: registered, isSubmitting: false });
    return false;
  }
  set({ status: 'authenticated', user, isSubmitting: false, notice: null });
  hydrateUserCaches();
  track('sign_in', { method });
  // An Apple session is remembered by its caller, which has Apple's id.
  forgetAppleUser();
  connectPendingIdentity();
  return true;
}

/** `IDENTITY_NOT_LINKED`'s details, as the identity waiting on a choice. */
function pendingIdentityFrom(error: ApiError): PendingIdentity | null {
  if (error.code !== 'IDENTITY_NOT_LINKED' || !error.details) {
    return null;
  }
  const { provider, email, existingAccount, existingMethods, linkToken, expiresInSeconds } = error.details;
  const known = signInProviderSchema.safeParse(provider);
  if (!known.success || typeof linkToken !== 'string') {
    return null;
  }
  const ttl = typeof expiresInSeconds === 'number' ? expiresInSeconds : 600;
  return {
    provider: known.data,
    email: typeof email === 'string' ? email : null,
    existingAccount: typeof existingAccount === 'string' ? existingAccount : null,
    existingMethods: Array.isArray(existingMethods)
      ? existingMethods.filter(
          (way): way is 'password' | SignInProvider =>
            way === 'password' || signInProviderSchema.safeParse(way).success,
        )
      : [],
    linkToken,
    // A minute short of the server's figure, so the phone gives up first
    // rather than sending a token that dies in flight.
    expiresAt: Date.now() + Math.max(0, ttl - 60) * 1000,
    stage: 'choose',
  };
}

const PROVIDER_NAME: Record<SignInProvider, string> = { google: 'Google', apple: 'Apple', facebook: 'Facebook' };

/**
 * After a sign-in starts a session: connects the identity the member said
 * belongs to an account they already have (RULES O15). Never holds up or
 * undoes the sign-in — the member is in their account either way, and the
 * outcome is one toast. A pending identity still at `choose` is dropped:
 * the member signed in some other way instead of answering.
 */
function connectPendingIdentity(): void {
  const pending = useAuthStore.getState().pendingIdentity;
  if (!pending) {
    return;
  }
  useAuthStore.setState({ pendingIdentity: null });
  if (pending.stage !== 'link') {
    return;
  }
  const name = PROVIDER_NAME[pending.provider];
  const failed = (message: string) =>
    useAuthStore.setState({
      identityLinkOutcome: { tone: 'error', title: `${name} was not connected`, message },
    });
  if (Date.now() > pending.expiresAt) {
    failed(`That ${name} sign-in expired. Connect it from Account → Security.`);
    return;
  }
  accountApi
    .connectIdentity(pending.linkToken)
    .then(() => {
      useAuthStore.setState({
        identityLinkOutcome: {
          tone: 'success',
          title: `${name} connected`,
          message: `Sign in with ${name} now opens this account.`,
        },
      });
      track('identity_linked', { provider: pending.provider });
    })
    .catch(error => failed(toApiError(error).message));
}

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
    pendingIdentity: null,
    identityLinkOutcome: null,
    stepUpToken: null,
    isSessionUnconfirmed: false,
    error: null,
    notice,
  });
  // Nothing may use this session again, whatever happens below — neither
  // the tokens nor the snapshot the app would otherwise open on offline.
  forgetAppleUser();
  await secureStorage.clearTokens();
  await secureStorage.clearUser();
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
export const usePendingIdentity = () => useAuthStore(s => s.pendingIdentity);

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
