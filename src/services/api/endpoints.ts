import { z } from 'zod';
import {
  accountDeletionSchema,
  achievementDetailSchema,
  achievementSchema,
  accountSessionSchema,
  activityConfigSchema,
  activityRangeSchema,
  addressSchema,
  deliveryPreferencesSchema,
  appAboutSchema,
  appNotificationSchema,
  attestationChallengeSchema,
  authResponseSchema,
  cartSchema,
  challengeDetailSchema,
  challengeSchema,
  checkoutResultSchema,
  coinTransactionSchema,
  contentTipSchema,
  notificationCountsSchema,
  notificationPreferencesSchema,
  nutritionDaySchema,
  nutritionDayTotalSchema,
  nutritionProfileSchema,
  orderSchema,
  privacySettingsSchema,
  profileSummarySchema,
  quoteSchema,
  referralProgramSchema,
  reorderResultSchema,
  referralSchema,
  reviewPageSchema,
  reviewSchema,
  shopCategorySummarySchema,
  shopConfigSchema,
  shopItemSchema,
  appGuideSchema,
  supportFaqSchema,
  supportHomeSchema,
  supportTicketSchema,
  dailyActivitySchema,
  deviceAttestationResultSchema,
  dietPlanDaySchema,
  dietPlanDaySummarySchema,
  foodItemSchema,
  deviceRegistrationSchema,
  earnRuleSchema,
  healthScoreSchema,
  hydrationDaySchema,
  hydrationReminderPlanSchema,
  hydrationStatsSchema,
  ingestNonceSchema,
  leaderboardBoardSchema,
  leaderboardHistorySchema,
  leaderboardRulesSchema,
  pageSchema,
  stepGoalSchema,
  stepIngestResultSchema,
  stepSourcesReportSchema,
  streakHistoryPageSchema,
  streakRestoreResultSchema,
  streakSummarySchema,
  verificationChallengeSchema,
  userSchema,
  userSettingsSchema,
  vitalReadingSchema,
  vitalsLatestSchema,
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
import type { CompleteProfilePayload, SignUpPayload } from '../../types/forms';
import { config } from '../../constants/config';
import { logger } from '../../utils/logger';
import { request } from './client';
import type {
  AccountApi,
  ActivityApi,
  AddressApi,
  AppApi,
  AuthApi,
  CartApi,
  ChallengeApi,
  CheckoutApi,
  ContentApi,
  DeviceApi,
  HydrationApi,
  LeaderboardApi,
  NotificationApi,
  NotificationPreferencesApi,
  NutritionApi,
  OrderApi,
  ReferralApi,
  SettingsApi,
  ShopApi,
  StreakApi,
  SupportApi,
  UserApi,
  VitalsApi,
  WalletApi,
  WishlistApi,
  WorkoutApi,
} from './contracts';
import {
  MOCK_RULES,
  mockAccountApi,
  mockActivityApi,
  mockAddressApi,
  mockAppApi,
  mockAuthApi,
  mockCartApi,
  mockChallengeApi,
  mockCheckoutApi,
  mockContentApi,
  mockDeviceApi,
  mockHydrationApi,
  mockLeaderboardApi,
  mockNotificationApi,
  mockNotificationPreferencesApi,
  mockNutritionApi,
  mockOrderApi,
  mockReferralApi,
  mockSettingsApi,
  mockShopApi,
  mockStreakApi,
  mockUserApi,
  mockSupportApi,
  mockVitalsApi,
  mockWalletApi,
  mockWishlistApi,
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

  stepUp: (): Promise<VerificationChallenge> =>
    request(verificationChallengeSchema, client =>
      client.post('/auth/step-up'),
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

const okSchema = z.object({ ok: z.boolean() });

const realDeviceApi: DeviceApi = {
  register: (profile, refreshToken) =>
    request(deviceRegistrationSchema, client =>
      client.post('/devices/register', profile, {
        // Lets the server bind the session that just started to this device.
        headers: refreshToken ? { 'X-Vokve-Refresh-Token': refreshToken } : {},
      }),
    ),
  setPushToken: (deviceId, pushToken) =>
    request(okSchema, client =>
      client.patch(`/devices/${encodeURIComponent(deviceId)}`, { pushToken }),
    ),
  attestationChallenge: deviceId =>
    request(attestationChallengeSchema, client =>
      client.post(
        `/devices/${encodeURIComponent(deviceId)}/attestation/challenge`,
      ),
    ),
  submitAttestation: (deviceId, attestation) =>
    request(deviceAttestationResultSchema, client =>
      client.post(
        `/devices/${encodeURIComponent(deviceId)}/attestation`,
        attestation,
      ),
    ),
};

const realWalletApi: WalletApi = {
  get: () => request(walletSchema, client => client.get('/wallet')),
  // axios drops undefined params, so an unset filter sends no `source=`.
  transactions: (query = {}) =>
    request(pageSchema(coinTransactionSchema), client =>
      client.get('/wallet/transactions', {
        params: {
          cursor: query.cursor,
          limit: query.limit,
          source: query.source,
        },
      }),
    ),
  earnRules: () =>
    request(pageSchema(earnRuleSchema), client =>
      client.get('/wallet/earn-rules'),
    ).then(page => page.data),
};

const realUserApi: UserApi = {
  me: (): Promise<User> => request(userSchema, client => client.get('/me')),

  updateProfile: (patch: Partial<User>): Promise<User> =>
    request(userSchema, client => client.patch('/me', patch)),

  completeProfile: (payload: CompleteProfilePayload): Promise<User> =>
    request(userSchema, client => client.post('/me/complete-profile', payload)),
  uploadAvatar: input =>
    request(userSchema, client => client.post('/me/avatar', input)),
  removeAvatar: () =>
    request(userSchema, client => client.delete('/me/avatar')),
};

const realSettingsApi: SettingsApi = {
  get: () => request(userSettingsSchema, client => client.get('/me/settings')),
  update: patch =>
    request(userSettingsSchema, client => client.put('/me/settings', patch)),
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
  day: date =>
    request(dailyActivitySchema, client =>
      client.get('/activity/day', { params: { date } }),
    ),
  range: query =>
    request(activityRangeSchema, client =>
      client.get('/activity/range', { params: query }),
    ),
  config: () =>
    request(activityConfigSchema, client => client.get('/activity/config')),
  goal: () => request(stepGoalSchema, client => client.get('/activity/goal')),
  sources: date =>
    request(stepSourcesReportSchema, client =>
      client.get('/activity/sources', { params: { date } }),
    ),
  ingestNonce: () =>
    request(ingestNonceSchema, client => client.post('/activity/ingest/nonce')),
  // The key is one per attempt, not the snapshot's hash: a snapshot sent
  // again with the integrity token the server asked for is a new attempt,
  // and must not be answered with the stored refusal of the first one. The
  // server dedupes the snapshot itself on its hash.
  ingest: (payload, { idempotencyKey }) =>
    request(stepIngestResultSchema, client =>
      client.post('/activity/ingest', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
};

const orderResultSchema = z.object({
  order: orderSchema,
  balance: z.number().nonnegative(),
});

const cataloguePageSchema = pageSchema(shopItemSchema).extend({
  total: z.number().int().nonnegative(),
});

/** Booleans travel as the words the server's query parser reads; an unset one is left out. */
const flag = (value: boolean | undefined) => (value ? 'true' : undefined);

const realShopApi: ShopApi = {
  items: (query = {}) =>
    request(cataloguePageSchema, client =>
      client.get('/shop/items', {
        params: {
          category: query.category,
          subcategory: query.subcategory,
          deals: flag(query.deals),
          featured: flag(query.featured),
          inStock: flag(query.inStock),
          q: query.q || undefined,
          sort: query.sort,
          minPrice: query.minPrice,
          maxPrice: query.maxPrice,
          minRating: query.minRating,
          cursor: query.cursor,
          limit: query.limit,
        },
      }),
    ),
  item: id =>
    request(shopItemSchema, client =>
      client.get(`/shop/items/${encodeURIComponent(id)}`),
    ),
  categories: () =>
    request(pageSchema(shopCategorySummarySchema), client =>
      client.get('/shop/categories'),
    ).then(page => page.data),
  config: () => request(shopConfigSchema, client => client.get('/shop/config')),
  reviews: (itemId, query = {}) =>
    request(reviewPageSchema, client =>
      client.get(`/shop/items/${encodeURIComponent(itemId)}/reviews`, {
        params: { sort: query.sort, cursor: query.cursor, limit: query.limit },
      }),
    ),
  writeReview: (itemId, input) =>
    request(reviewSchema, client =>
      client.put(`/shop/items/${encodeURIComponent(itemId)}/reviews/me`, input),
    ),
  deleteReview: itemId =>
    request(okSchema, client =>
      client.delete(`/shop/items/${encodeURIComponent(itemId)}/reviews/me`),
    ),
};

const realWishlistApi: WishlistApi = {
  list: () =>
    request(pageSchema(shopItemSchema), client => client.get('/wishlist')).then(
      page => page.data,
    ),
  ids: () =>
    request(pageSchema(z.string()), client => client.get('/wishlist/ids')).then(
      page => page.data,
    ),
  add: itemId =>
    request(okSchema, client =>
      client.put(`/wishlist/${encodeURIComponent(itemId)}`),
    ),
  remove: itemId =>
    request(okSchema, client =>
      client.delete(`/wishlist/${encodeURIComponent(itemId)}`),
    ),
};

const realCartApi: CartApi = {
  get: () => request(cartSchema, client => client.get('/cart')),
  setLine: line =>
    request(cartSchema, client =>
      client.put('/cart/lines', {
        itemId: line.itemId,
        quantity: line.quantity,
        size: line.size ?? null,
        color: line.color ?? null,
      }),
    ),
  removeLine: (itemId, size, color) =>
    request(cartSchema, client =>
      client.delete(`/cart/lines/${encodeURIComponent(itemId)}`, {
        params: { size: size ?? undefined, color: color ?? undefined },
      }),
    ),
  applyCoupon: code =>
    request(cartSchema, client => client.put('/cart/coupon', { code })),
  removeCoupon: () =>
    request(cartSchema, client => client.delete('/cart/coupon')),
  clear: () => request(cartSchema, client => client.delete('/cart')),
};

const realCheckoutApi: CheckoutApi = {
  quote: (lines, coins, couponCode) =>
    request(quoteSchema, client =>
      client.post('/checkout/quote', {
        lines,
        coins,
        couponCode: couponCode ?? undefined,
      }),
    ),
  place: (payload, { idempotencyKey }) =>
    request(checkoutResultSchema, client =>
      client.post('/checkout', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
  pay: (orderId, proof, { idempotencyKey }) =>
    request(orderResultSchema, client =>
      client.post(`/orders/${encodeURIComponent(orderId)}/pay`, proof, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
};

const realOrderApi: OrderApi = {
  list: (cursor, filter) =>
    request(pageSchema(orderSchema), client =>
      client.get('/orders', { params: { cursor, status: filter } }),
    ),
  get: id =>
    request(orderSchema, client =>
      client.get(`/orders/${encodeURIComponent(id)}`),
    ),
  count: () =>
    request(z.object({ count: z.number().int().nonnegative() }), client =>
      client.get('/orders/count'),
    ).then(result => result.count),
  cancel: (id, { idempotencyKey }) =>
    request(orderResultSchema, client =>
      client.post(`/orders/${encodeURIComponent(id)}/cancel`, undefined, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
  changeAddress: (id, addressId) =>
    request(orderSchema, client =>
      client.post(`/orders/${encodeURIComponent(id)}/address`, { addressId }),
    ),
  reorder: (id, { idempotencyKey }) =>
    request(reorderResultSchema, client =>
      client.post(`/orders/${encodeURIComponent(id)}/reorder`, undefined, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
};

const realAccountApi: AccountApi = {
  profile: () =>
    request(profileSummarySchema, client => client.get('/me/profile')),
  privacy: () =>
    request(privacySettingsSchema, client => client.get('/me/privacy')),
  updatePrivacy: patch =>
    request(privacySettingsSchema, client => client.put('/me/privacy', patch)),
  changePassword: input =>
    request(
      z.object({
        ok: z.boolean(),
        signedOutSessions: z.number().int().nonnegative(),
      }),
      client => client.put('/me/password', input),
    ),
  changeEmail: input =>
    request(verificationChallengeSchema, client =>
      client.post('/me/email', input),
    ),
  changePhone: input =>
    request(verificationChallengeSchema, client =>
      client.post('/me/phone', input),
    ),
  sessions: () =>
    request(pageSchema(accountSessionSchema), client =>
      client.get('/me/sessions'),
    ).then(page => page.data),
  revokeOtherSessions: () =>
    request(z.object({ signedOut: z.number().int().nonnegative() }), client =>
      client.post('/me/sessions/revoke-others'),
    ),
  // The export is the member's own data, whatever shape it has grown into:
  // validating it against a schema here would mean a new field on the server
  // could stop them taking a copy of it.
  exportData: () =>
    request(z.record(z.string(), z.unknown()), client =>
      client.get('/me/export'),
    ),
  deletion: () =>
    request(accountDeletionSchema, client => client.get('/me/deletion')),
  scheduleDeletion: input =>
    request(accountDeletionSchema, client =>
      client.post('/me/deletion', input),
    ),
  cancelDeletion: () =>
    request(accountDeletionSchema, client => client.delete('/me/deletion')),
};

const realSupportApi: SupportApi = {
  home: () => request(supportHomeSchema, client => client.get('/support/home')),
  guide: () => request(appGuideSchema, client => client.get('/support/guide')),
  faqs: (query = {}) =>
    request(pageSchema(supportFaqSchema), client =>
      client.get('/support/faqs', {
        params: { q: query.q || undefined, category: query.category },
      }),
    ).then(page => page.data),
  tickets: () =>
    request(pageSchema(supportTicketSchema), client =>
      client.get('/support/tickets'),
    ).then(page => page.data),
  ticket: id =>
    request(supportTicketSchema, client =>
      client.get(`/support/tickets/${encodeURIComponent(id)}`),
    ),
  createTicket: input =>
    request(supportTicketSchema, client =>
      client.post('/support/tickets', input),
    ),
  reply: (id, message) =>
    request(supportTicketSchema, client =>
      client.post(`/support/tickets/${encodeURIComponent(id)}/replies`, {
        message,
      }),
    ),
};

const realAppApi: AppApi = {
  about: () => request(appAboutSchema, client => client.get('/app/about')),
};

const realNotificationPreferencesApi: NotificationPreferencesApi = {
  get: () =>
    request(notificationPreferencesSchema, client =>
      client.get('/me/notification-preferences'),
    ),
  update: patch =>
    request(notificationPreferencesSchema, client =>
      client.put('/me/notification-preferences', patch),
    ),
};

const realReferralApi: ReferralApi = {
  me: () =>
    request(referralProgramSchema, client => client.get('/referrals/me')),
  list: cursor =>
    request(pageSchema(referralSchema), client =>
      client.get('/referrals', { params: { cursor } }),
    ),
  apply: code =>
    request(referralProgramSchema, client =>
      client.post('/referrals/apply', { code }),
    ),
};

const realStreakApi: StreakApi = {
  get: () => request(streakSummarySchema, client => client.get('/streak')),
  freeze: ({ idempotencyKey }) =>
    request(streakSummarySchema, client =>
      client.post('/streak/freeze', undefined, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
  restore: ({ idempotencyKey }) =>
    request(streakRestoreResultSchema, client =>
      client.post('/streak/restore', undefined, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
  history: (cursor, limit) =>
    request(streakHistoryPageSchema, client =>
      client.get('/streak/history', { params: { cursor, limit } }),
    ),
};

const realChallengeApi: ChallengeApi = {
  board: date =>
    request(z.array(challengeSchema), client =>
      client.get('/challenges', { params: { date } }),
    ),
  detail: (id, date) =>
    request(challengeDetailSchema, client =>
      client.get(`/challenges/${encodeURIComponent(id)}`, {
        params: { date },
      }),
    ),
  achievements: () =>
    request(z.array(achievementSchema), client => client.get('/achievements')),
  achievement: id =>
    request(achievementDetailSchema, client =>
      client.get(`/achievements/${encodeURIComponent(id)}`),
    ),
};

const realLeaderboardApi: LeaderboardApi = {
  board: () =>
    request(leaderboardBoardSchema, client => client.get('/leaderboard')),
  history: () =>
    request(leaderboardHistorySchema, client =>
      client.get('/leaderboard/history'),
    ),
  rules: () =>
    request(leaderboardRulesSchema, client =>
      client.get('/leaderboard/reward-tiers'),
    ),
};

const hydrationDayTotalsSchema = z.array(
  z.object({
    date: z.string(),
    consumedMl: z.number().int().nonnegative(),
    goalMl: z.number().int().positive(),
  }),
);

const realHydrationApi: HydrationApi = {
  today: () =>
    request(hydrationDaySchema, client => client.get('/hydration/today')),
  log: (entry, { idempotencyKey }) =>
    request(hydrationDaySchema, client =>
      client.post('/hydration/entries', entry, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
  remove: (id, { idempotencyKey }) =>
    request(hydrationDaySchema, client =>
      client.delete(`/hydration/entries/${encodeURIComponent(id)}`, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
  stats: () =>
    request(hydrationStatsSchema, client => client.get('/hydration/stats')),
  days: (from, to) =>
    request(hydrationDayTotalsSchema, client =>
      client.get('/hydration/days', { params: { from, to } }),
    ),
  reminders: () =>
    request(hydrationReminderPlanSchema, client =>
      client.get('/hydration/reminders'),
    ),
  saveReminders: (plan, { idempotencyKey }) =>
    request(hydrationReminderPlanSchema, client =>
      client.put('/hydration/reminders', plan, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
};

const realContentApi: ContentApi = {
  tip: topic =>
    request(contentTipSchema, client =>
      client.get(`/content/tips/${encodeURIComponent(topic)}`),
    ),
};

const realNutritionApi: NutritionApi = {
  profile: () =>
    request(nutritionProfileSchema, client => client.get('/nutrition/profile')),
  updateProfile: (patch, { idempotencyKey }) =>
    request(nutritionProfileSchema, client =>
      client.put('/nutrition/profile', patch, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
  day: date =>
    request(nutritionDaySchema, client =>
      client.get('/nutrition/day', { params: { date } }),
    ),
  days: (from, to) =>
    request(z.array(nutritionDayTotalSchema), client =>
      client.get('/nutrition/days', { params: { from, to } }),
    ),
  log: (entries, { idempotencyKey }) =>
    request(nutritionDaySchema, client =>
      client.post(
        '/nutrition/entries',
        { entries },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    ),
  remove: (id, { idempotencyKey }) =>
    request(nutritionDaySchema, client =>
      client.delete(`/nutrition/entries/${encodeURIComponent(id)}`, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
  searchFoods: query =>
    request(z.array(foodItemSchema), client =>
      client.get('/foods', { params: { q: query } }),
    ),
  quickAddFoods: () =>
    request(z.array(foodItemSchema), client => client.get('/foods/quick-add')),
  plan: date =>
    request(dietPlanDaySchema, client =>
      client.get('/diet-plan', { params: { date } }),
    ),
  planDays: (from, to) =>
    request(z.array(dietPlanDaySummarySchema), client =>
      client.get('/diet-plan/days', { params: { from, to } }),
    ),
};

const realVitalsApi: VitalsApi = {
  list: query =>
    request(z.array(vitalReadingSchema), client =>
      client.get('/vitals', { params: query }),
    ),
  latest: () =>
    request(vitalsLatestSchema, client => client.get('/vitals/latest')),
  log: (reading, { idempotencyKey }) =>
    request(vitalReadingSchema, client =>
      client.post(
        '/vitals',
        {
          id: reading.id,
          kind: reading.kind,
          value: reading.value,
          secondary: reading.secondary,
          recordedAt: reading.recordedAt,
        },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    ),
  remove: (id, { idempotencyKey }) =>
    request(z.object({ ok: z.boolean() }), client =>
      client.delete(`/vitals/${encodeURIComponent(id)}`, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    ),
  score: () =>
    request(healthScoreSchema, client => client.get('/health/score')),
};

const realAddressApi: AddressApi = {
  list: () =>
    request(pageSchema(addressSchema), client =>
      client.get('/me/addresses'),
    ).then(page => page.data),
  create: input =>
    request(addressSchema, client => client.post('/me/addresses', input)),
  update: (id, patch) =>
    request(addressSchema, client =>
      client.put(`/me/addresses/${encodeURIComponent(id)}`, patch),
    ),
  setDefault: id =>
    request(addressSchema, client =>
      client.post(`/me/addresses/${encodeURIComponent(id)}/default`),
    ),
  remove: id =>
    request(okSchema, client =>
      client.delete(`/me/addresses/${encodeURIComponent(id)}`),
    ),
  deliveryPreferences: () =>
    request(deliveryPreferencesSchema, client =>
      client.get('/me/delivery-preferences'),
    ),
  setDeliveryPreferences: patch =>
    request(deliveryPreferencesSchema, client =>
      client.put('/me/delivery-preferences', patch),
    ),
};

const realNotificationApi: NotificationApi = {
  list: (query = {}) =>
    request(pageSchema(appNotificationSchema), client =>
      client.get('/notifications', {
        params: {
          cursor: query.cursor,
          limit: query.limit,
          category: query.category,
        },
      }),
    ),
  counts: () =>
    request(notificationCountsSchema, client =>
      client.get('/notifications/counts'),
    ),
  markRead: id =>
    request(okSchema, client =>
      client.post(`/notifications/${encodeURIComponent(id)}/read`),
    ),
  markAllRead: () =>
    request(okSchema, client => client.post('/notifications/read-all')),
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
    pick(mockAuthApi, realAuthApi).resetPassword(
      verificationId,
      code,
      password,
    ),
  stepUp: () => pick(mockAuthApi, realAuthApi).stepUp(),
  signOut: () => pick(mockAuthApi, realAuthApi).signOut(),
};

export const deviceApi: DeviceApi = {
  register: (profile, refreshToken) =>
    pick(mockDeviceApi, realDeviceApi).register(profile, refreshToken),
  setPushToken: (deviceId, pushToken) =>
    pick(mockDeviceApi, realDeviceApi).setPushToken(deviceId, pushToken),
  attestationChallenge: deviceId =>
    pick(mockDeviceApi, realDeviceApi).attestationChallenge(deviceId),
  submitAttestation: (deviceId, attestation) =>
    pick(mockDeviceApi, realDeviceApi).submitAttestation(deviceId, attestation),
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
  uploadAvatar: input => pick(mockUserApi, realUserApi).uploadAvatar(input),
  removeAvatar: () => pick(mockUserApi, realUserApi).removeAvatar(),
};

export const settingsApi: SettingsApi = {
  get: () => pick(mockSettingsApi, realSettingsApi).get(),
  update: patch => pick(mockSettingsApi, realSettingsApi).update(patch),
};

export const workoutApi: WorkoutApi = {
  templates: () => pick(mockWorkoutApi, realWorkoutApi).templates(),
  history: cursor => pick(mockWorkoutApi, realWorkoutApi).history(cursor),
  save: workout => pick(mockWorkoutApi, realWorkoutApi).save(workout),
};

export const activityApi: ActivityApi = {
  weekly: () => pick(mockActivityApi, realActivityApi).weekly(),
  today: () => pick(mockActivityApi, realActivityApi).today(),
  day: date => pick(mockActivityApi, realActivityApi).day(date),
  range: query => pick(mockActivityApi, realActivityApi).range(query),
  config: () => pick(mockActivityApi, realActivityApi).config(),
  goal: () => pick(mockActivityApi, realActivityApi).goal(),
  sources: date => pick(mockActivityApi, realActivityApi).sources(date),
  ingestNonce: () => pick(mockActivityApi, realActivityApi).ingestNonce(),
  ingest: (payload, options) =>
    pick(mockActivityApi, realActivityApi).ingest(payload, options),
};

export const shopApi: ShopApi = {
  items: query => pick(mockShopApi, realShopApi).items(query),
  item: id => pick(mockShopApi, realShopApi).item(id),
  categories: () => pick(mockShopApi, realShopApi).categories(),
  config: () => pick(mockShopApi, realShopApi).config(),
  reviews: (itemId, query) =>
    pick(mockShopApi, realShopApi).reviews(itemId, query),
  writeReview: (itemId, input) =>
    pick(mockShopApi, realShopApi).writeReview(itemId, input),
  deleteReview: itemId => pick(mockShopApi, realShopApi).deleteReview(itemId),
};

export const wishlistApi: WishlistApi = {
  list: () => pick(mockWishlistApi, realWishlistApi).list(),
  ids: () => pick(mockWishlistApi, realWishlistApi).ids(),
  add: itemId => pick(mockWishlistApi, realWishlistApi).add(itemId),
  remove: itemId => pick(mockWishlistApi, realWishlistApi).remove(itemId),
};

export const cartApi: CartApi = {
  get: () => pick(mockCartApi, realCartApi).get(),
  setLine: line => pick(mockCartApi, realCartApi).setLine(line),
  removeLine: (itemId, size, color) =>
    pick(mockCartApi, realCartApi).removeLine(itemId, size, color),
  applyCoupon: code => pick(mockCartApi, realCartApi).applyCoupon(code),
  removeCoupon: () => pick(mockCartApi, realCartApi).removeCoupon(),
  clear: () => pick(mockCartApi, realCartApi).clear(),
};

export const checkoutApi: CheckoutApi = {
  quote: (lines, coins, couponCode) =>
    pick(mockCheckoutApi, realCheckoutApi).quote(lines, coins, couponCode),
  place: (payload, options) =>
    pick(mockCheckoutApi, realCheckoutApi).place(payload, options),
  pay: (orderId, proof, options) =>
    pick(mockCheckoutApi, realCheckoutApi).pay(orderId, proof, options),
};

export const orderApi: OrderApi = {
  list: (cursor, filter) =>
    pick(mockOrderApi, realOrderApi).list(cursor, filter),
  get: id => pick(mockOrderApi, realOrderApi).get(id),
  count: () => pick(mockOrderApi, realOrderApi).count(),
  cancel: (id, options) => pick(mockOrderApi, realOrderApi).cancel(id, options),
  changeAddress: (id, addressId) =>
    pick(mockOrderApi, realOrderApi).changeAddress(id, addressId),
  reorder: (id, options) =>
    pick(mockOrderApi, realOrderApi).reorder(id, options),
};

export const referralApi: ReferralApi = {
  me: () => pick(mockReferralApi, realReferralApi).me(),
  list: cursor => pick(mockReferralApi, realReferralApi).list(cursor),
  apply: code => pick(mockReferralApi, realReferralApi).apply(code),
};

export const streakApi: StreakApi = {
  get: () => pick(mockStreakApi, realStreakApi).get(),
  freeze: options => pick(mockStreakApi, realStreakApi).freeze(options),
  restore: options => pick(mockStreakApi, realStreakApi).restore(options),
  history: (cursor, limit) =>
    pick(mockStreakApi, realStreakApi).history(cursor, limit),
};

export const challengeApi: ChallengeApi = {
  board: date => pick(mockChallengeApi, realChallengeApi).board(date),
  detail: (id, date) => pick(mockChallengeApi, realChallengeApi).detail(id, date),
  achievements: () => pick(mockChallengeApi, realChallengeApi).achievements(),
  achievement: id => pick(mockChallengeApi, realChallengeApi).achievement(id),
};

export const leaderboardApi: LeaderboardApi = {
  board: () => pick(mockLeaderboardApi, realLeaderboardApi).board(),
  history: () => pick(mockLeaderboardApi, realLeaderboardApi).history(),
  rules: () => pick(mockLeaderboardApi, realLeaderboardApi).rules(),
};

export const hydrationApi: HydrationApi = {
  today: () => pick(mockHydrationApi, realHydrationApi).today(),
  log: (entry, options) =>
    pick(mockHydrationApi, realHydrationApi).log(entry, options),
  remove: (id, options) =>
    pick(mockHydrationApi, realHydrationApi).remove(id, options),
  stats: () => pick(mockHydrationApi, realHydrationApi).stats(),
  days: (from, to) => pick(mockHydrationApi, realHydrationApi).days(from, to),
  reminders: () => pick(mockHydrationApi, realHydrationApi).reminders(),
  saveReminders: (plan, options) =>
    pick(mockHydrationApi, realHydrationApi).saveReminders(plan, options),
};

export const contentApi: ContentApi = {
  tip: topic => pick(mockContentApi, realContentApi).tip(topic),
};

export const nutritionApi: NutritionApi = {
  profile: () => pick(mockNutritionApi, realNutritionApi).profile(),
  updateProfile: (patch, options) =>
    pick(mockNutritionApi, realNutritionApi).updateProfile(patch, options),
  day: date => pick(mockNutritionApi, realNutritionApi).day(date),
  days: (from, to) => pick(mockNutritionApi, realNutritionApi).days(from, to),
  log: (entries, options) =>
    pick(mockNutritionApi, realNutritionApi).log(entries, options),
  remove: (id, options) =>
    pick(mockNutritionApi, realNutritionApi).remove(id, options),
  searchFoods: query =>
    pick(mockNutritionApi, realNutritionApi).searchFoods(query),
  quickAddFoods: () => pick(mockNutritionApi, realNutritionApi).quickAddFoods(),
  plan: date => pick(mockNutritionApi, realNutritionApi).plan(date),
  planDays: (from, to) =>
    pick(mockNutritionApi, realNutritionApi).planDays(from, to),
};

export const vitalsApi: VitalsApi = {
  list: query => pick(mockVitalsApi, realVitalsApi).list(query),
  latest: () => pick(mockVitalsApi, realVitalsApi).latest(),
  log: (reading, options) =>
    pick(mockVitalsApi, realVitalsApi).log(reading, options),
  remove: (id, options) =>
    pick(mockVitalsApi, realVitalsApi).remove(id, options),
  score: () => pick(mockVitalsApi, realVitalsApi).score(),
};

export const addressApi: AddressApi = {
  list: () => pick(mockAddressApi, realAddressApi).list(),
  create: input => pick(mockAddressApi, realAddressApi).create(input),
  update: (id, patch) => pick(mockAddressApi, realAddressApi).update(id, patch),
  setDefault: id => pick(mockAddressApi, realAddressApi).setDefault(id),
  remove: id => pick(mockAddressApi, realAddressApi).remove(id),
  deliveryPreferences: () =>
    pick(mockAddressApi, realAddressApi).deliveryPreferences(),
  setDeliveryPreferences: patch =>
    pick(mockAddressApi, realAddressApi).setDeliveryPreferences(patch),
};

export const notificationPreferencesApi: NotificationPreferencesApi = {
  get: () =>
    pick(mockNotificationPreferencesApi, realNotificationPreferencesApi).get(),
  update: patch =>
    pick(mockNotificationPreferencesApi, realNotificationPreferencesApi).update(
      patch,
    ),
};

export const notificationApi: NotificationApi = {
  list: query => pick(mockNotificationApi, realNotificationApi).list(query),
  counts: () => pick(mockNotificationApi, realNotificationApi).counts(),
  markRead: id => pick(mockNotificationApi, realNotificationApi).markRead(id),
  markAllRead: () =>
    pick(mockNotificationApi, realNotificationApi).markAllRead(),
};

export const accountApi: AccountApi = {
  profile: () => pick(mockAccountApi, realAccountApi).profile(),
  privacy: () => pick(mockAccountApi, realAccountApi).privacy(),
  updatePrivacy: patch =>
    pick(mockAccountApi, realAccountApi).updatePrivacy(patch),
  changePassword: input =>
    pick(mockAccountApi, realAccountApi).changePassword(input),
  changeEmail: input => pick(mockAccountApi, realAccountApi).changeEmail(input),
  changePhone: input => pick(mockAccountApi, realAccountApi).changePhone(input),
  sessions: () => pick(mockAccountApi, realAccountApi).sessions(),
  revokeOtherSessions: () =>
    pick(mockAccountApi, realAccountApi).revokeOtherSessions(),
  exportData: () => pick(mockAccountApi, realAccountApi).exportData(),
  deletion: () => pick(mockAccountApi, realAccountApi).deletion(),
  scheduleDeletion: input =>
    pick(mockAccountApi, realAccountApi).scheduleDeletion(input),
  cancelDeletion: () => pick(mockAccountApi, realAccountApi).cancelDeletion(),
};

export const supportApi: SupportApi = {
  home: () => pick(mockSupportApi, realSupportApi).home(),
  guide: () => pick(mockSupportApi, realSupportApi).guide(),
  faqs: query => pick(mockSupportApi, realSupportApi).faqs(query),
  tickets: () => pick(mockSupportApi, realSupportApi).tickets(),
  ticket: id => pick(mockSupportApi, realSupportApi).ticket(id),
  createTicket: input =>
    pick(mockSupportApi, realSupportApi).createTicket(input),
  reply: (id, message) =>
    pick(mockSupportApi, realSupportApi).reply(id, message),
};

export const appApi: AppApi = {
  about: () => pick(mockAppApi, realAppApi).about(),
};
