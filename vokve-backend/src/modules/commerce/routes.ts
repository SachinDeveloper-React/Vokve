import { Router } from 'express';
import { z } from 'zod';
import { shopCategorySchema } from '../../contracts/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { requireVerifiedContacts } from '../../middleware/verified.js';
import {
  addressBody, cancelOrder, countOrders, createAddress, deleteAddress, getItem, getOrder, listAddresses, listItems,
  listOrders, redeem, setDefaultAddress, updateAddress,
} from './service.js';

export const commerceRouter = Router();
commerceRouter.use(['/shop', '/orders', '/me/addresses'], requireAuth, requireDevice);

// ─── Catalogue ─────────────────────────────────────────────────────────────

const itemsQuery = z.object({
  category: shopCategorySchema.optional(),
  deals: z.enum(['true', 'false']).optional(),
});

commerceRouter.get('/shop/items', validate('query', itemsQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof itemsQuery>;
  res.json({ data: await listItems({ category: q.category, deals: q.deals === 'true' }), nextCursor: null });
});

commerceRouter.get('/shop/items/:id', async (req, res) => {
  res.json(await getItem(req.params.id as string));
});

// ─── Redeem ────────────────────────────────────────────────────────────────

const redeemBody = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(5).default(1),
  addressId: z.string().min(1),
  /** The step-up proof, when the price asks for one (RULES O8). */
  stepUpToken: z.string().optional(),
});

/**
 * Both contacts proven first (RULES O5), then the idempotency replay, then
 * the transaction. The middleware order is the gate order: a user who has
 * not verified is told so before anything is spent or stored.
 */
commerceRouter.post('/shop/redeem', requireVerifiedContacts, validate('body', redeemBody), idempotent, async (req, res) => {
  const body = req.body as z.infer<typeof redeemBody>;
  res.json(await redeem({
    userId: req.ctx.userId!, itemId: body.itemId, quantity: body.quantity, addressId: body.addressId, stepUpToken: body.stepUpToken,
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
