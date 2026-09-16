import type {
  Address,
  AppNotification,
  AuthResponse,
  CoinSource,
  CoinTransaction,
  DailyActivity,
  DeviceRegistration,
  EarnRule,
  NotificationCategory,
  NotificationCountsSummary,
  NotificationPreferences,
  Order,
  Referral,
  ReferralProgram,
  ShopCategory,
  ShopItem,
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
  /**
   * Asks for a second factor before one sensitive action (RULES O8). The
   * code goes to the verified email; `verifyOtp` on it answers with a
   * `stepUpToken` the sensitive endpoint then takes.
   */
  stepUp(): Promise<VerificationChallenge>;
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
  /**
   * The device's push token, as FCM hands it out — `null` withdraws it
   * (permission revoked, signing out). Where a push for this user is
   * actually sent to.
   */
  setPushToken(deviceId: string, pushToken: string | null): Promise<{ ok: boolean }>;
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

export interface NotificationQuery {
  cursor?: string;
  /** Rows per page. The server caps it at 100 and defaults to 20. */
  limit?: number;
  /** Only rows filed under this chip. */
  category?: NotificationCategory;
}

export interface NotificationApi {
  list(query?: NotificationQuery): Promise<Page<AppNotification>>;
  /** Totals per chip plus unread — the server's, so a paged feed still counts right. */
  counts(): Promise<NotificationCountsSummary>;
  /**
   * Both are idempotent on the server — a row already read, or one that has
   * gone, still answers ok — so the store can fire them after its own
   * optimistic update without a reconciliation step.
   */
  markRead(id: string): Promise<{ ok: boolean }>;
  markAllRead(): Promise<{ ok: boolean }>;
}

export interface ShopItemsQuery {
  category?: ShopCategory;
  deals?: boolean;
}

export interface RedeemPayload {
  itemId: string;
  quantity?: number;
  addressId: string;
  /** The step-up proof, when the server asked for one. */
  stepUpToken?: string;
}

export interface RedeemOptions {
  /**
   * Sent as `Idempotency-Key` (BACKEND.md §3.6): the same key on a retry
   * replays the same order rather than placing a second one. One key per
   * attempt the user makes; a retry of that attempt reuses it.
   */
  idempotencyKey: string;
}

export interface ShopApi {
  items(query?: ShopItemsQuery): Promise<ShopItem[]>;
  item(id: string): Promise<ShopItem>;
  /**
   * Spends coins on a reward (RULES R2–R4). The errors a screen branches on:
   * `STEP_UP_REQUIRED` (403), `ADDRESS_REQUIRED` (422), `INSUFFICIENT_COINS`
   * (422, `details.required` / `details.balance`), `OUT_OF_STOCK` (409).
   */
  redeem(payload: RedeemPayload, options: RedeemOptions): Promise<{ order: Order; balance: number }>;
}

export interface OrderApi {
  list(cursor?: string): Promise<Page<Order>>;
  get(id: string): Promise<Order>;
  /** How many orders the shop's header counts (RULES R7). */
  count(): Promise<number>;
  /** Idempotent: a second cancel returns the cancelled order unchanged. */
  cancel(id: string, options: RedeemOptions): Promise<{ order: Order; balance: number }>;
}

/** Everything but the id — what the form collects. */
export type AddressInput = Omit<Address, 'id'>;

export interface AddressApi {
  list(): Promise<Address[]>;
  create(input: AddressInput): Promise<Address>;
  update(id: string, patch: Partial<AddressInput>): Promise<Address>;
  setDefault(id: string): Promise<Address>;
  remove(id: string): Promise<{ ok: boolean }>;
}

export interface ReferralApi {
  /** Everything the Referral & Earn screen shows, in one call (RULES F6). */
  me(): Promise<ReferralProgram>;
  list(cursor?: string): Promise<Page<Referral>>;
  /**
   * Applies a friend's code (RULES F2) and answers with the refreshed
   * programme. The errors the claim card words: `REFERRAL_CODE_INVALID`
   * (404), `REFERRAL_SELF` (422), `REFERRAL_ALREADY_APPLIED` (409),
   * `REFERRAL_WINDOW_CLOSED` (422).
   */
  apply(code: string): Promise<ReferralProgram>;
}

/** A partial write: only the switches that changed travel (BACKEND §5). */
export type NotificationPreferencesPatch = {
  categories?: Partial<NotificationPreferences['categories']>;
  quietHours?: Partial<NotificationPreferences['quietHours']>;
  sms?: boolean;
  email?: boolean;
};

export interface NotificationPreferencesApi {
  get(): Promise<NotificationPreferences>;
  /** Merges the patch and answers with the whole record as the server now holds it. */
  update(patch: NotificationPreferencesPatch): Promise<NotificationPreferences>;
}
