import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ReferralPromoModel } from '../src/modules/content/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { seed } from '../src/seed/seed.js';
import { app, authed, signUpAndRegister } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/**
 * The invite card the app draws around the place (`/admin/referral-cards`,
 * BACKEND §6.15).
 *
 * The same shape as the tips beside it, so what is checked here is what is
 * different: that the reward in the words is the one the economy is paying
 * rather than one somebody typed, that a screen can be silenced on its own,
 * and that the member endpoint reads a card written a moment ago without an
 * app release.
 */

describe('admin: the invite card, screen by screen', () => {
  it('lists every screen with the card it is drawing today', async () => {
    await seed();

    const page = await request(app).get('/v1/admin/referral-cards').set(ADMIN);

    expect(page.status).toBe(200);
    expect(page.body.screens).toContain('wallet');
    expect(page.body.accents).toContain('gold');
    expect(page.body.positions).toEqual(['top', 'middle', 'bottom']);
    const wallet = page.body.byScreen.find((row: { screen: string }) => row.screen === 'wallet');
    expect(wallet.todayId).toBe('wallet-invite-1');
    // Every screen the app can draw one on ships with one.
    expect(page.body.totals.silentScreens).toEqual([]);
    expect(page.body.data.filter((row: { showingToday: boolean }) => row.showingToday).length).toBeGreaterThan(0);
  });

  it('fills the reward from what the economy pays, not from the words', async () => {
    await seed();
    const session = await signUpAndRegister();

    const res = await request(app).get('/v1/content/referral-cards').set(authed(session));

    expect(res.status).toBe(200);
    const wallet = res.body.cards.wallet;
    // `{coins}` in the seeded line, 20 in `coins.referral.inviter`.
    expect(wallet.title).toBe('The quickest 20 coins here');
    expect(wallet.message).toContain('20 coins for every friend');
    expect(wallet).toMatchObject({
      inviterCoins: 20,
      inviteeCoins: 20,
      accent: 'gold',
      // Seeded mid-screen: at the foot of a wallet it is under the ledger,
      // which is a long way past where anybody stops scrolling.
      position: 'middle',
    });
    expect(wallet.message).not.toContain('{coins}');
  });

  it('writes a card, and the app reads it without a release', async () => {
    await seed();
    const session = await signUpAndRegister();
    // One card for the screen, so today's is not in doubt.
    await ReferralPromoModel.updateMany({ screen: 'home' }, { $set: { active: false } });

    const written = await request(app)
      .post('/v1/admin/referral-cards')
      .set(ADMIN)
      .send({
        id: 'home-invite-diwali',
        screen: 'home',
        title: 'Double up this Diwali',
        message: 'Bring a friend and take {coins} coins each.',
        ctaLabel: 'Share now',
        accent: 'gold',
        emoji: '🪔',
        sort: 5,
        note: 'festival push',
      });

    expect(written.status).toBe(201);
    expect(written.body.created).toBe(true);

    const res = await request(app).get('/v1/content/referral-cards').set(authed(session));
    expect(res.body.cards.home).toMatchObject({
      id: 'home-invite-diwali',
      title: 'Double up this Diwali',
      message: 'Bring a friend and take 20 coins each.',
      ctaLabel: 'Share now',
      accent: 'gold',
      emoji: '🪔',
    });

    expect(
      await AuditLogModel.countDocuments({
        action: 'content.referral_card_created',
        subjectId: 'home-invite-diwali',
      }),
    ).toBe(1);
  });

  it('moves a card up the screen without touching anything else', async () => {
    await seed();
    const session = await signUpAndRegister();

    const moved = await request(app)
      .put('/v1/admin/referral-cards/streak-invite-1')
      .set(ADMIN)
      .send({ position: 'top', note: 'nobody scrolls to the foot of the streak' });
    expect(moved.status).toBe(200);
    expect(moved.body.card.position).toBe('top');

    const res = await request(app).get('/v1/content/referral-cards').set(authed(session));
    expect(res.body.cards.streak.position).toBe('top');
    // The words and the colour are untouched by a move.
    expect(res.body.cards.streak.title).toBe('Streaks love a rival');
    // And the other screens keep theirs.
    expect(res.body.cards.nutrition.position).toBe('bottom');
  });

  it('a screen with nothing live draws no card at all', async () => {
    await seed();
    const session = await signUpAndRegister();

    const hidden = await request(app)
      .put('/v1/admin/referral-cards/shop-invite-1')
      .set(ADMIN)
      .send({ active: false, note: 'pulled from the shop' });
    expect(hidden.status).toBe(200);

    const res = await request(app).get('/v1/content/referral-cards').set(authed(session));
    // Absent, not blank: the app draws nothing where there is no card.
    expect(res.body.cards.shop).toBeUndefined();
    // And the other screens are untouched.
    expect(res.body.cards.wallet).toBeTruthy();

    const page = await request(app).get('/v1/admin/referral-cards').set(ADMIN);
    expect(page.body.totals.silentScreens).toEqual(['shop']);
  });

  it('rotates a screen with two live cards by the day', async () => {
    await seed();
    const session = await signUpAndRegister();
    await request(app)
      .post('/v1/admin/referral-cards')
      .set(ADMIN)
      .send({
        id: 'home-invite-2',
        screen: 'home',
        title: 'A second line',
        message: 'Also worth {coins} coins.',
        sort: 2,
      });

    const res = await request(app).get('/v1/content/referral-cards').set(authed(session));
    // Whichever of the two the day lands on, it is one of them and only one.
    expect(['home-invite-1', 'home-invite-2']).toContain(res.body.cards.home.id);
  });

  it('refuses a screen the app has nowhere to draw', async () => {
    const res = await request(app)
      .post('/v1/admin/referral-cards')
      .set(ADMIN)
      .send({ id: 'checkout-invite', screen: 'checkout', title: 'Nope', message: 'Nope' });

    expect(res.status).toBe(422);
  });

  it('deletes a card for good, and says so in the log', async () => {
    await seed();

    const gone = await request(app)
      .delete('/v1/admin/referral-cards/streak-invite-1')
      .set(ADMIN)
      .send({ note: 'campaign over' });

    expect(gone.status).toBe(200);
    expect(await ReferralPromoModel.countDocuments({ _id: 'streak-invite-1' })).toBe(0);
    expect(
      await AuditLogModel.countDocuments({
        action: 'content.referral_card_deleted',
        subjectId: 'streak-invite-1',
      }),
    ).toBe(1);
  });

  it('a re-seed leaves a card an operator has rewritten', async () => {
    await seed();
    await request(app)
      .put('/v1/admin/referral-cards/home-invite-1')
      .set(ADMIN)
      .send({ title: 'Our own words' });

    await seed();

    const row = await ReferralPromoModel.findById('home-invite-1').lean();
    expect(row?.title).toBe('Our own words');
  });
});
