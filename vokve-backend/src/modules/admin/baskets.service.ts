import type { PipelineStage } from 'mongoose';
import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { clearCart, getCart, listWishlist, removeCartLine, removeCoupon } from '../commerce/service.js';
import { CartModel, OrderModel, ShopInventoryModel, ShopItemModel, WishlistModel } from '../commerce/models.js';
import { UserModel } from '../identity/models.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * Baskets and saved items (RULES R14).
 *
 * The two places a member's intent sits before it becomes an order, and
 * neither was visible to anybody. Which matters in both directions: a
 * basket nobody checked out is the shop's clearest list of what is nearly
 * selling, and a basket that *cannot* be checked out — because a line went
 * out of stock or was retired under it — is a member stuck on a screen
 * with no way to say so.
 *
 * Two rules shape what is here:
 *
 *   - **A basket is references, not snapshots.** The lines point at
 *     catalogue rows, so a price that changes while something sits in a
 *     basket is the new price at checkout. Every figure below is therefore
 *     computed now, at today's prices, and is not what the member saw when
 *     they added it.
 *   - **Two different kinds of stuck, and only one of them lasts.** A line
 *     whose item is off the shelf is dropped by `getCart` — and the drop
 *     written back — so it clears itself the next time the member opens
 *     their basket, and this read, which calls `getCart` to quote the
 *     basket as they see it, clears it too. A line whose item is simply
 *     *out of stock* is kept and refused at checkout, with nothing to tell
 *     the member why. That second one is the one to act on, and it is what
 *     `blocked` counts.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const basketQuery = z.object({
  /** A member id, or an email, a phone or part of a name. */
  q: z.string().max(120).default(''),
  state: z.enum(['any', 'with_coupon', 'blocked', 'off_shelf', 'stale', 'fresh']).default('any'),
  /** What "stale" means — days since the basket was last touched. */
  staleDays: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['updated', 'value', 'units', 'oldest']).default('updated'),
});
export type BasketQuery = z.infer<typeof basketQuery>;

/**
 * Every basket with something in it, dearest or most recent first.
 *
 * The value is summed in the pipeline rather than in a second pass, so
 * "the biggest baskets nobody checked out" is a sort the database does
 * rather than a sort of one page. `blocked` counts the lines a checkout
 * would refuse — retired, deleted or out of stock — because those are the
 * baskets to act on rather than to chase.
 */
