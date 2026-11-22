import { z } from 'zod';
import { CONFIG_DEFAULTS } from '../../config/defaults.js';
import { assertConfigValid, deepMerge, getConfig, invalidateConfig } from '../../config/remote.js';
import { localDayOf } from '../../lib/dates.js';
import { Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import {
  AUTOMATIONS,
  AUTOMATION_KEYS,
  CAMPAIGN_VARIABLES,
  CATEGORY_ROUTE,
  LINKS,
  linkSchema,
  variablesIn,
  type AutomationKey,
} from '../notifications/automations.catalog.js';
import { NotificationAutomationModel, NotificationCampaignModel } from '../notifications/automations.models.js';
import { loadAutomation, loadAutomations, originStats, previewAutomation } from '../notifications/automations.service.js';
import { notify } from '../notifications/service.js';
import { AppConfigModel, AuditLogModel } from '../platform/models.js';
import { segmentSchema } from './broadcast.service.js';

/**
 * The automated messages, as the operator runs them (RULES M11).
 *
 * Three things are editable and each is checked before it is written: the
 * rules over all of them (⚙ `automations`), each built-in automation's
 * hour, days, knobs and words, and the scheduled messages. Words are
 * refused if they use a `{name}` the message cannot fill — a line that
 * reached a member reading "Hi {fristName}" is the mistake this guards.
 * Every write is on the audit log with the operator and the before/after.
 */

const ZERO = { sent: 0, pushed: 0, read: 0 };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD.');
const weekdays = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Pick at least one day.')
  .max(7)
  .transform(days => [...new Set(days)].sort());

/** `[` and `]` in pairs, never nested — what the renderer can read. */
function bracketsBalanced(text: string): boolean {
  let open = false;
  for (const char of text) {
    if (char === '[') {
      if (open) return false;
      open = true;
    } else if (char === ']') {
      if (!open) return false;
      open = false;
    }
  }
  return !open;
}

function checkWords(text: string, allowed: string[], field: string): string | null {
  if (!bracketsBalanced(text)) return `${field}: the [square brackets] do not pair up.`;
  const unknown = variablesIn(text).filter(name => !allowed.includes(name));
  return unknown.length > 0
    ? `${field}: {${unknown.join('}, {')}} cannot be filled here. It can use ${allowed.map(name => `{${name}}`).join(', ')}.`
    : null;
}

// ─── The list ──────────────────────────────────────────────────────────────

export async function listAutomations(now = new Date()) {
  const config = await getConfig();
  const [automations, campaigns] = await Promise.all([
    loadAutomations(),
    NotificationCampaignModel.find().sort({ createdAt: -1 }).lean(),
  ]);
  const [autoStats, campaignStats] = await Promise.all([
    originStats(automations.map(automation => `auto:${automation.definition.key}`), 7, now),
    originStats(campaigns.map(campaign => `campaign:${campaign._id}`), 30, now),
  ]);
  const today = localDayOf(now, config.locale.timezone);

  return {
    settings: { ...config.automations, defaults: CONFIG_DEFAULTS.automations },
    timezone: config.locale.timezone,
    links: [...LINKS, 'product:<item id>'],
    campaignVariables: CAMPAIGN_VARIABLES,
    categories: Object.keys(CATEGORY_ROUTE),
    automations: automations.map(automation => {
      const { definition } = automation;
      return {
        key: definition.key,
        label: definition.label,
        trigger: definition.trigger,
        category: definition.category,
        topic: definition.topic,
        preference: definition.preference,
        timing: definition.timing,
        dropInQuietHours: definition.dropInQuietHours,
        exemptFromCap: definition.exemptFromCap,
        slots: definition.slots,
        enabled: automation.enabled,
        hour: automation.hour,
        weekdays: automation.weekdays,
        params: automation.params,
        paramsDefaults: definition.defaults.params,
        templates: automation.templates,
        customised: automation.customised,
        updatedAt: automation.updatedAt?.toISOString() ?? null,
        updatedBy: automation.updatedBy,
        last7Days: autoStats.get(`auto:${definition.key}`) ?? ZERO,
      };
    }),
    campaigns: campaigns.map(campaign => {
      const finished =
        (campaign.schedule?.kind === 'once' && (campaign.schedule.date ?? '') < today) ||
        (campaign.endsOn != null && campaign.endsOn < today);
      return {
        id: campaign._id,
        name: campaign.name,
        category: campaign.category,
        title: campaign.title,
        message: campaign.message,
        link: campaign.link ?? null,
        segment: campaign.segment ?? {},
        schedule: {
          kind: campaign.schedule?.kind,
          date: campaign.schedule?.date ?? null,
          weekdays: campaign.schedule?.weekdays ?? [],
          hour: campaign.schedule?.hour,
        },
        startsOn: campaign.startsOn ?? null,
        endsOn: campaign.endsOn ?? null,
        enabled: campaign.enabled,
        state: !campaign.enabled ? 'off' : finished ? 'finished' : 'scheduled',
        lastRunAt: campaign.lastRunAt?.toISOString() ?? null,
        createdBy: campaign.createdBy ?? null,
        updatedAt: (campaign as { updatedAt?: Date }).updatedAt?.toISOString() ?? null,
        last30Days: campaignStats.get(`campaign:${campaign._id}`) ?? ZERO,
      };
    }),
  };
}

// ─── The rules over all of them ────────────────────────────────────────────

export const automationSettingsBody = z
  .object({
    enabled: z.boolean(),
    maxPerDay: z.number().int().min(1).max(10),
    activeWithinDays: z.number().int().min(1).max(365),
    note: z.string().trim().max(300).optional(),
  })
  .partial()
  .strict();

export async function updateAutomationSettings(actor: string, body: z.infer<typeof automationSettingsBody>) {
  const { note, ...patch } = body;
  if (Object.keys(patch).length === 0) throw Errors.validation({ settings: 'Nothing to change.' });
  const current = await getConfig();
  const merged = deepMerge(current, { automations: patch });
  try {
    assertConfigValid(merged);
  } catch (error) {
    throw Errors.validation({ config: error instanceof Error ? error.message : 'That would not be accepted.' });
  }
  await AppConfigModel.updateOne(
    { _id: 'automations' },
    { $set: { ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [`value.${key}`, value])), updatedBy: actor } },
    { upsert: true },
  );
  invalidateConfig();
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'automations.settings',
    subjectType: 'app_config',
    subjectId: 'automations',
    before: current.automations,
    after: { ...merged.automations, note: note ?? null },
  });
  return (await getConfig()).automations;
}

