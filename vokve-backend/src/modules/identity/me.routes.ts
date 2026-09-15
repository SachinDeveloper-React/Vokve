import { Router } from 'express';
import { z } from 'zod';
import { activityLevelSchema, fitnessGoalSchema, genderSchema, unitSystemSchema } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { validate } from '../../middleware/validate.js';
import { AuditLogModel } from '../platform/models.js';
import { NotificationPreferencesModel, UserModel, UserSettingsModel } from './models.js';
import { toUser } from './serialize.js';

export const meRouter = Router();
meRouter.use('/me', requireAuth, requireDevice);

meRouter.get('/me', async (req, res) => {
  const user = await UserModel.findById(req.ctx.userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();
  res.json(toUser(user));
});

/** Whitelisted patch — `profileCompletedAt`, verification stamps and trust are server-only (RULES P1). */
const patchMeBody = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  heightCm: z.number().min(90).max(250).nullable().optional(),
  weightKg: z.number().min(25).max(300).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gender: genderSchema.nullable().optional(),
  goal: fitnessGoalSchema.optional(),
  activityLevel: activityLevelSchema.optional(),
  units: unitSystemSchema.optional(),
  weeklyGoalWorkouts: z.number().int().min(1).max(14).optional(),
}).strict();

meRouter.patch('/me', validate('body', patchMeBody), async (req, res) => {
  const before = await UserModel.findById(req.ctx.userId).lean();
  if (!before) throw Errors.unauthorized();
  const user = await UserModel.findByIdAndUpdate(req.ctx.userId, { $set: req.body }, { new: true });
  await AuditLogModel.create({ actorType: 'user', actorId: req.ctx.userId, deviceId: req.ctx.deviceId, appVersion: req.ctx.appVersion,
    action: 'user.patch', subjectType: 'user', subjectId: req.ctx.userId, before: pick(before, Object.keys(req.body)), after: req.body });
  res.json(toUser(user!));
});

const completeProfileBody = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(60),
  heightCm: z.number().min(90, 'Check your height').max(250, 'Check your height'),
  weightKg: z.number().min(25, 'Check your weight').max(300, 'Check your weight'),
  units: unitSystemSchema,
});

/** The only endpoint that stamps `profileCompletedAt` (RULES P1). Idempotent: a second call updates fields, keeps the stamp. */
meRouter.post('/me/complete-profile', validate('body', completeProfileBody), async (req, res) => {
  const user = await UserModel.findById(req.ctx.userId);
  if (!user) throw Errors.unauthorized();
  user.name = req.body.name;
  user.heightCm = Math.round(req.body.heightCm * 10) / 10;
  user.weightKg = Math.round(req.body.weightKg * 10) / 10;
  user.units = req.body.units;
  if (!user.profileCompletedAt) user.profileCompletedAt = new Date();
  await user.save();
  await UserSettingsModel.updateOne({ _id: user._id }, { $set: { units: req.body.units } }, { upsert: true });
  res.json(toUser(user));
});

// ─── Settings (mirror of settingsStore, with its clamps — RULES P3) ────────

const settingsBody = z.object({
  units: unitSystemSchema.optional(),
  dailyStepGoal: z.number().int().min(1000).max(50000).optional(),
  dailyWaterGoalMl: z.number().int().min(500).max(8000).optional(),
  restTimerSeconds: z.number().int().min(15).max(600).optional(),
  hapticsEnabled: z.boolean().optional(),
  workoutRemindersEnabled: z.boolean().optional(),
  keepAwakeDuringWorkout: z.boolean().optional(),
}).strict();

const settingsOut = (s: Record<string, any>) => ({
  units: s.units, dailyStepGoal: s.dailyStepGoal, dailyWaterGoalMl: s.dailyWaterGoalMl, restTimerSeconds: s.restTimerSeconds,
  hapticsEnabled: s.hapticsEnabled, workoutRemindersEnabled: s.workoutRemindersEnabled, keepAwakeDuringWorkout: s.keepAwakeDuringWorkout,
});

meRouter.get('/me/settings', async (req, res) => {
  const s = await UserSettingsModel.findOneAndUpdate({ _id: req.ctx.userId }, { $setOnInsert: { _id: req.ctx.userId } }, { upsert: true, new: true }).lean();
  res.json(settingsOut(s!));
});

meRouter.put('/me/settings', validate('body', settingsBody), async (req, res) => {
  const s = await UserSettingsModel.findOneAndUpdate({ _id: req.ctx.userId }, { $set: req.body }, { upsert: true, new: true }).lean();
  if (req.body.units) await UserModel.updateOne({ _id: req.ctx.userId }, { $set: { units: req.body.units } });
  res.json(settingsOut(s!));
});

// ─── Notification preferences (mirror of notificationSettingsStore) ────────

const timeHHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const prefsBody = z.object({
  categories: z.object({
    activity: z.boolean(), coins: z.boolean(), challenges: z.boolean(), orders: z.boolean(),
    offers: z.boolean(), announcements: z.boolean(), referrals: z.boolean(), health: z.boolean(),
  }).partial().optional(),
  quietHours: z.object({ enabled: z.boolean(), start: timeHHmm, end: timeHHmm }).partial().optional(),
  sms: z.boolean().optional(),
  email: z.boolean().optional(),
}).strict();

const prefsOut = (p: Record<string, any>) => ({ categories: p.categories, quietHours: p.quietHours, sms: p.sms, email: p.email });

meRouter.get('/me/notification-preferences', async (req, res) => {
  const p = await NotificationPreferencesModel.findOneAndUpdate({ _id: req.ctx.userId }, { $setOnInsert: { _id: req.ctx.userId } }, { upsert: true, new: true }).lean();
  res.json(prefsOut(p!));
});

meRouter.put('/me/notification-preferences', validate('body', prefsBody), async (req, res) => {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.body.categories ?? {})) set[`categories.${k}`] = v;
  for (const [k, v] of Object.entries(req.body.quietHours ?? {})) set[`quietHours.${k}`] = v;
  if (req.body.sms !== undefined) set.sms = req.body.sms;
  if (req.body.email !== undefined) set.email = req.body.email;
  const p = await NotificationPreferencesModel.findOneAndUpdate({ _id: req.ctx.userId }, { $set: set }, { upsert: true, new: true }).lean();
  res.json(prefsOut(p!));
});

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map(k => [k, obj[k]]));
}
