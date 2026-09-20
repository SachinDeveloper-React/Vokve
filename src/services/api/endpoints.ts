import { z } from 'zod';
import {
  addressSchema,
  appNotificationSchema,
  authResponseSchema,
  cartSchema,
  checkoutResultSchema,
  coinTransactionSchema,
  notificationCountsSchema,
  notificationPreferencesSchema,
  orderSchema,
  quoteSchema,
  referralProgramSchema,
  referralSchema,
  reviewPageSchema,
  reviewSchema,
  shopCategorySummarySchema,
  shopConfigSchema,
  shopItemSchema,
  dailyActivitySchema,
  deviceRegistrationSchema,
  earnRuleSchema,
  pageSchema,
  verificationChallengeSchema,
  userSchema,
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
import type {
  CompleteProfilePayload,
  SignUpPayload,
} from '../../types/forms';
import { config } from '../../constants/config';
import { logger } from '../../utils/logger';
import { request } from './client';
import type {
  ActivityApi,
  AddressApi,
  AuthApi,
  CartApi,
  CheckoutApi,
  DeviceApi,
  NotificationApi,
  NotificationPreferencesApi,
  OrderApi,
  ReferralApi,
  ShopApi,
  UserApi,
  WalletApi,
  WishlistApi,
  WorkoutApi,
} from './contracts';
import {
  MOCK_RULES,
  mockActivityApi,
  mockAddressApi,
  mockAuthApi,
  mockCartApi,
  mockCheckoutApi,
  mockDeviceApi,
  mockNotificationApi,
  mockNotificationPreferencesApi,
  mockOrderApi,
  mockReferralApi,
  mockShopApi,
  mockUserApi,
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
};

const realWalletApi: WalletApi = {
  get: () => request(walletSchema, client => client.get('/wallet')),
  // axios drops undefined params, so an unset filter sends no `source=`.
  transactions: (query = {}) =>
    request(pageSchema(coinTransactionSchema), client =>
      client.get('/wallet/transactions', {
        params: { cursor: query.cursor, limit: query.limit, source: query.source },
      }),
    ),
  earnRules: () =>
    request(pageSchema(earnRuleSchema), client =>
      client.get('/wallet/earn-rules'),
    ).then(page => page.data),
};

const realUserApi: UserApi = {
  me: (): Promise<User> =>
    request(userSchema, client => client.get('/me')),

  updateProfile: (patch: Partial<User>): Promise<User> =>
    request(userSchema, client => client.patch('/me', patch)),

  completeProfile: (payload: CompleteProfilePayload): Promise<User> =>
    request(userSchema, client => client.post('/me/complete-profile', payload)),
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
      }),
    ),
  removeLine: (itemId, size) =>
    request(cartSchema, client =>
      client.delete(`/cart/lines/${encodeURIComponent(itemId)}`, {
        params: { size: size ?? undefined },
      }),
    ),
  clear: () => request(cartSchema, client => client.delete('/cart')),
};

const realCheckoutApi: CheckoutApi = {
  quote: (lines, coins) =>
    request(quoteSchema, client =>
      client.post('/checkout/quote', { lines, coins }),
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
  list: cursor =>
    request(pageSchema(orderSchema), client =>
      client.get('/orders', { params: { cursor } }),
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
    pick(mockAuthApi, realAuthApi).resetPassword(verificationId, code, password),
  stepUp: () => pick(mockAuthApi, realAuthApi).stepUp(),
  signOut: () => pick(mockAuthApi, realAuthApi).signOut(),
};

export const deviceApi: DeviceApi = {
  register: (profile, refreshToken) =>
    pick(mockDeviceApi, realDeviceApi).register(profile, refreshToken),
  setPushToken: (deviceId, pushToken) =>
    pick(mockDeviceApi, realDeviceApi).setPushToken(deviceId, pushToken),
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
};

export const workoutApi: WorkoutApi = {
  templates: () => pick(mockWorkoutApi, realWorkoutApi).templates(),
  history: cursor => pick(mockWorkoutApi, realWorkoutApi).history(cursor),
  save: workout => pick(mockWorkoutApi, realWorkoutApi).save(workout),
};

export const activityApi: ActivityApi = {
  weekly: () => pick(mockActivityApi, realActivityApi).weekly(),
  today: () => pick(mockActivityApi, realActivityApi).today(),
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
  removeLine: (itemId, size) =>
    pick(mockCartApi, realCartApi).removeLine(itemId, size),
  clear: () => pick(mockCartApi, realCartApi).clear(),
};

export const checkoutApi: CheckoutApi = {
  quote: (lines, coins) =>
    pick(mockCheckoutApi, realCheckoutApi).quote(lines, coins),
  place: (payload, options) =>
    pick(mockCheckoutApi, realCheckoutApi).place(payload, options),
  pay: (orderId, proof, options) =>
    pick(mockCheckoutApi, realCheckoutApi).pay(orderId, proof, options),
};

export const orderApi: OrderApi = {
  list: cursor => pick(mockOrderApi, realOrderApi).list(cursor),
  get: id => pick(mockOrderApi, realOrderApi).get(id),
  count: () => pick(mockOrderApi, realOrderApi).count(),
  cancel: (id, options) => pick(mockOrderApi, realOrderApi).cancel(id, options),
};

export const referralApi: ReferralApi = {
  me: () => pick(mockReferralApi, realReferralApi).me(),
  list: cursor => pick(mockReferralApi, realReferralApi).list(cursor),
  apply: code => pick(mockReferralApi, realReferralApi).apply(code),
};

export const addressApi: AddressApi = {
  list: () => pick(mockAddressApi, realAddressApi).list(),
  create: input => pick(mockAddressApi, realAddressApi).create(input),
  update: (id, patch) => pick(mockAddressApi, realAddressApi).update(id, patch),
  setDefault: id => pick(mockAddressApi, realAddressApi).setDefault(id),
  remove: id => pick(mockAddressApi, realAddressApi).remove(id),
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
  markAllRead: () => pick(mockNotificationApi, realNotificationApi).markAllRead(),
};

