import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { activityQuery, listActivity, type ActivityQuery } from './activity.js';
import {
  changeOwnPassword, changePasswordBody, confirmTotp, listSessions, login, loginBody, loginThrottled, logout, revokeOwnSession, startTotp,
} from './auth.service.js';
import { guardedRouter } from './guard.js';
import {
  catalogue, changeRole, create, createBody, get, list, listQuery, logoutEverywhere, me, reactivate, reassign, reassignBody, remove,
  resetPassword, resetTotp, roleBody, sessionsOf, suspend, suspendBody, update, updateBody,
} from './service.js';

/**
 * Signing in — the one staff route in front of the gate, since it is where
 * sessions come from. Limited per address and per email, beside the
 * account's own lock after five wrong answers.
 */
export const staffPublicRouter = Router();

staffPublicRouter.post(
  '/admin/staff/login',
  rateLimit({ name: 'staff-login-ip-burst', max: 60, windowSeconds: 60, by: 'ip' }),
  validate('body', loginBody),
  async (req, res) => {
    const body = req.body as z.infer<typeof loginBody>;
    if (await loginThrottled(req.ip, body.email)) throw Errors.rateLimited(900);
    res.set('Cache-Control', 'no-store').json(await login(req, body));
  },
);

/** Everything else, behind the gate and a permission each (RULES Z9). */
export const staffRouter = guardedRouter();

const who = (req: Parameters<Parameters<typeof staffRouter.get>[1]>[0]) => req.ctx.staff!;

// ─── One's own account (`@setup` / `@self`) ─────────────────────────────────

staffRouter.get('/admin/staff/me', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await me(who(req)));
});

staffRouter.get('/admin/staff/permissions', async (_req, res) => {
  res.json(catalogue());
});

staffRouter.post('/admin/staff/me/password', validate('body', changePasswordBody), async (req, res) => {
  res.json(await changeOwnPassword(req, who(req), req.body));
});

staffRouter.post('/admin/staff/me/totp/setup', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await startTotp(who(req)));
});

staffRouter.post(
  '/admin/staff/me/totp/confirm',
  validate('body', z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Six digits') }).strict()),
  async (req, res) => {
    res.json(await confirmTotp(req, who(req), req.body.code));
  },
);

staffRouter.post('/admin/staff/logout', async (req, res) => {
  res.json(await logout(req, who(req)));
});

staffRouter.get('/admin/staff/me/sessions', async (req, res) => {
  const me = who(req);
  res.json({ data: me.kind === 'staff' ? await listSessions(me.id, me.sessionId) : [] });
});

staffRouter.delete('/admin/staff/me/sessions/:sessionId', async (req, res) => {
  res.json(await revokeOwnSession(who(req), String(req.params.sessionId)));
});

staffRouter.get('/admin/staff/me/activity', validate('query', activityQuery), async (req, res) => {
  res.json(await listActivity(who(req), req.query as unknown as ActivityQuery, true));
});

// ─── The team ────────────────────────────────────────────────────────────────

// Before `/:staffId`, or "activity" would be read as an id.
staffRouter.get('/admin/staff/activity', validate('query', activityQuery), async (req, res) => {
  res.json(await listActivity(who(req), req.query as unknown as ActivityQuery));
});

staffRouter.get('/admin/staff', validate('query', listQuery), async (req, res) => {
  res.json(await list(who(req), req.query as unknown as z.infer<typeof listQuery>));
});

staffRouter.post('/admin/staff', validate('body', createBody), async (req, res) => {
  res.status(201).set('Cache-Control', 'no-store').json(await create(who(req), req.body));
});

staffRouter.get('/admin/staff/:staffId', async (req, res) => {
  res.json(await get(who(req), String(req.params.staffId)));
});

staffRouter.get('/admin/staff/:staffId/sessions', async (req, res) => {
  res.json(await sessionsOf(who(req), String(req.params.staffId)));
});

staffRouter.put('/admin/staff/:staffId', validate('body', updateBody), async (req, res) => {
  res.json(await update(who(req), String(req.params.staffId), req.body));
});

staffRouter.post('/admin/staff/:staffId/suspend', validate('body', suspendBody), async (req, res) => {
  res.json(await suspend(who(req), String(req.params.staffId), req.body.reason));
});

staffRouter.post('/admin/staff/:staffId/reactivate', async (req, res) => {
  res.json(await reactivate(who(req), String(req.params.staffId)));
});

staffRouter.post('/admin/staff/:staffId/reset-password', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await resetPassword(who(req), String(req.params.staffId)));
});

staffRouter.post('/admin/staff/:staffId/reset-totp', async (req, res) => {
  res.json(await resetTotp(who(req), String(req.params.staffId)));
});

staffRouter.post('/admin/staff/:staffId/logout-all', async (req, res) => {
  res.json(await logoutEverywhere(who(req), String(req.params.staffId)));
});

staffRouter.put('/admin/staff/:staffId/manager', validate('body', reassignBody), async (req, res) => {
  res.json(await reassign(who(req), String(req.params.staffId), req.body.managerId));
});

staffRouter.put('/admin/staff/:staffId/role', validate('body', roleBody), async (req, res) => {
  res.json(await changeRole(who(req), String(req.params.staffId), req.body));
});

staffRouter.delete('/admin/staff/:staffId', async (req, res) => {
  res.json(await remove(who(req), String(req.params.staffId)));
});
