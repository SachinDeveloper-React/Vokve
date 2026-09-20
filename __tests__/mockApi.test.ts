/**
 * The mock backend is what the whole app runs on until a real one exists, so
 * a hole in it looks exactly like a bug in a screen. These checks pin down the
 * contract the screens were built against: the code that works, the ones that
 * do not, and the failures a developer needs to be able to reach on purpose.
 *
 * @format
 */

// Latency is what makes spinners visible in the app and slow in a test suite.
jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

import { config } from '../src/constants/config';
import { ApiError } from '../src/services/api/errors';
import { shouldUseMockApi } from '../src/services/api/endpoints';
import {
  MOCK_RULES,
  MOCK_STEP_UP_THRESHOLD,
  mockActivityApi,
  mockAddressApi,
  mockAuthApi,
  mockCartApi,
  mockCheckoutApi,
  mockNotificationApi,
  mockOrderApi,
  mockReferralApi,
  mockShopApi,
  mockUserApi,
  mockWalletApi,
  mockWishlistApi,
  mockWorkoutApi,
} from '../src/services/api/mockApi';
import {
  REFERRAL_REWARD_COINS,
  referralCode,
  seedCoinTransactions,
  seedNotifications,
} from '../src/constants/seedData';
import type { SignUpPayload } from '../src/types/forms';

const PAYLOAD: SignUpPayload = {
  email: 'sachin@example.com',
  phone: '+919876543210',
  password: 'longenough1',
  dateOfBirth: '1995-04-17',
  gender: 'male',
};

/** Signing out is the mock's own reset — it clears every bit of module state. */
beforeEach(async () => {
  await mockAuthApi.signOut();
});

const expectApiError = async (
  run: () => Promise<unknown>,
  kind: ApiError['kind'],
) => {
  await expect(run()).rejects.toBeInstanceOf(ApiError);
  await run().catch(error => {
    expect((error as ApiError).kind).toBe(kind);
  });
};

describe('the mock switch', () => {
  // The backend exists now (vokve-backend/), so the default is the real API.
  test('is off now that there is a backend', () => {
    expect(shouldUseMockApi()).toBe(false);
  });

  test('turns on from the config flag alone', () => {
    const mutable = config as { useMockApi: boolean };
    mutable.useMockApi = true;
    try {
      expect(shouldUseMockApi()).toBe(true);
    } finally {
      mutable.useMockApi = false;
    }
  });
});

describe('mock sign-up and verification', () => {
  test('returns a challenge rather than a session', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);

    // The code goes to the email while there is no SMS provider, as on the
    // server (`otp.signupChannel`), so the phone field is empty and the
    // masked target is the address.
    expect(challenge.channel).toBe('email');
    expect(challenge.phone).toBe('');
    expect(challenge.target).toMatch(/^.•••@/);
    expect(challenge.codeLength).toBe(MOCK_RULES.otp.length);
    expect(challenge.expiresInSeconds).toBeGreaterThan(0);
    expect(challenge.resendInSeconds).toBeGreaterThan(0);
    // No tokens anywhere: the number is not proven yet.
    expect(challenge).not.toHaveProperty('tokens');
  });

  test('issues a session once the right code comes back', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);
    const { user, tokens } = await mockAuthApi.verifyOtp(
      challenge.verificationId,
      MOCK_RULES.otp,
    );

    expect(tokens.accessToken).toBeTruthy();
    expect(user.email).toBe(PAYLOAD.email);
    expect(user.phone).toBe(PAYLOAD.phone);
    expect(user.gender).toBe('male');
    // Sign-up collects no name, so one has to be derived rather than left blank.
    expect(user.name).toBeTruthy();
  });

  test('rejects any code that is not the magic one', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);

    await expectApiError(
      () => mockAuthApi.verifyOtp(challenge.verificationId, '000000'),
      'validation',
    );
  });

  test('rejects a verification id it has never seen', async () => {
    await expectApiError(
      () => mockAuthApi.verifyOtp('ver_nope', MOCK_RULES.otp),
      'not_found',
    );
  });

  test('will not verify the same sign-up twice', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);
    await mockAuthApi.verifyOtp(challenge.verificationId, MOCK_RULES.otp);

    await expectApiError(
      () => mockAuthApi.verifyOtp(challenge.verificationId, MOCK_RULES.otp),
      'not_found',
    );
  });

  test('a resend restarts both clocks on the same sign-up', async () => {
    const first = await mockAuthApi.signUp(PAYLOAD);
    const second = await mockAuthApi.resendOtp(first.verificationId);

    expect(second.verificationId).toBe(first.verificationId);
    expect(second.resendInSeconds).toBeGreaterThan(0);
    expect(second.expiresInSeconds).toBeGreaterThan(0);
  });

  test('offers a way to reach the "already registered" path on purpose', async () => {
    await expectApiError(
      () =>
        mockAuthApi.signUp({
          ...PAYLOAD,
          email: `${MOCK_RULES.takenMarker}@example.com`,
        }),
      'validation',
    );
  });
});

