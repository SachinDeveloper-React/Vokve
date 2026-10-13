import { z } from 'zod';
import { getConfig, invalidateConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { compareVersions } from '../../middleware/version.js';
import { AppReleaseModel } from '../devices/models.js';
import { AppConfigModel, AuditLogModel } from '../platform/models.js';

/**
 * The releases, and the line below which a build is refused (RULES DV12).
 *
 * This is the whole operator workflow for an update, and it is deliberately
 * two separate decisions rather than one. Publishing a build to the store
 * and telling the app about it is `POST /admin/releases` — a knock, at
 * most. **Making that update mandatory is raising `app.minVersion`**, which
 * walls off every build below it. Keeping them apart means a routine
 * release cannot accidentally lock anybody out, and a wall is never a side
 * effect of shipping.
 *
 * Both are config and rows, not deploys: an update can be made mandatory,
 * or stop being mandatory, in one call.
 */

const PLATFORMS = ['ios', 'android'] as const;
const version = z.string().regex(/^\d+(\.\d+){0,3}$/, 'A version looks like 1.2.3');

export const releaseBody = z.object({
  platform: z.enum(PLATFORMS),
  version,
  build: z.string().trim().min(1).max(32),
  /**
   * `current` is the one the store is serving — there is only ever one per
   * platform, so naming a new one steps the old one down to `supported`.
   * `deprecated` is what makes the app knock (soft); `blocked` is what walls
   * off one broken build without moving the minimum for everyone.
   */
  status: z.enum(['current', 'supported', 'deprecated', 'blocked']).default('current'),
  /** What is new, in the member's words — the soft prompt shows this. */
  notes: z.string().trim().max(500).optional(),
  minOs: z.string().trim().max(32).optional(),
  releasedAt: z.string().datetime({ offset: true }).optional(),
});
export type ReleaseBody = z.infer<typeof releaseBody>;

export async function listReleases(platform?: 'ios' | 'android') {
  const rows = await AppReleaseModel.find(platform ? { platform } : {})
    .sort({ platform: 1, releasedAt: -1 })
    .lean();
  const config = await getConfig();
  return {
    minVersion: config.app.minVersion,
    storeUrl: config.app.storeUrl,
    nudgeOnNewer: config.app.update.nudgeOnNewer,
    data: rows.map(row => ({
      id: String(row._id),
      platform: row.platform,
      version: row.version,
      build: row.build,
      status: row.status,
      notes: row.notes ?? null,
      minOs: row.minOs ?? null,
      releasedAt: row.releasedAt?.toISOString() ?? null,
      /** Whether the version gate would refuse this build today. */
      refused: compareVersions(row.version, config.app.minVersion[row.platform as 'ios' | 'android']) < 0,
    })),
    nextCursor: null,
  };
}

/**
 * Records a build, idempotent on (platform, version, build) — the same
 * release posted twice updates its status and notes rather than appearing
 * twice. `current` is exclusive per platform.
 */
export async function saveRelease(actor: string, body: ReleaseBody) {
  const releasedAt = body.releasedAt ? new Date(body.releasedAt) : new Date();
  const before = await AppReleaseModel.findOne({ platform: body.platform, version: body.version, build: body.build }).lean();

  if (body.status === 'current') {
    // One current release per platform: the store serves one build.
    await AppReleaseModel.updateMany(
      { platform: body.platform, status: 'current', $nor: [{ version: body.version, build: body.build }] },
      { $set: { status: 'supported' } },
    );
  }

  const saved = await AppReleaseModel.findOneAndUpdate(
    { platform: body.platform, version: body.version, build: body.build },
    {
      $set: {
        status: body.status,
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.minOs !== undefined ? { minOs: body.minOs } : {}),
        releasedAt,
      },
    },
    { upsert: true, new: true },
  ).lean();

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'app.release_saved', subjectType: 'app_release', subjectId: String(saved!._id),
    before: before ? { status: before.status, notes: before.notes ?? null } : null,
    after: { platform: body.platform, version: body.version, build: body.build, status: body.status },
  });

  return {
    id: String(saved!._id),
    platform: saved!.platform,
    version: saved!.version,
    build: saved!.build,
    status: saved!.status,
    notes: saved!.notes ?? null,
    releasedAt: saved!.releasedAt?.toISOString() ?? null,
  };
}

export const updatePolicyBody = z
  .object({
    /** The version below which every build is refused — raising this is what forces the update. */
    minVersion: z.object({ ios: version.optional(), android: version.optional() }).optional(),
    /** Whether a newer `current` release knocks on its own, or only a `deprecated` one does. */
    nudgeOnNewer: z.boolean().optional(),
    remindAfterHours: z.number().int().min(1).max(720).optional(),
    hardTitle: z.string().trim().min(1).max(120).optional(),
    hardMessage: z.string().trim().min(1).max(500).optional(),
    softTitle: z.string().trim().min(1).max(120).optional(),
    softMessage: z.string().trim().min(1).max(500).optional(),
    actionLabel: z.string().trim().min(1).max(40).optional(),
    laterLabel: z.string().trim().min(1).max(40).optional(),
  })
  .refine(body => Object.keys(body).length > 0, 'Change something');
export type UpdatePolicyBody = z.infer<typeof updatePolicyBody>;

/**
 * Raises (or lowers) the wall, and rewords both prompts.
 *
 * A minimum above every known release is refused: that would wall off a
 * member with no build to go to, and an app with nowhere to send them is
 * worse than an old build. The check is against what the store is actually
 * serving — the `current` release — because that is what a member who taps
 * "Update now" will get.
 */
export async function setUpdatePolicy(actor: string, body: UpdatePolicyBody) {
  const config = await getConfig();

  for (const platform of PLATFORMS) {
    const wanted = body.minVersion?.[platform];
    if (!wanted) continue;
    const current = await AppReleaseModel.findOne({ platform, status: 'current' }).lean();
    if (current && compareVersions(wanted, current.version) > 0) {
      throw Errors.conflict(
        'NO_BUILD_TO_UPDATE_TO',
        `The store is serving ${current.version} on ${platform}; a minimum of ${wanted} would leave members with nowhere to go.`,
        { platform, minVersion: wanted, currentRelease: current.version },
      );
    }
  }

  const set: Record<string, unknown> = {};
  for (const platform of PLATFORMS) {
    const wanted = body.minVersion?.[platform];
    if (wanted) set[`value.minVersion.${platform}`] = wanted;
  }
  for (const [key, value] of Object.entries(body)) {
    if (key === 'minVersion' || value === undefined) continue;
    set[`value.update.${key}`] = value;
  }

  await AppConfigModel.updateOne({ _id: 'app' }, { $set: { ...set, updatedBy: actor } }, { upsert: true });
  invalidateConfig();

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'app.update_policy', subjectType: 'app_config', subjectId: 'app',
    before: { minVersion: config.app.minVersion, update: config.app.update },
    after: body,
  });

  const after = await getConfig();
  return { minVersion: after.app.minVersion, update: after.app.update };
}