// ─── One automation ────────────────────────────────────────────────────────

const templateBody = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'A line id is lowercase letters, numbers and hyphens.'),
    slot: z.string().trim().min(1).max(20).default('default'),
    title: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(300),
    active: z.boolean().default(true),
  })
  .strict();

export const automationBody = z
  .object({
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    weekdays,
    params: z.record(z.string(), z.unknown()),
    templates: z.array(templateBody).min(1).max(20),
    note: z.string().trim().max(300).optional(),
  })
  .partial()
  .strict();

export function automationKeyOf(raw: string): AutomationKey {
  if (!(AUTOMATION_KEYS as readonly string[]).includes(raw)) throw Errors.notFound('That automation');
  return raw as AutomationKey;
}

export async function updateAutomation(actor: string, key: AutomationKey, body: z.infer<typeof automationBody>) {
  const definition = AUTOMATIONS[key];
  const before = await loadAutomation(key);
  const problems: Record<string, string> = {};

  if (body.hour !== undefined && definition.timing !== 'hour') {
    problems.hour = 'This one goes out as it happens, not at an hour.';
  }

  let params = before.params;
  if (body.params) {
    const parsed = definition.params.safeParse({ ...before.params, ...body.params });
    if (parsed.success) params = parsed.data as Record<string, unknown>;
    else problems.params = parsed.error.issues.map(issue => `${issue.path.join('.') || 'params'}: ${issue.message}`).join(' ');
  }

  let templates = before.templates;
  if (body.templates) {
    const slots = new Map(definition.slots.map(slot => [slot.key, slot]));
    const ids = new Set<string>();
    for (const [index, template] of body.templates.entries()) {
      const slot = slots.get(template.slot);
      if (!slot) {
        problems[`templates.${index}.slot`] = `This automation has no "${template.slot}" message.`;
        continue;
      }
      if (ids.has(template.id)) problems[`templates.${index}.id`] = `${template.id} is used twice.`;
      ids.add(template.id);
      const title = checkWords(template.title, slot.variables, 'Title');
      const message = checkWords(template.message, slot.variables, 'Message');
      if (title) problems[`templates.${index}.title`] = title;
      if (message) problems[`templates.${index}.message`] = message;
    }
    templates = body.templates;
  }

  const enabled = body.enabled ?? before.enabled;
  if (enabled) {
    for (const slot of definition.slots) {
      if (!templates.some(template => template.slot === slot.key && template.active)) {
        problems[`slot.${slot.key}`] = `“${slot.label}” needs at least one live line while this is on.`;
      }
    }
  }
  if (Object.keys(problems).length > 0) throw Errors.validation(problems);

  const next = {
    enabled,
    hour: definition.timing === 'hour' ? body.hour ?? before.hour : null,
    weekdays: body.weekdays ?? before.weekdays,
    params,
    templates,
    updatedBy: actor,
  };
  await NotificationAutomationModel.updateOne({ _id: key }, { $set: next }, { upsert: true });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'automations.update',
    subjectType: 'automation',
    subjectId: key,
    before: { enabled: before.enabled, hour: before.hour, weekdays: before.weekdays, params: before.params, templates: before.templates },
    after: { ...next, note: body.note ?? null },
  });
  return (await listAutomations()).automations.find(automation => automation.key === key)!;
}