describe('mock onboarding', () => {
  test('a fresh sign-up arrives with no profile and no stamp', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);
    const { user } = await mockAuthApi.verifyOtp(
      challenge.verificationId,
      MOCK_RULES.otp,
    );

    // Seeding these would skip the onboarding step entirely.
    expect(user.profileCompletedAt).toBeNull();
    expect(user.heightCm).toBeNull();
    expect(user.weightKg).toBeNull();
  });

  test('completing the profile stamps it and stores canonical units', async () => {
    const challenge = await mockAuthApi.signUp(PAYLOAD);
    await mockAuthApi.verifyOtp(challenge.verificationId, MOCK_RULES.otp);

    const user = await mockUserApi.completeProfile({
      name: 'Rahul Sharma',
      heightCm: 175,
      weightKg: 68,
      units: 'metric',
    });

    expect(user.name).toBe('Rahul Sharma');
    expect(user.heightCm).toBe(175);
    expect(user.weightKg).toBe(68);
    expect(user.profileCompletedAt).not.toBeNull();
  });

  test('refuses to complete a profile with no session behind it', async () => {
    await expectApiError(
      () =>
        mockUserApi.completeProfile({
          name: 'Rahul Sharma',
          heightCm: 175,
          weightKg: 68,
          units: 'metric',
        }),
      'unauthorized',
    );
  });
});

describe('mock sign-in', () => {
  test('accepts any credentials, so the app is never locked out', async () => {
    const { tokens } = await mockAuthApi.signIn('anyone@example.com', 'secret');
    expect(tokens.accessToken).toBeTruthy();
  });

  test('offers a way to reach the rejection path on purpose', async () => {
    await expectApiError(
      () => mockAuthApi.signIn('a@b.com', MOCK_RULES.rejectedPassword),
      'unauthorized',
    );
  });
});

describe('mock session restore', () => {
  test('fails the way a dead token does, before anyone has signed in', async () => {
    await expectApiError(() => mockUserApi.me(), 'unauthorized');
  });

  test('returns the signed-in user afterwards', async () => {
    await mockAuthApi.signIn('a@b.com', 'secret');
    await expect(mockUserApi.me()).resolves.toHaveProperty('id');
  });
});

