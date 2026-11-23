import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { getKV } from '../src/db/redis.js';
import { ShopItemModel } from '../src/modules/commerce/models.js';
import { seed } from '../src/seed/seed.js';
import { app } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/**
 * The shop with no payment gateway (D-109).
 *
 * Production on the mock gateway takes no money, so the server sells every
 * product for coins whatever it is set to (the member's side is in
 * `security.test.ts`), and the panel may not newly make a product a money
 * one — that is the mistake that would turn into a real money product the
 * day a gateway is connected. `NODE_ENV` is read per call, so flipping it
 * here stands the server in production.
 */

/**
 * Stands the server in production. The KV is made first: it is chosen on
 * first use, and made under `production` it would be the project's real
 * Redis rather than the test's in-memory one.
 */
function standInProduction(): void {
  getKV();
  env.NODE_ENV = 'production';
}

const product = (over: Record<string, unknown> = {}) => ({
  id: 'cork-yoga-block',
  title: 'Cork Yoga Block',
  price: 49_900,
  category: 'gym',
  ...over,
});

describe('admin: no payment gateway, no money products (D-109)', () => {
  afterEach(() => {
    env.NODE_ENV = 'test';
  });

  it('tells the panel there is no gateway, and reads every product as coins', async () => {
    await seed();
    expect(env.PAYMENT_PROVIDER).toBe('mock');
    standInProduction();

    const list = await request(app).get('/v1/admin/shop/items').query({ limit: 100 }).set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.shop).toMatchObject({ paymentMode: 'coins', configuredPaymentMode: 'mixed', moneyPayments: false });
    // Its own setting is kept, for the day a gateway is connected; what is in force is coins.
    expect(list.body.data.find((item: { id: string }) => item.id === 'foam-roller')).toMatchObject({
      paymentMode: 'money',
      effectivePaymentMode: 'coins',
    });
    expect(list.body.data.every((item: { effectivePaymentMode: string }) => item.effectivePaymentMode === 'coins')).toBe(true);

    env.NODE_ENV = 'test';
    const later = await request(app).get('/v1/admin/shop/items').query({ limit: 100 }).set(ADMIN);
    expect(later.body.shop).toMatchObject({ paymentMode: 'mixed', moneyPayments: true });
    expect(later.body.data.find((item: { id: string }) => item.id === 'foam-roller').effectivePaymentMode).toBe('money');
  });

  it('refuses to list or switch a product to money or mixed, and takes coins or the shop’s mode', async () => {
    await seed();
    standInProduction();

    for (const paymentMode of ['money', 'mixed']) {
      const refused = await request(app).post('/v1/admin/shop/items').set(ADMIN).send(product({ paymentMode }));
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('MONEY_PAYMENTS_UNAVAILABLE');
    }
    expect(await ShopItemModel.findById('cork-yoga-block').lean()).toBeNull();

    const coins = await request(app).post('/v1/admin/shop/items').set(ADMIN).send(product({ paymentMode: 'coins' }));
    expect(coins.status).toBe(201);
    const shops = await request(app).post('/v1/admin/shop/items').set(ADMIN).send(product({ id: 'chalk-ball', title: 'Chalk Ball', paymentMode: null }));
    expect(shops.status).toBe(201);
    expect(shops.body.item).toMatchObject({ paymentMode: null, effectivePaymentMode: 'coins' });

    const quick = await request(app).put('/v1/admin/shop/items/cap').set(ADMIN).send({ paymentMode: 'mixed' });
    expect(quick.status).toBe(422);
    expect((await ShopItemModel.findById('cap').lean())!.paymentMode ?? null).toBeNull();

    // A product set to money before can still be edited without being refused
    // — it sells for coins until a gateway is connected — and moved to coins.
    const kept = await request(app).put('/v1/admin/shop/items/foam-roller').set(ADMIN).send({ price: 59_900, paymentMode: 'money' });
    expect(kept.status).toBe(200);
    expect(kept.body.item).toMatchObject({ price: 59_900, paymentMode: 'money', effectivePaymentMode: 'coins' });
    const moved = await request(app).put('/v1/admin/shop/items/foam-roller').set(ADMIN).send({ paymentMode: 'coins' });
    expect(moved.body.item.paymentMode).toBe('coins');

    // A sheet is held to the same, on the dry run as well as the write.
    const rows = [
      { line: 2, title: 'Resistance Band', price: 29_900, category: 'gym', paymentMode: 'money' },
      { line: 3, title: 'Grip Trainer', price: 19_900, category: 'gym', paymentMode: 'coins' },
    ];
    for (const dryRun of [true, false]) {
      const sheet = await request(app).post('/v1/admin/shop/items/import').set(ADMIN).send({ rows, dryRun });
      expect(sheet.status).toBe(200);
      expect(sheet.body.created).toBe(1);
      expect(sheet.body.failed).toEqual([{ line: 2, title: 'Resistance Band', reason: expect.stringContaining('No payment gateway') }]);
    }
    expect(await ShopItemModel.findById('resistance-band').lean()).toBeNull();

    // With a gateway, money is the operator's to choose again.
    env.NODE_ENV = 'test';
    const allowed = await request(app).put('/v1/admin/shop/items/cap').set(ADMIN).send({ paymentMode: 'mixed' });
    expect(allowed.status).toBe(200);
  });
});
