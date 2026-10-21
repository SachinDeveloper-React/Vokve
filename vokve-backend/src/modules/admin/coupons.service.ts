import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { CartModel, CouponModel, CouponUsageModel, OrderModel } from '../commerce/models.js';
import { UserModel } from '../identity/models.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * Coupons (RULES R16).
 *
 * The till already knew how to honour one — `checkCoupon` in commerce
 * decides whether a code applies and for how much — but nothing could
 * *write* one. A campaign meant a developer inserting a document, and the
 * fields that decide what a campaign costs (`maxDiscount`, `maxRedemptions`,
 * `perUserLimit`) were the ones most likely to be left at a default nobody
 * chose.
 *
 * Three things worth knowing about what this writes:
 *
 *   - **A code is its id, upper-case.** `checkCoupon` looks it up by the
 *     normalised code, so anything written here is normalised the same way:
 *     a coupon stored as `summer10` is a coupon no member can ever use.
 *   - **`redemptions` is the till's figure, not an operator's.** Checkout
 *     `$inc`s it under a conditional write and a cancel gives it back, which
 *     is what holds `maxRedemptions` when two orders race. Nothing here
 *     sets it; a patch that lowered it would hand out claims that were
 *     already spent.
 *   - **Deleting is for a coupon nothing happened to.** One that has been
 *     redeemed is deactivated instead, because an order holds its own
 *     `{ code, title, discount }` snapshot and the usage rows are what the
 *     per-member limit is counted from. Deleting it would leave an order
 *     citing a campaign that no longer exists.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

/** What the member typed, as a code is stored. Mirrors `normaliseCouponCode`. */
const normalise = (code: string): string => code.trim().toUpperCase();

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Redemptions left in a coupon, or null where it has no ceiling. */
const remaining = (row: { maxRedemptions: number | null; redemptions: number }): number | null =>
  row.maxRedemptions === null ? null : Math.max(0, row.maxRedemptions - row.redemptions);

export type CouponState = 'live' | 'scheduled' | 'expired' | 'exhausted' | 'inactive';

/**
 * Which of the five a coupon is in, in the order the till refuses them.
 *
 * `checkCoupon` tests active, then the window, then the ceiling — so a
 * switched-off coupon reads "inactive" even if it is also expired, which is
 * the reason the operator would be told "it is off" rather than sent to
 * change a date that would not help.
 */
function stateOf(row: { active: boolean; startsAt: Date | null; endsAt: Date | null; maxRedemptions: number | null; redemptions: number }, now = Date.now()): CouponState {
  if (!row.active) return 'inactive';
  if (row.startsAt && row.startsAt.getTime() > now) return 'scheduled';
  if (row.endsAt && row.endsAt.getTime() <= now) return 'expired';
  if (row.maxRedemptions !== null && row.redemptions >= row.maxRedemptions) return 'exhausted';
  return 'live';
}

/** The one `$expr` worth writing by hand: a ceiling a row has not reached. */
const UNDER_CEILING = {
  $expr: { $or: [{ $eq: ['$maxRedemptions', null] }, { $lt: ['$redemptions', '$maxRedemptions'] }] },
};

export const couponQuery = z.object({
  q: z.string().max(120).default(''),
  /** The five states, as the till reads them. */
  state: z.enum(['any', 'live', 'scheduled', 'expired', 'exhausted', 'inactive']).default('any'),
  kind: z.enum(['percent', 'flat']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['newest', 'code', 'redemptions', 'value', 'ending']).default('newest'),
});
export type CouponQuery = z.infer<typeof couponQuery>;

/**
 * Every coupon, with what it has actually cost.
 *
 * `redemptions` says how many orders claimed it; `given` says what those
 * claims took off, summed from the orders' own snapshots rather than
 * recomputed — a coupon whose rules changed last week still shows what it
 * really gave away.
 */
