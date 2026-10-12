import { Router } from 'express';
import { z } from 'zod';
import { localDayOf } from '../../lib/dates.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { DIET_TYPES, MEAL_PLANS, MEAL_SLOTS, NUTRITION_GOALS } from './models.js';
import {
  createCustomFood,
  deleteFood,
  getDietPlan,
  getDietPlanDays,
  getDietPlanDetail,
  getNutritionDay,
  getNutritionDays,
  getProfile,
  listDietPlans,
  listFoodLibrary,
  logFoods,
  quickAddFoods,
  searchFoods,
  updateProfile,
} from './service.js';

export const nutritionRouter = Router();
nutritionRouter.use(['/nutrition', '/foods', '/diet-plan', '/diet-plans'], requireAuth, requireDevice);

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const grams = z.number().min(0).max(1000);

nutritionRouter.get('/nutrition/profile', async (req, res) => {
  res.json(await getProfile(req.ctx.userId!));
});

const profileBody = z.object({
  goals: z
    .object({
      calories: z.number().int().min(800).max(6000),
      proteinG: z.number().int().min(0).max(400),
      carbsG: z.number().int().min(0).max(900),
      fatsG: z.number().int().min(0).max(300),
    })
    .partial()
    .optional(),
  preferences: z
    .object({ dietType: z.enum(DIET_TYPES), mealPlan: z.enum(MEAL_PLANS), goal: z.enum(NUTRITION_GOALS) })
    .partial()
    .optional(),
  /** A plan from the library, or null to hand the choice back to the server (RULES N10). */
  selectedPlanId: z.string().trim().min(1).max(64).nullable().optional(),
});

/** Changes the targets or preferences, field by field (RULES N4). */
nutritionRouter.put('/nutrition/profile', idempotent, validate('body', profileBody), async (req, res) => {
  res.json(await updateProfile(req.ctx.userId!, req.body));
});

const dayQuery = z.object({ date: isoDay.optional() });

/** One day's food — today in the caller's zone unless a day is named (BACKEND §6.11). */
nutritionRouter.get('/nutrition/day', validate('query', dayQuery), async (req, res) => {
  const { date } = req.query as z.infer<typeof dayQuery>;
  res.json(await getNutritionDay(req.ctx.userId!, date ?? localDayOf(new Date(), req.ctx.timezone)));
});

const rangeQuery = z.object({ from: isoDay, to: isoDay });

nutritionRouter.get('/nutrition/days', validate('query', rangeQuery), async (req, res) => {
  const { from, to } = req.query as z.infer<typeof rangeQuery>;
  res.json(await getNutritionDays(req.ctx.userId!, from, to));
});

const entriesBody = z.object({
  entries: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        slot: z.enum(MEAL_SLOTS),
        name: z.string().max(120),
        portion: z.string().max(80).optional(),
        calories: z.number().min(0).max(5000),
        proteinG: grams.optional(),
        carbsG: grams.optional(),
        fatsG: grams.optional(),
        fiberG: grams.optional(),
        loggedAt: z.string().datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(100),
});

/** Logs a meal's foods; idempotent per food id (RULES N2, N3). */
nutritionRouter.post('/nutrition/entries', idempotent, validate('body', entriesBody), async (req, res) => {
  res.json(await logFoods(req.ctx.userId!, req.body.entries, req.ctx.timezone));
});

nutritionRouter.delete('/nutrition/entries/:id', idempotent, async (req, res) => {
  res.json(await deleteFood(req.ctx.userId!, String(req.params.id)));
});

const searchQuery = z.object({
  q: z.string().max(60).default(''),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** The library the caller can see, by word prefix (RULES N8). */
nutritionRouter.get('/foods', validate('query', searchQuery), async (req, res) => {
  const { q, limit } = req.query as unknown as z.infer<typeof searchQuery>;
  res.json(await searchFoods(req.ctx.userId!, q, limit));
});

nutritionRouter.get('/foods/quick-add', async (_req, res) => {
  res.json(await quickAddFoods());
});

const libraryQuery = z.object({
  q: z.string().max(60).default(''),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
});

/** A page of the whole library, for browsing it (RULES N8). */
nutritionRouter.get('/foods/library', validate('query', libraryQuery), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof libraryQuery>;
  res.json(await listFoodLibrary(req.ctx.userId!, query));
});

const customFoodBody = z.object({
  name: z.string().max(120),
  portion: z.string().max(80),
  emoji: z.string().max(8).optional(),
  calories: z.number().min(0).max(5000),
  proteinG: grams.optional(),
  carbsG: grams.optional(),
  fatsG: grams.optional(),
  fiberG: grams.optional(),
});

nutritionRouter.post('/foods/custom', idempotent, validate('body', customFoodBody), async (req, res) => {
  res.json(await createCustomFood(req.ctx.userId!, req.body));
});

const planQuery = z.object({ date: isoDay.optional() });

/** The day's plan, chosen from the caller's preferences (RULES N6, N7). */
nutritionRouter.get('/diet-plan', validate('query', planQuery), async (req, res) => {
  const { date } = req.query as z.infer<typeof planQuery>;
  res.json(await getDietPlan(req.ctx.userId!, date ?? localDayOf(new Date(), req.ctx.timezone)));
});

nutritionRouter.get('/diet-plan/days', validate('query', rangeQuery), async (req, res) => {
  const { from, to } = req.query as z.infer<typeof rangeQuery>;
  res.json(await getDietPlanDays(req.ctx.userId!, from, to));
});

/** The plans on offer, the ones that suit the caller first (RULES N10). */
nutritionRouter.get('/diet-plans', async (req, res) => {
  res.json(await listDietPlans(req.ctx.userId!));
});

/** One plan with every day of it, so the member can read it before choosing. */
nutritionRouter.get('/diet-plans/:id', async (req, res) => {
  res.json(await getDietPlanDetail(req.ctx.userId!, String(req.params.id)));
});
