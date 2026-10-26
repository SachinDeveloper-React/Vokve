import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ShopInventoryModel, ShopItemModel } from '../src/modules/commerce/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { slugOfTitle } from '../src/modules/admin/catalogue.service.js';
import { seed } from '../src/seed/seed.js';
import { app } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/**
 * A spreadsheet's worth of products (`POST /admin/shop/items/import`).
 *
 * The panel reads the `.xlsx` and sends rows, so what is checked here is the
 * half that writes: the dry run that writes nothing, the slug an import is
 * matched by, the row that is refused without taking the sheet down with it,
 * and the stock that goes to inventory. Prices are paise — rupees belong to
 * the panel, which is where they are drawn.
 */

const row = (over: Record<string, unknown> = {}) => ({
  title: 'Cork Yoga Block',
  price: 49_900,
  category: 'gym',
  ...over,
});

const importRows = (rows: Record<string, unknown>[], dryRun = false) =>
  request(app).post('/v1/admin/shop/items/import').set(ADMIN).send({ rows, dryRun });

describe('admin: importing the catalogue', () => {
  it('a dry run says what would happen and writes nothing', async () => {
    await seed();

    const checked = await importRows([row({ line: 2 }), row({ line: 3, title: 'Steel Bottle 750' })], true);

    expect(checked.status).toBe(200);
    expect(checked.body).toMatchObject({ dryRun: true, created: 2, updated: 0, duplicates: 0, failed: [] });
    expect(await ShopItemModel.findById('cork-yoga-block').lean()).toBeNull();
    // Nothing written means nothing logged either.
    expect(await AuditLogModel.countDocuments({ action: 'shop.items_imported' })).toBe(0);
  });

  it('writes the rows, deriving a slug from the name', async () => {
    await seed();

    const written = await importRows([row({ line: 2, onHand: 12, lowStockAt: 3 })]);

    expect(written.body).toMatchObject({ created: 1, updated: 0, ids: ['cork-yoga-block'] });
    expect(slugOfTitle('Cork Yoga Block')).toBe('cork-yoga-block');
    expect(await ShopItemModel.findById('cork-yoga-block').lean()).toMatchObject({
      title: 'Cork Yoga Block',
      price: 49_900,
      category: 'gym',
    });
    // Stock is the other half of an order going wrong, so it goes with it.
    expect(await ShopInventoryModel.findById('cork-yoga-block').lean()).toMatchObject({ onHand: 12, lowStockAt: 3 });
    expect(await AuditLogModel.countDocuments({ action: 'shop.items_imported' })).toBe(1);
  });

  it('the same sheet twice corrects the same products rather than listing them twice', async () => {
    await seed();
    await importRows([row({ line: 2 })]);

    const again = await importRows([row({ line: 2, price: 44_900 })]);

    expect(again.body).toMatchObject({ created: 0, updated: 1 });
    expect(await ShopItemModel.countDocuments({ title: 'Cork Yoga Block' })).toBe(1);
    expect(await ShopItemModel.findById('cork-yoga-block').lean()).toMatchObject({ price: 44_900 });
  });

  it('an id column is used as the slug, and a bad one is refused by itself', async () => {
    await seed();

    const mixed = await importRows([
      row({ line: 2, id: 'yoga-block', title: 'Cork Yoga Block' }),
      row({ line: 3, id: 'Not A Slug', title: 'Steel Bottle' }),
    ]);

    // The schema refuses the whole call for a malformed id, because an id
    // that is not a slug is a column mapped to the wrong thing — which the
    // panel catches first, by line.
    expect(mixed.status).toBe(422);

    const good = await importRows([row({ line: 2, id: 'yoga-block' })]);
    expect(good.body).toMatchObject({ created: 1, ids: ['yoga-block'] });
    expect(await ShopItemModel.findById('yoga-block').lean()).toMatchObject({ title: 'Cork Yoga Block' });
  });

  it('a row naming a shelf that does not exist is skipped, and the rest are written', async () => {
    await seed();

    const mixed = await importRows([
      row({ line: 2 }),
      row({ line: 3, title: 'Mystery Thing', category: 'not-a-shelf' }),
    ]);

    expect(mixed.body).toMatchObject({ created: 1, updated: 0 });
    expect(mixed.body.failed).toHaveLength(1);
    expect(mixed.body.failed[0]).toMatchObject({ line: 3, title: 'Mystery Thing' });
    // The refusal names the shelves there are, because the fix is on another
    // page and the operator should not have to go looking for it.
    expect(mixed.body.failed[0].reason).toContain('gym');
    expect(await ShopItemModel.findById('cork-yoga-block').lean()).not.toBeNull();
    expect(await ShopItemModel.findById('mystery-thing').lean()).toBeNull();
  });

  it('a dry run checks the shelf too, so the second press holds no surprises', async () => {
    await seed();

    const checked = await importRows([row({ line: 2, category: 'not-a-shelf' })], true);

    expect(checked.body).toMatchObject({ dryRun: true, created: 0 });
    expect(checked.body.failed).toHaveLength(1);
  });

  it('a sheet that names the same product twice writes it once', async () => {
    await seed();

    const twice = await importRows([
      row({ line: 2, price: 49_900 }),
      row({ line: 7, price: 39_900 }),
    ]);

    // Folded together, last one winning — the same rule the food library's
    // import follows.
    expect(twice.body).toMatchObject({ duplicates: 1 });
    expect(await ShopItemModel.countDocuments({ title: 'Cork Yoga Block' })).toBe(1);
    expect(await ShopItemModel.findById('cork-yoga-block').lean()).toMatchObject({ price: 39_900 });
  });

  it('carries the fields a shelf is actually merchandised with', async () => {
    await seed();

    const rich = await importRows([
      row({
        line: 2,
        mrp: 59_900,
        coinPrice: 2_000,
        paymentMode: 'mixed',
        badge: 'bestseller',
        ribbon: 'Save ₹100',
        isDeal: true,
        featured: true,
        tags: ['yoga', 'block'],
        sizes: ['One size'],
        colors: [{ name: 'Cork', hex: '#c8a165' }],
        sort: 3,
        active: false,
      }),
    ]);

    expect(rich.body).toMatchObject({ created: 1 });
    expect(await ShopItemModel.findById('cork-yoga-block').lean()).toMatchObject({
      mrp: 59_900,
      coinPrice: 2_000,
      paymentMode: 'mixed',
      badge: 'bestseller',
      isDeal: true,
      featured: true,
      sort: 3,
      // Listed but not on the shelf: staging a launch.
      active: false,
    });
  });

  it('refuses a price of zero and a title that is not one', async () => {
    await seed();

    expect((await importRows([row({ price: 0 })])).status).toBe(422);
    expect((await importRows([row({ title: '' })])).status).toBe(422);
    expect((await importRows([])).status).toBe(422);
  });

  it('is behind the operator key like everything else here', async () => {
    await seed();

    const open = await request(app).post('/v1/admin/shop/items/import').send({ rows: [row()] });

    expect(open.status).toBe(401);
  });
});