export async function listBaskets(query: BasketQuery) {
  const config = await getConfig();
  const staleBefore = new Date(Date.now() - query.staleDays * 86_400_000);

  const match: Record<string, unknown> = { 'lines.0': { $exists: true } };
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    const members = await UserModel.find(
      { $or: [{ _id: trimmed }, { email: like }, { phone: like }, { name: like }] },
      { _id: 1 },
    )
      .limit(500)
      .lean();
    match._id = { $in: members.map(member => member._id) };
  }
  if (query.state === 'with_coupon') match.couponCode = { $ne: null };
  if (query.state === 'stale') match.updatedAt = { $lte: staleBefore };
  if (query.state === 'fresh') match.updatedAt = { $gt: staleBefore };

  const order: Record<string, 1 | -1> =
    query.sort === 'value'
      ? { value: -1 }
      : query.sort === 'units'
        ? { units: -1 }
        : query.sort === 'oldest'
          ? { updatedAt: 1 }
          : { updatedAt: -1 };

  /**
   * One line at a time, joined to its catalogue row and its stock, then
   * added back up. `preserveNullAndEmptyArrays` is what keeps a line whose
   * item has been deleted outright: dropping it would make a broken basket
   * look like a shorter one.
   */
  const pipeline: PipelineStage[] = [
    { $match: match },
    { $unwind: '$lines' },
    { $lookup: { from: 'shop_items', localField: 'lines.itemId', foreignField: '_id', as: 'item' } },
    { $unwind: { path: '$item', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'shop_inventory', localField: 'lines.itemId', foreignField: '_id', as: 'stock' } },
    { $unwind: { path: '$stock', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$_id',
        couponCode: { $first: '$couponCode' },
        updatedAt: { $first: '$updatedAt' },
        createdAt: { $first: '$createdAt' },
        lines: { $sum: 1 },
        units: { $sum: '$lines.quantity' },
        value: { $sum: { $multiply: ['$lines.quantity', { $ifNull: ['$item.price', 0] }] } },
        /**
         * Two different kinds of stuck, counted apart, because only one of
         * them lasts: a line short of stock is kept by the member's own
         * basket and refused at checkout, while a line whose item is off
         * the shelf is dropped — and the drop written back — the next time
         * they open it. The first is work; the second is history.
         */
        blocked: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$item.active', true] },
                  { $lt: [{ $ifNull: ['$stock.onHand', 0] }, '$lines.quantity'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        offShelf: {
          $sum: { $cond: [{ $or: [{ $not: ['$item'] }, { $eq: ['$item.active', false] }] }, 1, 0] },
        },
        titles: { $push: { $ifNull: ['$item.title', '$lines.itemId'] } },
      },
    },
  ];
  if (query.state === 'blocked') pipeline.push({ $match: { blocked: { $gt: 0 } } });
  if (query.state === 'off_shelf') pipeline.push({ $match: { offShelf: { $gt: 0 } } });

  const [faceted] = await CartModel.aggregate<{
    page: {
      _id: string;
      couponCode: string | null;
      updatedAt: Date;
      createdAt: Date;
      lines: number;
      units: number;
      value: number;
      blocked: number;
      offShelf: number;
      titles: string[];
    }[];
    summary: { baskets: number; units: number; value: number; blocked: number; offShelf: number }[];
  }>([
    ...pipeline,
    {
      $facet: {
        page: [{ $sort: order }, { $skip: query.offset }, { $limit: query.limit }],
        summary: [
          {
            $group: {
              _id: null,
              baskets: { $sum: 1 },
              units: { $sum: '$units' },
              value: { $sum: '$value' },
              blocked: { $sum: { $cond: [{ $gt: ['$blocked', 0] }, 1, 0] } },
              offShelf: { $sum: { $cond: [{ $gt: ['$offShelf', 0] }, 1, 0] } },
            },
          },
        ],
      },
    },
  ]);

  const rows = faceted?.page ?? [];
  const summary = faceted?.summary?.[0];

  const members = await UserModel.find({ _id: { $in: rows.map(row => row._id) } }, { name: 1, email: 1, phone: 1 }).lean();
  const memberOf = new Map(members.map(member => [member._id, member]));

  /**
   * Whether they have ordered since the basket was last touched.
   *
   * An abandoned basket where the member went on to order something else is
   * not abandoned — it is a shortlist. Chasing it would be chasing a
   * customer who already bought.
   */
  const since = await OrderModel.aggregate<{ _id: string; lastAt: Date }>([
    { $match: { userId: { $in: rows.map(row => row._id) } } },
    { $group: { _id: '$userId', lastAt: { $max: '$placedAt' } } },
  ]);
  const lastOrderOf = new Map(since.map(row => [row._id, row.lastAt]));

  return {
    total: summary?.baskets ?? 0,
    offset: query.offset,
    limit: query.limit,
    shop: {
      paymentMode: config.commerce.paymentMode,
      coinValuePaise: config.commerce.coinValuePaise,
      currency: config.commerce.currency,
      couponsEnabled: config.commerce.couponsEnabled,
    },
    /** At today's prices, across every basket the filter matched. */
    totals: {
      baskets: summary?.baskets ?? 0,
      units: summary?.units ?? 0,
      value: summary?.value ?? 0,
      blocked: summary?.blocked ?? 0,
      offShelf: summary?.offShelf ?? 0,
      staleDays: query.staleDays,
    },
    data: rows.map(row => {
      const member = memberOf.get(row._id);
      const lastOrderAt = lastOrderOf.get(row._id) ?? null;
      return {
        member: {
          id: row._id,
          name: member?.name ?? '',
          email: member?.email ?? null,
          phone: member?.phone ?? null,
        },
        lines: row.lines,
        units: row.units,
        /** Paise, at today's prices — a basket is references, not a snapshot. */
        value: row.value,
        couponCode: row.couponCode ?? null,
        /** Lines short of stock: kept by their basket, refused at checkout. */
        blocked: row.blocked,
        /** Lines whose item is off the shelf; their next basket open drops these. */
        offShelf: row.offShelf,
        titles: row.titles.slice(0, 4),
        updatedAt: iso(row.updatedAt),
        createdAt: iso(row.createdAt),
        stale: row.updatedAt.getTime() <= staleBefore.getTime(),
        lastOrderAt: iso(lastOrderAt),
        /** They bought something after last touching this basket. */
        orderedSince: Boolean(lastOrderAt && lastOrderAt.getTime() > row.updatedAt.getTime()),
      };
    }),
    nextCursor: null,
  };
}

type ItemRow = {
  _id: string;
  title: string;
  price: number;
  /** The operator's figure for a coins-only sale; null is the price in coins. */
  coinPrice?: number | null;
  mrp: number | null;
  emoji: string | null;
  imageUrl: string | null;
  category: string;
  paymentMode: string | null;
  active: boolean;
};

/**
 * One member's basket and saved items, as stored and as they see it.
 *
 * `member` is `getCart` — the same call the app makes, so the quote, the
 * coupon and its problem text are exactly what is on their screen. `lines`
 * is the raw rows beside it, including the ones their view drops, which is
 * what makes "my basket is empty" answerable.
 */
export async function getBasket(userId: string) {
  const account = await UserModel.findById(userId, { name: 1, email: 1, phone: 1 }).lean();
  if (!account) throw Errors.notFound('That account');

  const [config, doc, saved, savedRows] = await Promise.all([
    getConfig(),
    CartModel.findById(userId).lean(),
    listWishlist(userId),
    WishlistModel.find({ userId }).sort({ addedAt: -1 }).lean(),
  ]);
  const stored = (doc?.lines ?? []) as { itemId: string; quantity: number; size: string | null; color?: string | null; addedAt: Date }[];

  const ids = [...new Set([...stored.map(line => line.itemId), ...savedRows.map(row => row.itemId)])];
  const [items, stock] = await Promise.all([
    ShopItemModel.find({ _id: { $in: ids } }).lean(),
    ShopInventoryModel.find({ _id: { $in: ids } }).lean(),
  ]);
  const itemOf = new Map(items.map(item => [item._id, item as unknown as ItemRow]));
  const stockOf = new Map(stock.map(row => [row._id, row.onHand]));

  /**
   * The member's own view — and, as a side effect, the tidy-up.
   *
   * `getCart` drops lines whose item is off the shelf and writes the drop
   * back, which is why `stored` is read *before* this call: afterwards those
   * lines are gone from the database as well. So `offShelf` below is "lines
   * this read has just cleared, as the member's own next basket open would
   * have" rather than a repair somebody has to make.
   */
  const view = await getCart(userId);
  const visible = new Set(view.lines.map(line => line.item.id));

  const lines = stored.map(line => {
    const item = itemOf.get(line.itemId);
    const onHand = stockOf.get(line.itemId) ?? 0;
    const price = item?.price ?? 0;
    return {
      itemId: line.itemId,
      title: item?.title ?? line.itemId,
      emoji: item?.emoji ?? null,
      imageUrl: item?.imageUrl ?? null,
      category: item?.category ?? null,
      quantity: line.quantity,
      size: line.size ?? null,
      color: line.color ?? null,
      /** Paise, at today's price. */
      price,
      lineTotal: price * line.quantity,
      // The item's own coin price where one was set, as the till charges it.
      coinPrice: item?.coinPrice ?? (price === 0 ? 0 : Math.ceil(price / config.commerce.coinValuePaise)),
      paymentMode: item?.paymentMode ?? null,
      effectivePaymentMode: (item?.paymentMode as 'coins' | 'money' | 'mixed' | null) ?? config.commerce.paymentMode,
      onHand,
      /** Why a checkout would refuse this line, or null where it would not. */
      problem: !item
        ? 'The item has been deleted — this read has dropped the line'
        : !item.active
          ? 'The item is off the shelf — this read has dropped the line'
          : onHand === 0
            ? 'Out of stock, and nothing tells them why'
            : onHand < line.quantity
              ? `Only ${onHand} left of ${line.quantity}`
              : null,
      /**
       * Their own basket drew this line. False means the item is off the
       * shelf, so `getCart` has just dropped it for good — not that they are
       * stuck with something they cannot see.
       */
      visibleToMember: visible.has(line.itemId),
      addedAt: iso(line.addedAt),
    };
  });

  const wishlistIds = new Set(saved.map(item => item.id));

  return {
    member: {
      id: userId,
      name: account.name ?? '',
      email: account.email ?? null,
      phone: account.phone ?? null,
    },
    shop: {
      paymentMode: config.commerce.paymentMode,
      coinValuePaise: config.commerce.coinValuePaise,
      currency: config.commerce.currency,
      couponsEnabled: config.commerce.couponsEnabled,
    },
    basket: {
      lines,
      units: lines.reduce((sum, line) => sum + line.quantity, 0),
      value: lines.reduce((sum, line) => sum + line.lineTotal, 0),
      couponCode: doc?.couponCode ?? null,
      /**
       * Lines a checkout would refuse *and that will still be there next
       * time*: out of stock, or short of the quantity asked for. The ones
       * to act on.
       */
      blocked: lines.filter(line => line.visibleToMember && line.problem !== null).length,
      /**
       * Lines pointing at an item off the shelf, which this read has just
       * dropped. Worth showing — it is what the member had — but not a
       * repair: their own next basket open would have done the same.
       */
      offShelf: lines.filter(line => !line.visibleToMember).length,
      updatedAt: iso((doc as { updatedAt?: Date } | null)?.updatedAt),
    },
    /** The quote on their screen: the coupon as applied, and its problem text. */
    quote: view.quote,
    wishlist: savedRows.map(row => {
      const item = itemOf.get(row.itemId);
      const onHand = stockOf.get(row.itemId) ?? 0;
      return {
        itemId: row.itemId,
        title: item?.title ?? row.itemId,
        emoji: item?.emoji ?? null,
        imageUrl: item?.imageUrl ?? null,
        price: item?.price ?? 0,
        onHand,
        active: item?.active ?? false,
        /** Saved and buyable: the one that is worth telling them about. */
        buyable: wishlistIds.has(row.itemId) && onHand > 0,
        addedAt: iso(row.addedAt),
      };
    }),
  };
}

const lineTarget = z
  .object({
    itemId: z.string().trim().min(1).max(80),
    /** A basket can hold one item twice at two sizes; this says which line. */
    size: z.string().trim().max(16).nullable().optional(),
    color: z.string().trim().max(40).nullable().optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export const basketLineBody = lineTarget;
export type BasketLineBody = z.infer<typeof lineTarget>;

export const basketNoteBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/**
 * Takes a line out of somebody's basket.
 *
 * Through the member's own `removeCartLine`, so a basket an operator
 * touched is left in exactly the shape the app would have left it in. The
 * reason is required: this is somebody else's basket, and the audit row is
 * the only place that says why it changed under them.
 */
export async function removeBasketLine(actor: string, userId: string, body: BasketLineBody) {
  const before = await CartModel.findById(userId).lean();
  if (!before) throw Errors.notFound('That basket');
  const size = body.size ?? null;
  const color = body.color ?? null;
  const held = (before.lines ?? []).some(
    line => line.itemId === body.itemId && (line.size ?? null) === size && (line.color ?? null) === color,
  );
  if (!held) throw Errors.notFound('That basket line');

  await removeCartLine(userId, body.itemId, size, color);
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'shop.basket_line_removed',
    subjectType: 'cart',
    subjectId: userId,
    before: { lines: (before.lines ?? []).length },
    after: { itemId: body.itemId, size, color, reason: body.reason },
  });
  return getBasket(userId);
}

/** Empties it, coupon and all — the same call the checkout makes when it succeeds. */
export async function clearBasket(actor: string, userId: string, reason: string) {
  const before = await CartModel.findById(userId).lean();
  if (!before) throw Errors.notFound('That basket');
  await clearCart(userId);
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'shop.basket_cleared',
    subjectType: 'cart',
    subjectId: userId,
    before: { lines: (before.lines ?? []).length, couponCode: before.couponCode ?? null },
    after: { lines: 0, reason },
  });
  return getBasket(userId);
}

