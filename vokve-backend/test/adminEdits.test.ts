import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ReviewModel, ShopItemModel } from '../src/modules/commerce/models.js';
import { UserModel, UserSettingsModel } from '../src/modules/identity/models.js';
import { AuditLogModel, MediaAssetModel } from '../src/modules/platform/models.js';
import { VitalReadingModel } from '../src/modules/vitals/models.js';
import { app, authed, signUpAndRegister } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

describe('admin: correcting a member’s profile', () => {
  it('changes only what differs, keeps units in step, and says what changed', async () => {
    const session = await signUpAndRegister();
    await UserModel.updateOne({ _id: session.userId }, { $set: { name: 'Asha', units: 'metric' } });

    const saved = await request(app)
      .put(`/v1/admin/users/${session.userId}/profile`)
      .set(ADMIN)
      .send({ name: 'Asha Verma', units: 'imperial', heightCm: 162, gender: 'female', reason: 'member asked on chat' });
    expect(saved.status).toBe(200);
    // `gender` was already female from sign-up, so it is not a change.
    expect(saved.body.changed.sort()).toEqual(['heightCm', 'name', 'units']);
    expect(saved.body.profile).toMatchObject({ name: 'Asha Verma', units: 'imperial', heightCm: 162 });
    expect(await UserSettingsModel.findById(session.userId).lean()).toMatchObject({ units: 'imperial' });

    const audit = await AuditLogModel.findOne({ action: 'member.profile', subjectId: session.userId }).lean();
    expect(audit?.before).toMatchObject({ name: 'Asha', units: 'metric', heightCm: null });
    expect(audit?.after).toMatchObject({ name: 'Asha Verma', reason: 'member asked on chat' });

    // The overview reads it back, so the panel's form opens on what is stored.
    const overview = await request(app).get(`/v1/admin/users/${session.userId}`).set(ADMIN);
    expect(overview.body.account).toMatchObject({ name: 'Asha Verma', heightCm: 162, units: 'imperial' });
  });

  it('takes a new email or number as unproven, and refuses one another account holds', async () => {
    const one = await signUpAndRegister();
    const two = await signUpAndRegister();
    await UserModel.updateOne({ _id: one.userId }, { $set: { emailVerifiedAt: new Date(), phoneVerifiedAt: new Date() } });

    const taken = await request(app)
      .put(`/v1/admin/users/${one.userId}/profile`)
      .set(ADMIN)
      .send({ email: two.email.toUpperCase(), reason: 'typo fix' });
    expect(taken.status).toBe(422);

    const moved = await request(app)
      .put(`/v1/admin/users/${one.userId}/profile`)
      .set(ADMIN)
      .send({ email: 'new-address@example.com', phone: '+919000000001', reason: 'lost the old phone' });
    expect(moved.status).toBe(200);
    expect(moved.body.changed.sort()).toEqual(['email', 'phone']);
    expect(moved.body.profile).toMatchObject({ email: 'new-address@example.com', emailVerifiedAt: null, phoneVerifiedAt: null });
  });

  it('records a weight as a reading, and refuses a patch that changes nothing or has no reason', async () => {
    const session = await signUpAndRegister();
    const weighed = await request(app)
      .put(`/v1/admin/users/${session.userId}/profile`)
      .set(ADMIN)
      .send({ weightKg: 64, reason: 'typed it wrong at sign-up' });
    expect(weighed.status).toBe(200);
    const reading = await VitalReadingModel.findOne({ userId: session.userId, kind: 'weight' }).lean();
    expect(reading).toMatchObject({ value: 64 });

    const same = await request(app)
      .put(`/v1/admin/users/${session.userId}/profile`)
      .set(ADMIN)
      .send({ weightKg: 64, reason: 'again' });
    expect(same.status).toBe(422);

    const noReason = await request(app).put(`/v1/admin/users/${session.userId}/profile`).set(ADMIN).send({ name: 'Ravi' });
    expect(noReason.status).toBe(422);

    const nobody = await request(app).put('/v1/admin/users/usr_nobody/profile').set(ADMIN).send({ name: 'Ravi', reason: 'x y z' });
    expect(nobody.status).toBe(404);
  });
});

describe('admin: correcting a review', () => {
  it('edits the words in place and recounts the item when the stars move', async () => {
    const cross = await signUpAndRegister();
    const happy = await signUpAndRegister();
    for (const [session, rating, body] of [[cross, 1, 'Call me on 98765 43210, awful.'], [happy, 5, 'Wear it every day.']] as const) {
      const res = await request(app).put('/v1/shop/items/tee/reviews/me').set(authed(session)).send({ rating, body });
      expect(res.status).toBe(200);
    }
    const row = await ReviewModel.findOne({ itemId: 'tee', userId: cross.userId }).lean();

    const edited = await request(app)
      .put(`/v1/admin/shop/reviews/${row!._id}`)
      .set(ADMIN)
      .send({ body: 'Awful.', rating: 3, reason: 'phone number in the text; member meant 3 stars' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ review: { body: 'Awful.', rating: 3 }, rating: { average: 4, count: 2 } });
    expect(await ShopItemModel.findById('tee').lean()).toMatchObject({ ratingAverage: 4, ratingCount: 2 });

    const audit = await AuditLogModel.findOne({ action: 'shop.review_edited', subjectId: row!._id }).lean();
    expect(audit?.before).toMatchObject({ body: 'Call me on 98765 43210, awful.', rating: 1 });

    const nothing = await request(app).put(`/v1/admin/shop/reviews/${row!._id}`).set(ADMIN).send({ body: 'Awful.', reason: 'again' });
    expect(nothing.status).toBe(422);
  });
});

describe('admin: renaming an image', () => {
  it('changes the name and the shelf, never the url', async () => {
    await MediaAssetModel.create({
      _id: 'med_1', key: 'shop/abc.jpg', url: 'https://cdn.example.com/shop/abc.jpg', filename: 'IMG_2041.jpg',
      kind: 'shop', contentType: 'image/jpeg', bytes: 1000, uploadedBy: 'admin',
    });
    const renamed = await request(app).put('/v1/admin/media/med_1').set(ADMIN).send({ filename: 'protein-bar.jpg', kind: 'food' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ filename: 'protein-bar.jpg', kind: 'food', url: 'https://cdn.example.com/shop/abc.jpg' });

    expect((await request(app).put('/v1/admin/media/med_1').set(ADMIN).send({})).status).toBe(422);
    expect((await request(app).put('/v1/admin/media/med_nope').set(ADMIN).send({ filename: 'x.jpg' })).status).toBe(404);
  });
});
