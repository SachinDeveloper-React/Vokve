import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { recomputeItemRating } from '../commerce/service.js';
import { OrderModel, ReviewModel, ShopItemModel } from '../commerce/models.js';
import { UserModel } from '../identity/models.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * Reviews, from the other side (RULES R15).
 *
 * A review is a member's words on a product page, which makes it the one
 * piece of member-written text in the shop — and the one thing an operator
 * occasionally has to take down. There was no way to: the member's own
 * route deletes their own review and nothing else.
 *
 * Two things worth knowing:
 *
 *   - **Deleting recounts the item.** `ratingAverage` and `ratingCount` are
 *     denormalised onto the item so no list ever joins `reviews`, so a
 *     delete that skipped the recount would leave a rating with nothing
 *     behind it. It goes through commerce's own `recomputeItemRating`.
 *   - **`verified` is not re-decided here.** It was set at write time from
 *     the member's orders and is deliberately never revisited: a review
 *     written after buying stays a buyer's review even if the order was
 *     later refunded. This read says whether they *still* hold an order
 *     for it, separately, because that is what somebody judging a review
 *     wants to know.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const BOUGHT_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered'];

export const reviewQuery = z.object({
  /** Words in the review, its title, the author's name, or an item slug. */
  q: z.string().max(160).default(''),
  itemId: z.string().max(80).optional(),
  userId: z.string().max(80).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  /** `verified` is a review whose author had bought the thing at the time. */
  verified: z.enum(['any', 'yes', 'no']).default('any'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['newest', 'oldest', 'lowest', 'highest']).default('newest'),
});
export type ReviewQuery = z.infer<typeof reviewQuery>;

/**
 * Every review, worst first if asked.
 *
 * `lowest` is the sort this exists for: a one-star review is either a
 * product problem to fix or a review to take down, and both need somebody
 * to read it.
 */
export async function listReviews(query: ReviewQuery) {
  const filter: Record<string, unknown> = {};
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    filter.$or = [{ body: like }, { title: like }, { authorName: like }, { itemId: like }, { _id: trimmed }];
  }
  if (query.itemId) filter.itemId = query.itemId;
  if (query.userId) filter.userId = query.userId;
  if (query.rating) filter.rating = query.rating;
  if (query.verified === 'yes') filter.verified = true;
  if (query.verified === 'no') filter.verified = { $ne: true };

  const order: Record<string, 1 | -1> =
    query.sort === 'oldest'
      ? { createdAt: 1 }
      : query.sort === 'lowest'
        ? { rating: 1, createdAt: -1 }
        : query.sort === 'highest'
          ? { rating: -1, createdAt: -1 }
          : { createdAt: -1 };

  const [rows, total, spread] = await Promise.all([
    ReviewModel.find(filter).sort(order).skip(query.offset).limit(query.limit).lean(),
    ReviewModel.countDocuments(filter),
    ReviewModel.aggregate<{ _id: number; reviews: number }>([
      { $match: filter },
      { $group: { _id: '$rating', reviews: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const itemIds = [...new Set(rows.map(row => row.itemId))];
  const userIds = [...new Set(rows.map(row => row.userId))];
  const [items, members, orders] = await Promise.all([
    ShopItemModel.find({ _id: { $in: itemIds } }, { title: 1, emoji: 1, active: 1, ratingAverage: 1, ratingCount: 1 }).lean(),
    UserModel.find({ _id: { $in: userIds } }, { name: 1, email: 1 }).lean(),
    OrderModel.find(
      { userId: { $in: userIds }, 'items.itemId': { $in: itemIds }, status: { $in: BOUGHT_STATUSES } },
      { userId: 1, 'items.itemId': 1 },
    ).lean(),
  ]);
  const itemOf = new Map(items.map(item => [item._id, item]));
  const memberOf = new Map(members.map(member => [member._id, member]));
  // The pairs that still hold an order, which is not the same question as
  // `verified` — see the note at the top.
  const holds = new Set(orders.flatMap(order => order.items.map(line => `${order.userId}:${line.itemId}`)));

  const histogram = [1, 2, 3, 4, 5].map(rating => ({
    rating,
    reviews: spread.find(row => row._id === rating)?.reviews ?? 0,
  }));
  const counted = histogram.reduce((sum, row) => sum + row.reviews, 0);
  const average =
    counted === 0 ? 0 : Math.round((histogram.reduce((sum, row) => sum + row.rating * row.reviews, 0) / counted) * 10) / 10;

  return {
    total,
    offset: query.offset,
    limit: query.limit,
    /** Across the filter, not the page. */
    summary: { reviews: total, average, histogram },
    data: rows.map(row => {
      const item = itemOf.get(row.itemId);
      const member = memberOf.get(row.userId);
      return {
        id: row._id,
        item: {
          id: row.itemId,
          title: item?.title ?? row.itemId,
          emoji: item?.emoji ?? null,
          active: item?.active ?? false,
          rating: { average: item?.ratingAverage ?? 0, count: item?.ratingCount ?? 0 },
        },
        member: { id: row.userId, name: member?.name ?? '', email: member?.email ?? null },
        /** The first name the review is signed with — never the account. */
        authorName: row.authorName,
        rating: row.rating,
        title: row.title ?? null,
        body: row.body,
        /** They had bought it when they wrote this. Set once, never revisited. */
        verified: row.verified ?? false,
        /** They hold an order for it now — which a refund can change. */
        stillHoldsAnOrder: holds.has(`${row.userId}:${row.itemId}`),
        createdAt: iso((row as { createdAt?: Date }).createdAt),
        updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
      };
    }),
    nextCursor: null,
  };
}

export const deleteReviewBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/**
 * Takes a review down, and recounts the item it was on.
 *
 * The member can write another one — the unique index is on the pair, not on
 * the history — so this is a removal rather than a ban. The reason is
 * required: taking down somebody's words is the kind of thing that gets
 * asked about later.
 */
export async function deleteReview(actor: string, reviewId: string, reason: string) {
  const before = await ReviewModel.findById(reviewId).lean();
  if (!before) throw Errors.notFound('That review');

  await ReviewModel.deleteOne({ _id: reviewId });
  await recomputeItemRating(before.itemId);

  const item = await ShopItemModel.findById(before.itemId, { ratingAverage: 1, ratingCount: 1 }).lean();
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'shop.review_deleted',
    subjectType: 'review',
    subjectId: reviewId,
    before: { itemId: before.itemId, userId: before.userId, rating: before.rating, title: before.title ?? null, body: before.body },
    after: { deleted: true, reason, rating: { average: item?.ratingAverage ?? 0, count: item?.ratingCount ?? 0 } },
  });

  return {
    deleted: true,
    id: reviewId,
    itemId: before.itemId,
    /** The item's figures after the recount, so the panel can show the effect. */
    rating: { average: item?.ratingAverage ?? 0, count: item?.ratingCount ?? 0 },
  };
}
