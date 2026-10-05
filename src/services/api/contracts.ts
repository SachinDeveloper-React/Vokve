import type {
  Achievement,
  AccountDeletion,
  AccountSession,
  Address,
  AppAbout,
  Cart,
  Challenge,
  CheckoutResult,
  PurchaseLine,
  Quote,
  Review,
  ReviewPage,
  ShopConfig,
  ActivityConfig,
  ActivityGranularity,
  ActivityRange,
  AppNotification,
  AttestationChallenge,
  AuthResponse,
  CoinSource,
  CoinTransaction,
  ContentTip,
  ContentTopic,
  DailyActivity,
  DeviceAttestationResult,
  DietPlanDay,
  DietPlanDaySummary,
  FoodEntry,
  FoodItem,
  DeviceRegistration,
  EarnRule,
  HealthScore,
  HydrationDay,
  HydrationEntry,
  HydrationReminderPlan,
  HydrationStats,
  IngestNonce,
  LeaderboardBoard,
  LeaderboardHistory,
  LeaderboardRules,
  NotificationCategory,
  NotificationCountsSummary,
  NotificationPreferences,
  NutritionDay,
  NutritionDayTotal,
  NutritionGoals,
  NutritionPreferences,
  NutritionProfile,
  Order,
  PrivacySettings,
  ProfileSummary,
  Referral,
  ReferralProgram,
  ShopCategory,
  ShopCategorySummary,
  ShopItem,
  ShopSort,
  StepGoal,
  StepIngestResult,
  StepSourcesReport,
  StreakRestoreResult,
  StreakSummary,
  SupportCategory,
  SupportFaq,
  SupportTicket,
  User,
  UserSettings,
  VerificationChallenge,
  VitalKind,
  VitalReading,
  VitalsLatest,
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
  /** A single-use challenge for the next Keystore key this device makes. */
  attestationChallenge(deviceId: string): Promise<AttestationChallenge>;
  /**
   * Hands over the key the challenge was bound into — its public half and
   * the certificate chain that vouches for it. Every signed step snapshot
   * from this device is checked against it afterwards.
   */
  submitAttestation(
    deviceId: string,
    attestation: DeviceAttestationPayload,
  ): Promise<DeviceAttestationResult>;
}

/**
 * A Keystore key as `attestDevice()` reports it. Written out rather than
 * imported from the step tracker, so the API layer does not depend on the
 * one platform that has it.
 */