/** Puts an automation back on the code's defaults. */
export async function resetAutomation(actor: string, key: AutomationKey) {
  const before = await loadAutomation(key);
  await NotificationAutomationModel.deleteOne({ _id: key });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'automations.reset',
    subjectType: 'automation',
    subjectId: key,
    before: { enabled: before.enabled, hour: before.hour, weekdays: before.weekdays, params: before.params, templates: before.templates },
    after: null,
  });
  return (await listAutomations()).automations.find(automation => automation.key === key)!;
}

export const previewBody = z
  .object({
    userId: z.string().trim().min(1).max(80),
    /** Sends what the preview shows to that one member, now — a test, kept out of the figures and the cap. */
    send: z.boolean().default(false),
  })
  .strict();

export async function tryAutomation(actor: string, key: AutomationKey, body: z.infer<typeof previewBody>) {
  const preview = await previewAutomation(key, body.userId);
  if (!preview) throw Errors.notFound('That member');
  if (!body.send) return { ...preview, sent: null };
  if (!preview.title || !preview.message) throw Errors.validation({ templates: 'There is no live line to send.' });
  const result = await notify({
    userId: body.userId,
    topic: preview.topic,
    preference: preview.preference,
    title: preview.title,
    message: preview.message,
    link: preview.link,
    dedupeKey: `test:${key}:${Date.now()}`,
  });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'automations.test',
    subjectType: 'automation',
    subjectId: key,
    before: null,
    after: { userId: body.userId, title: preview.title, message: preview.message, push: result.push },
  });
  return { ...preview, sent: { status: result.status, push: result.push } };
}

// ─── Scheduled messages ────────────────────────────────────────────────────