export async function listCoupons(query: CouponQuery) {
  const config = await getConfig();
  const now = new Date();
  const filter: Record<string, unknown> = {};
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    filter.$or = [{ _id: like }, { title: like }];
  }
  if (query.kind) filter.kind = query.kind;
  switch (query.state) {
    case 'live':
      Object.assign(filter, {
        active: true,
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
          UNDER_CEILING,
        ],
      });
      break;
    case 'scheduled':
      Object.assign(filter, { active: true, startsAt: { $gt: now } });
      break;
    case 'expired':
      Object.assign(filter, { endsAt: { $ne: null, $lte: now } });
      break;
    case 'exhausted':
      Object.assign(filter, {
        maxRedemptions: { $ne: null },
        $expr: { $gte: ['$redemptions', '$maxRedemptions'] },
      });
      break;
    case 'inactive':
      filter.active = false;
      break;
    default:
      break;
  }

  const order: Record<string, 1 | -1> =
    query.sort === 'code'
      ? { _id: 1 }
      : query.sort === 'redemptions'
        ? { redemptions: -1 }
        : query.sort === 'value'
          ? { value: -1 }
          : query.sort === 'ending'
            ? { endsAt: 1 }
            : { createdAt: -1 };

  const [rows, total] = await Promise.all([
    CouponModel.find(filter).sort(order).skip(query.offset).limit(query.limit).lean(),
    CouponModel.countDocuments(filter),
  ]);

  const codes = rows.map(row => row._id);
  const [spend, overall] = await Promise.all([
    OrderModel.aggregate<{ _id: string; orders: number; given: number; goods: number; cancelled: number }>([
      { $match: { 'coupon.code': { $in: codes } } },
      {
        $group: {
          _id: '$coupon.code',
          orders: { $sum: 1 },
          given: { $sum: { $ifNull: ['$coupon.discount', 0] } },
          goods: { $sum: '$subtotal' },
          // A cancelled order gave its claim back (RULES R16), so it is
          // counted apart rather than quietly inflating what a campaign cost.
          cancelled: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'refunded']] }, 1, 0] } },
        },
      },
    ]),
    CouponModel.aggregate<{ _id: null; coupons: number; redemptions: number }>([
      { $group: { _id: null, coupons: { $sum: 1 }, redemptions: { $sum: '$redemptions' } } },
    ]),
  ]);
  const spendOf = new Map(spend.map(row => [row._id, row]));

  return {
    total,
    offset: query.offset,
    limit: query.limit,
    /** The shop's own switch: with coupons off, no code applies whatever is written here. */
    shop: {
      couponsEnabled: config.commerce.couponsEnabled,
      paymentMode: config.commerce.paymentMode,
      coinValuePaise: config.commerce.coinValuePaise,
      currency: config.commerce.currency,
    },
    totals: {
      coupons: overall[0]?.coupons ?? 0,
      redemptions: overall[0]?.redemptions ?? 0,
      given: spend.reduce((sum, row) => sum + row.given, 0),
    },
    data: rows.map(row => {
      const used = spendOf.get(row._id);
      return {
        code: row._id,
        title: row.title,
        kind: row.kind as 'percent' | 'flat',
        /** 1–100 for a percent coupon; paise for a flat one. */
        value: row.value,
        maxDiscount: row.maxDiscount ?? null,
        minSubtotal: row.minSubtotal ?? 0,
        startsAt: iso(row.startsAt),
        endsAt: iso(row.endsAt),
        maxRedemptions: row.maxRedemptions ?? null,
        redemptions: row.redemptions ?? 0,
        remaining: remaining({ maxRedemptions: row.maxRedemptions ?? null, redemptions: row.redemptions ?? 0 }),
        perUserLimit: row.perUserLimit ?? 1,
        active: row.active ?? true,
        state: stateOf({
          active: row.active ?? true,
          startsAt: row.startsAt ?? null,
          endsAt: row.endsAt ?? null,
          maxRedemptions: row.maxRedemptions ?? null,
          redemptions: row.redemptions ?? 0,
        }),
        /** What orders holding it actually took off, in paise. */
        given: used?.given ?? 0,
        orders: used?.orders ?? 0,
        goods: used?.goods ?? 0,
        cancelledOrders: used?.cancelled ?? 0,
        /** Whether it may be deleted rather than retired — see `deleteCoupon`. */
        deletable: (row.redemptions ?? 0) === 0 && (used?.orders ?? 0) === 0,
        createdAt: iso((row as { createdAt?: Date }).createdAt),
        updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
      };
    }),
    nextCursor: null,
  };
}

