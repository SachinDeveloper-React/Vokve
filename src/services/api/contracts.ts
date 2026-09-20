import type {
  Address,
  Cart,
  CheckoutResult,
  PurchaseLine,
  Quote,
  Review,
  ReviewPage,
  ShopConfig,
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
  ShopCategorySummary,
  ShopItem,
  ShopSort,
  User,
  VerificationChallenge,
  Wallet,
  Workout,
  WorkoutTemplate,
} from '../../types/models';
import type { DeviceProfile } from '../device';
import type { CompleteProfilePayload, SignUpPayload } from '../../types/forms';

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
  resetPassword(
    verificationId: string,
    code: string,
    password: string,
  ): Promise<{ ok: boolean }>;
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
  register(
    profile: DeviceProfile,
    refreshToken: string | null,
  ): Promise<DeviceRegistration>;
  /**
   * The device's push token, as FCM hands it out — `null` withdraws it
   * (permission revoked, signing out). Where a push for this user is
   * actually sent to.
   */
  setPushToken(
    deviceId: string,
    pushToken: string | null,
  ): Promise<{ ok: boolean }>;
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

/**
 * How the catalogue may be narrowed and ordered — one shape for the shelf,
 * a category page, the deals page and search, because the server answers
 * all four from one list (`GET /shop/items`).
 */
export interface ShopItemsQuery {
  category?: ShopCategory;
  subcategory?: string;
  deals?: boolean;
  featured?: boolean;
  /** Free text over title, description, tags and subcategory; a prefix matches. */
  q?: string;
  sort?: ShopSort;
  /** Only what can be bought right now. */
  inStock?: boolean;
  /** Paise, inclusive. */
  minPrice?: number;
  maxPrice?: number;
  /** 1–5: items rated at least this. */
  minRating?: number;
  cursor?: string;
  /** Rows per page. The server caps it at 100 and defaults to 20. */
  limit?: number;
}

/** A catalogue page: the rows, the cursor for the next, and how many the whole query holds. */
export interface CataloguePage extends Page<ShopItem> {
  total: number;
}

export type ReviewSort = 'recent' | 'top';

export interface ReviewsQuery {
  sort?: ReviewSort;
  cursor?: string;
  limit?: number;
}

/** What the review form collects (RULES R15). */
export interface ReviewInput {
  rating: number;
  title?: string | null;
  body: string;
}

export interface ShopApi {
  items(query?: ShopItemsQuery): Promise<CataloguePage>;
  item(id: string): Promise<ShopItem>;
  /** What each shelf holds: counts, in-stock counts, subcategories. */
  categories(): Promise<ShopCategorySummary[]>;
  /** The till's rules — coin value, coin share, shipping — so prices are drawn the way they are charged. */
  config(): Promise<ShopConfig>;
  reviews(itemId: string, query?: ReviewsQuery): Promise<ReviewPage>;
  /** Creates or replaces the reader's own review of the item. */
  writeReview(itemId: string, input: ReviewInput): Promise<Review>;
  deleteReview(itemId: string): Promise<{ ok: boolean }>;
}

export interface WishlistApi {
  /** The saved items, newest save first, with stock and price as they are now. */
  list(): Promise<ShopItem[]>;
  ids(): Promise<string[]>;
  add(itemId: string): Promise<{ ok: boolean }>;
  remove(itemId: string): Promise<{ ok: boolean }>;
}

export interface CartApi {
  get(): Promise<Cart>;
  /** Sets a line's quantity — add, change, or remove at zero — and answers with the whole basket. */
  setLine(line: {
    itemId: string;
    quantity: number;
    size?: string | null;
  }): Promise<Cart>;
  removeLine(itemId: string, size?: string | null): Promise<Cart>;
  clear(): Promise<Cart>;
}

export interface CheckoutPayload {
  /** The lines to buy, or `fromCart` for the basket. */
  lines?: PurchaseLine[];
  fromCart?: boolean;
  addressId: string;
  /** The coins to put towards it; the quote said how many may. */
  coins: number;
  /** The step-up proof, when the server asked for one. */
  stepUpToken?: string;
}

export interface IdempotentOptions {
  /**
   * Sent as `Idempotency-Key` (BACKEND.md §3.6): the same key on a retry
   * replays the same order rather than placing a second one. One key per
   * attempt the user makes; a retry of that attempt reuses it.
   */
  idempotencyKey: string;
}

/** Kept under its old name for the stores that only cancel. */
export type RedeemOptions = IdempotentOptions;

/** What the gateway handed back once the user paid. */
export interface PaymentProof {
  providerPaymentId: string;
  signature?: string;
}

export interface CheckoutApi {
  /** The till's arithmetic for some lines, with nothing placed. */
  quote(lines: PurchaseLine[], coins: number | 'max'): Promise<Quote>;
  /**
   * Places the order (RULES R2–R4, R11–R13). The errors a screen branches
   * on: `STEP_UP_REQUIRED` (403), `ADDRESS_REQUIRED` (422),
   * `COINS_OVER_LIMIT` (422, `details.coinsMax`), `INSUFFICIENT_COINS`
   * (422), `OUT_OF_STOCK` (409), `SIZE_REQUIRED` / `QUANTITY_LIMIT` (422),
   * `CART_EMPTY` (422).
   */
  place(
    payload: CheckoutPayload,
    options: IdempotentOptions,
  ): Promise<CheckoutResult>;
  /** Hands the server the gateway's proof; `PAYMENT_EXPIRED` / `ORDER_NOT_PENDING` (409) when too late. */
  pay(
    orderId: string,
    proof: PaymentProof,
    options: IdempotentOptions,
  ): Promise<{ order: Order; balance: number }>;
}

export interface OrderApi {
  list(cursor?: string): Promise<Page<Order>>;
  get(id: string): Promise<Order>;
  /** How many orders the shop's header counts (RULES R7). */
  count(): Promise<number>;
  /** Idempotent: a second cancel returns the cancelled order unchanged. */
  cancel(
    id: string,
    options: IdempotentOptions,
  ): Promise<{ order: Order; balance: number }>;
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
