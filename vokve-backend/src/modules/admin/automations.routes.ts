import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { guardedRouter } from '../staff/guard.js';
import {
  automationBody,
  automationKeyOf,
  automationSettingsBody,
  campaignBody,
  createCampaign,
  deleteCampaign,
  listAutomations,
  previewBody,
  resetAutomation,
  tryAutomation,
  updateAutomation,
  updateAutomationSettings,
  updateCampaign,
} from './automations.service.js';

/**
 * The automated messages and the scheduled ones (RULES M11). Reading is
 * `notifications.view`; changing anything that sends on its own is
 * `notifications.automate`, a permission of its own because a wrong hour
 * here messages the whole base every day until somebody notices.
 */
export const adminAutomationsRouter = guardedRouter();

adminAutomationsRouter.get('/admin/automations', async (_req, res) => {
  res.json(await listAutomations());
});

// Before `/:key`, so "settings" is never read as an automation's name.
adminAutomationsRouter.put('/admin/automations/settings', validate('body', automationSettingsBody), async (req, res) => {
  res.json(await updateAutomationSettings(req.ctx.adminActor!, req.body));
});

adminAutomationsRouter.put('/admin/automations/:key', validate('body', automationBody), async (req, res) => {
  res.json(await updateAutomation(req.ctx.adminActor!, automationKeyOf(String(req.params.key)), req.body));
});

adminAutomationsRouter.delete('/admin/automations/:key', async (req, res) => {
  res.json(await resetAutomation(req.ctx.adminActor!, automationKeyOf(String(req.params.key))));
});

/** What it would say to one member now, from their own figures — and, with `send`, sends them that. */
adminAutomationsRouter.post('/admin/automations/:key/preview', validate('body', previewBody), async (req, res) => {
  res.json(await tryAutomation(req.ctx.adminActor!, automationKeyOf(String(req.params.key)), req.body));
});

adminAutomationsRouter.post('/admin/campaigns', validate('body', campaignBody), async (req, res) => {
  res.status(201).json(await createCampaign(req.ctx.adminActor!, req.body));
});

adminAutomationsRouter.put('/admin/campaigns/:id', validate('body', campaignBody), async (req, res) => {
  res.json(await updateCampaign(req.ctx.adminActor!, String(req.params.id), req.body));
});

const deleteBody = z.object({ note: z.string().trim().max(300).optional() }).strict();

adminAutomationsRouter.delete('/admin/campaigns/:id', validate('body', deleteBody), async (req, res) => {
  res.json(await deleteCampaign(req.ctx.adminActor!, String(req.params.id), req.body.note));
});
