import { z } from 'zod';
import { DIET_TYPES, MEAL_PLANS, MEAL_SLOTS } from './models.js';

/**
 * What the admin surface accepts, in one place.
 *
 * The HTTP routes and the operator script both validate against these: a plan
 * typed into a JSON file and a plan POSTed over the wire have to be the same
 * plan, or the file would be a second, looser way in.
 */

const grams = z.number().min(0).max(1000);

export const adminPlannedItem = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.string().trim().max(80).default(''),
});

export const adminPlannedMeal = z.object({
  slot: z.enum(MEAL_SLOTS),
  /** 24-hour `HH:mm`, in the member's own local time. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm.'),
  calories: z.number().min(0).max(5000),
  proteinG: grams.default(0),
  carbsG: grams.default(0),
  fatsG: grams.default(0),
  items: z.array(adminPlannedItem).max(20).default([]),
});

export const adminPlanDay = z.object({
  label: z.string().trim().max(80).optional(),
  meals: z.array(adminPlannedMeal).min(1).max(8),
});

export const adminPlanBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional(),
  emoji: z.string().max(8).optional(),
  dietTypes: z.array(z.enum(DIET_TYPES)).min(1),
  mealPlans: z.array(z.enum(MEAL_PLANS)).min(1),
  days: z.array(adminPlanDay).min(1).max(31),
  sort: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});
export type AdminPlanBody = z.infer<typeof adminPlanBody>;

/** A plan in a file may name its own id, so an import can be re-run. */
export const adminPlanFileEntry = adminPlanBody.extend({
  id: z.string().trim().min(1).max(64).optional(),
});
export type AdminPlanFileEntry = z.infer<typeof adminPlanFileEntry>;

export const adminFoodBody = z.object({
  name: z.string().trim().min(1).max(120),
  portion: z.string().trim().min(1).max(80),
  emoji: z.string().max(8).optional(),
  calories: z.number().min(0).max(5000),
  proteinG: grams.optional(),
  carbsG: grams.optional(),
  fatsG: grams.optional(),
  fiberG: grams.optional(),
  /** One of the add-meal screen's shortcut tiles. */
  quickAdd: z.boolean().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});