export interface DeviceAttestationPayload {
  /** Hex SHA-256 of `publicKey`; every signature names it. */
  keyId: string;
  algorithm: string;
  /** Base64 X.509 SubjectPublicKeyInfo. */
  publicKey: string;
  /** Base64 DER certificates, leaf first. */
  certificateChain: string[];
  /** False when the device refused attestation and made a plain key instead. */
  attested: boolean;
  securityLevel: string;
  /** Epoch ms the key was made. */
  createdAt: number;
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

/** A photo on its way up: the bytes, and what they are (RULES P10). */
export interface AvatarUpload {
  /** Base64, without a `data:` prefix. */
  data: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface UserApi {
  me(): Promise<User>;
  updateProfile(patch: Partial<User>): Promise<User>;
  /**
   * Replaces the profile photo and answers with the whole user, whose
   * `avatarUrl` now points at it. `AVATAR_TOO_LARGE` (413) carries the cap
   * in `details.maxKb`.
   */
  uploadAvatar(input: AvatarUpload): Promise<User>;
  /** Drops the photo; the app goes back to drawing initials. */
  removeAvatar(): Promise<User>;
  /**
   * Finishes onboarding. Separate from `updateProfile` because only this one
   * stamps `profileCompletedAt`, and that stamp is what decides whether the
   * app opens on the onboarding step or on the home screen.
   */
  completeProfile(payload: CompleteProfilePayload): Promise<User>;
}

export interface SettingsApi {
  get(): Promise<UserSettings>;
  /** Only what changed; answers with the whole record as the server keeps it. */
  update(patch: Partial<UserSettings>): Promise<UserSettings>;
}

export interface WorkoutApi {
  templates(): Promise<WorkoutTemplate[]>;
  history(cursor?: string): Promise<Page<Workout>>;
  save(workout: Workout): Promise<Workout>;
}

/**
 * One day of steps, signed on the phone by the attested Keystore key. The
 * server verifies `value` over `signedPayload` and then reads only the
 * parsed payload — the counts, the sources, the minutes and the motion
 * windows are all inside it, so nothing outside the signature is trusted.
 */
export interface SignedSnapshot {
  keyId: string;
  algorithm: string;
  /** Base64 DER ECDSA over the UTF-8 bytes of `signedPayload`. */
  value: string;
  /** The key that signed was attested by the hardware. */
  attested: boolean;
  /** The snapshot as JSON, exactly as it was signed. */
  signedPayload: string;
  /** Hex SHA-256 of `signedPayload` — what a Play Integrity token is bound to. */
  payloadSha256: string;
}

/**
 * Play Integrity for one snapshot, sent once the server asks for it: a
 * token bound to the snapshot's `payloadSha256`, or why Play would not give
 * one — a phone without the Play Store still gets its steps judged.
 */
export type IngestIntegrity =
  | { token: string }
  | { error: string; retryable: boolean };

export interface StepIngestPayload {
  /** The day the snapshot covers, `YYYY-MM-DD` in the phone's zone. */
  date: string;
  snapshot: SignedSnapshot;
  integrity?: IngestIntegrity;
}

export interface ActivityRangeQuery {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  granularity: ActivityGranularity;
}

export interface ActivityApi {
  weekly(): Promise<DailyActivity[]>;
  today(): Promise<DailyActivity>;
  /** Any one day, in the user's zone. */
  day(date: string): Promise<DailyActivity>;
  /** A period's steps at one grain, with its totals (BACKEND.md §6.3). */
  range(query: ActivityRangeQuery): Promise<ActivityRange>;
  /** How the tracker on this phone is set up and when it syncs. */
  config(): Promise<ActivityConfig>;
  /** The step goal, the one suggested and the range (D-55); saved through `SettingsApi.update`. */
  goal(): Promise<StepGoal>;
  /** Where a day's steps came from, and how the server matched them. */
  sources(date: string): Promise<StepSourcesReport>;
  /** The single-use value the next signed snapshot carries. */
  ingestNonce(): Promise<IngestNonce>;
  /**
   * One day's signed snapshot (BACKEND.md §7.3). The errors the sync
   * branches on, both answered before the nonce is spent:
   * `ATTESTATION_REQUIRED` (403) — the server holds no key for this device,
   * so attest and take the snapshot again; `INTEGRITY_REQUIRED` (403,
   * `details.cloudProjectNumber`) — send the same snapshot again with a Play
   * Integrity token. `NONCE_INVALID` (409) means the nonce was spent or ran
   * out: take a new one and a new snapshot.
   */
  ingest(
    payload: StepIngestPayload,
    options: IdempotentOptions,
  ): Promise<StepIngestResult>;
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

/**
 * The account's own surface: who the member is, what they have earned, what
 * they have chosen, and the two things only they can do — take their data
 * out and end the account (RULES P4–P8).
 */
export interface AccountApi {
  /** Everything the account screen draws, in one call. */
  profile(): Promise<ProfileSummary>;
  privacy(): Promise<PrivacySettings>;
  /** A patch of only what changed; answers with the whole record. */
  updatePrivacy(patch: Partial<PrivacySettings>): Promise<PrivacySettings>;
  /**
   * Changes the password and signs every other device out.
   * `PASSWORD_INCORRECT` / `PASSWORD_UNCHANGED` (422) are the two the form words.
   */
  changePassword(input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: boolean; signedOutSessions: number }>;
  /**
   * Starts a contact change: the password proves it is them, the challenge
   * that comes back goes to the **new** address, and only `verifyOtp` on it
   * moves the account.
   */
  changeEmail(input: {
    email: string;
    password: string;
  }): Promise<VerificationChallenge>;
  changePhone(input: {
    phone: string;
    password: string;
  }): Promise<VerificationChallenge>;
  sessions(): Promise<AccountSession[]>;
  /** Signs every device but this one out. */
  revokeOtherSessions(): Promise<{ signedOut: number }>;
  /** The whole account as JSON. `EXPORT_TOO_SOON` (429) carries `retryAfterSeconds`. */
  exportData(): Promise<Record<string, unknown>>;
  deletion(): Promise<AccountDeletion>;
  /** Schedules it for the end of the grace window; the password is asked for again. */
  scheduleDeletion(input: {
    password: string;
    reason?: string;
  }): Promise<AccountDeletion>;
  cancelDeletion(): Promise<AccountDeletion>;
}

export interface SupportApi {
  /** The help centre, searched by word and narrowed by category. */
  faqs(query?: {
    q?: string;
    category?: SupportCategory;
  }): Promise<SupportFaq[]>;
  tickets(): Promise<SupportTicket[]>;
  ticket(id: string): Promise<SupportTicket>;
  createTicket(input: {
    subject: string;
    category: SupportCategory;
    message: string;
  }): Promise<SupportTicket>;
  /** Adds to a thread support has not closed (`TICKET_CLOSED`, 409). */
  reply(id: string, message: string): Promise<SupportTicket>;
}

export interface AppApi {
  /** Version, update state, release notes and the legal links. */
  about(): Promise<AppAbout>;
}

export interface StreakApi {
  /** Every figure the streak screen shows, worked out by the server (RULES §S). */
  get(): Promise<StreakSummary>;
  /**
   * Spends a freeze on today. Refused with `NO_FREEZES_LEFT` or
   * `STREAK_ALREADY_COVERED` (409), with nothing spent.
   */
  freeze(options: IdempotentOptions): Promise<StreakSummary>;
  /**
   * Bridges the last gap for coins — the debit and the days in one
   * transaction. Refused with `NOTHING_TO_RESTORE` or `INSUFFICIENT_COINS`
   * (422), with nothing charged.
   */
  restore(options: IdempotentOptions): Promise<StreakRestoreResult>;
}

export interface ChallengeApi {
  /**
   * The board for one day (`YYYY-MM-DD`): what is open on it with the
   * progress of the period it falls in (`startsAt: null`), then what opens
   * soon (`startsAt` set). Progress and completion are the server's (RULES
   * C3, C4) — there is nothing to report and nothing to claim.
   */
  board(date: string): Promise<Challenge[]>;
  /** The achievement shelf, in the server's order, with what is unlocked. */
  achievements(): Promise<Achievement[]>;
}

export interface LeaderboardApi {
  /** This week's board for the caller's country, and their place on it. */
  board(): Promise<LeaderboardBoard>;
  /** The caller's record over the weeks that have closed. */
  history(): Promise<LeaderboardHistory>;
  /** The prizes and how a place is won, worded from the server's rules. */
  rules(): Promise<LeaderboardRules>;
}

export interface HydrationDayTotal {
  date: string;
  consumedMl: number;
  goalMl: number;
}

export interface HydrationApi {
  /** Today's water in the user's zone. */
  today(): Promise<HydrationDay>;
  /**
   * Logs a drink. The id is the app's own: sending the same drink again —
   * a retry after a dropped connection — is the same glass, not a second.
   */
  log(entry: HydrationEntry, options: IdempotentOptions): Promise<HydrationDay>;
  /** Takes a logged drink back out. Answers the day it was on. */
  remove(id: string, options: IdempotentOptions): Promise<HydrationDay>;
  /** The habit figures (RULES Y4). */
  stats(): Promise<HydrationStats>;
  /** Per-day totals, every day present. */
  days(from: string, to: string): Promise<HydrationDayTotal[]>;
  /** The reminder plan; the default one until the user has changed it. */
  reminders(): Promise<HydrationReminderPlan>;
  /** Replaces the whole plan; answers it as stored. */
  saveReminders(
    plan: HydrationReminderPlan,
    options: IdempotentOptions,
  ): Promise<HydrationReminderPlan>;
}

export interface ContentApi {
  /** The day's tip for one place in the app — or, for `motivation`, the day's line. */
  tip(topic: ContentTopic): Promise<ContentTip>;
}

export interface NutritionProfilePatch {
  goals?: Partial<NutritionGoals>;
  preferences?: Partial<NutritionPreferences>;
}

export interface NutritionApi {
  /** The targets and the preferences (RULES N4). */
  profile(): Promise<NutritionProfile>;
  /** Changes them field by field; answers the whole profile as stored. */
  updateProfile(
    patch: NutritionProfilePatch,
    options: IdempotentOptions,
  ): Promise<NutritionProfile>;
  /** One day's food (`YYYY-MM-DD`). */
  day(date: string): Promise<NutritionDay>;
  /** What each day from `from` to `to` came to, every day present. */
  days(from: string, to: string): Promise<NutritionDayTotal[]>;
  /**
   * Logs a meal's foods. Each carries the app's own id: a retried save is
   * the same plate. Answers the day of the first food.
   */
  log(entries: FoodEntry[], options: IdempotentOptions): Promise<NutritionDay>;
  /** Takes a logged food back out; answers its day. */
  remove(id: string, options: IdempotentOptions): Promise<NutritionDay>;
  /** The library the user can see, by word prefix. */
  searchFoods(query: string): Promise<FoodItem[]>;
  /** The add-meal screen's shortcuts. */
  quickAddFoods(): Promise<FoodItem[]>;
  /** The plan for a day, chosen from the preferences (RULES N6, N7). */
  plan(date: string): Promise<DietPlanDay>;
  /** A run of days' plans in brief. */
  planDays(from: string, to: string): Promise<DietPlanDaySummary[]>;
}

export interface VitalsApi {
  /** The newest readings, of one kind or all, newest first. */
  list(query: {
    kind?: Exclude<VitalKind, 'bmi'>;
    limit?: number;
  }): Promise<VitalReading[]>;
  /** The newest of each kind, and the BMI derived from them (RULES V3). */
  latest(): Promise<VitalsLatest>;
  /**
   * Logs a reading under the app's own id — a retry is the same reading.
   * BMI is never entered (RULES V1); the server refuses it.
   */
  log(reading: VitalReading, options: IdempotentOptions): Promise<VitalReading>;
  remove(id: string, options: IdempotentOptions): Promise<{ ok: boolean }>;
  /** One number for how the user is doing, and what made it (RULES V8). */
  score(): Promise<HealthScore>;
}