describe('mock app data', () => {
  test('serves the workout templates the screens already read', async () => {
    await expect(mockWorkoutApi.templates()).resolves.not.toHaveLength(0);
  });

  test('starts a new account with no history, so the empty state is reachable', async () => {
    await expect(mockWorkoutApi.history()).resolves.toEqual({ data: [], nextCursor: null });
  });

  test('returns a full week of activity, dated and consistent', async () => {
    const week = await mockActivityApi.weekly();

    expect(week).toHaveLength(7);
    for (const day of week) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.steps).toBeGreaterThan(0);
      expect(day.caloriesBurned).toBeGreaterThan(0);
    }
    // Last entry is today, which is what the Today screen assumes.
    expect(week[6].date).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('the wallet ledger', () => {
  test('pages with a cursor the way the server does', async () => {
    const first = await mockWalletApi.transactions({ limit: 4 });
    expect(first.data).toHaveLength(4);
    expect(first.nextCursor).toBe(first.data[3].id);

    const second = await mockWalletApi.transactions({
      limit: 4,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data[0].id).toBe(seedCoinTransactions[4].id);

    // Walk to the end: the last page says there is no more.
    const third = await mockWalletApi.transactions({
      limit: 4,
      cursor: second.nextCursor ?? undefined,
    });
    expect(third.nextCursor).toBeNull();
    expect(first.data.length + second.data.length + third.data.length).toBe(
      seedCoinTransactions.length,
    );
  });

  test('filters to one source and pages inside it', async () => {
    const page = await mockWalletApi.transactions({ source: 'workout', limit: 2 });
    expect(page.data.every(row => row.source === 'workout')).toBe(true);
    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    const rest = await mockWalletApi.transactions({
      source: 'workout',
      cursor: page.nextCursor ?? undefined,
    });
    expect(rest.data.every(row => row.source === 'workout')).toBe(true);
    expect(rest.nextCursor).toBeNull();
  });

  test("the month summary is this calendar month's rows, not the lifetime", async () => {
    const wallet = await mockWalletApi.get();
    const now = new Date();
    const thisMonth = seedCoinTransactions.filter(row => {
      const at = new Date(row.createdAt);
      return at.getMonth() === now.getMonth() && at.getFullYear() === now.getFullYear();
    });
    const earned = thisMonth.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const spent = thisMonth.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0);

    expect(wallet.monthSummary).toEqual({ earned, spent, net: earned - spent });
  });
});

describe('the notification feed', () => {
  test('pages with a cursor and filters by chip', async () => {
    const first = await mockNotificationApi.list({ limit: 3 });
    expect(first.data).toHaveLength(3);
    expect(first.nextCursor).toBe(first.data[2].id);

    const second = await mockNotificationApi.list({
      limit: 3,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data[0].id).toBe(seedNotifications[3].id);

    const rewards = await mockNotificationApi.list({ category: 'reward' });
    expect(rewards.data.length).toBeGreaterThan(0);
    expect(
      rewards.data.every(n => ['coins', 'challenge', 'reward'].includes(n.topic)),
    ).toBe(true);
  });

  test('a read mark survives the next fetch, and sign-out forgets it', async () => {
    const before = await mockNotificationApi.list();
    const target = before.data.find(n => !n.read);
    if (!target) throw new Error('The seed has no unread row to read');

    await mockNotificationApi.markRead(target.id);
    const after = await mockNotificationApi.list();
    expect(after.data.find(n => n.id === target.id)?.read).toBe(true);

    await mockNotificationApi.markAllRead();
    expect((await mockNotificationApi.list()).data.every(n => n.read)).toBe(true);

    await mockAuthApi.signOut();
    expect((await mockNotificationApi.list()).data.some(n => !n.read)).toBe(true);
  });
});

describe('the shop, orders and addresses', () => {
  const ADDRESS = {
    label: 'Home', name: 'Asha Verma', phone: '+919876543210', line1: '12 MG Road', line2: '',
    city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'IN', isDefault: false,
  };

  /** Signs in and walks the flow to a session, as the screens would. */
  const signIn = async () => {
    await mockAuthApi.signUp(PAYLOAD);
    const challenge = await mockAuthApi.signUp({ ...PAYLOAD, email: 'shopper@example.com', phone: '+919876543211' });
    await mockAuthApi.verifyOtp(challenge.verificationId, MOCK_RULES.otp);
  };

  test('the catalogue carries stock, and filters by category, deals and featured', async () => {
    const all = await mockShopApi.items({ limit: 100 });
    expect(all.total).toBeGreaterThan(20);
    expect(all.data.find(i => i.id === 'gym-towel')?.inStock).toBe(false);
    const clothing = await mockShopApi.items({ category: 'clothing' });
    expect(clothing.data.every(i => i.category === 'clothing')).toBe(true);
    const deals = await mockShopApi.items({ deals: true });
    expect(deals.data.every(i => i.isDeal)).toBe(true);
    const featured = await mockShopApi.items({ featured: true });
    expect(featured.data.every(i => i.featured)).toBe(true);
    const inStock = await mockShopApi.items({ category: 'accessories', inStock: true });
    expect(inStock.data.some(i => i.id === 'gym-towel')).toBe(false);
  });

  test('searches by prefix across title, tags and subcategory, sorts, and pages', async () => {
    const vest = await mockShopApi.items({ q: 'vest' });
    expect(vest.data.map(i => i.id)).toEqual(['tank-top']);
    const leather = await mockShopApi.items({ q: 'leather ball' });
    expect(leather.data.map(i => i.id)).toEqual(['cricket-ball']);
    expect((await mockShopApi.items({ q: 'zzzz' })).total).toBe(0);

    const cheap = await mockShopApi.items({ sort: 'price_asc', limit: 1 });
    expect(cheap.data[0].id).toBe('sweatbands');
    const dear = await mockShopApi.items({ sort: 'price_desc', limit: 1 });
    expect(dear.data[0].id).toBe('kettlebell-8');

    const first = await mockShopApi.items({ limit: 10 });
    expect(first.data).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const second = await mockShopApi.items({ limit: 10, cursor: first.nextCursor ?? undefined });
    expect(second.data[0].id).not.toBe(first.data[0].id);
    expect(new Set([...first.data, ...second.data].map(i => i.id)).size).toBe(20);
  });

  test('describes each shelf with counts and subcategories', async () => {
    const shelves = await mockShopApi.categories();
    expect(shelves.map(s => s.category)).toEqual(['clothing', 'gym', 'sports', 'accessories']);
    const clothing = shelves.find(s => s.category === 'clothing')!;
    expect(clothing.count).toBe(8);
    expect(clothing.subcategories[0]).toEqual({ name: 'T-shirts', count: 2 });
    const accessories = shelves.find(s => s.category === 'accessories')!;
    expect(accessories.inStock).toBe(accessories.count - 1); // the towel
  });

  test('the first address is the default; the default can move, and a deleted default hands over', async () => {
    await signIn();
    const home = await mockAddressApi.create(ADDRESS);
    expect(home.isDefault).toBe(true);
    const office = await mockAddressApi.create({ ...ADDRESS, label: 'Office' });
    expect(office.isDefault).toBe(false);

    await mockAddressApi.setDefault(office.id);
    const book = await mockAddressApi.list();
    expect(book.map(a => [a.label, a.isDefault])).toEqual([['Office', true], ['Home', false]]);

    await mockAddressApi.remove(office.id);
    expect((await mockAddressApi.list())[0]).toMatchObject({ label: 'Home', isDefault: true });
  });

  test('the basket keeps lines by item and size, checks sizes, and quotes the split', async () => {
    await signIn();
    await expectApiError(() => mockCartApi.setLine({ itemId: 'tee', quantity: 1 }), 'validation');
    await mockCartApi.setLine({ itemId: 'tee', quantity: 2, size: 'M' });
    const cart = await mockCartApi.setLine({ itemId: 'cap', quantity: 1 });
    expect(cart.lines.map(l => [l.item.id, l.quantity, l.size])).toEqual([['tee', 2, 'M'], ['cap', 1, null]]);
    expect(cart.count).toBe(3);
    // ₹1,598 + ₹449 = ₹2,047 of goods, over the free-shipping line; 30% is 2,456 coins, capped by the wallet.
    const balance = Math.floor((await mockWalletApi.get()).balance);
    expect(cart.quote).toMatchObject({ subtotal: 204700, shipping: 0, coinsMax: Math.min(2456, balance) });
    expect(cart.quote.payable).toBe(204700 - cart.quote.coinsValue);

    const fewer = await mockCartApi.setLine({ itemId: 'tee', quantity: 0, size: 'M' });
    expect(fewer.lines.map(l => l.item.id)).toEqual(['cap']);
    expect((await mockCartApi.clear()).count).toBe(0);
  });

  test('the wishlist saves once, lists newest first, and forgets', async () => {
    await signIn();
    await mockWishlistApi.add('cap');
    await mockWishlistApi.add('yoga-mat');
    await mockWishlistApi.add('cap');
    expect(await mockWishlistApi.ids()).toEqual(['yoga-mat', 'cap']);
    expect((await mockWishlistApi.list()).map(i => i.id)).toEqual(['yoga-mat', 'cap']);
    await mockWishlistApi.remove('cap');
    expect(await mockWishlistApi.ids()).toEqual(['yoga-mat']);
  });

  test('a quote splits the goods between coins and money the way the server does', async () => {
    await signIn();
    // A ₹449 cap: 30% at ₹0.25 a coin is 538 coins; ₹49 to ship under ₹999.
    const q = await mockCheckoutApi.quote([{ itemId: 'cap', quantity: 1, size: null }], 'max');
    expect(q).toMatchObject({ subtotal: 44900, discount: 15000, shipping: 4900, total: 49800, coinsMax: 538, coinsApplied: 538, coinsValue: 13450, payable: 36350 });
    expect((await mockCheckoutApi.quote([{ itemId: 'cap', quantity: 1, size: null }], 100)).payable).toBe(49800 - 2500);
    expect((await mockCheckoutApi.quote([{ itemId: 'kettlebell-8', quantity: 1, size: null }], 'max')).shipping).toBe(0);
  });

  test('checkout needs an address, holds coins and stock as pending, and pay makes it an order', async () => {
    await signIn();
    await expectApiError(
      () => mockCheckoutApi.place({ lines: [{ itemId: 'cap', quantity: 1, size: null }], addressId: 'nope', coins: 0 }, { idempotencyKey: 'k' }),
      'validation',
    );
    const home = await mockAddressApi.create(ADDRESS);
    const before = (await mockWalletApi.get()).balance;

    const placed = await mockCheckoutApi.place({ lines: [{ itemId: 'cap', quantity: 1, size: null }], addressId: home.id, coins: 300 }, { idempotencyKey: 'k' });
    expect(placed.order).toMatchObject({ status: 'pending_payment', coinsUsed: 300, coinsValue: 7500, payable: 42300, cancellable: true, address: { city: 'Bengaluru' } });
    expect(placed.payment).toMatchObject({ provider: 'mock', amount: 42300 });
    expect(placed.balance).toBe(before - 300);
    expect(await mockOrderApi.count()).toBe(0);

    const paid = await mockCheckoutApi.pay(placed.order.id, { providerPaymentId: 'mockpay_1' }, { idempotencyKey: 'p' });
    expect(paid.order).toMatchObject({ status: 'placed', payment: { status: 'paid' } });
    expect(await mockOrderApi.count()).toBe(1);
    expect((await mockOrderApi.list()).data[0].id).toBe(placed.order.id);

    // Cancel puts the coins and the stock back and refunds the money; a second cancel changes nothing.
    const cancelled = await mockOrderApi.cancel(placed.order.id, { idempotencyKey: 'c' });
    expect(cancelled.order).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' } });
    expect(cancelled.balance).toBe(before);
    expect((await mockOrderApi.cancel(placed.order.id, { idempotencyKey: 'c2' })).balance).toBe(before);

    // More coins than the quote allows is refused; an order the coins cover is placed at once.
    await expectApiError(
      () => mockCheckoutApi.place({ lines: [{ itemId: 'cap', quantity: 1, size: null }], addressId: home.id, coins: 9999 }, { idempotencyKey: 'k3' }),
      'validation',
    );
  });

  test('a thousand coins in one order asks for a step-up, and the code it issues works once', async () => {
    await signIn();
    const home = await mockAddressApi.create(ADDRESS);
    const hoodie = { lines: [{ itemId: 'hoodie', quantity: 1, size: 'L' }], addressId: home.id, coins: MOCK_STEP_UP_THRESHOLD };

    await expectApiError(() => mockCheckoutApi.place(hoodie, { idempotencyKey: 'k' }), 'forbidden');

    const challenge = await mockAuthApi.stepUp();
    expect(challenge).toMatchObject({ channel: 'email', purpose: 'step_up' });
    const verified = await mockAuthApi.verifyOtp(challenge.verificationId, MOCK_RULES.otp);
    expect(verified.stepUpToken).toEqual(expect.any(String));

    const placed = await mockCheckoutApi.place({ ...hoodie, stepUpToken: verified.stepUpToken! }, { idempotencyKey: 'k' });
    expect(placed.order.coinsUsed).toBe(MOCK_STEP_UP_THRESHOLD);
    expect(placed.order.items[0].size).toBe('L');

    // The coins come back on cancel, and the same token is refused the second time.
    await mockOrderApi.cancel(placed.order.id, { idempotencyKey: 'c' });
    await expectApiError(
      () => mockCheckoutApi.place({ ...hoodie, stepUpToken: verified.stepUpToken! }, { idempotencyKey: 'k2' }),
      'forbidden',
    );
  });

  test('reviews: one per user, verified for a buyer, summarised onto the item', async () => {
    await signIn();
    const home = await mockAddressApi.create(ADDRESS);
    const placed = await mockCheckoutApi.place({ lines: [{ itemId: 'yoga-mat', quantity: 1, size: null }], addressId: home.id, coins: 0 }, { idempotencyKey: 'k' });
    await mockCheckoutApi.pay(placed.order.id, { providerPaymentId: 'mockpay_2' }, { idempotencyKey: 'p' });

    await expectApiError(() => mockShopApi.writeReview('yoga-mat', { rating: 5, body: 'Great' }), 'validation');
    const mine = await mockShopApi.writeReview('yoga-mat', { rating: 4, title: 'Grippy', body: 'Stays put on a wooden floor.' });
    expect(mine).toMatchObject({ rating: 4, verified: true, mine: true });
    const edited = await mockShopApi.writeReview('yoga-mat', { rating: 5, body: 'Stays put on a wooden floor. Still grippy.' });
    expect(edited.id).toBe(mine.id);

    const page = await mockShopApi.reviews('yoga-mat');
    expect(page.summary).toEqual({ average: 5, count: 1, histogram: [0, 0, 0, 0, 1] });
    expect(page.mine?.id).toBe(mine.id);
    expect((await mockShopApi.item('yoga-mat')).rating).toEqual({ average: 5, count: 1 });
    expect((await mockShopApi.items({ sort: 'rating', limit: 1 })).data[0].id).toBe('yoga-mat');

    await mockShopApi.deleteReview('yoga-mat');
    expect((await mockShopApi.item('yoga-mat')).rating).toEqual({ average: 0, count: 0 });
  });
});

describe('the referral programme', () => {
  test('serves the code, the share text with it, and the amounts', async () => {
    const me = await mockReferralApi.me();
    expect(me.code).toBe(referralCode);
    expect(me.shareMessage).toContain(referralCode);
    expect(me.shareUrl).toContain(referralCode);
    expect(me.rewards).toMatchObject({ inviter: REFERRAL_REWARD_COINS, invitee: REFERRAL_REWARD_COINS });
    expect(me.stats.successful + me.stats.pending).toBe(me.referrals.length);
    expect(me).toMatchObject({ applied: null, canApply: true });
  });

  test("a code typed at sign-up is checked on the form and applied when the account is created", async () => {
    await expectApiError(
      () => mockAuthApi.signUp({ ...PAYLOAD, referralCode: 'NOPE999' }),
      'validation',
    );
    await mockAuthApi.signUp({ ...PAYLOAD, referralCode: 'NOPE999' }).catch(error => {
      expect((error as ApiError).fieldErrors).toHaveProperty('referralCode');
    });

    const challenge = await mockAuthApi.signUp({ ...PAYLOAD, referralCode: 'ASHA2K7' });
    // Nothing applied until the code passes.
    expect((await mockReferralApi.me()).applied).toBeNull();
    await mockAuthApi.verifyOtp(challenge.verificationId, MOCK_RULES.otp);
    expect((await mockReferralApi.me()).applied).toMatchObject({ code: 'ASHA2K7', inviterName: 'Asha', status: 'pending' });
  });

  test('applying a friend\'s code once is accepted; your own, an unknown one, or a second is refused', async () => {
    await expectApiError(() => mockReferralApi.apply(referralCode), 'validation');
    await expectApiError(() => mockReferralApi.apply('NOPE123'), 'not_found');

    const applied = await mockReferralApi.apply('asha 2k7');
    expect(applied.applied).toMatchObject({ code: 'ASHA2K7', inviterName: 'Asha', status: 'pending' });
    expect(applied.canApply).toBe(false);

    await expectApiError(() => mockReferralApi.apply('RAVI9XB'), 'unknown');
    // Sign-out forgets it, like the rest of the mock's state.
    await mockAuthApi.signOut();
    expect((await mockReferralApi.me()).applied).toBeNull();
  });
});
