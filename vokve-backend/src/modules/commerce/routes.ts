import { Router } from 'express';
import { z } from 'zod';
import { paymentMethodSchema, purchaseLineSchema, shopCategorySchema, shopSortSchema } from '../../contracts/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { requireVerifiedContacts } from '../../middleware/verified.js';
import {
  addToWishlist, addressBody, cancelOrder, checkout, clearCart, countOrders, createAddress, deleteAddress, deleteReview, getCart, getItem, getOrder,
  applyCoupon, deliveryPreferencesBody, getDeliveryPreferences, listAddresses, listCategories, listItems, listOrders, listReviews, listWishlist, payOrder, quote, removeCartLine, removeCoupon,
  removeFromWishlist, reviewBody, setCartLine, setDefaultAddress, setDeliveryPreferences, shopConfig, updateAddress, upsertReview, wishlistIds,
} from './service.js';

export const commerceRouter = Router();
commerceRouter.use(['/shop', '/cart', '/wishlist', '/checkout', '/orders', '/me/addresses', '/me/delivery-preferences'], requireAuth, requireDevice);

// ─── Catalogue ─────────────────────────────────────────────────────────────

const flag = z.enum(['true', 'false']).optional();
const itemsQuery = z.object({
  category: shopCategorySchema.optional(),
  subcategory: z.string().trim().max(40).optional(),
  deals: flag,
  featured: flag,
  inStock: flag,
  q: z.string().trim().max(60).optional(),
  sort: shopSortSchema.optional(),
  /** Paise, inclusive. */
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().positive().optional(),
  /** 1–5: items rated at least this. */
  minRating: z.coerce.number().min(1).max(5).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * One endpoint for the shelf, a category page, the deals page and search:
 * the same list, differently narrowed and ordered, so a screen that mixes
 * them — search within a category, under a price, sorted by rating — needs
 * no second call.
 */
commerceRouter.get('/shop/items', validate('query', itemsQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof itemsQuery>;
  res.json(await listItems({
    category: q.category, subcategory: q.subcategory, deals: q.deals === 'true', featured: q.featured === 'true',
    inStock: q.inStock === 'true', q: q.q, sort: q.sort, minPrice: q.minPrice, maxPrice: q.maxPrice, minRating: q.minRating,
    cursor: q.cursor, limit: q.limit,
  }));
});

commerceRouter.get('/shop/categories', async (_req, res) => {
  res.json({ data: await listCategories(), nextCursor: null });
});

/** The till's rules (RULES R11–R13), so the app draws a price split the way the server will charge it. */
commerceRouter.get('/shop/config', async (_req, res) => {
  res.json(await shopConfig());
});

commerceRouter.get('/shop/items/:id', async (req, res) => {
  res.json(await getItem(req.params.id as string));
});

// ─── Reviews ───────────────────────────────────────────────────────────────

const reviewsQuery = z.object({
  sort: z.enum(['recent', 'top']).default('recent'),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

commerceRouter.get('/shop/items/:id/reviews', validate('query', reviewsQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof reviewsQuery>;
  res.json(await listReviews(req.params.id as string, req.ctx.userId!, q.sort, q.cursor, q.limit));
});

/** Create or replace the reader's own review — one per item (RULES R15). Rate-limited: a review is not a chat. */
commerceRouter.put('/shop/items/:id/reviews/me', rateLimit({ name: 'review-write-user', max: 10, windowSeconds: 3600, by: 'user' }), validate('body', reviewBody), async (req, res) => {
  res.json(await upsertReview(req.ctx.userId!, req.params.id as string, req.body));
});

commerceRouter.delete('/shop/items/:id/reviews/me', async (req, res) => {
  await deleteReview(req.ctx.userId!, req.params.id as string);
  res.json({ ok: true });
});

// ─── Wishlist ──────────────────────────────────────────────────────────────

commerceRouter.get('/wishlist', async (req, res) => {
  res.json({ data: await listWishlist(req.ctx.userId!), nextCursor: null });
});

/** Just the ids, for marking hearts on any list without fetching the items again. */
commerceRouter.get('/wishlist/ids', async (req, res) => {
  res.json({ data: await wishlistIds(req.ctx.userId!), nextCursor: null });
});

commerceRouter.put('/wishlist/:itemId', async (req, res) => {
  await addToWishlist(req.ctx.userId!, req.params.itemId as string);
  res.json({ ok: true });
});

commerceRouter.delete('/wishlist/:itemId', async (req, res) => {
  await removeFromWishlist(req.ctx.userId!, req.params.itemId as string);
  res.json({ ok: true });
});

// ─── Cart ──────────────────────────────────────────────────────────────────

const cartLineBody = z.object({
  itemId: z.string().min(1),
  /** Zero removes the line. */
  quantity: z.number().int().min(0).max(10),
  size: z.string().max(12).nullable().optional(),
  color: z.string().max(24).nullable().optional(),
}).strict();

const cartLineQuery = z.object({ size: z.string().max(12).optional(), color: z.string().max(24).optional() });

commerceRouter.get('/cart', async (req, res) => {
  res.json(await getCart(req.ctx.userId!));
});

/** Sets a line's quantity — add, change, or remove at zero — and answers with the whole basket. */
commerceRouter.put('/cart/lines', validate('body', cartLineBody), async (req, res) => {
  const body = req.body as z.infer<typeof cartLineBody>;
  res.json(await setCartLine(req.ctx.userId!, { itemId: body.itemId, quantity: body.quantity, size: body.size ?? null, color: body.color ?? null }));
});

commerceRouter.delete('/cart/lines/:itemId', validate('query', cartLineQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof cartLineQuery>;
  res.json(await removeCartLine(req.ctx.userId!, req.params.itemId as string, q.size ?? null, q.color ?? null));
});

commerceRouter.delete('/cart', async (req, res) => {
  res.json(await clearCart(req.ctx.userId!));
});

const couponBody = z.object({ code: z.string().trim().min(1).max(24) }).strict();

/**
 * Puts a coupon on the basket (RULES R16); a code that does not apply is
 * refused with why. Rate-limited per member, so codes cannot be guessed by
 * trying them all.
 */
commerceRouter.put('/cart/coupon', rateLimit({ name: 'coupon-apply-user', max: 20, windowSeconds: 3600, by: 'user' }), validate('body', couponBody), async (req, res) => {
  res.json(await applyCoupon(req.ctx.userId!, (req.body as z.infer<typeof couponBody>).code));
});

commerceRouter.delete('/cart/coupon', async (req, res) => {
  res.json(await removeCoupon(req.ctx.userId!));
});

// ─── Checkout ──────────────────────────────────────────────────────────────

const coinsField = z.union([z.number().int().nonnegative(), z.literal('max')]);

const couponField = z.string().trim().min(1).max(24);

const quoteBody = z.object({
  lines: z.array(purchaseLineSchema).min(1).max(20),
  coins: coinsField.default('max'),
  /** Quoted with its `problem` when it does not apply, rather than refused. */
  couponCode: couponField.nullable().optional(),
}).strict();

/** The till's arithmetic for some lines, with nothing placed — what "Buy now" shows first. */
commerceRouter.post('/checkout/quote', validate('body', quoteBody), async (req, res) => {
  const body = req.body as z.infer<typeof quoteBody>;
  res.json(await quote(req.ctx.userId!, body.lines, body.coins, body.couponCode ?? null));
});

const checkoutBody = z.object({
  lines: z.array(purchaseLineSchema).min(1).max(20).optional(),
  fromCart: z.boolean().optional(),
  addressId: z.string().min(1),
  coins: z.number().int().nonnegative().default(0),
  /** The coupon the quote showed applying (RULES R16); refused if it no longer does. */
  couponCode: couponField.optional(),
  /** How it should be handed over (RULES R17); the saved preferences fill what is left out. */
  delivery: deliveryPreferencesBody.optional(),
  /** How the member chose to pay on the payment page (RULES R12). */
  paymentMethod: paymentMethodSchema.optional(),
  /** The step-up proof, when the coins ask for one (RULES O8). */
  stepUpToken: z.string().optional(),
}).strict().refine(b => Boolean(b.fromCart) !== Boolean(b.lines?.length), { message: 'Send either lines or fromCart.' });

/**
 * Both contacts proven first (RULES O5), then the idempotency replay, then
 * the transaction. The middleware order is the gate order: a user who has
 * not verified is told so before anything is held or stored.
 */
commerceRouter.post('/checkout', requireVerifiedContacts, validate('body', checkoutBody), idempotent, async (req, res) => {
  const body = req.body as z.infer<typeof checkoutBody>;
  res.json(await checkout({
    userId: req.ctx.userId!, lines: body.lines, fromCart: body.fromCart, addressId: body.addressId, coins: body.coins, couponCode: body.couponCode,
    delivery: body.delivery, paymentMethod: body.paymentMethod, stepUpToken: body.stepUpToken,
    idempotencyKey: req.ctx.idempotencyKey, trustTier: req.ctx.trustTier, deviceId: req.ctx.deviceId, appVersion: req.ctx.appVersion,
  }));
});

// ─── Orders ────────────────────────────────────────────────────────────────

const ordersQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

commerceRouter.get('/orders', validate('query', ordersQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof ordersQuery>;
  res.json(await listOrders(req.ctx.userId!, q.cursor, q.limit));
});

/** The shop's header figure (RULES R7): orders, not purchase rows. */
commerceRouter.get('/orders/count', async (req, res) => {
  res.json({ count: await countOrders(req.ctx.userId!) });
});

commerceRouter.get('/orders/:id', async (req, res) => {
  res.json(await getOrder(req.ctx.userId!, req.params.id as string));
});

const payBody = z.object({
  providerPaymentId: z.string().min(1).max(120),
  signature: z.string().max(200).optional(),
}).strict();

/** The app's proof from the gateway (RULES R12). Idempotent on the order: paid once, paid. */
commerceRouter.post('/orders/:id/pay', validate('body', payBody), idempotent, async (req, res) => {
  res.json(await payOrder(req.ctx.userId!, req.params.id as string, req.body));
});

commerceRouter.post('/orders/:id/cancel', idempotent, async (req, res) => {
  res.json(await cancelOrder(req.ctx.userId!, req.params.id as string, req.ctx.deviceId));
});

// ─── Addresses ─────────────────────────────────────────────────────────────

commerceRouter.get('/me/addresses', async (req, res) => {
  res.json({ data: await listAddresses(req.ctx.userId!), nextCursor: null });
});

commerceRouter.post('/me/addresses', validate('body', addressBody), async (req, res) => {
  res.status(201).json(await createAddress(req.ctx.userId!, req.body));
});

commerceRouter.put('/me/addresses/:id', validate('body', addressBody.partial()), async (req, res) => {
  res.json(await updateAddress(req.ctx.userId!, req.params.id as string, req.body));
});

commerceRouter.post('/me/addresses/:id/default', async (req, res) => {
  res.json(await setDefaultAddress(req.ctx.userId!, req.params.id as string));
});

commerceRouter.delete('/me/addresses/:id', async (req, res) => {
  await deleteAddress(req.ctx.userId!, req.params.id as string);
  res.json({ ok: true });
});

// ─── Delivery preferences ──────────────────────────────────────────────────

/** What the shipping page opens with (RULES R17). */
commerceRouter.get('/me/delivery-preferences', async (req, res) => {
  res.json(await getDeliveryPreferences(req.ctx.userId!));
});

commerceRouter.put('/me/delivery-preferences', validate('body', deliveryPreferencesBody), async (req, res) => {
  res.json(await setDeliveryPreferences(req.ctx.userId!, req.body));
});
