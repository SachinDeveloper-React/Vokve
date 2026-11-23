import { z } from 'zod';
import { getConfig, invalidateConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { UserModel } from '../identity/models.js';
import { forgetMaintenanceBypass } from '../platform/maintenance.js';
import { AppConfigModel, AuditLogModel } from '../platform/models.js';
import { StaffModel } from '../staff/models.js';

/**
 * The panel's Maintenance page (RULES DV14): the switch, the words members
 * see while it is on, and the testers who carry on through it.
 *
 * It writes ⚙ `app.maintenance` like the Releases page writes the update
 * wall — straight into `app_config`, then the cache dropped — so the switch
 * is live on this instance at once and on every other within the config's
 * 30-second cache.
 */

export const maintenanceBody = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().trim().min(1).max(80).optional(),
    message: z.string().trim().min(1).max(400).optional(),
    /** When the team expects to be back; null takes it off the screen. */
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine(body => Object.keys(body).length > 0, 'Change something');
export type MaintenanceBody = z.infer<typeof maintenanceBody>;

export const testerBody = z
  .object({
    /** An email, a phone number or a member id — whatever the person asking gave. */
    identifier: z.string().trim().min(3).max(200),
  })
  .strict();

type Tester = { id: string; name: string; email: string | null; phone: string | null; emailVerified: boolean };

function toTester(row: { _id: string; name?: string; email?: string; phone?: string | null; emailVerifiedAt?: Date | null }): Tester {
  return {
    id: row._id,
    name: row.name ?? '',
    email: row.email ?? null,
    phone: row.phone ?? null,
    emailVerified: Boolean(row.emailVerifiedAt),
  };
}

/** The switch as it stands, the testers, and how many panel accounts may also get in. */
export async function getMaintenance() {
  const [config, testers, staff] = await Promise.all([
    getConfig(),
    UserModel.find({ 'flags.tester': true, deletedAt: null }, { name: 1, email: 1, phone: 1, emailVerifiedAt: 1 })
      .sort({ name: 1 })
      .limit(500)
      .lean(),
    StaffModel.countDocuments({ status: 'active' }),
  ]);
  const { maintenance } = config.app;
  return {
    maintenance: {
      enabled: maintenance.enabled,
      title: maintenance.title,
      message: maintenance.message,
      endsAt: maintenance.endsAt,
      startedAt: maintenance.startedAt,
      startedBy: maintenance.startedBy,
    },
    testers: testers.map(row => toTester(row as Parameters<typeof toTester>[0])),
    /** Active panel accounts: each may use the app too, signed in with the same email, once verified there. */
    staffAccounts: staff,
  };
}

/** The one line the panel's header reads on every page: is it on, and since when. */
export async function maintenanceFlag() {
  const { maintenance } = (await getConfig()).app;
  return { enabled: maintenance.enabled, startedAt: maintenance.startedAt, endsAt: maintenance.endsAt };
}

/**
 * Switches maintenance on or off, and rewords it.
 *
 * Going on stamps when and by whom, so the page and the log can say how long
 * members have been kept out; going off clears both. The expected end is
 * refused in the past when it is being set — a member told "back by 3pm" at
 * 4pm is worse off than one told nothing.
 */
export async function setMaintenance(actor: string, body: MaintenanceBody) {
  const before = (await getConfig()).app.maintenance;
  if (body.endsAt && Date.parse(body.endsAt) <= Date.now()) {
    throw Errors.validation({ endsAt: 'That time has already passed. Leave it empty if there is no time to promise.' });
  }

  const set: Record<string, unknown> = {};
  for (const key of ['title', 'message', 'endsAt'] as const) {
    if (body[key] !== undefined) set[`value.maintenance.${key}`] = body[key];
  }
  if (body.enabled !== undefined && body.enabled !== before.enabled) {
    set['value.maintenance.enabled'] = body.enabled;
    set['value.maintenance.startedAt'] = body.enabled ? new Date().toISOString() : null;
    set['value.maintenance.startedBy'] = body.enabled ? actor : null;
    // An expected end belongs to one stretch of maintenance, not the next.
    if (!body.enabled && body.endsAt === undefined) set['value.maintenance.endsAt'] = null;
  }

  await AppConfigModel.updateOne({ _id: 'app' }, { $set: { ...set, updatedBy: actor } }, { upsert: true });
  invalidateConfig();

  const action =
    body.enabled === true && !before.enabled ? 'app.maintenance_on' : body.enabled === false && before.enabled ? 'app.maintenance_off' : 'app.maintenance_updated';
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action, subjectType: 'app_config', subjectId: 'app',
    before: { enabled: before.enabled, title: before.title, message: before.message, endsAt: before.endsAt },
    after: body,
  });

  return getMaintenance();
}

/** Every spelling of a phone number a member might have been stored under. */
function phoneCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  const out = new Set([raw, raw.replace(/[\s-]/g, '')]);
  if (digits) out.add(`+${digits}`);
  if (digits.length === 10) out.add(`+91${digits}`);
  return [...out];
}

/** Marks a member a tester, found by email, phone or id. */
export async function addTester(actor: string, identifier: string) {
  const value = identifier.trim();
  const user = value.includes('@')
    ? await UserModel.findOne({ email: value, deletedAt: null }).collation({ locale: 'en', strength: 2 }).lean()
    : await UserModel.findOne({ $or: [{ _id: value }, { phone: { $in: phoneCandidates(value) } }], deletedAt: null }).lean();
  if (!user) {
    throw Errors.notFound('A member with that email, phone or id');
  }
  if (!user.flags?.tester) {
    await UserModel.updateOne({ _id: user._id }, { $set: { 'flags.tester': true } });
    forgetMaintenanceBypass(user._id);
    await AuditLogModel.create({
      actorType: 'admin', actorId: actor, action: 'member.tester_added', subjectType: 'user', subjectId: user._id,
      before: { tester: false }, after: { tester: true },
    });
  }
  return { tester: toTester(user as Parameters<typeof toTester>[0]), ...(await getMaintenance()) };
}

export async function removeTester(actor: string, userId: string) {
  const user = await UserModel.findById(userId, { flags: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  if (user.flags?.tester) {
    await UserModel.updateOne({ _id: userId }, { $set: { 'flags.tester': false } });
    forgetMaintenanceBypass(userId);
    await AuditLogModel.create({
      actorType: 'admin', actorId: actor, action: 'member.tester_removed', subjectType: 'user', subjectId: userId,
      before: { tester: true }, after: { tester: false },
    });
  }
  return getMaintenance();
}
