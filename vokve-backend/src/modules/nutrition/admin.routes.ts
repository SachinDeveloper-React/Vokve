import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import {
  adminCreateFood,
  adminCreateFoods,
  adminCreatePlan,
  adminGetFood,
  adminGetPlan,
  adminListFoods,
  adminListPlans,
  adminRetireFood,
  adminRetirePlan,
  adminUpdateFood,
  adminUpdatePlan,
} from './admin.service.js';
import { adminFoodBody, adminPlanBody } from './admin.schemas.js';

/**
 * The admin HTTP API for the content a member eats by: the food library
 * (RULES N8, N11) and the diet plans (N10).
 *
 * Mounted under `/v1/admin` and gated by the operator's key alone — no member
 * token reaches it, and with no key configured every route here answers 404.
 */
export const adminNutritionRouter = Router();
adminNutritionRouter.use('/admin', requireAdmin);

/** Every plan, retired ones included. */
adminNutritionRouter.get('/admin/diet-plans', async (_req, res) => {
  res.json(await adminListPlans());
});

adminNutritionRouter.post('/admin/diet-plans', validate('body', adminPlanBody), async (req, res) => {
  res.status(201).json(await adminCreatePlan(req.ctx.adminActor!, req.body));
});

adminNutritionRouter.get('/admin/diet-plans/:id', async (req, res) => {
  res.json(await adminGetPlan(String(req.params.id)));
});

/** Changes a plan field by field; `days` replaces the whole programme. */
adminNutritionRouter.put('/admin/diet-plans/:id', validate('body', adminPlanBody.partial()), async (req, res) => {
  res.json(await adminUpdatePlan(req.ctx.adminActor!, String(req.params.id), req.body));
});

/** Retires it: out of the library, and everyone on it falls back to the server's choice. */
adminNutritionRouter.delete('/admin/diet-plans/:id', async (req, res) => {
  res.json(await adminRetirePlan(req.ctx.adminActor!, String(req.params.id)));
});

// ─── The food library (RULES N8, N11) ──────────────────────────────────────

const foodsQuery = z.object({
  q: z.string().max(60).default(''),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** The global library in pages, retired rows included. */
adminNutritionRouter.get('/admin/foods', validate('query', foodsQuery), async (req, res) => {
  res.json(await adminListFoods(req.query as unknown as z.infer<typeof foodsQuery>));
});

/**
 * One food, or a whole list of them in one call — `{ foods: [...] }`, which is
 * how a list typed out at once ("Chapati, Banana, Orange…") goes in without
 * one request per row.
 */
const foodsBody = z.union([
  adminFoodBody,
  z.object({ foods: z.array(adminFoodBody).min(1).max(200) }),
]);

adminNutritionRouter.post('/admin/foods', validate('body', foodsBody), async (req, res) => {
  const body = req.body as z.infer<typeof foodsBody>;
  if ('foods' in body) {
    res.status(201).json(await adminCreateFoods(req.ctx.adminActor!, body.foods));
    return;
  }
  res.status(201).json(await adminCreateFood(req.ctx.adminActor!, body));
});

adminNutritionRouter.get('/admin/foods/:id', async (req, res) => {
  res.json(await adminGetFood(String(req.params.id)));
});

adminNutritionRouter.put('/admin/foods/:id', validate('body', adminFoodBody.partial()), async (req, res) => {
  res.json(await adminUpdateFood(req.ctx.adminActor!, String(req.params.id), req.body));
});

/** Retires it: out of search, the quick-add row and the library. */
adminNutritionRouter.delete('/admin/foods/:id', async (req, res) => {
  res.json(await adminRetireFood(req.ctx.adminActor!, String(req.params.id)));
});