/** One coupon, with who claimed it and the orders that hold it. */
export async function getCoupon(rawCode: string) {
  const code = normalise(rawCode);
  const row = await CouponModel.findById(code).lean();
  if (!row) throw Errors.notFound('That coupon');

  const page = await listCoupons({ q: code, state: 'any', limit: 1, offset: 0, sort: 'code' });
  const coupon = page.data.find(entry => entry.code === code);
  if (!coupon) throw Errors.notFound('That coupon');

  const [usage, orders] = await Promise.all([
    CouponUsageModel.find({ code }).sort({ count: -1, updatedAt: -1 }).limit(50).lean(),
    OrderModel.find({ 'coupon.code': code }, { number: 1, userId: 1, status: 1, subtotal: 1, total: 1, coupon: 1, placedAt: 1 })
      .sort({ placedAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const memberIds = [...new Set([...usage.map(entry => entry.userId), ...orders.map(entry => entry.userId)])];
  const members = await UserModel.find({ _id: { $in: memberIds } }, { name: 1, email: 1 }).lean();
  const memberOf = new Map(members.map(member => [member._id, member]));
  const named = (userId: string) => ({
    id: userId,
    name: memberOf.get(userId)?.name ?? '',
    email: memberOf.get(userId)?.email ?? null,
  });

  return {
    shop: page.shop,
    coupon,
    /** The per-member counter the limit is actually held by. */
    usage: usage.map(entry => ({
      member: named(entry.userId),
      count: entry.count ?? 0,
      atLimit: (entry.count ?? 0) >= (row.perUserLimit ?? 1),
      lastAt: iso((entry as { updatedAt?: Date }).updatedAt),
    })),
    orders: orders.map(entry => ({
      id: entry._id,
      number: entry.number,
      member: named(entry.userId),
      status: entry.status,
      subtotal: entry.subtotal,
      total: entry.total,
      discount: (entry.coupon as { discount?: number } | null)?.discount ?? 0,
      placedAt: iso(entry.placedAt),
    })),
  };
}

const dateish = z
  .string()
  .trim()
  .max(40)
  .refine(value => !Number.isNaN(Date.parse(value)), 'A date the browser can parse, like 2026-11-01T00:00:00Z')
  .nullable();

export const couponBody = z
  .object({
    /** The code a member types. Stored upper-case, which is how the till looks it up. */
    code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/, 'A code looks like SUMMER10 — letters, numbers, - or _'),
    /** What the member reads on the basket: "10% off, up to ₹150". */
    title: z.string().trim().min(1).max(120),
    kind: z.enum(['percent', 'flat']),
    /** 1–100 for `percent`; paise for `flat`. Checked against `kind` below. */
    value: z.number().int().min(1).max(100_000_000),
    maxDiscount: z.number().int().min(1).max(100_000_000).nullable().optional(),
    minSubtotal: z.number().int().min(0).max(100_000_000).optional(),
    startsAt: dateish.optional(),
    endsAt: dateish.optional(),
    maxRedemptions: z.number().int().min(1).max(10_000_000).nullable().optional(),
    perUserLimit: z.number().int().min(1).max(1_000).optional(),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type CouponBody = z.infer<typeof couponBody>;

export const couponPatch = couponBody.partial().omit({ code: true }).strict();
export type CouponPatch = z.infer<typeof couponPatch>;

/**
 * The rules zod cannot state on its own, because each needs two fields.
 *
 * Every one of these is a coupon that would be written happily and then
 * behave as nobody intended: a 150% discount, a cap on a flat coupon (which
 * `checkCoupon` applies, quietly making ₹200 off into ₹50 off), a window
 * that closes before it opens, or a ceiling already below what has been
 * claimed — which reads as "exhausted" the moment it is saved.
 */
function assertCoherent(
  next: {
    kind: 'percent' | 'flat';
    value: number;
    maxDiscount: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
    maxRedemptions: number | null;
  },
  redemptions: number,
): void {
  if (next.kind === 'percent' && next.value > 100) {
    throw Errors.validation({ value: `A percent coupon takes 1–100% off, not ${next.value}%.` });
  }
  if (next.kind === 'flat' && next.maxDiscount !== null) {
    throw Errors.validation({
      maxDiscount: 'A cap belongs to a percent coupon. On a flat one the till would apply it as well, so ₹200 off with a ₹50 cap is ₹50 off.',
    });
  }
  if (next.startsAt && next.endsAt && next.endsAt.getTime() <= next.startsAt.getTime()) {
    throw Errors.validation({ endsAt: 'It would close before it opened.' });
  }
  if (next.maxRedemptions !== null && next.maxRedemptions < redemptions) {
    throw Errors.validation({
      maxRedemptions: `${redemptions} ${redemptions === 1 ? 'order has' : 'orders have'} already claimed this coupon, so a ceiling of ${next.maxRedemptions} would read as exhausted.`,
    });
  }
}

const asDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(value);

/** Creates a coupon, or rewrites the one with that code. Idempotent on the code. */
export async function saveCoupon(actor: string, body: CouponBody) {
  const code = normalise(body.code);
  const before = await CouponModel.findById(code).lean();
  // `code` stays in `fields`: the audit row wants it, and nothing below
  // reads it from there — the normalised one above is what is written.
  const { note, ...fields } = body;

  const next = {
    kind: fields.kind,
    value: fields.value,
    maxDiscount: fields.maxDiscount ?? null,
    startsAt: asDate(fields.startsAt) ?? null,
    endsAt: asDate(fields.endsAt) ?? null,
    maxRedemptions: fields.maxRedemptions ?? null,
  };
  assertCoherent(next, before?.redemptions ?? 0);

  await CouponModel.updateOne(
    { _id: code },
    {
      $set: {
        title: fields.title,
        kind: next.kind,
        value: next.value,
        maxDiscount: next.maxDiscount,
        minSubtotal: fields.minSubtotal ?? 0,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        maxRedemptions: next.maxRedemptions,
        perUserLimit: fields.perUserLimit ?? 1,
        ...(fields.active === undefined ? {} : { active: fields.active }),
      },
      // `redemptions` is the till's counter: it starts at zero on a new
      // coupon and is never touched again from here. Nothing in `$set` may
      // also appear here — Mongo refuses an update that touches one path
      // twice — so `active` is left to `$set` and to the schema's default.
      $setOnInsert: { _id: code, redemptions: 0 },
    },
    { upsert: true },
  );

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: before ? 'shop.coupon_updated' : 'shop.coupon_created',
    subjectType: 'coupon',
    subjectId: code,
    before: before
      ? { title: before.title, kind: before.kind, value: before.value, active: before.active, maxRedemptions: before.maxRedemptions ?? null }
      : null,
    after: { ...fields, code, note: note ?? null },
  });

  return { created: !before, ...(await getCoupon(code)) };
}

/** A patch, for the one field somebody came to change. */
export async function patchCoupon(actor: string, rawCode: string, body: CouponPatch) {
  const code = normalise(rawCode);
  const before = await CouponModel.findById(code).lean();
  if (!before) throw Errors.notFound('That coupon');
  const { note, ...fields } = body;

  // A coupon that was a percent one keeps its cap unless the patch clears
  // it, and on a flat coupon `checkCoupon` would go on applying it — ₹200
  // off with a ₹150 cap is ₹150 off. Switching the kind therefore clears
  // it, and does so before the check below, which would otherwise refuse
  // the switch over a field the operator never mentioned.
  const capCleared = fields.kind === 'flat' && fields.maxDiscount === undefined && (before.maxDiscount ?? null) !== null;

  const next = {
    kind: fields.kind ?? (before.kind as 'percent' | 'flat'),
    value: fields.value ?? before.value,
    maxDiscount: capCleared ? null : fields.maxDiscount === undefined ? before.maxDiscount ?? null : fields.maxDiscount,
    startsAt: fields.startsAt === undefined ? before.startsAt ?? null : asDate(fields.startsAt) ?? null,
    endsAt: fields.endsAt === undefined ? before.endsAt ?? null : asDate(fields.endsAt) ?? null,
    maxRedemptions: fields.maxRedemptions === undefined ? before.maxRedemptions ?? null : fields.maxRedemptions,
  };
  assertCoherent(next, before.redemptions ?? 0);

  const update: Record<string, unknown> = {};
  if (fields.title !== undefined) update.title = fields.title;
  if (fields.kind !== undefined) update.kind = next.kind;
  if (fields.value !== undefined) update.value = next.value;
  if (fields.maxDiscount !== undefined) update.maxDiscount = next.maxDiscount;
  if (fields.minSubtotal !== undefined) update.minSubtotal = fields.minSubtotal;
  if (fields.startsAt !== undefined) update.startsAt = next.startsAt;
  if (fields.endsAt !== undefined) update.endsAt = next.endsAt;
  if (fields.maxRedemptions !== undefined) update.maxRedemptions = next.maxRedemptions;
  if (fields.perUserLimit !== undefined) update.perUserLimit = fields.perUserLimit;
  if (fields.active !== undefined) update.active = fields.active;

  if (capCleared) update.maxDiscount = null;

  if (Object.keys(update).length > 0) {
    await CouponModel.updateOne({ _id: code }, { $set: update });
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'shop.coupon_updated',
    subjectType: 'coupon',
    subjectId: code,
    before: Object.fromEntries(Object.keys(update).map(key => [key, (before as Record<string, unknown>)[key] ?? null])),
    after: { ...update, note: note ?? null },
  });

  return getCoupon(code);
}

/**
 * Switches it off, or back on.
 *
 * The ordinary way to end a campaign: `checkCoupon` tests `active` first, so
 * an off coupon stops applying everywhere at once while every order that
 * holds it, and every usage row the per-member limit is counted from, stays
 * exactly as it was.
 */
export async function setCouponActive(actor: string, rawCode: string, active: boolean, note?: string) {
  const code = normalise(rawCode);
  const before = await CouponModel.findById(code).lean();
  if (!before) throw Errors.notFound('That coupon');
  await CouponModel.updateOne({ _id: code }, { $set: { active } });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: active ? 'shop.coupon_enabled' : 'shop.coupon_disabled',
    subjectType: 'coupon',
    subjectId: code,
    before: { active: before.active ?? true },
    after: { active, note: note ?? null },
  });
  return getCoupon(code);
}