const scheduleBody = z
  .object({
    kind: z.enum(['once', 'daily', 'weekly']),
    date: isoDate.nullable().optional(),
    weekdays: weekdays.optional(),
    hour: z.number().int().min(0).max(23),
  })
  .strict()
  .superRefine((schedule, ctx) => {
    if (schedule.kind === 'once' && !schedule.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'A one-off needs its date.' });
    if (schedule.kind === 'weekly' && !schedule.weekdays?.length) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Pick the days it goes out on.' });
  });

export const campaignBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    category: z.enum(['motivation', 'information', 'update', 'offer']),
    title: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(500),
    link: linkSchema.nullable().optional(),
    segment: segmentSchema.default({}),
    schedule: scheduleBody,
    startsOn: isoDate.nullable().optional(),
    endsOn: isoDate.nullable().optional(),
    enabled: z.boolean().default(true),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
type CampaignBody = z.infer<typeof campaignBody>;

async function checkCampaign(body: CampaignBody, isNew: boolean): Promise<void> {
  const problems: Record<string, string> = {};
  const title = checkWords(body.title, CAMPAIGN_VARIABLES, 'Title');
  const message = checkWords(body.message, CAMPAIGN_VARIABLES, 'Message');
  if (title) problems.title = title;
  if (message) problems.message = message;
  if (body.startsOn && body.endsOn && body.endsOn < body.startsOn) problems.endsOn = 'It ends before it starts.';
  const today = localDayOf(new Date(), (await getConfig()).locale.timezone);
  if (isNew && body.schedule.kind === 'once' && (body.schedule.date ?? '') < today) {
    problems['schedule.date'] = 'That day has gone.';
  }
  if (Object.keys(problems).length > 0) throw Errors.validation(problems);
}

function campaignFields(body: CampaignBody) {
  return {
    name: body.name,
    category: body.category,
    title: body.title,
    message: body.message,
    link: body.link ?? null,
    segment: body.segment,
    schedule: {
      kind: body.schedule.kind,
      date: body.schedule.kind === 'once' ? body.schedule.date ?? null : null,
      weekdays: body.schedule.kind === 'weekly' ? body.schedule.weekdays ?? [] : undefined,
      hour: body.schedule.hour,
    },
    startsOn: body.startsOn ?? null,
    endsOn: body.endsOn ?? null,
    enabled: body.enabled,
  };
}

export async function createCampaign(actor: string, body: CampaignBody) {
  await checkCampaign(body, true);
  const id = newId('cmp');
  const fields = campaignFields(body);
  await NotificationCampaignModel.create({ _id: id, ...fields, createdBy: actor, updatedBy: actor });
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'campaigns.create', subjectType: 'campaign', subjectId: id,
    before: null, after: { ...fields, note: body.note ?? null },
  });
  return (await listAutomations()).campaigns.find(campaign => campaign.id === id)!;
}

export async function updateCampaign(actor: string, id: string, body: CampaignBody) {
  const before = await NotificationCampaignModel.findById(id).lean();
  if (!before) throw Errors.notFound('That scheduled message');
  await checkCampaign(body, false);
  const fields = campaignFields(body);
  await NotificationCampaignModel.updateOne({ _id: id }, { $set: { ...fields, updatedBy: actor } });
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'campaigns.update', subjectType: 'campaign', subjectId: id,
    before, after: { ...fields, note: body.note ?? null },
  });
  return (await listAutomations()).campaigns.find(campaign => campaign.id === id)!;
}

/**
 * Deletes a scheduled message. What it already sent stays in members'
 * feeds and in the notification log; only the schedule goes.
 */
export async function deleteCampaign(actor: string, id: string, note?: string) {
  const before = await NotificationCampaignModel.findById(id).lean();
  if (!before) throw Errors.notFound('That scheduled message');
  await NotificationCampaignModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'campaigns.delete', subjectType: 'campaign', subjectId: id,
    before, after: { note: note ?? null },
  });
  return { deleted: true, id };
}