/**
 * Takes the coupon off the basket.
 *
 * A cart keeps its code while it does not apply, so that it returns when the
 * basket qualifies (RULES R14) — which is right for a member who is still
 * shopping and wrong for one stuck behind a campaign that has ended.
 */
export async function clearBasketCoupon(actor: string, userId: string, reason: string) {
  const before = await CartModel.findById(userId).lean();
  if (!before?.couponCode) throw Errors.validation({ couponCode: 'There is no coupon on that basket.' });
  await removeCoupon(userId);
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'shop.basket_coupon_removed',
    subjectType: 'cart',
    subjectId: userId,
    before: { couponCode: before.couponCode },
    after: { couponCode: null, reason },
  });
  return getBasket(userId);
}

/** Unsaves an item for somebody. The row is keyed on the pair, so this is exact. */
export async function removeWishlistEntry(actor: string, userId: string, itemId: string, reason: string) {
  const gone = await WishlistModel.deleteOne({ userId, itemId });
  if (gone.deletedCount === 0) throw Errors.notFound('That saved item');
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'shop.wishlist_removed',
    subjectType: 'wishlist',
    subjectId: `${userId}:${itemId}`,
    before: { saved: true },
    after: { saved: false, reason },
  });
  return getBasket(userId);
}

export const demandQuery = z.object({
  /** `wishlist` is what people saved; `basket` is what they got as far as a basket. */
  of: z.enum(['wishlist', 'basket', 'both']).default('both'),
  state: z.enum(['any', 'out_of_stock', 'low_stock']).default('any'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type DemandQuery = z.infer<typeof demandQuery>;

/**
 * What people want, against what is on the shelf.
 *
 * The one report that reads both collections together: an item fifty people
 * saved and nobody can buy is a restock, and an item nobody saved and the
 * shelf is full of is a markdown. Sorted by the wanting rather than by the
 * selling, which is the point — sales figures can only ever show what was
 * in stock.
 */
export async function demand(query: DemandQuery) {
  const [saves, baskets] = await Promise.all([
    query.of === 'basket'
      ? []
      : WishlistModel.aggregate<{ _id: string; members: number }>([
          { $group: { _id: '$itemId', members: { $addToSet: '$userId' } } },
          { $project: { members: { $size: '$members' } } },
        ]),
    query.of === 'wishlist'
      ? []
      : CartModel.aggregate<{ _id: string; members: number; units: number }>([
          { $unwind: '$lines' },
          { $group: { _id: '$lines.itemId', members: { $addToSet: '$_id' }, units: { $sum: '$lines.quantity' } } },
          { $project: { members: { $size: '$members' }, units: 1 } },
        ]),
  ]);

  const savedOf = new Map(saves.map(row => [row._id, row.members]));
  const basketOf = new Map(baskets.map(row => [row._id, row]));
  const ids = [...new Set([...savedOf.keys(), ...basketOf.keys()])];
  if (ids.length === 0) {
    return { total: 0, offset: query.offset, limit: query.limit, data: [], nextCursor: null };
  }

  const [items, stock] = await Promise.all([
    ShopItemModel.find({ _id: { $in: ids } }, { title: 1, price: 1, category: 1, active: 1, emoji: 1, popularity: 1 }).lean(),
    ShopInventoryModel.find({ _id: { $in: ids } }).lean(),
  ]);
  const itemOf = new Map(items.map(item => [item._id, item]));
  const stockOf = new Map(stock.map(row => [row._id, row]));

  const rows = ids
    .map(id => {
      const item = itemOf.get(id);
      const inventory = stockOf.get(id);
      const onHand = inventory?.onHand ?? 0;
      const lowStockAt = inventory?.lowStockAt ?? 5;
      const saved = savedOf.get(id) ?? 0;
      const basket = basketOf.get(id);
      return {
        itemId: id,
        title: item?.title ?? id,
        emoji: item?.emoji ?? null,
        category: item?.category ?? null,
        price: item?.price ?? 0,
        active: item?.active ?? false,
        /** Members who saved it. */
        saved,
        /** Members with it in a basket now, and how many units those baskets hold. */
        inBaskets: basket?.members ?? 0,
        units: basket?.units ?? 0,
        onHand,
        low: onHand > 0 && onHand <= lowStockAt,
        out: onHand === 0,
        /** The two wantings added up — what the list is ordered by. */
        wanted: saved + (basket?.members ?? 0),
        /** Wanted by more people than there are units to sell them. */
        short: Math.max(0, saved + (basket?.units ?? 0) - onHand),
      };
    })
    .filter(row => (query.state === 'out_of_stock' ? row.out : query.state === 'low_stock' ? row.low : true))
    .sort((a, b) => b.wanted - a.wanted || b.short - a.short);

  return {
    total: rows.length,
    offset: query.offset,
    limit: query.limit,
    data: rows.slice(query.offset, query.offset + query.limit),
    nextCursor: null,
  };
}