/**
 * Deletes a coupon nothing ever used.
 *
 * A coupon that has been redeemed is refused: an order holds its own
 * `{ code, title, discount }` snapshot and would be left citing a campaign
 * that no longer exists, and the usage rows are what the per-member limit is
 * counted from. Switching it off does everything deleting it would, which is
 * what the refusal says.
 *
 * The one piece of tidying it does do is in the baskets: a cart keeps its
 * `couponCode` while the code does not apply, so that it comes back when the
 * basket qualifies (RULES R14) — and a cart pointing at a code that has gone
 * would keep failing its check for a reason the member cannot see.
 */
export async function deleteCoupon(actor: string, rawCode: string, note?: string) {
  const code = normalise(rawCode);
  const before = await CouponModel.findById(code).lean();
  if (!before) throw Errors.notFound('That coupon');

  const [orders, usage] = await Promise.all([
    OrderModel.countDocuments({ 'coupon.code': code }),
    CouponUsageModel.countDocuments({ code }),
  ]);
  if ((before.redemptions ?? 0) > 0 || orders > 0 || usage > 0) {
    throw Errors.validation({
      code: `${code} has been used — ${orders} ${orders === 1 ? 'order holds' : 'orders hold'} it. Switch it off instead: that stops it applying everywhere while those orders stay readable.`,
    });
  }

  const baskets = await CartModel.updateMany({ couponCode: code }, { $set: { couponCode: null } });
  await CouponModel.deleteOne({ _id: code });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'shop.coupon_deleted',
    subjectType: 'coupon',
    subjectId: code,
    before: { title: before.title, kind: before.kind, value: before.value, redemptions: before.redemptions ?? 0 },
    after: { deleted: true, basketsCleared: baskets.modifiedCount ?? 0, note: note ?? null },
  });

  return { deleted: true, code, basketsCleared: baskets.modifiedCount ?? 0 };
}
